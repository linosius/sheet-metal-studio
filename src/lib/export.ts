import { FlatPattern, BendLine } from './unfold';
import { Point2D } from './sheetmetal';

// ========== SVG Export ==========

export function exportFlatPatternSVG(pattern: FlatPattern): string {
  const { regions, bendLines, boundingBox } = pattern;
  const margin = 10;
  const vbX = boundingBox.minX - margin;
  const vbY = boundingBox.minY - margin;
  const vbW = (boundingBox.maxX - boundingBox.minX) + margin * 2;
  const vbH = (boundingBox.maxY - boundingBox.minY) + margin * 2;

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}mm" height="${vbH}mm">`);
  lines.push(`  <style>
    .outline { fill: none; stroke: #000; stroke-width: 0.25; }
    .bend { fill: none; stroke: #E00; stroke-width: 0.15; stroke-dasharray: 1,0.8; }
    .label { font-family: monospace; font-size: 2px; fill: #E00; }
  </style>`);

  // Regions
  for (const region of regions) {
    const d = region.polygon.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + ' Z';
    lines.push(`  <path class="outline" d="${d}" />`);
  }

  // Bend lines
  for (let i = 0; i < bendLines.length; i++) {
    const bl = bendLines[i];
    lines.push(`  <line class="bend" x1="${bl.start.x.toFixed(3)}" y1="${bl.start.y.toFixed(3)}" x2="${bl.end.x.toFixed(3)}" y2="${bl.end.y.toFixed(3)}" />`);
    if (i % 2 === 0) {
      const mx = (bl.start.x + bl.end.x) / 2;
      const my = (bl.start.y + bl.end.y) / 2;
      lines.push(`  <text class="label" x="${mx.toFixed(3)}" y="${(my - 1).toFixed(3)}" text-anchor="middle">${bl.label}: ${bl.angle}° R${bl.radius}</text>`);
    }
  }

  lines.push(`</svg>`);
  return lines.join('\n');
}

// ========== DXF Export (R12 ASCII) ==========

export function exportFlatPatternDXF(pattern: FlatPattern): string {
  const lines: string[] = [];

  // Header
  lines.push('0', 'SECTION', '2', 'HEADER', '0', 'ENDSEC');

  // Tables (layers)
  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push('0', 'TABLE', '2', 'LAYER');
  lines.push('0', 'LAYER', '2', 'OUTLINE', '70', '0', '62', '7', '6', 'CONTINUOUS'); // white
  lines.push('0', 'LAYER', '2', 'BEND', '70', '0', '62', '1', '6', 'DASHED');       // red
  lines.push('0', 'ENDTAB');
  lines.push('0', 'ENDSEC');

  // Entities
  lines.push('0', 'SECTION', '2', 'ENTITIES');

  // Outline polylines
  for (const region of pattern.regions) {
    const poly = region.polygon;
    for (let i = 0; i < poly.length; i++) {
      const s = poly[i];
      const e = poly[(i + 1) % poly.length];
      lines.push('0', 'LINE', '8', 'OUTLINE',
        '10', s.x.toFixed(4), '20', s.y.toFixed(4), '30', '0',
        '11', e.x.toFixed(4), '21', e.y.toFixed(4), '31', '0');
    }
  }

  // Bend lines
  for (const bl of pattern.bendLines) {
    lines.push('0', 'LINE', '8', 'BEND',
      '10', bl.start.x.toFixed(4), '20', bl.start.y.toFixed(4), '30', '0',
      '11', bl.end.x.toFixed(4), '21', bl.end.y.toFixed(4), '31', '0');
  }

  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');

  return lines.join('\n');
}

// ========== Bend Table ==========

export interface BendTableRow {
  label: string;
  angle: number;
  radius: number;
  direction: string;
  length: number;
}

export function generateBendTable(bendLines: BendLine[]): BendTableRow[] {
  const rows: BendTableRow[] = [];
  // Bend lines come in pairs (start + end of bend zone); take every other
  for (let i = 0; i < bendLines.length; i += 2) {
    const bl = bendLines[i];
    const len = Math.hypot(bl.end.x - bl.start.x, bl.end.y - bl.start.y);
    rows.push({
      label: bl.label,
      angle: bl.angle,
      radius: bl.radius,
      direction: bl.angle > 0 ? 'Up' : 'Down',
      length: len,
    });
  }
  return rows;
}

// ========== PDF Export (minimal single-page) ==========

