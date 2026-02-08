import * as THREE from 'three';
import { SketchEntity, Point2D } from '@/lib/sheetmetal';

// ========== 3D Part Model ==========

export interface PartEdge {
  id: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** Which face this edge belongs to */
  faceId: string;
  /** Direction the flange would extend (outward normal in the face plane) */
  normal: THREE.Vector3;
  /** Normal of the face this edge belongs to (perpendicular to the surface) */
  faceNormal: THREE.Vector3;
}

export interface Flange {
  id: string;
  edgeId: string;
  height: number;       // mm
  angle: number;        // degrees (default 90)
  direction: 'up' | 'down'; // relative to face normal
  bendRadius: number;   // inner bend radius in mm
}

export interface SheetMetalPart {
  /** Closed 2D profile points (in XY plane) */
  profile: Point2D[];
  /** Material thickness */
  thickness: number;
  /** Edges available for flange operations */
  edges: PartEdge[];
  /** Applied flanges */
  flanges: Flange[];
}

/**
 * Extract a closed profile from sketch entities.
 * For rectangles: directly returns 4 corner points.
 * For lines: attempts to find connected closed loops.
 * Returns the first valid closed profile found.
 */
export function extractProfile(entities: SketchEntity[]): Point2D[] | null {
  // Priority: look for rectangles first (most common base face)
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

  // Try to build a closed loop from lines
  const lines = entities.filter(e => e.type === 'line');
  if (lines.length < 3) return null;

  const tolerance = 1.0; // mm snap tolerance
  const points: Point2D[] = [];
  const used = new Set<string>();

  // Start from the first line
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
        // Check if this closes the loop
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

/**
 * Create a Three.js Shape from a 2D profile.
 */
export function profileToShape(profile: Point2D[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0].x, profile[0].y);
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i].x, profile[i].y);
  }
  shape.closePath();
  return shape;
}

/**
 * Create an extruded mesh from a profile and thickness.
 */
export function createBaseFaceMesh(
  profile: Point2D[],
  thickness: number
): THREE.BufferGeometry {
  const shape = profileToShape(profile);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  return geometry;
}

/**
 * Extract selectable edges from a profile.
 * Returns both top-face edges (z=thickness) and bottom-face edges (z=0),
 * giving the user full control over flange placement.
 */
export function extractEdges(profile: Point2D[], thickness: number): PartEdge[] {
  const edges: PartEdge[] = [];

  for (let i = 0; i < profile.length; i++) {
    const curr = profile[i];
    const next = profile[(i + 1) % profile.length];

    // Edge direction vector (2D)
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;

    // Outward normal (perpendicular, pointing outward from shape)
    // For a CCW wound polygon, outward normal is (dy, -dx) normalized
    const nx = dy / len;
    const ny = -dx / len;

    // Top-face edge (z = thickness), faceNormal points up
    edges.push({
      id: `edge_top_${i}`,
      start: new THREE.Vector3(curr.x, curr.y, thickness),
      end: new THREE.Vector3(next.x, next.y, thickness),
      faceId: 'base_top',
      normal: new THREE.Vector3(nx, ny, 0).normalize(),
      faceNormal: new THREE.Vector3(0, 0, 1),
    });

    // Bottom-face edge (z = 0), faceNormal points down
    edges.push({
      id: `edge_bot_${i}`,
      start: new THREE.Vector3(curr.x, curr.y, 0),
      end: new THREE.Vector3(next.x, next.y, 0),
      faceId: 'base_bot',
      normal: new THREE.Vector3(nx, ny, 0).normalize(),
      faceNormal: new THREE.Vector3(0, 0, -1),
    });
  }

  return edges;
}

/**
 * Create a flange mesh with a proper curved bend section and flat extension.
 *
 * Cross-section (perpendicular to the edge, in u-w space):
 *   u = edge outward normal direction
 *   w = Z × dirSign (up or down)
 *
 * The bend arc sweeps from 0 to bendAngle around a center at (0, R) in u-w
 * space, starting from the edge point. The flat flange extends from the arc
 * end in the tangent direction.
 */
