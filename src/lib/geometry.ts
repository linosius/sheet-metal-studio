import * as THREE from 'three';
import { SketchEntity, Point2D } from '@/lib/sheetmetal';

// ========== 3D Part Model Types ==========

export interface PartEdge {
  id: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  faceId: string;
  normal: THREE.Vector3;
  faceNormal: THREE.Vector3;
}

export interface Flange {
  id: string;
  edgeId: string;
  height: number;
  angle: number;
  direction: 'up' | 'down';
  bendRadius: number;
}

export interface SheetMetalPart {
  profile: Point2D[];
  thickness: number;
  edges: PartEdge[];
  flanges: Flange[];
}

// ========== Profile Extraction (2D) ==========

export function extractProfile(entities: SketchEntity[]): Point2D[] | null {
  const rects = entities.filter(e => e.type === 'rect');
  if (rects.length > 0) {
    const rect = rects[0];
    if (rect.type === 'rect') {
      return [
        { x: rect.origin.x, y: rect.origin.y },
        { x: rect.origin.x + rect.width, y: rect.origin.y },
        { x: rect.origin.x + rect.width, y: rect.origin.y + rect.height },
        { x: rect.origin.x, y: rect.origin.y + rect.height },
      ];
    }
  }

  const lines = entities.filter(e => e.type === 'line');
  if (lines.length < 3) return null;

  const tolerance = 1.0;
  const points: Point2D[] = [];
  const used = new Set<string>();

  const firstLine = lines[0];
  if (firstLine.type !== 'line') return null;

  points.push(firstLine.start);
  points.push(firstLine.end);
  used.add(firstLine.id);

  let closed = false;
  let maxIter = lines.length * 2;

  while (!closed && maxIter > 0) {
    maxIter--;
    const lastPoint = points[points.length - 1];
    let found = false;

    for (const line of lines) {
      if (used.has(line.id) || line.type !== 'line') continue;

      const dStart = Math.hypot(line.start.x - lastPoint.x, line.start.y - lastPoint.y);
      const dEnd = Math.hypot(line.end.x - lastPoint.x, line.end.y - lastPoint.y);

      if (dStart < tolerance) {
        const dClose = Math.hypot(line.end.x - points[0].x, line.end.y - points[0].y);
        if (dClose < tolerance && used.size >= 2) {
          closed = true;
        } else {
          points.push(line.end);
        }
        used.add(line.id);
        found = true;
        break;
      } else if (dEnd < tolerance) {
        const dClose = Math.hypot(line.start.x - points[0].x, line.start.y - points[0].y);
        if (dClose < tolerance && used.size >= 2) {
          closed = true;
        } else {
          points.push(line.start);
        }
        used.add(line.id);
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  return closed ? points : null;
}

// ========== Cutout Types ==========

export interface ProfileCutout {
  type: 'circle' | 'rect' | 'polygon';
  center?: Point2D;
  radius?: number;
  origin?: Point2D;
  width?: number;
  height?: number;
  polygon: Point2D[];
}

export function circleToPolygon(center: Point2D, radius: number, segments = 32): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

export function rectToPolygon(origin: Point2D, width: number, height: number): Point2D[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
}

// ========== Fold & Face Sketch Types ==========

export interface Fold {
  id: string;
  lineStart: Point2D;
  lineEnd: Point2D;
  angle: number;
  direction: 'up' | 'down';
  bendRadius: number;
  sketchLineId?: string;
  faceId?: string;
  foldLocation?: 'centerline' | 'material-inside' | 'material-outside';
}

export interface FaceSketchLine {
  id: string;
  type: 'line';
  start: Point2D;
  end: Point2D;
}

export interface FaceSketchCircle {
  id: string;
  type: 'circle';
  center: Point2D;
  radius: number;
}

export interface FaceSketchRect {
  id: string;
  type: 'rect';
  origin: Point2D;
  width: number;
  height: number;
}

export interface FaceSketchPoint {
  id: string;
  type: 'point';
  position: Point2D;
}

export type FaceSketchEntity = FaceSketchLine | FaceSketchCircle | FaceSketchRect | FaceSketchPoint;

export type FaceSketchTool = 'select' | 'line' | 'circle' | 'rect' | 'point' | 'move';

export interface FaceSketch {
  faceId: string;
  entities: FaceSketchEntity[];
}

export interface FlangeTipClipLine {
  lineStart: Point2D;
  lineEnd: Point2D;
  normal: Point2D;
}

// ========== 2D Classification Helpers ==========

function lineFaceBoundaryIntersections(
  p1: Point2D, p2: Point2D, faceWidth: number, faceHeight: number
): { point: Point2D; edge: 'left' | 'right' | 'top' | 'bottom' }[] | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const TOL = 0.5;
  const hits: { point: Point2D; edge: 'left' | 'right' | 'top' | 'bottom'; t: number }[] = [];

  const edges: { edge: 'left' | 'right' | 'top' | 'bottom'; solve: () => { t: number; point: Point2D } | null }[] = [
    { edge: 'left', solve: () => {
      if (Math.abs(dx) < 1e-9) return null;
      const t = (0 - p1.x) / dx;
      const y = p1.y + t * dy;
      return (y >= -TOL && y <= faceHeight + TOL) ? { t, point: { x: 0, y: Math.max(0, Math.min(faceHeight, y)) } } : null;
    }},
    { edge: 'right', solve: () => {
      if (Math.abs(dx) < 1e-9) return null;
      const t = (faceWidth - p1.x) / dx;
      const y = p1.y + t * dy;
      return (y >= -TOL && y <= faceHeight + TOL) ? { t, point: { x: faceWidth, y: Math.max(0, Math.min(faceHeight, y)) } } : null;
    }},
    { edge: 'bottom', solve: () => {
      if (Math.abs(dy) < 1e-9) return null;
      const t = (0 - p1.y) / dy;
      const x = p1.x + t * dx;
      return (x >= -TOL && x <= faceWidth + TOL) ? { t, point: { x: Math.max(0, Math.min(faceWidth, x)), y: 0 } } : null;
    }},
    { edge: 'top', solve: () => {
      if (Math.abs(dy) < 1e-9) return null;
      const t = (faceHeight - p1.y) / dy;
      const x = p1.x + t * dx;
      return (x >= -TOL && x <= faceWidth + TOL) ? { t, point: { x: Math.max(0, Math.min(faceWidth, x)), y: faceHeight } } : null;
    }},
  ];

  for (const { edge, solve } of edges) {
    const result = solve();
    if (result) {
      const isDup = hits.some(h => Math.hypot(h.point.x - result.point.x, h.point.y - result.point.y) < TOL);
      if (!isDup) {
        hits.push({ ...result, edge });
      }
    }
  }

  if (hits.length < 2) return null;
  hits.sort((a, b) => a.t - b.t);
  return [{ point: hits[0].point, edge: hits[0].edge }, { point: hits[1].point, edge: hits[1].edge }];
}

/**
 * Classify a sketch line as a potential fold line.
 * A line qualifies if the infinite line through its endpoints intersects any two different face boundaries.
 */
export function classifySketchLineAsFold(
  line: FaceSketchLine,
  faceWidth: number,
  faceHeight: number,
): { lineStart: Point2D; lineEnd: Point2D } | null {
  const intersections = lineFaceBoundaryIntersections(line.start, line.end, faceWidth, faceHeight);
  if (!intersections) return null;
  if (intersections[0].edge === intersections[1].edge) return null;
  return { lineStart: intersections[0].point, lineEnd: intersections[1].point };
}

/**
 * Compute the fold normal: perpendicular to the fold line, pointing toward the moving side.
 */
export function getFoldNormal(fold: Fold, faceWidth: number, faceHeight: number): Point2D {
  const dx = fold.lineEnd.x - fold.lineStart.x;
  const dy = fold.lineEnd.y - fold.lineStart.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: 0, y: 1 };

  let nx = dy / len;
  let ny = -dx / len;

  const midX = (fold.lineStart.x + fold.lineEnd.x) / 2;
  const midY = (fold.lineStart.y + fold.lineEnd.y) / 2;
  const centX = faceWidth / 2;
  const centY = faceHeight / 2;
  const toCentX = centX - midX;
  const toCentY = centY - midY;

  if (nx * toCentX + ny * toCentY > 0) {
    nx = -nx;
    ny = -ny;
  }

  return { x: nx, y: ny };
}

// ========== Unified Loop Detection ==========

interface Edge {
  id: string;
  start: Point2D;
  end: Point2D;
}

function pointKey(p: Point2D, tol = 1.0): string {
  const rx = Math.round(p.x / tol) * tol;
  const ry = Math.round(p.y / tol) * tol;
  return `${rx},${ry}`;
}

/**
 * Convert all sketch entities into a unified edge list.
 */
function entitiesToEdges(entities: SketchEntity[]): Edge[] {
  const edges: Edge[] = [];
  let eid = 0;
  for (const e of entities) {
    if (e.type === 'line') {
      edges.push({ id: `e${eid++}`, start: e.start, end: e.end });
    } else if (e.type === 'rect') {
      const corners = rectToPolygon(e.origin, e.width, e.height);
      for (let i = 0; i < corners.length; i++) {
        edges.push({ id: `e${eid++}`, start: corners[i], end: corners[(i + 1) % corners.length] });
      }
    } else if (e.type === 'arc') {
      // Approximate arc as line segments
      const segments = 16;
      for (let i = 0; i < segments; i++) {
        const a1 = e.startAngle + (e.endAngle - e.startAngle) * (i / segments);
        const a2 = e.startAngle + (e.endAngle - e.startAngle) * ((i + 1) / segments);
        edges.push({
          id: `e${eid++}`,
          start: { x: e.center.x + Math.cos(a1) * e.radius, y: e.center.y + Math.sin(a1) * e.radius },
          end: { x: e.center.x + Math.cos(a2) * e.radius, y: e.center.y + Math.sin(a2) * e.radius },
        });
      }
    }
    // circles are handled separately as standalone loops
  }
  return edges;
}

/**
 * Find all closed loops from sketch entities using graph traversal.
 */
export function findAllClosedLoops(entities: SketchEntity[]): Point2D[][] {
  const edges = entitiesToEdges(entities);
  const tol = 1.0;
  const loops: Point2D[][] = [];

  // Build adjacency: pointKey -> list of edge indices
  const adj = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const ks = pointKey(edges[i].start, tol);
    const ke = pointKey(edges[i].end, tol);
    if (!adj.has(ks)) adj.set(ks, []);
    if (!adj.has(ke)) adj.set(ke, []);
    adj.get(ks)!.push(i);
    adj.get(ke)!.push(i);
  }

  const usedEdges = new Set<number>();

  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (usedEdges.has(startIdx)) continue;

    const path: Point2D[] = [edges[startIdx].start, edges[startIdx].end];
    const pathEdges: number[] = [startIdx];
    const localUsed = new Set<number>([startIdx]);
    let closed = false;
    let maxIter = edges.length * 2;

    while (!closed && maxIter-- > 0) {
      const last = path[path.length - 1];
      const lastKey = pointKey(last, tol);
      const candidates = adj.get(lastKey) ?? [];
      let found = false;

      for (const ci of candidates) {
        if (localUsed.has(ci)) continue;
        const edge = edges[ci];
        const ks = pointKey(edge.start, tol);
        const ke = pointKey(edge.end, tol);
        let nextPt: Point2D;

        if (ks === lastKey) {
          nextPt = edge.end;
        } else if (ke === lastKey) {
          nextPt = edge.start;
        } else {
          continue;
        }

        // Check if we close back to start
        if (pointKey(nextPt, tol) === pointKey(path[0], tol) && pathEdges.length >= 2) {
          closed = true;
          localUsed.add(ci);
          pathEdges.push(ci);
          found = true;
          break;
        }

        path.push(nextPt);
        localUsed.add(ci);
        pathEdges.push(ci);
        found = true;
        break;
      }

      if (!found) break;
    }

    if (closed && path.length >= 3) {
      loops.push(path);
      pathEdges.forEach(ei => usedEdges.add(ei));
    }
  }

  // Add standalone circles as polygon loops
  for (const e of entities) {
    if (e.type === 'circle') {
      loops.push(circleToPolygon(e.center, e.radius));
    }
  }

  return loops;
}

