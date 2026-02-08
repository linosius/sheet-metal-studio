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
  if (Math.abs(p.x) < tol && p.y >= -tol && p.y <= faceHeight + tol) return 'left';
  if (Math.abs(p.x - faceWidth) < tol && p.y >= -tol && p.y <= faceHeight + tol) return 'right';
  if (Math.abs(p.y) < tol && p.x >= -tol && p.x <= faceWidth + tol) return 'bottom';
  if (Math.abs(p.y - faceHeight) < tol && p.x >= -tol && p.x <= faceWidth + tol) return 'top';
  return null;
}

/**
 * Find where an infinite line (through p1, p2) intersects a face boundary rectangle [0,0]→[w,h].
 * Returns the two intersection points and which edges they lie on, or null if fewer than 2 intersections.
 */
function lineFaceBoundaryIntersections(
  p1: Point2D, p2: Point2D, faceWidth: number, faceHeight: number
): { point: Point2D; edge: 'left' | 'right' | 'top' | 'bottom' }[] | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const TOL = 0.5;
  const hits: { point: Point2D; edge: 'left' | 'right' | 'top' | 'bottom'; t: number }[] = [];

  // Check intersection with each boundary edge
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
      // Avoid duplicate hits at corners (same point)
      const isDup = hits.some(h => Math.hypot(h.point.x - result.point.x, h.point.y - result.point.y) < TOL);
      if (!isDup) {
        hits.push({ ...result, edge });
      }
    }
  }

  if (hits.length < 2) return null;

  // Sort by parameter t so the order follows line direction
  hits.sort((a, b) => a.t - b.t);
  return [{ point: hits[0].point, edge: hits[0].edge }, { point: hits[1].point, edge: hits[1].edge }];
}

/**
 * Classify a sketch line as a potential fold line.
 * A line qualifies if the infinite line through its endpoints intersects any two different face boundaries,
 * fully dividing the face into two regions. This supports angled folds across adjacent edges (e.g. right↔bottom).
 * Returns the clipped intersection points as the fold line start/end.
 */
export function classifySketchLineAsFold(
  line: FaceSketchLine,
  faceWidth: number,
  faceHeight: number,
): { lineStart: Point2D; lineEnd: Point2D } | null {
  const intersections = lineFaceBoundaryIntersections(line.start, line.end, faceWidth, faceHeight);
  if (!intersections) return null;

  const e1 = intersections[0].edge;
  const e2 = intersections[1].edge;

  // Any two different edges is valid — the line divides the face into two regions
  if (e1 === e2) return null;

  return { lineStart: intersections[0].point, lineEnd: intersections[1].point };
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

  // Point normal AWAY from face centroid (toward the smaller/moving portion).
  // The centroid is almost always in the larger "fixed" region, making this robust
  // even when the fold line passes through a face corner.
  const midX = (fold.lineStart.x + fold.lineEnd.x) / 2;
  const midY = (fold.lineStart.y + fold.lineEnd.y) / 2;
  const centX = faceWidth / 2;
  const centY = faceHeight / 2;
  const toCentX = centX - midX;
  const toCentY = centY - midY;

  // If normal points toward centroid, flip it so it points away (toward moving side)
  if (nx * toCentX + ny * toCentY > 0) {
    nx = -nx;
    ny = -ny;
  }

  return { x: nx, y: ny };
}

/**
 * Compute the signed area of a 2D polygon (shoelace formula).
 */
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
 * Create a fold mesh from the actual moving polygon shape.
 * Clips the base face polygon by the fold line, excluding regions already claimed
 * by other folds, then builds proper arc + tip geometry that matches the true shape.
 */