/**
 * Compute the 3D positions for both bend lines as closed loops around the cross-section.
 * Each bend line has 4 corners: innerStart, innerEnd, outerEnd, outerStart (forming a rectangle).
 * Returns arrays of Vector3 points for each closed loop.
 */
export function computeBendLinePositions(
  edge: PartEdge,
  flange: Flange,
  thickness: number
): { bendStart: THREE.Vector3[]; bendEnd: THREE.Vector3[] } {
  const bendAngleRad = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;
  const R = flange.bendRadius;

  const uDir = edge.normal.clone().normalize();
  const wDir = edge.faceNormal.clone().multiplyScalar(dirSign);

  const W_EPSILON = 0.02;

  function makePoint(base: THREE.Vector3, u: number, w: number): THREE.Vector3 {
    return base.clone()
      .add(uDir.clone().multiplyScalar(u))
      .add(wDir.clone().multiplyScalar(w));
  }

  // Bend Start Line (t=0): closed loop around cross-section
  const s_iu = 0, s_iw = W_EPSILON;
  const s_ou = 0, s_ow = -thickness + W_EPSILON;

  const bendStart = [
    makePoint(edge.start, s_iu, s_iw),  // inner start
    makePoint(edge.end,   s_iu, s_iw),  // inner end
    makePoint(edge.end,   s_ou, s_ow),  // outer end
    makePoint(edge.start, s_ou, s_ow),  // outer start
    makePoint(edge.start, s_iu, s_iw),  // close the loop
  ];

  // Bend End Line (t=bendAngle): closed loop around cross-section
  const sinA = Math.sin(bendAngleRad);
  const cosA = Math.cos(bendAngleRad);
  const e_iu = R * sinA;
  const e_iw = R * (1 - cosA) + W_EPSILON;
  const e_ou = R * sinA + thickness * sinA;
  const e_ow = R * (1 - cosA) - thickness * cosA + W_EPSILON;

  const bendEnd = [
    makePoint(edge.start, e_iu, e_iw),  // inner start
    makePoint(edge.end,   e_iu, e_iw),  // inner end
    makePoint(edge.end,   e_ou, e_ow),  // outer end
    makePoint(edge.start, e_ou, e_ow),  // outer start
    makePoint(edge.start, e_iu, e_iw),  // close the loop
  ];

  return { bendStart, bendEnd };
}

/**
 * Compute ALL selectable edges of a flange:
 *  - Outer tip edge (primary for cascading flanges, at outer surface)
 *  - Inner tip edge (at inner surface)
 *  - Two side edges (left/right ends of the tip face)
 *
 * The outer tip edge is positioned at the outer surface so cascading flanges
 * start flush with the parent flange.
 */
