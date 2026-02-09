// ========== Sheet Metal Engineering Calculations ==========

export interface SheetMetalDefaults {
  material: string;
  thickness: number;       // mm
  bendRadius: number;      // inner bend radius in mm
  kFactor: number;         // 0.0 to 0.5 (typically 0.3-0.5)
}

export const DEFAULT_SHEET_METAL: SheetMetalDefaults = {
  material: 'Steel',
  thickness: 1.0,
  bendRadius: 1.0,
  kFactor: 0.44,
};

export const MATERIALS = [
  { name: 'Steel', defaultK: 0.44 },
  { name: 'Aluminum', defaultK: 0.33 },
  { name: 'Stainless Steel', defaultK: 0.45 },
  { name: 'Copper', defaultK: 0.35 },
  { name: 'Custom', defaultK: 0.44 },
];

/**
 * Calculate bend allowance using K-Factor method.
 * BA = π × (R + K × T) × (A / 180)
 * 
 * @param radius Inner bend radius (mm)
 * @param kFactor K-Factor (dimensionless, 0-0.5)
 * @param thickness Material thickness (mm)
 * @param angleDeg Bend angle in degrees
 * @returns Bend allowance in mm
 */
export function bendAllowance(
  radius: number,
  kFactor: number,
  thickness: number,
  angleDeg: number
): number {
  return Math.PI * (radius + kFactor * thickness) * (angleDeg / 180);
}

/**
 * Calculate bend deduction (setback minus bend allowance).
 * BD = 2 × (R + T) × tan(A/2) - BA
 */
export function bendDeduction(
  radius: number,
  kFactor: number,
  thickness: number,
  angleDeg: number
): number {
  const ba = bendAllowance(radius, kFactor, thickness, angleDeg);
  const angleRad = (angleDeg * Math.PI) / 180;
  const ossb = (radius + thickness) * Math.tan(angleRad / 2); // outside setback
  return 2 * ossb - ba;
}

/**
 * Calculate the flat length of a bend segment.
 */
export function flatLength(
  flangeLength: number,
  radius: number,
  kFactor: number,
  thickness: number,
  angleDeg: number
): number {
  const ba = bendAllowance(radius, kFactor, thickness, angleDeg);
  return flangeLength - (radius + thickness) * Math.tan((angleDeg * Math.PI / 180) / 2) + ba;
}

// ========== 2D Sketch Types ==========

export interface Point2D {
  x: number;
  y: number;
}

export interface SketchLine {
  id: string;
  type: 'line';
  start: Point2D;
  end: Point2D;
}

export interface SketchRect {
  id: string;
  type: 'rect';
  origin: Point2D;
  width: number;
  height: number;
}

export interface SketchCircle {
  id: string;
  type: 'circle';
  center: Point2D;
  radius: number;
}