export function createFoldMesh(
  profile: Point2D[],
  fold: Fold,
  otherFolds: Fold[],
  thickness: number,
): { arc: THREE.BufferGeometry; tip: THREE.BufferGeometry } | null {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const fs = { x: minX + fold.lineStart.x, y: minY + fold.lineStart.y };
  const fe = { x: minX + fold.lineEnd.x, y: minY + fold.lineEnd.y };
  const edx = fe.x - fs.x;
  const edy = fe.y - fs.y;
  const eLen = Math.hypot(edx, edy);
  if (eLen < 0.01) return null;

  const tang = { x: edx / eLen, y: edy / eLen };
  const norm = getFoldNormal(fold, faceW, faceH);

  const negN = { x: -norm.x, y: -norm.y };
  let movPoly = clipPolygonByLine([...profile], fs, negN);
  if (movPoly.length < 3) return null;

  const myArea = polygonArea(movPoly);
  for (const other of otherFolds) {
    const otherNorm = getFoldNormal(other, faceW, faceH);
    const otherFs = { x: minX + other.lineStart.x, y: minY + other.lineStart.y };
    const otherNegN = { x: -otherNorm.x, y: -otherNorm.y };
    const otherMov = clipPolygonByLine([...profile], otherFs, otherNegN);
    const otherArea = polygonArea(otherMov);
    if (otherArea < myArea * 0.99) {
      movPoly = clipPolygonByLine(movPoly, otherFs, otherNorm);
    }
  }
  if (movPoly.length < 3) return null;

  const dir = fold.direction ?? 'up';
  const z0 = dir === 'up' ? thickness : 0;
  const dSign = dir === 'up' ? 1 : -1;
  const O = new THREE.Vector3(fs.x, fs.y, z0);
  const T3 = new THREE.Vector3(tang.x, tang.y, 0);
  const U3 = new THREE.Vector3(norm.x, norm.y, 0);
  const W3 = new THREE.Vector3(0, 0, dSign);

  const A = (fold.angle * Math.PI) / 180;
  const R = fold.bendRadius;
  const TH = thickness;
  const sinA = Math.sin(A);
  const cosA = Math.cos(A);
  const EPS = 0.01;

  function toLocal(p: Point2D): { t: number; d: number } {
    const vx = p.x - fs.x;
    const vy = p.y - fs.y;
    return { t: vx * tang.x + vy * tang.y, d: vx * norm.x + vy * norm.y };
  }

  function tipInner(t: number, d: number): THREE.Vector3 {
    const dd = Math.max(0, d);
    const u = R * sinA + dd * cosA;
    const w = R * (1 - cosA) + dd * sinA + EPS;
    return O.clone().add(T3.clone().multiplyScalar(t))
      .add(U3.clone().multiplyScalar(u)).add(W3.clone().multiplyScalar(w));
  }

  function tipOuter(t: number, d: number): THREE.Vector3 {
    const dd = Math.max(0, d);
    const u = R * sinA + dd * cosA + TH * sinA;
    const w = R * (1 - cosA) + dd * sinA - TH * cosA + EPS;
    return O.clone().add(T3.clone().multiplyScalar(t))
      .add(U3.clone().multiplyScalar(u)).add(W3.clone().multiplyScalar(w));
  }

  function arcInner(t: number, ang: number): THREE.Vector3 {
    const u = R * Math.sin(ang);
    const w = R * (1 - Math.cos(ang)) + EPS;
    return O.clone().add(T3.clone().multiplyScalar(t))
      .add(U3.clone().multiplyScalar(u)).add(W3.clone().multiplyScalar(w));
  }

  function arcOuter(t: number, ang: number): THREE.Vector3 {
    const s = Math.sin(ang);
    const c = Math.cos(ang);
    const u = R * s + TH * s;
    const w = R * (1 - c) - TH * c + EPS;
    return O.clone().add(T3.clone().multiplyScalar(t))
      .add(U3.clone().multiplyScalar(u)).add(W3.clone().multiplyScalar(w));
  }

  const locs = movPoly.map(p => toLocal(p));
  const DTOL = 1.0;

  const foldTs = locs.filter(l => l.d < DTOL).map(l => l.t);
  if (foldTs.length < 2) return null;
  const tMin = Math.min(...foldTs);
  const tMax = Math.max(...foldTs);

  // ═══════ ARC GEOMETRY — polygon-bounded with smooth inner/outer ═══════
  const arcVerts: number[] = [];
  const arcNormals: number[] = [];
  const arcIdx: number[] = [];
  let arcVi = 0;
  function addArcV(v: THREE.Vector3, n: THREE.Vector3): number {
    arcVerts.push(v.x, v.y, v.z);
    arcNormals.push(n.x, n.y, n.z);
    return arcVi++;
  }

  const ARC_N = 24;

  // Uniform t-range for ALL arc steps — the arc is a clean cylinder along the fold line
  interface ArcStep {
    ang: number;
    tLI: number; tRI: number;
    tLO: number; tRO: number;
  }
  const arcSteps: ArcStep[] = [];
  for (let i = 0; i <= ARC_N; i++) {
    const ang = A * (i / ARC_N);
    arcSteps.push({ ang, tLI: tMin, tRI: tMax, tLO: tMin, tRO: tMax });
  }

  // Inner surface — smooth normals pointing toward center of curvature
  const innerVi: [number, number][] = [];
  for (let i = 0; i <= ARC_N; i++) {
    const { ang, tLI, tRI } = arcSteps[i];
    const n = U3.clone().multiplyScalar(-Math.sin(ang))
      .add(W3.clone().multiplyScalar(Math.cos(ang)));
    innerVi.push([
      addArcV(arcInner(tLI, ang), n),
      addArcV(arcInner(tRI, ang), n),
    ]);
  }
  for (let i = 0; i < ARC_N; i++) {
    const c = innerVi[i], n = innerVi[i + 1];
    arcIdx.push(c[0], c[1], n[1], c[0], n[1], n[0]);
  }

  // Outer surface — smooth normals pointing away from center
  const outerVi: [number, number][] = [];
  for (let i = 0; i <= ARC_N; i++) {
    const { ang, tLO, tRO } = arcSteps[i];
    const n = U3.clone().multiplyScalar(Math.sin(ang))
      .add(W3.clone().multiplyScalar(-Math.cos(ang)));
    outerVi.push([
      addArcV(arcOuter(tLO, ang), n),
      addArcV(arcOuter(tRO, ang), n),
    ]);
  }
  for (let i = 0; i < ARC_N; i++) {
    const c = outerVi[i], n = outerVi[i + 1];
    arcIdx.push(c[0], n[0], n[1], c[0], n[1], c[1]);
  }

  // Left side surface — follows polygon left boundary with per-face normals
  for (let i = 0; i < ARC_N; i++) {
    const cStep = arcSteps[i], nStep = arcSteps[i + 1];
    const p0 = arcInner(cStep.tLI, cStep.ang);
    const p1 = arcOuter(cStep.tLO, cStep.ang);
    const p2 = arcInner(nStep.tLI, nStep.ang);
    const p3 = arcOuter(nStep.tLO, nStep.ang);

    const e1 = new THREE.Vector3().subVectors(p2, p0);
    const e2 = new THREE.Vector3().subVectors(p1, p0);
    const fN = new THREE.Vector3().crossVectors(e1, e2).normalize();

    const v0 = addArcV(p0, fN);
    const v1 = addArcV(p1, fN);
    const v2 = addArcV(p2, fN);
    const v3 = addArcV(p3, fN);
    arcIdx.push(v0, v1, v3, v0, v3, v2);
  }

  // Right side surface — follows polygon right boundary with per-face normals
  for (let i = 0; i < ARC_N; i++) {
    const cStep = arcSteps[i], nStep = arcSteps[i + 1];
    const p0 = arcInner(cStep.tRI, cStep.ang);
    const p1 = arcOuter(cStep.tRO, cStep.ang);
    const p2 = arcInner(nStep.tRI, nStep.ang);
    const p3 = arcOuter(nStep.tRO, nStep.ang);

    const e1 = new THREE.Vector3().subVectors(p2, p0);
    const e2 = new THREE.Vector3().subVectors(p1, p0);
    const fN = new THREE.Vector3().crossVectors(e2, e1).normalize();

    const v0 = addArcV(p0, fN);
    const v1 = addArcV(p1, fN);
    const v2 = addArcV(p2, fN);
    const v3 = addArcV(p3, fN);
    arcIdx.push(v0, v2, v3, v0, v3, v1);
  }

  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcVerts, 3));
  arcGeo.setAttribute('normal', new THREE.Float32BufferAttribute(arcNormals, 3));
  arcGeo.setIndex(arcIdx);

  // ═══════ TIP GEOMETRY — flat shading for sharp edges ═══════
  const tipVerts: number[] = [];
  const tipIdx: number[] = [];
  let tipVi = 0;
  function addTipV(v: THREE.Vector3): number {
    tipVerts.push(v.x, v.y, v.z);
    return tipVi++;
  }

  const tI = locs.map(l => addTipV(tipInner(l.t, l.d)));
  const tO = locs.map(l => addTipV(tipOuter(l.t, l.d)));

  for (let i = 1; i < tI.length - 1; i++) {
    tipIdx.push(tI[0], tI[i], tI[i + 1]);
    tipIdx.push(tO[0], tO[i + 1], tO[i]);
  }

  for (let i = 0; i < locs.length; i++) {
    const j = (i + 1) % locs.length;
    if (locs[i].d < DTOL && locs[j].d < DTOL) continue;
    tipIdx.push(tI[i], tI[j], tO[j]);
    tipIdx.push(tI[i], tO[j], tO[i]);
  }

  const tipIndexed = new THREE.BufferGeometry();
  tipIndexed.setAttribute('position', new THREE.Float32BufferAttribute(tipVerts, 3));
  tipIndexed.setIndex(tipIdx);
  const tipGeo = tipIndexed.toNonIndexed();
  tipGeo.computeVertexNormals();

  return { arc: arcGeo, tip: tipGeo };
}