export function computeFlangeTipEdges(
  parentEdge: PartEdge,
  flange: Flange,
  thickness: number
): PartEdge[] {
  const A = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;
  const R = flange.bendRadius;
  const H = flange.height;

  const uDir = parentEdge.normal.clone().normalize();
  const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);
  const edgeDir = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();

  const sinA = Math.sin(A);
  const cosA = Math.cos(A);

  // Arc end position (inner surface)
  const arcEndU = R * sinA;
  const arcEndW = R * (1 - cosA);

  // Tangent at end of arc (flat extension direction)
  const tanU = cosA;
  const tanW = sinA;

  // Perpendicular direction (inner→outer surface offset)
  const perpU = sinA;
  const perpW = -cosA;

  // Inner tip position
  const tipU = arcEndU + H * tanU;
  const tipW = arcEndW + H * tanW;

  // Outer tip position (offset by thickness)
  const outerTipU = tipU + thickness * perpU;
  const outerTipW = tipW + thickness * perpW;

  function makePos(base: THREE.Vector3, u: number, w: number): THREE.Vector3 {
    return base.clone()
      .add(uDir.clone().multiplyScalar(u))
      .add(wDir.clone().multiplyScalar(w));
  }

  const innerStart = makePos(parentEdge.start, tipU, tipW);
  const innerEnd = makePos(parentEdge.end, tipU, tipW);
  const outerStart = makePos(parentEdge.start, outerTipU, outerTipW);
  const outerEnd = makePos(parentEdge.end, outerTipU, outerTipW);

  // Tip normal = tangent direction (where a new flange would extend along the face plane)
  const tipNormal = uDir.clone().multiplyScalar(tanU)
    .add(wDir.clone().multiplyScalar(tanW))
    .normalize();

  // Outer face normal (perpendicular to flange surface, pointing away from bend center)
  const outerFaceNormal = uDir.clone().multiplyScalar(perpU)
    .add(wDir.clone().multiplyScalar(perpW))
    .normalize();

  // Inner face normal (opposite)
  const innerFaceNormal = outerFaceNormal.clone().negate();

  const edges: PartEdge[] = [];

  // 1) Outer tip edge — primary edge for cascading flanges (bends away from material)
  edges.push({
    id: `flange_tip_outer_${flange.id}`,
    start: outerStart,
    end: outerEnd,
    faceId: `flange_outer_${flange.id}`,
    normal: tipNormal,
    faceNormal: outerFaceNormal,
  });

  // 2) Inner tip edge
  edges.push({
    id: `flange_tip_inner_${flange.id}`,
    start: innerStart,
    end: innerEnd,
    faceId: `flange_inner_${flange.id}`,
    normal: tipNormal,
    faceNormal: innerFaceNormal,
  });

  // 3) Side edge at the "start" end of the parent edge
  edges.push({
    id: `flange_side_s_${flange.id}`,
    start: innerStart,
    end: outerStart,
    faceId: `flange_sideL_${flange.id}`,
    normal: tipNormal,
    faceNormal: edgeDir.clone().negate(),
  });

  // 4) Side edge at the "end" end of the parent edge
  edges.push({
    id: `flange_side_e_${flange.id}`,
    start: innerEnd,
    end: outerEnd,
    faceId: `flange_sideR_${flange.id}`,
    normal: tipNormal,
    faceNormal: edgeDir.clone(),
  });

  return edges;
}

/**
 * Get all selectable edges: base profile edges + flange tip/side edges.
 * Supports nested flanges (flange on flange).
 */
export function getAllSelectableEdges(
  profile: Point2D[],
  thickness: number,
  flanges: Flange[],
  folds: Fold[] = []
): PartEdge[] {
  const fixedProfile = getFixedProfile(profile, folds);
  const baseEdges = extractEdges(fixedProfile, thickness);
  const edgeMap = new Map<string, PartEdge>();
  baseEdges.forEach(e => edgeMap.set(e.id, e));

  // Process folds to add their tip/side edges (edges on folded faces)
  for (const fold of folds) {
    const foldEdge = computeFoldEdge(profile, thickness, fold);
    const { startHeight, endHeight } = getFoldMovingHeights(profile, fold);
    const tipEdges = computeFoldTipEdges(
      foldEdge, fold.angle, fold.direction ?? 'up', fold.bendRadius,
      thickness, startHeight, endHeight, fold.id
    );
    tipEdges.forEach(e => edgeMap.set(e.id, e));
  }

  // Process flanges iteratively to resolve nested dependencies
  const processed = new Set<string>();
  let remaining = [...flanges];
  let maxIter = flanges.length + 1;

  while (remaining.length > 0 && maxIter > 0) {
    maxIter--;
    const next: Flange[] = [];
    for (const flange of remaining) {
      const parentEdge = edgeMap.get(flange.edgeId);
      if (parentEdge && !processed.has(flange.id)) {
        const tipEdges = computeFlangeTipEdges(parentEdge, flange, thickness);
        tipEdges.forEach(e => edgeMap.set(e.id, e));
        processed.add(flange.id);
      } else if (!parentEdge) {
        next.push(flange);
      }
    }
    remaining = next;
  }

  return Array.from(edgeMap.values());
}