/**
 * Extract the base face profile (largest loop) and cutouts (all other loops).
 */
export function extractProfileAndCutouts(entities: SketchEntity[]): {
  profile: Point2D[];
  cutouts: ProfileCutout[];
} | null {
  const loops = findAllClosedLoops(entities);
  if (loops.length === 0) return null;

  // Sort by area descending
  loops.sort((a, b) => polygonArea(b) - polygonArea(a));

  const profile = loops[0];
  const cutouts: ProfileCutout[] = [];

  // Check if remaining loops correspond to standalone circle entities
  const circles = entities.filter(e => e.type === 'circle');

  for (let i = 1; i < loops.length; i++) {
    const loop = loops[i];
    // Check if this loop is a circle entity
    const matchingCircle = circles.find(c => {
      if (c.type !== 'circle') return false;
      const cPoly = circleToPolygon(c.center, c.radius);
      if (cPoly.length !== loop.length) return false;
      // Compare first point
      return Math.hypot(cPoly[0].x - loop[0].x, cPoly[0].y - loop[0].y) < 1.0;
    });

    if (matchingCircle && matchingCircle.type === 'circle') {
      cutouts.push({
        type: 'circle',
        center: matchingCircle.center,
        radius: matchingCircle.radius,
        polygon: loop,
      });
    } else {
      cutouts.push({ type: 'polygon', polygon: loop });
    }
  }

  return { profile, cutouts };
}