export interface SketchArc {
  id: string;
  type: 'arc';
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface SketchPoint {
  id: string;
  type: 'point';
  position: Point2D;
}

export type SketchEntity = SketchLine | SketchRect | SketchCircle | SketchArc | SketchPoint;

/**
 * Snap a point to the nearest grid intersection.
 */
export function snapToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Calculate distance between two 2D points.
 */
export function distance2D(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Calculate midpoint between two 2D points.
 */
export function midpoint2D(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Generate a unique ID for sketch entities.
 */
export function generateId(): string {
  return `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

// ========== Geometry Helpers for Modify Tools ==========

/**
 * Line-line intersection. Returns the intersection point or null if parallel/coincident.
 */
export function lineLineIntersection(
  p1: Point2D, p2: Point2D,
  p3: Point2D, p4: Point2D,
): Point2D | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * Check if a parameter t is within [0,1] (point lies on segment).
 */
function paramOnSegment(
  p: Point2D, segStart: Point2D, segEnd: Point2D,
): boolean {
  const dx = segEnd.x - segStart.x, dy = segEnd.y - segStart.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return distance2D(p, segStart) < 1e-5;
  const t = ((p.x - segStart.x) * dx + (p.y - segStart.y) * dy) / len2;
  return t >= -1e-6 && t <= 1 + 1e-6;
}

/**
 * Find all intersection points of a line segment with other entities.
 */
export function getLineIntersections(
  line: SketchLine, allEntities: SketchEntity[],
): Point2D[] {
  const pts: Point2D[] = [];
  for (const ent of allEntities) {
    if (ent.id === line.id) continue;
    if (ent.type === 'line') {
      const ip = lineLineIntersection(line.start, line.end, ent.start, ent.end);
      if (ip && paramOnSegment(ip, line.start, line.end) && paramOnSegment(ip, ent.start, ent.end)) {
        pts.push(ip);
      }
    } else if (ent.type === 'rect') {
      const corners = [
        { x: ent.origin.x, y: ent.origin.y },
        { x: ent.origin.x + ent.width, y: ent.origin.y },
        { x: ent.origin.x + ent.width, y: ent.origin.y + ent.height },
        { x: ent.origin.x, y: ent.origin.y + ent.height },
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const ip = lineLineIntersection(line.start, line.end, a, b);
        if (ip && paramOnSegment(ip, line.start, line.end) && paramOnSegment(ip, a, b)) {
          pts.push(ip);
        }
      }
    } else if (ent.type === 'circle') {
      const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      const dx = line.end.x - line.start.x, dy = line.end.y - line.start.y;
      const fx = line.start.x - cx, fy = line.start.y - cy;
      const a = dx * dx + dy * dy;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - r * r;
      let disc = b * b - 4 * a * c;
      if (disc >= 0) {
        disc = Math.sqrt(disc);
        for (const sign of [-1, 1]) {
          const t = (-b + sign * disc) / (2 * a);
          if (t >= -1e-6 && t <= 1 + 1e-6) {
            pts.push({ x: line.start.x + t * dx, y: line.start.y + t * dy });
          }
        }
      }
    }
  }
  // Sort by distance from line start
  pts.sort((a, b) => distance2D(line.start, a) - distance2D(line.start, b));
  return pts;
}

/**
 * Trim a line at intersections. Returns the trimmed segment nearest to clickPoint,
 * or null if no intersections found.
 */
export function trimLineAtIntersections(
  line: SketchLine, allEntities: SketchEntity[], clickPoint: Point2D,
): { start: Point2D; end: Point2D } | null {
  const ints = getLineIntersections(line, allEntities);
  if (ints.length === 0) return null;

  // Build segments: [lineStart, ...intersections, lineEnd]
  const points = [line.start, ...ints, line.end];
  // Find which segment the click is closest to
  let bestSegIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const mid = midpoint2D(points[i], points[i + 1]);
    const d = distance2D(mid, clickPoint);
    if (d < bestDist) { bestDist = d; bestSegIdx = i; }
  }
  // Return the segment to REMOVE (the clicked one)
  return { start: points[bestSegIdx], end: points[bestSegIdx + 1] };
}

/**
 * Extend a line to the nearest intersection with another entity.
 * `endpoint` is 'start' or 'end' indicating which end to extend.
 */
export function extendLineToNearest(
  line: SketchLine, endpoint: 'start' | 'end', allEntities: SketchEntity[],
): Point2D | null {
  const from = endpoint === 'start' ? line.start : line.end;
  const dir = endpoint === 'start'
    ? { x: line.start.x - line.end.x, y: line.start.y - line.end.y }
    : { x: line.end.x - line.start.x, y: line.end.y - line.start.y };
  
  // Extend infinitely in the direction
  const farPt: Point2D = { x: from.x + dir.x * 1000, y: from.y + dir.y * 1000 };
  
  let bestPt: Point2D | null = null;
  let bestDist = Infinity;
  
  for (const ent of allEntities) {
    if (ent.id === line.id) continue;
    if (ent.type === 'line') {
      const ip = lineLineIntersection(from, farPt, ent.start, ent.end);
      if (ip && paramOnSegment(ip, ent.start, ent.end)) {
        // Must be in the extension direction (positive t)
        const t = dir.x !== 0 ? (ip.x - from.x) / dir.x : (ip.y - from.y) / dir.y;
        if (t > 1e-6) {
          const d = distance2D(from, ip);
          if (d < bestDist) { bestDist = d; bestPt = ip; }
        }
      }
    } else if (ent.type === 'rect') {
      const corners = [
        { x: ent.origin.x, y: ent.origin.y },
        { x: ent.origin.x + ent.width, y: ent.origin.y },
        { x: ent.origin.x + ent.width, y: ent.origin.y + ent.height },
        { x: ent.origin.x, y: ent.origin.y + ent.height },
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const ip = lineLineIntersection(from, farPt, a, b);
        if (ip && paramOnSegment(ip, a, b)) {
          const t = dir.x !== 0 ? (ip.x - from.x) / dir.x : (ip.y - from.y) / dir.y;
          if (t > 1e-6) {
            const d = distance2D(from, ip);
            if (d < bestDist) { bestDist = d; bestPt = ip; }
          }
        }
      }
    }
  }
  return bestPt;
}

/**
 * Offset a line by a given distance perpendicular to it.
 * `side` > 0 = offset to the left (when looking from start to end), < 0 = right.
 */
export function offsetLine(
  line: SketchLine, dist: number, side: number,
): { start: Point2D; end: Point2D } {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return { start: { ...line.start }, end: { ...line.end } };
  const nx = -dy / len * Math.sign(side) * dist;
  const ny = dx / len * Math.sign(side) * dist;
  return {
    start: { x: line.start.x + nx, y: line.start.y + ny },
    end: { x: line.end.x + nx, y: line.end.y + ny },
  };
}

/**
 * Offset a rectangle by a given distance (expand or shrink).
 */
export function offsetRect(
  rect: SketchRect, dist: number, side: number,
): { origin: Point2D; width: number; height: number } {
  const d = dist * Math.sign(side);
  return {
    origin: { x: rect.origin.x - d, y: rect.origin.y - d },
    width: Math.max(0.1, rect.width + 2 * d),
    height: Math.max(0.1, rect.height + 2 * d),
  };
}

/**
 * Offset a circle by a given distance.
 */
export function offsetCircle(
  circle: SketchCircle, dist: number, side: number,
): { center: Point2D; radius: number } {
  return {
    center: { ...circle.center },
    radius: Math.max(0.1, circle.radius + dist * Math.sign(side)),
  };
}

/**
 * Mirror a point across an axis defined by two points.
 */
export function mirrorPoint(p: Point2D, axisStart: Point2D, axisEnd: Point2D): Point2D {
  const dx = axisEnd.x - axisStart.x;
  const dy = axisEnd.y - axisStart.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return { ...p };
  const t = ((p.x - axisStart.x) * dx + (p.y - axisStart.y) * dy) / len2;
  const projX = axisStart.x + t * dx;
  const projY = axisStart.y + t * dy;
  return { x: 2 * projX - p.x, y: 2 * projY - p.y };
}

/**
 * Mirror an entity across an axis. Returns a new entity with a new ID.
 */
export function mirrorEntity(
  entity: SketchEntity, axisStart: Point2D, axisEnd: Point2D,
): SketchEntity {
  const id = generateId();
  switch (entity.type) {
    case 'line':
      return { id, type: 'line', start: mirrorPoint(entity.start, axisStart, axisEnd), end: mirrorPoint(entity.end, axisStart, axisEnd) };
    case 'rect': {
      const c1 = mirrorPoint(entity.origin, axisStart, axisEnd);
      const c2 = mirrorPoint({ x: entity.origin.x + entity.width, y: entity.origin.y + entity.height }, axisStart, axisEnd);
      return { id, type: 'rect', origin: { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y) }, width: Math.abs(c2.x - c1.x), height: Math.abs(c2.y - c1.y) };
    }
    case 'circle':
      return { id, type: 'circle', center: mirrorPoint(entity.center, axisStart, axisEnd), radius: entity.radius };
    case 'arc':
      return { id, type: 'arc', center: mirrorPoint(entity.center, axisStart, axisEnd), radius: entity.radius, startAngle: -entity.endAngle, endAngle: -entity.startAngle };
    case 'point':
      return { id, type: 'point', position: mirrorPoint(entity.position, axisStart, axisEnd) };
  }
}

/**
 * Create an SVG arc path from center, radius, startAngle, endAngle (in radians).
 */
export function arcSvgPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const sx = cx + r * Math.cos(startAngle);
  const sy = cy + r * Math.sin(startAngle);
  const ex = cx + r * Math.cos(endAngle);
  const ey = cy + r * Math.sin(endAngle);
  let sweep = endAngle - startAngle;
  if (sweep < 0) sweep += 2 * Math.PI;
  const largeArc = sweep > Math.PI ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

/**
 * Find the closest endpoint ('start' or 'end') of a line to a given point.
 */
export function closestEndpoint(line: SketchLine, p: Point2D): 'start' | 'end' {
  return distance2D(p, line.start) < distance2D(p, line.end) ? 'start' : 'end';
}

/**
 * Determine which side of a line a point is on. Returns +1 or -1.
 */
export function pointSideOfLine(p: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const cross = (lineEnd.x - lineStart.x) * (p.y - lineStart.y) - (lineEnd.y - lineStart.y) * (p.x - lineStart.x);
  return cross >= 0 ? 1 : -1;
}