export function createFlangeMesh(
  edge: PartEdge,
  flange: Flange,
  thickness: number
): THREE.BufferGeometry {
  const bendAngleRad = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;
  const R = flange.bendRadius;
  const H = flange.height;

  const uDir = edge.normal.clone().normalize();           // outward from face
  const wDir = edge.faceNormal.clone().multiplyScalar(dirSign); // perpendicular to face

  const BEND_SEGMENTS = 12;
  // Small offset to prevent z-fighting between flange base cap and base face edge
  const W_EPSILON = 0.01;

  // ---------- Build 2D cross-section profile (u, w) ----------
  // Each entry stores inner & outer positions in (u,w) space relative to the edge point.
  interface CrossSection { iu: number; iw: number; ou: number; ow: number }
  const profile: CrossSection[] = [];

  // 1. Bend arc
  for (let i = 0; i <= BEND_SEGMENTS; i++) {
    const t = (i / BEND_SEGMENTS) * bendAngleRad;
    const sinT = Math.sin(t);
    const cosT = Math.cos(t);
    // Inner surface traces radius R around center (0, R)
    const iu = R * sinT;
    const iw = R * (1 - cosT) + W_EPSILON;
    // Outer surface is offset by thickness radially outward from center
    const ou = iu + thickness * sinT;
    const ow = iw - thickness * cosT;
    profile.push({ iu, iw, ou, ow });
  }

  // 2. Flat flange after the arc
  const arcEndT = bendAngleRad;
  const sinA = Math.sin(arcEndT);
  const cosA = Math.cos(arcEndT);
  const arcEndIU = R * sinA;
  const arcEndIW = R * (1 - cosA);
  // Tangent direction at end of arc
  const tanU = cosA;
  const tanW = sinA;
  // Perpendicular (thickness offset direction) = radial outward at end
  const perpU = sinA;
  const perpW = -cosA;

  profile.push({
    iu: arcEndIU + H * tanU,
    iw: arcEndIW + H * tanW + W_EPSILON,
    ou: arcEndIU + H * tanU + thickness * perpU,
    ow: arcEndIW + H * tanW + thickness * perpW + W_EPSILON,
  });

  // ---------- Convert to 3D vertices ----------
  // For each profile point: 4 vertices (innerStart, innerEnd, outerStart, outerEnd)
  const verts: number[] = [];
  for (const p of profile) {
    // Inner at edge start
    const is = edge.start.clone().add(uDir.clone().multiplyScalar(p.iu)).add(wDir.clone().multiplyScalar(p.iw));
    // Inner at edge end
    const ie = edge.end.clone().add(uDir.clone().multiplyScalar(p.iu)).add(wDir.clone().multiplyScalar(p.iw));
    // Outer at edge start
    const os = edge.start.clone().add(uDir.clone().multiplyScalar(p.ou)).add(wDir.clone().multiplyScalar(p.ow));
    // Outer at edge end
    const oe = edge.end.clone().add(uDir.clone().multiplyScalar(p.ou)).add(wDir.clone().multiplyScalar(p.ow));
    verts.push(
      is.x, is.y, is.z,   // idx i*4+0
      ie.x, ie.y, ie.z,   // idx i*4+1
      os.x, os.y, os.z,   // idx i*4+2
      oe.x, oe.y, oe.z,   // idx i*4+3
    );
  }

  // ---------- Build index buffer ----------
  const indices: number[] = [];
  const N = profile.length;
  for (let i = 0; i < N - 1; i++) {
    const c = i * 4;
    const n = (i + 1) * 4;

    // Inner surface
    indices.push(c, n, n + 1, c, n + 1, c + 1);
    // Outer surface
    indices.push(c + 2, c + 3, n + 3, c + 2, n + 3, n + 2);
    // Left side (edge start)
    indices.push(c, c + 2, n + 2, c, n + 2, n);
    // Right side (edge end)
    indices.push(c + 1, n + 1, n + 3, c + 1, n + 3, c + 3);
  }

  // Tip cap
  const last = (N - 1) * 4;
  indices.push(last, last + 1, last + 3, last, last + 3, last + 2);
  // Base cap (at edge, first profile point)
  indices.push(0, 3, 1, 0, 2, 3);

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  indexed.setIndex(indices);

  // Convert to non-indexed so each face gets its own vertices,
  // then recompute normals — gives clean flat shading per face
  const geometry = indexed.toNonIndexed();
  geometry.computeVertexNormals();
  return geometry;
}