/**
 * Compute the 3D positions for both bend tangent lines of a fold,
 * wrapping around the cross-section at the start and end of the bend arc.
 */
export function computeFoldBendLines(
  profile: Point2D[],
  fold: Fold,
  thickness: number,
): { bendStart: THREE.Vector3[]; bendEnd: THREE.Vector3[] } {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const fs = { x: minX + fold.lineStart.x, y: minY + fold.lineStart.y };
  const fe = { x: minX + fold.lineEnd.x, y: minY + fold.lineEnd.y };
  const edx = fe.x - fs.x;
  const edy = fe.y - fs.y;
  const eLen = Math.hypot(edx, edy);
  if (eLen < 0.01) return { bendStart: [], bendEnd: [] };

  const tang = { x: edx / eLen, y: edy / eLen };
  const norm = getFoldNormal(fold, faceW, faceH);

  const negN = { x: -norm.x, y: -norm.y };
  const movPoly = clipPolygonByLine([...profile], fs, negN);
  if (movPoly.length < 3) return { bendStart: [], bendEnd: [] };

  const locs = movPoly.map(p => {
    const vx = p.x - fs.x;
    const vy = p.y - fs.y;
    return { t: vx * tang.x + vy * tang.y, d: vx * norm.x + vy * norm.y };
  });
  const foldTs = locs.filter(l => l.d < 1.0).map(l => l.t);
  if (foldTs.length < 2) return { bendStart: [], bendEnd: [] };
  const tMin = Math.min(...foldTs);
  const tMax = Math.max(...foldTs);

  const dir = fold.direction ?? 'up';
  const dSign = dir === 'up' ? 1 : -1;
  const z0 = dir === 'up' ? thickness : 0;
  const O = new THREE.Vector3(fs.x, fs.y, z0);
  const T3 = new THREE.Vector3(tang.x, tang.y, 0);
  const U3 = new THREE.Vector3(norm.x, norm.y, 0);
  const W3 = new THREE.Vector3(0, 0, dSign);

  const A = (fold.angle * Math.PI) / 180;
  const R = fold.bendRadius;
  const TH = thickness;
  const W_EPS = 0.02;

  function pos(t: number, u: number, w: number): THREE.Vector3 {
    return O.clone()
      .add(T3.clone().multiplyScalar(t))
      .add(U3.clone().multiplyScalar(u))
      .add(W3.clone().multiplyScalar(w));
  }

  // Bend start line (angle = 0): closed loop around cross-section
  const bendStart = [
    pos(tMin, 0, W_EPS),
    pos(tMax, 0, W_EPS),
    pos(tMax, 0, -TH + W_EPS),
    pos(tMin, 0, -TH + W_EPS),
    pos(tMin, 0, W_EPS),
  ];

  // Bend end line (angle = A): uniform t-range matching the cylinder
  const sA = Math.sin(A);
  const cA = Math.cos(A);
  const e_iu = R * sA;
  const e_iw = R * (1 - cA) + W_EPS;
  const e_ou = R * sA + TH * sA;
  const e_ow = R * (1 - cA) - TH * cA + W_EPS;

  const bendEnd = [
    pos(tMin, e_iu, e_iw),
    pos(tMax, e_iu, e_iw),
    pos(tMax, e_ou, e_ow),
    pos(tMin, e_ou, e_ow),
    pos(tMin, e_iu, e_iw),
  ];

  return { bendStart, bendEnd };
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

/**
 * Determine if a fold is a sub-fold of another fold (its fold line midpoint
 * lies inside another fold's moving region). Returns the parent fold's ID, or null.
 */
export function getFoldParentId(
  fold: Fold,
  allFolds: Fold[],
  profile: Point2D[],
): string | null {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const foldMidX = minX + (fold.lineStart.x + fold.lineEnd.x) / 2;
  const foldMidY = minY + (fold.lineStart.y + fold.lineEnd.y) / 2;

  let bestParent: Fold | null = null;
  let smallestArea = Infinity;

  for (const other of allFolds) {
    if (other.id === fold.id) continue;
    const otherNorm = getFoldNormal(other, faceW, faceH);
    const otherFs = { x: minX + other.lineStart.x, y: minY + other.lineStart.y };

    // Is this fold's midpoint on the other fold's moving side?
    const dot = (foldMidX - otherFs.x) * otherNorm.x + (foldMidY - otherFs.y) * otherNorm.y;
    if (dot > 1) {
      const otherNegN = { x: -otherNorm.x, y: -otherNorm.y };
      const otherMov = clipPolygonByLine([...profile], otherFs, otherNegN);
      const area = polygonArea(otherMov);
      if (area < smallestArea) {
        bestParent = other;
        smallestArea = area;
      }
    }
  }

  return bestParent?.id ?? null;
}