export function exportFlatPatternPDF(pattern: FlatPattern, bendTable: BendTableRow[]): Blob {
  // We build a minimal valid PDF with vector graphics
  const { regions, bendLines, boundingBox } = pattern;
  const margin = 30;
  const pageW = 595; // A4 pts
  const pageH = 842;

  // Scale pattern to fit on page (top half)
  const drawAreaW = pageW - margin * 2;
  const drawAreaH = pageH * 0.55;
  const patW = boundingBox.maxX - boundingBox.minX;
  const patH = boundingBox.maxY - boundingBox.minY;
  const scale = Math.min(drawAreaW / (patW || 1), drawAreaH / (patH || 1));
  const offX = margin + (drawAreaW - patW * scale) / 2 - boundingBox.minX * scale;
  const offY = pageH - margin - 20; // PDF y is bottom-up, we flip

  const tx = (p: Point2D) => ({ x: offX + p.x * scale, y: offY - p.y * scale });

  // Build content stream
  const streamLines: string[] = [];

  // Draw regions
  streamLines.push('0 0 0 RG', '0.5 w');
  for (const region of regions) {
    const pts = region.polygon.map(tx);
    streamLines.push(`${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} m`);
    for (let i = 1; i < pts.length; i++) {
      streamLines.push(`${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} l`);
    }
    streamLines.push('s');
  }

  // Draw bend lines (red dashed)
  streamLines.push('1 0 0 RG', '0.3 w', '[2 1] 0 d');
  for (const bl of bendLines) {
    const s = tx(bl.start);
    const e = tx(bl.end);
    streamLines.push(`${s.x.toFixed(2)} ${s.y.toFixed(2)} m ${e.x.toFixed(2)} ${e.y.toFixed(2)} l S`);
  }
  streamLines.push('[] 0 d'); // reset dash

  // Title
  streamLines.push('BT', '/F1 14 Tf', `${margin} ${pageH - margin} Td`, '0 0 0 rg', '(Flat Pattern Export) Tj', 'ET');

  // Bend table (bottom section)
  const tableTop = offY - patH * scale - 40;
  streamLines.push('BT', '/F1 10 Tf', `${margin} ${tableTop} Td`, '(Bend Table) Tj', 'ET');

  const rowH = 14;
  const colX = [margin, margin + 60, margin + 140, margin + 230, margin + 330];
  const headers = ['Bend', 'Angle (°)', 'Radius (mm)', 'Direction', 'Length (mm)'];

  // Headers
  streamLines.push('BT', '/F1 8 Tf');
  headers.forEach((h, ci) => {
    streamLines.push(`${colX[ci]} ${tableTop - rowH} Td (${h}) Tj`);
    if (ci < headers.length - 1) {
      streamLines.push(`${colX[ci + 1] - colX[ci]} 0 Td`);
    }
  });
  // We need absolute positioning per cell
  streamLines.length -= headers.length * 2; // remove relative moves
  streamLines.push('ET');

  // Re-do headers with absolute positions
  for (let ci = 0; ci < headers.length; ci++) {
    streamLines.push('BT', '/F1 8 Tf', `${colX[ci]} ${tableTop - rowH} Td`, `(${headers[ci]}) Tj`, 'ET');
  }

  // Table line
  streamLines.push('0 0 0 RG', '0.3 w');
  streamLines.push(`${margin} ${tableTop - rowH - 2} m ${pageW - margin} ${tableTop - rowH - 2} l S`);

  // Rows
  bendTable.forEach((row, ri) => {
    const y = tableTop - rowH * (ri + 2);
    const vals = [row.label, row.angle.toFixed(1), row.radius.toFixed(2), row.direction, row.length.toFixed(2)];
    for (let ci = 0; ci < vals.length; ci++) {
      streamLines.push('BT', '/F1 7 Tf', `${colX[ci]} ${y} Td`, `(${vals[ci]}) Tj`, 'ET');
    }
  });

  // Dimensions info
  const infoY = tableTop - rowH * (bendTable.length + 3);
  streamLines.push('BT', '/F1 8 Tf', `${margin} ${infoY} Td`,
    `(Overall: ${patW.toFixed(1)} x ${patH.toFixed(1)} mm) Tj`, 'ET');

  const stream = streamLines.join('\n');

  // Build minimal PDF structure
  const objects: string[] = [];
  let objCount = 0;
  const offsets: number[] = [];
  let currentPos = 0;

  const addLine = (s: string) => { objects.push(s); currentPos += s.length + 1; };

  addLine('%PDF-1.4');

  // Obj 1: Catalog
  offsets.push(currentPos);
  addLine('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');

  // Obj 2: Pages
  offsets.push(currentPos);
  addLine('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');

  // Obj 3: Page
  offsets.push(currentPos);
  addLine(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`);

  // Obj 4: Content stream
  offsets.push(currentPos);
  addLine(`4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);

  // Obj 5: Font
  offsets.push(currentPos);
  addLine('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');

  objCount = 5;

  // Cross-reference
  const xrefPos = currentPos;
  addLine('xref');
  addLine(`0 ${objCount + 1}`);
  addLine('0000000000 65535 f ');
  for (const off of offsets) {
    addLine(String(off).padStart(10, '0') + ' 00000 n ');
  }

  addLine('trailer');
  addLine(`<< /Size ${objCount + 1} /Root 1 0 R >>`);
  addLine('startxref');
  addLine(String(xrefPos));
  addLine('%%EOF');

  return new Blob([objects.join('\n')], { type: 'application/pdf' });
}

// ========== Download Helper ==========

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}