// ========== Fold & Face Sketch Model ==========

export interface Fold {
  id: string;
  lineStart: Point2D;    // face-local start of fold line
  lineEnd: Point2D;      // face-local end of fold line
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

export type FaceSketchEntity = FaceSketchLine | FaceSketchCircle | FaceSketchRect;

export interface FaceSketch {
  faceId: string;
  entities: FaceSketchEntity[];
}

// ── Helpers ──

/**
 * Determine which boundary edge of a rectangular face a point lies on.
 */
function pointOnFaceEdge(
  p: Point2D, faceWidth: number, faceHeight: number, tol: number
): 'left' | 'right' | 'top' | 'bottom' | null {
  if (p.x < tol && p.y >= -tol && p.y <= faceHeight + tol) return 'left';
  if (p.x > faceWidth - tol && p.y >= -tol && p.y <= faceHeight + tol) return 'right';
  if (p.y < tol && p.x >= -tol && p.x <= faceWidth + tol) return 'bottom';
  if (p.y > faceHeight - tol && p.x >= -tol && p.x <= faceWidth + tol) return 'top';
  return null;
}

/**
 * Classify a sketch line as a potential fold line.
 * A line qualifies if its endpoints lie on opposite face boundaries (left↔right or top↔bottom).
 * Returns the line coordinates or null if not valid.
 */
export function classifySketchLineAsFold(
  line: FaceSketchLine,
  faceWidth: number,
  faceHeight: number,
): { lineStart: Point2D; lineEnd: Point2D } | null {
  const TOL = 1;
  const startEdge = pointOnFaceEdge(line.start, faceWidth, faceHeight, TOL);
  const endEdge = pointOnFaceEdge(line.end, faceWidth, faceHeight, TOL);

  if (!startEdge || !endEdge) return null;

  const isOpposite = (
    (startEdge === 'left' && endEdge === 'right') ||
    (startEdge === 'right' && endEdge === 'left') ||
    (startEdge === 'top' && endEdge === 'bottom') ||
    (startEdge === 'bottom' && endEdge === 'top')
  );

  return isOpposite ? { lineStart: { ...line.start }, lineEnd: { ...line.end } } : null;
}

/**
 * Compute the fold normal: perpendicular to the fold line, pointing toward the moving side.
 * The moving side is determined by checking which side contains the far corner of the face.
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
  const toFarX = faceWidth - midX;
  const toFarY = faceHeight - midY;
  if (nx * toFarX + ny * toFarY < 0) {
    nx = -nx;
    ny = -ny;
  }

  return { x: nx, y: ny };
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

export interface StressRelief {
  position: Point2D;
  width: number;
  depth: number;
  foldId: string;
}

/**
 * Compute the virtual PartEdge at a fold line position.
 * Uses lineStart/lineEnd for 3D mapping with perpendicular normal toward moving side.
 */
export function computeFoldEdge(
  profile: Point2D[],
  thickness: number,
  fold: Fold
): PartEdge {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceWidth = Math.max(...xs) - minX;
  const faceHeight = Math.max(...ys) - minY;

  const z = fold.direction === 'up' ? thickness : 0;
  const faceNormal = fold.direction === 'up'
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 0, -1);