// ========== Polygon Utilities (2D) ==========

export function polygonArea(poly: Point2D[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Sutherland-Hodgman polygon clipping by a line.
 * Keeps the side where dot(point - linePoint, lineNormal) <= 0.
 */
export function clipPolygonByLine(
  polygon: Point2D[],
  linePoint: Point2D,
  lineNormal: Point2D,
): Point2D[] {
  if (polygon.length < 3) return polygon;

  function signedDist(p: Point2D): number {
    return (p.x - linePoint.x) * lineNormal.x + (p.y - linePoint.y) * lineNormal.y;
  }

  function intersect(a: Point2D, b: Point2D): Point2D {
    const dA = signedDist(a);
    const dB = signedDist(b);
    const t = dA / (dA - dB);
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }

  const result: Point2D[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const dCurr = signedDist(curr);
    const dNext = signedDist(next);

    if (dCurr <= 0) {
      result.push(curr);
      if (dNext > 0) result.push(intersect(curr, next));
    } else if (dNext <= 0) {
      result.push(intersect(curr, next));
    }
  }

  return result;
}

// ========== Edge / Fold Helpers (2D only) ==========

export function foldLineToInnerEdgeOffset(
  foldLocation: Fold['foldLocation'],
  thickness: number,
): number {
  switch (foldLocation) {
    case 'material-inside': return 0;
    case 'material-outside': return thickness;
    case 'centerline':
    default: return thickness / 2;
  }
}

/**
 * Check if a fold is on the base face (top or bottom).
 */
export function isBaseFaceFold(fold: Fold): boolean {
  return !fold.faceId || fold.faceId === 'base_top' || fold.faceId === 'base_bot';
}

/**
 * Check if a 3D edge geometrically corresponds to a fold line.
 */
export function isEdgeOnFoldLine(edge: PartEdge, folds: Fold[], profile: Point2D[]): boolean {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const TOL = 1;

  for (const fold of folds) {
    const ls = { x: minX + fold.lineStart.x, y: minY + fold.lineStart.y };
    const le = { x: minX + fold.lineEnd.x, y: minY + fold.lineEnd.y };

    const es = { x: edge.start.x, y: edge.start.y };
    const ee = { x: edge.end.x, y: edge.end.y };

    const matchFwd = Math.hypot(es.x - ls.x, es.y - ls.y) < TOL && Math.hypot(ee.x - le.x, ee.y - le.y) < TOL;
    const matchRev = Math.hypot(es.x - le.x, es.y - le.y) < TOL && Math.hypot(ee.x - ls.x, ee.y - ls.y) < TOL;

    if (matchFwd || matchRev) return true;
  }
  return false;
}

/**
 * Map an edge ID to its geometric opposite on the other face.
 */
export function getOppositeEdgeId(edgeId: string): string | null {
  if (edgeId.startsWith('edge_top_')) return edgeId.replace('edge_top_', 'edge_bot_');
  if (edgeId.startsWith('edge_bot_')) return edgeId.replace('edge_bot_', 'edge_top_');
  if (edgeId.includes('_tip_outer_')) return edgeId.replace('_tip_outer_', '_tip_inner_');
  if (edgeId.includes('_tip_inner_')) return edgeId.replace('_tip_inner_', '_tip_outer_');
  return null;
}

/**
 * Derive the user-facing direction from an edge ID.
 */
export function getUserFacingDirection(edgeId: string): 'up' | 'down' {
  if (edgeId.startsWith('edge_bot_') || edgeId.includes('_tip_inner_')) return 'down';
  return 'up';
}

/**
 * Get the fixed (remaining) profile after applying folds (2D clipping).
 */
export function getFixedProfile(profile: Point2D[], folds: Fold[], thickness: number = 0): Point2D[] {
  const baseFolds = folds.filter(f => isBaseFaceFold(f));
  if (baseFolds.length === 0) return profile;

  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceWidth = Math.max(...xs) - minX;
  const faceHeight = Math.max(...ys) - minY;

  let clipped = [...profile];

  for (const fold of baseFolds) {
    const normal = getFoldNormal(fold, faceWidth, faceHeight);
    const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
    const linePoint: Point2D = {
      x: minX + fold.lineStart.x - normal.x * off,
      y: minY + fold.lineStart.y - normal.y * off,
    };
    clipped = clipPolygonByLine(clipped, linePoint, normal);
  }

  return clipped;
}

/**
 * Get the fixed-side portions of cutouts (clipped by all base-face fold lines).
 */
export function getFixedCutouts(
  cutouts: ProfileCutout[],
  folds: Fold[],
  profile: Point2D[],
  thickness: number,
): Point2D[][] {
  const baseFolds = folds.filter(f => isBaseFaceFold(f));
  if (baseFolds.length === 0) return cutouts.map(c => c.polygon);

  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const result: Point2D[][] = [];
  for (const cutout of cutouts) {
    let poly = [...cutout.polygon];
    for (const fold of baseFolds) {
      const norm = getFoldNormal(fold, faceW, faceH);
      const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
      const linePoint = {
        x: minX + fold.lineStart.x - norm.x * off,
        y: minY + fold.lineStart.y - norm.y * off,
      };
      poly = clipPolygonByLine(poly, linePoint, norm);
    }
    if (poly.length >= 3) result.push(poly);
  }
  return result;
}

/**
 * Create a simple rectangular profile for virtual face geometry.
 */
export function makeVirtualProfile(width: number, height: number): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}