  const start3d = new THREE.Vector3(minX + fold.lineStart.x, minY + fold.lineStart.y, z);
  const end3d = new THREE.Vector3(minX + fold.lineEnd.x, minY + fold.lineEnd.y, z);

  const normal2d = getFoldNormal(fold, faceWidth, faceHeight);
  const outwardNormal = new THREE.Vector3(normal2d.x, normal2d.y, 0);

  return {
    id: `fold_edge_${fold.id}`,
    start: start3d,
    end: end3d,
    faceId: fold.direction === 'up' ? 'base_top' : 'base_bot',
    normal: outwardNormal,
    faceNormal,
  };
}

/**
 * Get the fixed (remaining) profile after applying folds.
 * Uses Sutherland-Hodgman polygon clipping against each fold line.
 */
export function getFixedProfile(profile: Point2D[], folds: Fold[]): Point2D[] {
  if (folds.length === 0) return profile;

  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceWidth = Math.max(...xs) - minX;
  const faceHeight = Math.max(...ys) - minY;

  let clipped = [...profile];

  for (const fold of folds) {
    const linePoint: Point2D = { x: minX + fold.lineStart.x, y: minY + fold.lineStart.y };
    const normal = getFoldNormal(fold, faceWidth, faceHeight);
    clipped = clipPolygonByLine(clipped, linePoint, normal);
  }

  return clipped;
}

/**
 * Get the moving portion heights for a fold (different at each end for angled folds).
 * startHeight corresponds to fold.lineStart, endHeight to fold.lineEnd.
 */
export function getFoldMovingHeights(
  profile: Point2D[],
  fold: Fold
): { startHeight: number; endHeight: number } {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceWidth = Math.max(...xs) - minX;
  const faceHeight = Math.max(...ys) - minY;

  const normal = getFoldNormal(fold, faceWidth, faceHeight);
  const fs = { x: minX + fold.lineStart.x, y: minY + fold.lineStart.y };

  // Get moving polygon (side opposite to fixed = where dot > 0)
  const negNormal = { x: -normal.x, y: -normal.y };
  const movingPoly = clipPolygonByLine([...profile], fs, negNormal);

  if (movingPoly.length < 3) return { startHeight: 0, endHeight: 0 };

  const fe = { x: minX + fold.lineEnd.x, y: minY + fold.lineEnd.y };
  const edx = fe.x - fs.x;
  const edy = fe.y - fs.y;
  const edgeLen = Math.hypot(edx, edy);
  if (edgeLen < 0.01) return { startHeight: 0, endHeight: 0 };

  let hStart = 0;
  let hEnd = 0;

  for (const v of movingPoly) {
    const vx = v.x - fs.x;
    const vy = v.y - fs.y;
    const perpDist = vx * normal.x + vy * normal.y;
    if (perpDist <= 0.01) continue;

    const t = (vx * edx + vy * edy) / (edgeLen * edgeLen);
    if (t <= 0.5) {
      hStart = Math.max(hStart, perpDist);
    } else {
      hEnd = Math.max(hEnd, perpDist);
    }
  }

  return { startHeight: hStart, endHeight: hEnd };
}

/**
 * Backward-compatible single height (max of start/end).
 */
export function getFoldMovingHeight(profile: Point2D[], fold: Fold): number {
  const { startHeight, endHeight } = getFoldMovingHeights(profile, fold);
  return Math.max(startHeight, endHeight);
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
 * Create a fold mesh with variable heights at each end of the fold line.
 * Supports angled folds where the moving portion is trapezoidal.
 */
export function createFoldMesh(
  edge: PartEdge,
  angle: number,
  direction: 'up' | 'down',
  bendRadius: number,
  thickness: number,
  heightStart: number,
  heightEnd: number,
): THREE.BufferGeometry {
  const bendAngleRad = (angle * Math.PI) / 180;
  const dirSign = direction === 'up' ? 1 : -1;
  const R = bendRadius;

  const uDir = edge.normal.clone().normalize();
  const wDir = edge.faceNormal.clone().multiplyScalar(dirSign);

  const BEND_SEGMENTS = 12;
  const W_EPSILON = 0.01;

  interface CrossSection { iu: number; iw: number; ou: number; ow: number }

  // Build arc profile (same at both ends)
  const arcProfile: CrossSection[] = [];
  for (let i = 0; i <= BEND_SEGMENTS; i++) {
    const t = (i / BEND_SEGMENTS) * bendAngleRad;
    const sinT = Math.sin(t);
    const cosT = Math.cos(t);
    const iu = R * sinT;
    const iw = R * (1 - cosT) + W_EPSILON;
    const ou = iu + thickness * sinT;
    const ow = iw - thickness * cosT;
    arcProfile.push({ iu, iw, ou, ow });
  }

  // Tip direction after arc
  const sinA = Math.sin(bendAngleRad);
  const cosA = Math.cos(bendAngleRad);
  const arcEndIU = R * sinA;
  const arcEndIW = R * (1 - cosA);
  const tanU = cosA;
  const tanW = sinA;
  const perpU = sinA;
  const perpW = -cosA;

  function computeTip(H: number): CrossSection {
    return {
      iu: arcEndIU + H * tanU,
      iw: arcEndIW + H * tanW + W_EPSILON,
      ou: arcEndIU + H * tanU + thickness * perpU,
      ow: arcEndIW + H * tanW + thickness * perpW + W_EPSILON,
    };
  }

  const tipS = computeTip(heightStart);
  const tipE = computeTip(heightEnd);

  // Build vertices
  const verts: number[] = [];

  function addVert(base: THREE.Vector3, u: number, w: number) {
    const v = base.clone()
      .add(uDir.clone().multiplyScalar(u))
      .add(wDir.clone().multiplyScalar(w));
    verts.push(v.x, v.y, v.z);
  }

  // Arc sections (same cross-section at both ends)
  for (const p of arcProfile) {
    addVert(edge.start, p.iu, p.iw);
    addVert(edge.end, p.iu, p.iw);
    addVert(edge.start, p.ou, p.ow);
    addVert(edge.end, p.ou, p.ow);
  }

  // Tip (different cross-section at each end)
  addVert(edge.start, tipS.iu, tipS.iw);
  addVert(edge.end, tipE.iu, tipE.iw);
  addVert(edge.start, tipS.ou, tipS.ow);
  addVert(edge.end, tipE.ou, tipE.ow);

  // Build indices
  const indices: number[] = [];
  const N = arcProfile.length + 1;
  for (let i = 0; i < N - 1; i++) {
    const c = i * 4;
    const n = (i + 1) * 4;
    indices.push(c, n, n + 1, c, n + 1, c + 1);
    indices.push(c + 2, c + 3, n + 3, c + 2, n + 3, n + 2);
    indices.push(c, c + 2, n + 2, c, n + 2, n);
    indices.push(c + 1, n + 1, n + 3, c + 1, n + 3, c + 3);
  }

  const last = (N - 1) * 4;
  indices.push(last, last + 1, last + 3, last, last + 3, last + 2);
  indices.push(0, 3, 1, 0, 2, 3);

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Compute tip edges for a fold with variable heights.
 */
export function computeFoldTipEdges(
  parentEdge: PartEdge,
  angle: number,
  direction: 'up' | 'down',
  bendRadius: number,
  thickness: number,
  heightStart: number,
  heightEnd: number,
  foldId: string,
): PartEdge[] {
  const A = (angle * Math.PI) / 180;
  const dirSign = direction === 'up' ? 1 : -1;
  const R = bendRadius;

  const uDir = parentEdge.normal.clone().normalize();
  const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);
  const edgeDir = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();

  const sinA = Math.sin(A);
  const cosA = Math.cos(A);
  const arcEndU = R * sinA;
  const arcEndW = R * (1 - cosA);
  const tanU = cosA;
  const tanW = sinA;
  const perpU = sinA;
  const perpW = -cosA;

  function makePos(base: THREE.Vector3, u: number, w: number): THREE.Vector3 {
    return base.clone()
      .add(uDir.clone().multiplyScalar(u))
      .add(wDir.clone().multiplyScalar(w));
  }

  // Different tip positions at each end
  const tipU_s = arcEndU + heightStart * tanU;
  const tipW_s = arcEndW + heightStart * tanW;
  const tipU_e = arcEndU + heightEnd * tanU;
  const tipW_e = arcEndW + heightEnd * tanW;

  const outerTipU_s = tipU_s + thickness * perpU;
  const outerTipW_s = tipW_s + thickness * perpW;
  const outerTipU_e = tipU_e + thickness * perpU;
  const outerTipW_e = tipW_e + thickness * perpW;

  const innerStart = makePos(parentEdge.start, tipU_s, tipW_s);
  const innerEnd = makePos(parentEdge.end, tipU_e, tipW_e);
  const outerStart = makePos(parentEdge.start, outerTipU_s, outerTipW_s);
  const outerEnd = makePos(parentEdge.end, outerTipU_e, outerTipW_e);

  const tipNormal = uDir.clone().multiplyScalar(tanU)
    .add(wDir.clone().multiplyScalar(tanW)).normalize();
  const outerFaceNormal = uDir.clone().multiplyScalar(perpU)
    .add(wDir.clone().multiplyScalar(perpW)).normalize();
  const innerFaceNormal = outerFaceNormal.clone().negate();

  return [
    {
      id: `flange_tip_outer_fold_${foldId}`,
      start: outerStart, end: outerEnd,
      faceId: `flange_outer_fold_${foldId}`,
      normal: tipNormal, faceNormal: outerFaceNormal,
    },
    {
      id: `flange_tip_inner_fold_${foldId}`,
      start: innerStart, end: innerEnd,
      faceId: `flange_inner_fold_${foldId}`,
      normal: tipNormal, faceNormal: innerFaceNormal,
    },
    {
      id: `flange_side_s_fold_${foldId}`,
      start: innerStart, end: outerStart,
      faceId: `flange_sideL_fold_${foldId}`,
      normal: tipNormal, faceNormal: edgeDir.clone().negate(),
    },
    {
      id: `flange_side_e_fold_${foldId}`,
      start: innerEnd, end: outerEnd,
      faceId: `flange_sideR_fold_${foldId}`,
      normal: tipNormal, faceNormal: edgeDir.clone(),
    },
  ];
}

/**
 * Compute stress relief cuts at fold-flange intersections.
 */
export function computeStressReliefs(
  profile: Point2D[],
  thickness: number,
  folds: Fold[],
  flanges: Flange[],
): StressRelief[] {
  const reliefs: StressRelief[] = [];
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const faceWidth = maxX - minX;
  const faceHeight = maxY - minY;

  const flangedEdgeIndices = new Set<number>();
  for (const f of flanges) {
    const match = f.edgeId.match(/edge_(?:top|bot)_(\d+)/);
    if (match) flangedEdgeIndices.add(parseInt(match[1]));
  }

  // Edge index mapping for rectangle: 0=bottom, 1=right, 2=top, 3=left
  const edgeForBoundary: Record<string, number> = {
    bottom: 0, right: 1, top: 2, left: 3,
  };

  for (const fold of folds) {
    const rw = thickness;
    const rd = fold.bendRadius + thickness;

    const endpoints = [fold.lineStart, fold.lineEnd];
    for (const pt of endpoints) {
      const boundary = pointOnFaceEdge(pt, faceWidth, faceHeight, 1);
      if (!boundary) continue;
      const edgeIdx = edgeForBoundary[boundary];
      if (edgeIdx !== undefined && flangedEdgeIndices.has(edgeIdx)) {
        reliefs.push({
          position: { x: minX + pt.x, y: minY + pt.y },
          width: rw,
          depth: rd,
          foldId: fold.id,
        });
      }
    }
  }

  return reliefs;
}
