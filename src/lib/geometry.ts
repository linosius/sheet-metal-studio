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

/** A cutout (hole) in the base face — supports circles, rects, and arbitrary polygons */
export interface ProfileCutout {
  type: 'circle' | 'rect' | 'polygon';
  center?: Point2D;
  radius?: number;
  origin?: Point2D;
  width?: number;
  height?: number;
  /** Polygon approximation used for clipping operations */
  polygon: Point2D[];
}

/** Convert a circle to a polygon approximation */
export function circleToPolygon(center: Point2D, radius: number, segments = 32): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

/** Convert a rectangle to a polygon */
export function rectToPolygon(origin: Point2D, width: number, height: number): Point2D[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
}

/**
 * Create an extruded mesh from a profile and thickness, with optional polygon cutouts (holes).
 */
export function createBaseFaceMesh(
  profile: Point2D[],
  thickness: number,
  cutoutPolygons?: Point2D[][],
): THREE.BufferGeometry {
  const shape = profileToShape(profile);

  if (cutoutPolygons && cutoutPolygons.length > 0) {
    for (const poly of cutoutPolygons) {
      if (poly.length < 3) continue;
      const holePath = new THREE.Path();
      holePath.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        holePath.lineTo(poly[i].x, poly[i].y);
      }
      holePath.closePath();
      shape.holes.push(holePath);
    }
  }

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
  const fixedProfile = getFixedProfile(profile, folds, thickness);
  const baseEdges = extractEdges(fixedProfile, thickness);
  const edgeMap = new Map<string, PartEdge>();
  baseEdges.forEach(e => edgeMap.set(e.id, e));

  // Process only base-face folds to add their tip/side edges
  const baseFoldsForEdges = folds.filter(f => isBaseFaceFold(f));
  for (const fold of baseFoldsForEdges) {
    const foldEdge = computeFoldEdge(profile, thickness, fold);
    const { startHeight, endHeight } = getFoldMovingHeights(profile, fold, thickness);
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

/**
 * Data describing a child fold line for clipping the flange tip.
 * Coordinates are in flange-face-local space:
 *   x = along parent edge (0..edgeLen), y = along extension (0..flangeHeight)
 */
export interface FlangeTipClipLine {
  lineStart: Point2D;
  lineEnd: Point2D;
  /** Normal pointing toward the moving (removed) side */
  normal: Point2D;
}

export function createFlangeMesh(
  edge: PartEdge,
  flange: Flange,
  thickness: number,
  childClipLines?: FlangeTipClipLine[],
): THREE.BufferGeometry {
  const bendAngleRad = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;
  const R = flange.bendRadius;
  const H = flange.height;

  const edgeLen = edge.start.distanceTo(edge.end);
  const uDir = edge.normal.clone().normalize();
  const wDir = edge.faceNormal.clone().multiplyScalar(dirSign);
  const edgeDir = new THREE.Vector3().subVectors(edge.end, edge.start).normalize();

  const BEND_SEGMENTS = 12;
  const W_EPSILON = 0.01;

  // ---------- Build 2D cross-section profile (u, w) ----------
  interface CrossSection { iu: number; iw: number; ou: number; ow: number }
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

  const sinA = Math.sin(bendAngleRad);
  const cosA = Math.cos(bendAngleRad);
  const arcEndIU = R * sinA;
  const arcEndIW = R * (1 - cosA);
  const tanU = cosA;
  const tanW = sinA;
  const perpU = sinA;
  const perpW = -cosA;

  // ---------- Build clipped tip polygon in face-local 2D ----------
  // Face-local: x = along edge (0..edgeLen), y = along extension (0..H)
  let tipPoly: Point2D[] = [
    { x: 0, y: 0 },
    { x: edgeLen, y: 0 },
    { x: edgeLen, y: H },
    { x: 0, y: H },
  ];

  if (childClipLines && childClipLines.length > 0) {
    for (const cl of childClipLines) {
      // clipPolygonByLine keeps the side where dot(p - linePoint, normal) <= 0
      // We want to keep the fixed side (opposite to moving), so use the normal as-is
      // (normal points toward moving side = the side to remove)
      tipPoly = clipPolygonByLine(tipPoly, cl.lineStart, cl.normal);
    }
  }

  // ---------- Helper: convert face-local tip point to 3D ----------
  // Face-local (fx, fy) → cross-section (u, w) for inner and outer surfaces
  function tipPointTo3D(fx: number, fy: number, surface: 'inner' | 'outer'): THREE.Vector3 {
    const baseU = arcEndIU + fy * tanU;
    const baseW = arcEndIW + fy * tanW + W_EPSILON;
    const u = surface === 'inner' ? baseU : baseU + thickness * perpU;
    const w = surface === 'inner' ? baseW : baseW + thickness * perpW + W_EPSILON;
    // Position along edge direction
    const base = edge.start.clone().add(edgeDir.clone().multiplyScalar(fx));
    return base.add(uDir.clone().multiplyScalar(u)).add(wDir.clone().multiplyScalar(w));
  }

  // ---------- Build arc geometry (same as before, using full edge length) ----------
  const verts: number[] = [];
  for (const p of arcProfile) {
    const is = edge.start.clone().add(uDir.clone().multiplyScalar(p.iu)).add(wDir.clone().multiplyScalar(p.iw));
    const ie = edge.end.clone().add(uDir.clone().multiplyScalar(p.iu)).add(wDir.clone().multiplyScalar(p.iw));
    const os = edge.start.clone().add(uDir.clone().multiplyScalar(p.ou)).add(wDir.clone().multiplyScalar(p.ow));
    const oe = edge.end.clone().add(uDir.clone().multiplyScalar(p.ou)).add(wDir.clone().multiplyScalar(p.ow));
    verts.push(
      is.x, is.y, is.z,
      ie.x, ie.y, ie.z,
      os.x, os.y, os.z,
      oe.x, oe.y, oe.z,
    );
  }

  const indices: number[] = [];
  const arcN = arcProfile.length;

  // Arc quad strips (inner, outer, left side, right side)
  for (let i = 0; i < arcN - 1; i++) {
    const c = i * 4;
    const n = (i + 1) * 4;
    indices.push(c, n, n + 1, c, n + 1, c + 1);
    indices.push(c + 2, c + 3, n + 3, c + 2, n + 3, n + 2);
    indices.push(c, c + 2, n + 2, c, n + 2, n);
    indices.push(c + 1, n + 1, n + 3, c + 1, n + 3, c + 3);
  }

  // Base cap
  indices.push(0, 3, 1, 0, 2, 3);

  // ---------- Build tip from clipped polygon ----------
  if (tipPoly.length >= 3) {
    // Add tip polygon vertices (inner surface, then outer surface)
    const tipBaseIdx = verts.length / 3;
    for (const p of tipPoly) {
      const v = tipPointTo3D(p.x, p.y, 'inner');
      verts.push(v.x, v.y, v.z);
    }
    const tipOuterBaseIdx = verts.length / 3;
    for (const p of tipPoly) {
      const v = tipPointTo3D(p.x, p.y, 'outer');
      verts.push(v.x, v.y, v.z);
    }

    const nPoly = tipPoly.length;

    // Triangulate inner face (fan from vertex 0)
    for (let i = 1; i < nPoly - 1; i++) {
      indices.push(tipBaseIdx, tipBaseIdx + i, tipBaseIdx + i + 1);
    }
    // Triangulate outer face (reverse winding)
    for (let i = 1; i < nPoly - 1; i++) {
      indices.push(tipOuterBaseIdx, tipOuterBaseIdx + i + 1, tipOuterBaseIdx + i);
    }
    // Side walls (connect inner and outer edges of the tip polygon)
    for (let i = 0; i < nPoly; i++) {
      const j = (i + 1) % nPoly;
      const ii = tipBaseIdx + i;
      const ij = tipBaseIdx + j;
      const oi = tipOuterBaseIdx + i;
      const oj = tipOuterBaseIdx + j;
      indices.push(ii, ij, oj, ii, oj, oi);
    }

    // Connect arc end to tip polygon bottom edge (y=0 edge of the tip)
    // The arc's last ring connects to the tip at y=0. We need to bridge
    // the last arc ring to the tip polygon's bottom boundary.
    // The last arc ring is at index (arcN-1)*4, vertices: [innerStart, innerEnd, outerStart, outerEnd]
    const lastArc = (arcN - 1) * 4;
    // Find tip polygon vertices that lie on y=0 (the bottom edge connecting to the arc)
    // These should be the first two vertices of the unclipped rectangle, but after clipping
    // we need to find them. For the connection, we use the full-width arc end ring.
    // The inner surface quad connecting arc end to tip bottom:
    // Arc end inner: lastArc+0 (start), lastArc+1 (end)
    // Tip inner bottom-left corner should be at (0, 0) and bottom-right at (edgeLen, 0)
    // Find indices in tipPoly closest to y=0
    const bottomTipInnerIndices: number[] = [];
    for (let i = 0; i < nPoly; i++) {
      if (Math.abs(tipPoly[i].y) < 0.01) {
        bottomTipInnerIndices.push(i);
      }
    }
    // If the bottom edge is intact (2 vertices at y≈0), connect arc to tip
    if (bottomTipInnerIndices.length >= 2) {
      // Sort by x to get left-to-right order
      bottomTipInnerIndices.sort((a, b) => tipPoly[a].x - tipPoly[b].x);
      const bL = tipBaseIdx + bottomTipInnerIndices[0];
      const bR = tipBaseIdx + bottomTipInnerIndices[bottomTipInnerIndices.length - 1];
      const obL = tipOuterBaseIdx + bottomTipInnerIndices[0];
      const obR = tipOuterBaseIdx + bottomTipInnerIndices[bottomTipInnerIndices.length - 1];
      // Inner surface: arc end → tip bottom
      indices.push(lastArc, bL, bR, lastArc, bR, lastArc + 1);
      // Outer surface: arc end → tip bottom
      indices.push(lastArc + 2, lastArc + 3, obR, lastArc + 2, obR, obL);
    }
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  indexed.setIndex(indices);

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

/**
 * Compute the distance from the drawn fold line to the physical inner edge of the bend,
 * based on the foldLocation setting:
 * - 'material-inside': 0 (drawn line = inner edge)
 * - 'centerline': thickness / 2
 * - 'material-outside': thickness
 */
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

/**
 * Get the fixed-side portions of cutouts (clipped by all base-face fold lines).
 * Returns polygon arrays suitable for passing to createBaseFaceMesh.
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
 * Get the moving-side portions of cutouts for a specific fold.
 * Returns polygon arrays in world coordinates.
 */
export function getMovingCutouts(
  cutouts: ProfileCutout[],
  fold: Fold,
  profile: Point2D[],
  thickness: number,
): Point2D[][] {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const norm = getFoldNormal(fold, faceW, faceH);
  const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
  const linePoint = {
    x: minX + fold.lineStart.x - norm.x * off,
    y: minY + fold.lineStart.y - norm.y * off,
  };

  const negN = { x: -norm.x, y: -norm.y };

  const result: Point2D[][] = [];
  for (const cutout of cutouts) {
    const poly = clipPolygonByLine([...cutout.polygon], linePoint, negN);
    if (poly.length >= 3) result.push(poly);
  }
  return result;
}

/**
 * Robust computation of blocked t-ranges where cutout polygons cross d=foldD.
 * Three-pass approach:
 *   1) Edge-intersection: polygon edges crossing d=foldD
 *   2) Near-line edges: edges nearly parallel to foldD → take both endpoints
 *   3) Sampling fallback: if no crossings found, sample along t to detect containment
 * This is the SINGLE SOURCE OF TRUTH for blocked intervals.
 */
export function computeFoldBlockedIntervalsTD(
  foldD: number,
  tMin: number,
  tMax: number,
  cutoutPolysTD: Point2D[][],
  eps: number = 0.1,
): [number, number][] {
  const blocked: [number, number][] = [];

  function pointInPoly(px: number, py: number, poly: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  for (const poly of cutoutPolysTD) {
    if (poly.length < 3) continue;

    const events: number[] = [];

    // Pass 1 & 2: edge intersections and near-line edges
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const d1 = poly[i].y - foldD;
      const d2 = poly[j].y - foldD;

      // Near-line: edge nearly on foldD
      if (Math.abs(d1) < eps && Math.abs(d2) < eps) {
        events.push(poly[i].x, poly[j].x);
        continue;
      }

      // One endpoint on line
      if (Math.abs(d1) < eps) { events.push(poly[i].x); continue; }
      if (Math.abs(d2) < eps) { events.push(poly[j].x); continue; }

      // True crossing
      if ((d1 > 0) !== (d2 > 0)) {
        const frac = d1 / (d1 - d2);
        const tCross = poly[i].x + frac * (poly[j].x - poly[i].x);
        events.push(tCross);
      }
    }

    // Deduplicate
    events.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (const e of events) {
      if (uniq.length === 0 || Math.abs(e - uniq[uniq.length - 1]) > eps * 0.5) uniq.push(e);
    }

    if (uniq.length >= 2) {
      // Pair events, verify blocked via midpoint containment
      for (let k = 0; k + 1 < uniq.length; k++) {
        const midT = (uniq[k] + uniq[k + 1]) / 2;
        if (pointInPoly(midT, foldD, poly) || pointInPoly(midT, foldD + eps * 0.1, poly)) {
          const b0 = Math.max(uniq[k], tMin);
          const b1 = Math.min(uniq[k + 1], tMax);
          if (b1 > b0 + 0.01) blocked.push([b0, b1]);
        }
      }
    } else if (uniq.length <= 1) {
      // Pass 3: sampling fallback
      const SAMPLES = 20;
      let insideStart: number | null = null;
      for (let s = 0; s <= SAMPLES; s++) {
        const t = tMin + (tMax - tMin) * (s / SAMPLES);
        const inside = pointInPoly(t, foldD, poly);
        if (inside && insideStart === null) insideStart = t;
        if (!inside && insideStart !== null) {
          blocked.push([insideStart, t]);
          insideStart = null;
        }
      }
      if (insideStart !== null) blocked.push([insideStart, tMax]);
    }
  }

  if (blocked.length === 0) return [];

  // Merge overlapping
  blocked.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[blocked[0][0], blocked[0][1]]];
  for (let i = 1; i < blocked.length; i++) {
    const last = merged[merged.length - 1];
    if (blocked[i][0] <= last[1] + 0.01) {
      last[1] = Math.max(last[1], blocked[i][1]);
    } else {
      merged.push([blocked[i][0], blocked[i][1]]);
    }
  }
  return merged;
}

/**
 * Compute the complement of blocked intervals within [tMin, tMax].
 */
export function complementIntervals(tMin: number, tMax: number, blocked: [number, number][]): [number, number][] {
  if (blocked.length === 0) return [[tMin, tMax]];
  const segs: [number, number][] = [];
  let cursor = tMin;
  for (const [bStart, bEnd] of blocked) {
    if (bStart > cursor + 0.01) segs.push([cursor, bStart]);
    cursor = Math.max(cursor, bEnd);
  }
  if (tMax > cursor + 0.01) segs.push([cursor, tMax]);
  return segs;
}

/**
 * Compute the fold line local coordinate system and blocked intervals for a fold.
 * This is the SINGLE SOURCE OF TRUTH for fold-line topology.
 */
export function computeFoldLineInfo(
  fold: Fold,
  profile: Point2D[],
  thickness: number,
  movingCutouts?: Point2D[][],
): {
  linePoint: Point2D; tangent: Point2D; normal: Point2D;
  tMin: number; tMax: number;
  blocked: [number, number][];
  bendSegments: [number, number][];
} | null {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const norm = getFoldNormal(fold, faceW, faceH);
  const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
  const fs = { x: minX + fold.lineStart.x - norm.x * off, y: minY + fold.lineStart.y - norm.y * off };
  const fe = { x: minX + fold.lineEnd.x - norm.x * off, y: minY + fold.lineEnd.y - norm.y * off };
  const edx = fe.x - fs.x;
  const edy = fe.y - fs.y;
  const eLen = Math.hypot(edx, edy);
  if (eLen < 0.01) return null;

  const tang = { x: edx / eLen, y: edy / eLen };

  function toLocal(p: Point2D): { t: number; d: number } {
    const vx = p.x - fs.x;
    const vy = p.y - fs.y;
    return { t: vx * tang.x + vy * tang.y, d: vx * norm.x + vy * norm.y };
  }

  const profileLocs = profile.map(p => toLocal(p));
  const foldTs = profileLocs.filter(l => l.d < 1.0).map(l => l.t);
  if (foldTs.length < 2) return null;
  const tMin = Math.min(...foldTs);
  const tMax = Math.max(...foldTs);

  // Convert moving cutouts to TD space using the SAME toLocal mapping
  let cutoutsTD: Point2D[][] = [];
  if (movingCutouts && movingCutouts.length > 0) {
    for (const cutPoly of movingCutouts) {
      const locs = cutPoly.map(p => toLocal(p));
      if (locs.length >= 3) {
        cutoutsTD.push(locs.map(l => ({ x: l.t, y: l.d })));
      }
    }
  }

  const blocked = computeFoldBlockedIntervalsTD(0, tMin, tMax, cutoutsTD);
  const bendSegments = complementIntervals(tMin, tMax, blocked);

  return { linePoint: fs, tangent: tang, normal: norm, tMin, tMax, blocked, bendSegments };
}

/**
 * Build segmented sidewall quads along a fold edge for unblocked segments only.
 * This replaces the ExtrudeGeometry sidewalls along the fold line deterministically.
 */
export function buildFoldEdgeSidewalls(
  foldLineInfo: {
    linePoint: Point2D; tangent: Point2D;
    bendSegments: [number, number][];
  },
  thickness: number,
): THREE.BufferGeometry {
  const { linePoint, tangent, bendSegments } = foldLineInfo;
  const verts: number[] = [];
  const indices: number[] = [];
  let vi = 0;

  for (const [t0, t1] of bendSegments) {
    const x0 = linePoint.x + tangent.x * t0;
    const y0 = linePoint.y + tangent.y * t0;
    const x1 = linePoint.x + tangent.x * t1;
    const y1 = linePoint.y + tangent.y * t1;

    // v0: (t0, z=0), v1: (t1, z=0), v2: (t1, z=thickness), v3: (t0, z=thickness)
    verts.push(x0, y0, 0);
    verts.push(x1, y1, 0);
    verts.push(x1, y1, thickness);
    verts.push(x0, y0, thickness);

    indices.push(vi, vi + 1, vi + 2);
    indices.push(vi, vi + 2, vi + 3);
    vi += 4;
  }

  const geo = new THREE.BufferGeometry();
  if (verts.length > 0) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Remove ALL sidewall triangles along a fold line from an ExtrudeGeometry.
 * We rebuild correct segmented sidewalls separately via buildFoldEdgeSidewalls.
 */
export function removeAllFoldEdgeSidewalls(
  geometry: THREE.BufferGeometry,
  foldLines: { linePoint: Point2D; tangent: Point2D; normal: Point2D; tMin: number; tMax: number }[],
): void {
  const pos = geometry.getAttribute('position');
  const idx = geometry.getIndex();
  if (!idx) return;

  const newIdx: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const verts = [a, b, c].map(vi => ({
      x: pos.getX(vi), y: pos.getY(vi), z: pos.getZ(vi),
    }));

    let remove = false;
    for (const fl of foldLines) {
      const ds = verts.map(v =>
        (v.x - fl.linePoint.x) * fl.normal.x + (v.y - fl.linePoint.y) * fl.normal.y
      );
      if (!ds.every(d => Math.abs(d) < 1.0)) continue;

      const ts = verts.map(v =>
        (v.x - fl.linePoint.x) * fl.tangent.x + (v.y - fl.linePoint.y) * fl.tangent.y
      );
      const minT = Math.min(...ts);
      const maxT = Math.max(...ts);
      if (maxT > fl.tMin - 0.5 && minT < fl.tMax + 0.5) {
        remove = true;
        break;
      }
    }

    if (!remove) {
      newIdx.push(a, b, c);
    }
  }

  geometry.setIndex(newIdx);
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

  const normal2d = getFoldNormal(fold, faceWidth, faceHeight);
  const outwardNormal = new THREE.Vector3(normal2d.x, normal2d.y, 0);

  // Shift from drawn fold line to physical inner edge of bend
  const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
  const start3d = new THREE.Vector3(
    minX + fold.lineStart.x - normal2d.x * off,
    minY + fold.lineStart.y - normal2d.y * off,
    z,
  );
  const end3d = new THREE.Vector3(
    minX + fold.lineEnd.x - normal2d.x * off,
    minY + fold.lineEnd.y - normal2d.y * off,
    z,
  );

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
export function getFixedProfile(profile: Point2D[], folds: Fold[], thickness: number = 0): Point2D[] {
  // Only base-face folds clip the base profile
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
 * Get the moving portion heights for a fold (different at each end for angled folds).
 * startHeight corresponds to fold.lineStart, endHeight to fold.lineEnd.
 */
export function getFoldMovingHeights(
  profile: Point2D[],
  fold: Fold,
  thickness: number = 0,
): { startHeight: number; endHeight: number } {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceWidth = Math.max(...xs) - minX;
  const faceHeight = Math.max(...ys) - minY;

  const normal = getFoldNormal(fold, faceWidth, faceHeight);
  // Shift reference to inner edge
  const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
  const fs = {
    x: minX + fold.lineStart.x - normal.x * off,
    y: minY + fold.lineStart.y - normal.y * off,
  };

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
  childFolds?: Fold[],
  movingCutouts?: Point2D[][],
): { arc: THREE.BufferGeometry; tip: THREE.BufferGeometry } | null {
  const xs = profile.map(p => p.x);
  const ys = profile.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const faceW = Math.max(...xs) - minX;
  const faceH = Math.max(...ys) - minY;

  const norm = getFoldNormal(fold, faceW, faceH);

  // Shift from drawn fold line to inner edge
  const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
  const fs = { x: minX + fold.lineStart.x - norm.x * off, y: minY + fold.lineStart.y - norm.y * off };
  const fe = { x: minX + fold.lineEnd.x - norm.x * off, y: minY + fold.lineEnd.y - norm.y * off };
  const edx = fe.x - fs.x;
  const edy = fe.y - fs.y;
  const eLen = Math.hypot(edx, edy);
  if (eLen < 0.01) return null;

  const tang = { x: edx / eLen, y: edy / eLen };

  const negN = { x: -norm.x, y: -norm.y };
  let movPoly = clipPolygonByLine([...profile], fs, negN);
  if (movPoly.length < 3) return null;

  const myArea = polygonArea(movPoly);
  for (const other of otherFolds) {
    const otherNorm = getFoldNormal(other, faceW, faceH);
    const otherOff = foldLineToInnerEdgeOffset(other.foldLocation, thickness);
    const otherFs = { x: minX + other.lineStart.x - otherNorm.x * otherOff, y: minY + other.lineStart.y - otherNorm.y * otherOff };
    const otherNegN = { x: -otherNorm.x, y: -otherNorm.y };
    const otherMov = clipPolygonByLine([...profile], otherFs, otherNegN);
    const otherArea = polygonArea(otherMov);
    if (otherArea < myArea * 0.99) {
      movPoly = clipPolygonByLine(movPoly, otherFs, otherNorm);
    }
  }
  if (movPoly.length < 3) return null;

  // ── Clip by child folds (sub-folds on this fold's face) ──
  if (childFolds && childFolds.length > 0) {
    for (const child of childFolds) {
      // Convert child fold line from fold-face-local to base face coords
      const cls = {
        x: fs.x + child.lineStart.x * tang.x + child.lineStart.y * norm.x,
        y: fs.y + child.lineStart.x * tang.y + child.lineStart.y * norm.y,
      };
      const cle = {
        x: fs.x + child.lineEnd.x * tang.x + child.lineEnd.y * norm.x,
        y: fs.y + child.lineEnd.x * tang.y + child.lineEnd.y * norm.y,
      };
      const cdx = cle.x - cls.x;
      const cdy = cle.y - cls.y;
      const clen = Math.hypot(cdx, cdy);
      if (clen < 0.01) continue;
      let cnx = cdy / clen;
      let cny = -cdx / clen;
      // Keep the side containing the fold edge (fs) — that's the "fixed" side
      const dotFs = (fs.x - cls.x) * cnx + (fs.y - cls.y) * cny;
      if (dotFs > 0) { cnx = -cnx; cny = -cny; }
      movPoly = clipPolygonByLine(movPoly, cls, { x: cnx, y: cny });
    }
    if (movPoly.length < 3) return null;
  }

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
  const EPS = 0;

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

  // ── Convert cutouts to (t,d) space early for bend-line splitting ──
  const holeLocs: { t: number; d: number }[][] = [];
  const tipHolePoly: Point2D[][] = [];
  if (movingCutouts && movingCutouts.length > 0) {
    for (const cutPoly of movingCutouts) {
      const cutLocs = cutPoly.map(p => toLocal(p));
      if (cutLocs.length < 3) continue;
      holeLocs.push(cutLocs);
      tipHolePoly.push(cutLocs.map(l => ({ x: l.t, y: l.d })));
    }
  }

  // ── Split bend line using the SINGLE SOURCE OF TRUTH ──
  const blocked = computeFoldBlockedIntervalsTD(0, tMin, tMax, tipHolePoly);
  const bendSegments = complementIntervals(tMin, tMax, blocked);

  if (bendSegments.length === 0) return null;

  // ── Compute global polygon-edge slopes for tapering ──
  let globalLeftSlope = 0, globalRightSlope = 0;
  let globalLeftAdjD = Infinity, globalRightAdjD = Infinity;

  const foldIdxs: number[] = [];
  for (let fi = 0; fi < locs.length; fi++) {
    if (locs[fi].d < DTOL) foldIdxs.push(fi);
  }
  if (foldIdxs.length >= 2) {
    let leftIdx = foldIdxs[0];
    for (const fi of foldIdxs) { if (locs[fi].t < locs[leftIdx].t) leftIdx = fi; }
    const ln1 = (leftIdx - 1 + locs.length) % locs.length;
    const ln2 = (leftIdx + 1) % locs.length;
    const lAdj = locs[ln1].d >= DTOL ? locs[ln1] : (locs[ln2].d >= DTOL ? locs[ln2] : null);
    if (lAdj && lAdj.d > DTOL) {
      globalLeftSlope = (lAdj.t - tMin) / lAdj.d;
      globalLeftAdjD = lAdj.d;
    }
    let rightIdx = foldIdxs[0];
    for (const fi of foldIdxs) { if (locs[fi].t > locs[rightIdx].t) rightIdx = fi; }
    const rn1 = (rightIdx - 1 + locs.length) % locs.length;
    const rn2 = (rightIdx + 1) % locs.length;
    const rAdj = locs[rn1].d >= DTOL ? locs[rn1] : (locs[rn2].d >= DTOL ? locs[rn2] : null);
    if (rAdj && rAdj.d > DTOL) {
      globalRightSlope = (rAdj.t - tMax) / rAdj.d;
      globalRightAdjD = rAdj.d;
    }
  }

  const K_FACTOR = 0.44;
  const BA_taper = (R + K_FACTOR * TH) * A;
  const R_neutral = R + K_FACTOR * TH;

  // Point-in-polygon test (ray casting)
  function pointInPolygon(px: number, py: number, poly: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // movPoly as Point2D for clipping
  const movPolyPts: Point2D[] = locs.map(l => ({ x: l.t, y: l.d }));

  // ═══════ ACCUMULATORS ═══════
  const arcVerts: number[] = [];
  const arcNormals: number[] = [];
  const arcIdx: number[] = [];
  let arcVi = 0;
  function addArcV(v: THREE.Vector3, n: THREE.Vector3): number {
    arcVerts.push(v.x, v.y, v.z);
    arcNormals.push(n.x, n.y, n.z);
    return arcVi++;
  }

  const tipVerts: number[] = [];
  const tipNormals: number[] = [];
  const tipIdx: number[] = [];
  let tipVi = 0;
  function addTipV(v: THREE.Vector3, n: THREE.Vector3): number {
    tipVerts.push(v.x, v.y, v.z);
    tipNormals.push(n.x, n.y, n.z);
    return tipVi++;
  }

  const ARC_N = 24;
  const GRID_T = 40;
  const GRID_THETA = ARC_N;
  const nTipInner = U3.clone().multiplyScalar(-sinA).add(W3.clone().multiplyScalar(cosA));
  const nTipOuter = U3.clone().multiplyScalar(sinA).add(W3.clone().multiplyScalar(-cosA));

  interface ArcStep {
    ang: number;
    tLI: number; tRI: number;
    tLO: number; tRO: number;
  }

  // ═══════ PER-SEGMENT GENERATION ═══════
  for (const [segTMin, segTMax] of bendSegments) {
    const isLeftEdge = Math.abs(segTMin - tMin) < 0.1;
    const isRightEdge = Math.abs(segTMax - tMax) < 0.1;
    const segLeftSlope = isLeftEdge ? globalLeftSlope : 0;
    const segRightSlope = isRightEdge ? globalRightSlope : 0;
    const segLeftAdjD = isLeftEdge ? globalLeftAdjD : Infinity;
    const segRightAdjD = isRightEdge ? globalRightAdjD : Infinity;

    // ── ARC for this segment ──
    const arcSteps: ArcStep[] = [];
    for (let i = 0; i <= ARC_N; i++) {
      const ang = A * (i / ARC_N);
      const d_eq = BA_taper * (i / ARC_N);
      const tL = segTMin + segLeftSlope * Math.min(d_eq, segLeftAdjD);
      const tR = segTMax + segRightSlope * Math.min(d_eq, segRightAdjD);
      arcSteps.push({ ang, tLI: tL, tRI: tR, tLO: tL, tRO: tR });
    }

    // Convert cutouts to (t, θ) space for this segment
    const segArcHoleLocs: Point2D[][] = [];
    for (const hLocs of holeLocs) {
      const cutTTheta: Point2D[] = hLocs.map(l => ({ x: l.t, y: l.d / R_neutral }));
      if (cutTTheta.length < 3) continue;
      const minTheta = Math.min(...cutTTheta.map(p => p.y));
      const maxTheta = Math.max(...cutTTheta.map(p => p.y));
      if (!(maxTheta > 0.001 && minTheta < A - 0.001)) continue;
      let clipped = [...cutTTheta];
      clipped = clipPolygonByLine(clipped, { x: 0, y: 0 }, { x: 0, y: -1 });
      clipped = clipPolygonByLine(clipped, { x: 0, y: A }, { x: 0, y: 1 });
      clipped = clipPolygonByLine(clipped, { x: segTMin - 0.1, y: 0 }, { x: -1, y: 0 });
      clipped = clipPolygonByLine(clipped, { x: segTMax + 0.1, y: 0 }, { x: 1, y: 0 });
      if (clipped.length < 3) continue;
      segArcHoleLocs.push(clipped);
    }

    function segIsInsideAnyArcHole(t: number, theta: number): boolean {
      for (const hole of segArcHoleLocs) {
        if (pointInPolygon(t, theta, hole)) return true;
      }
      return false;
    }

    function segCellOverlapsArcHole(it: number, ia: number): boolean {
      if (segArcHoleLocs.length === 0) return false;
      const samples = [
        { itF: it + 0.5, iaF: ia + 0.5 },
        { itF: it, iaF: ia },
        { itF: it + 1, iaF: ia },
        { itF: it, iaF: ia + 1 },
        { itF: it + 1, iaF: ia + 1 },
      ];
      for (const s of samples) {
        const theta = A * (s.iaF / GRID_THETA);
        const d_eq = BA_taper * (s.iaF / GRID_THETA);
        const tL = segTMin + segLeftSlope * Math.min(d_eq, segLeftAdjD);
        const tR = segTMax + segRightSlope * Math.min(d_eq, segRightAdjD);
        const t = tL + (tR - tL) * (s.itF / GRID_T);
        if (segIsInsideAnyArcHole(t, theta)) return true;
      }
      return false;
    }

    // Build inner arc surface
    const segInnerVIdx: number[][] = [];
    for (let it = 0; it <= GRID_T; it++) {
      segInnerVIdx[it] = [];
      for (let ia = 0; ia <= GRID_THETA; ia++) {
        const theta = A * (ia / GRID_THETA);
        const d_eq = BA_taper * (ia / GRID_THETA);
        const tL = segTMin + segLeftSlope * Math.min(d_eq, segLeftAdjD);
        const tR = segTMax + segRightSlope * Math.min(d_eq, segRightAdjD);
        const t = tL + (tR - tL) * (it / GRID_T);
        const v = arcInner(t, theta);
        const n = U3.clone().multiplyScalar(-Math.sin(theta))
          .add(W3.clone().multiplyScalar(Math.cos(theta)));
        segInnerVIdx[it][ia] = addArcV(v, n);
      }
    }

    // Inner triangles
    for (let it = 0; it < GRID_T; it++) {
      for (let ia = 0; ia < GRID_THETA; ia++) {
        if (segCellOverlapsArcHole(it, ia)) continue;
        const v00 = segInnerVIdx[it][ia];
        const v10 = segInnerVIdx[it + 1][ia];
        const v01 = segInnerVIdx[it][ia + 1];
        const v11 = segInnerVIdx[it + 1][ia + 1];
        arcIdx.push(v00, v10, v11, v00, v11, v01);
      }
    }

    // Build outer arc surface
    const segOuterVIdx: number[][] = [];
    for (let it = 0; it <= GRID_T; it++) {
      segOuterVIdx[it] = [];
      for (let ia = 0; ia <= GRID_THETA; ia++) {
        const theta = A * (ia / GRID_THETA);
        const d_eq = BA_taper * (ia / GRID_THETA);
        const tL = segTMin + segLeftSlope * Math.min(d_eq, segLeftAdjD);
        const tR = segTMax + segRightSlope * Math.min(d_eq, segRightAdjD);
        const t = tL + (tR - tL) * (it / GRID_T);
        const v = arcOuter(t, theta);
        const n = U3.clone().multiplyScalar(Math.sin(theta))
          .add(W3.clone().multiplyScalar(-Math.cos(theta)));
        segOuterVIdx[it][ia] = addArcV(v, n);
      }
    }

    // Outer triangles (reversed winding)
    for (let it = 0; it < GRID_T; it++) {
      for (let ia = 0; ia < GRID_THETA; ia++) {
        if (segCellOverlapsArcHole(it, ia)) continue;
        const v00 = segOuterVIdx[it][ia];
        const v10 = segOuterVIdx[it + 1][ia];
        const v01 = segOuterVIdx[it][ia + 1];
        const v11 = segOuterVIdx[it + 1][ia + 1];
        arcIdx.push(v00, v11, v10, v00, v01, v11);
      }
    }

    // Left side surface
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

    // Right side surface
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

    // Arc hole side walls
    for (const holePts of segArcHoleLocs) {
      for (let i = 0; i < holePts.length; i++) {
        const j = (i + 1) % holePts.length;
        const pII = arcInner(holePts[i].x, holePts[i].y);
        const pIJ = arcInner(holePts[j].x, holePts[j].y);
        const pOI = arcOuter(holePts[i].x, holePts[i].y);
        const pOJ = arcOuter(holePts[j].x, holePts[j].y);
        const e1 = new THREE.Vector3().subVectors(pIJ, pII);
        const e2 = new THREE.Vector3().subVectors(pOI, pII);
        const sN = new THREE.Vector3().crossVectors(e1, e2).normalize();
        const sII = addArcV(pII, sN);
        const sIJ = addArcV(pIJ, sN);
        const sOJ = addArcV(pOJ, sN);
        const sOI = addArcV(pOI, sN);
        arcIdx.push(sII, sIJ, sOJ, sII, sOJ, sOI);
      }
    }

    // ── TIP for this segment ──
    // Clip movPoly to segment t-range
    let segTipPoly: Point2D[] = [...movPolyPts];
    segTipPoly = clipPolygonByLine(segTipPoly, { x: segTMin, y: 0 }, { x: -1, y: 0 });
    segTipPoly = clipPolygonByLine(segTipPoly, { x: segTMax, y: 0 }, { x: 1, y: 0 });
    if (segTipPoly.length < 3) continue;

    // Taper for this segment
    const segArcEndStep = arcSteps[ARC_N];
    const seg_tL_end = segArcEndStep.tLI;
    const seg_tR_end = segArcEndStep.tRI;
    function segTaperT(t: number, d: number): number {
      if (d < DTOL && segTMax > segTMin) {
        const frac = (t - segTMin) / (segTMax - segTMin);
        return seg_tL_end + frac * (seg_tR_end - seg_tL_end);
      }
      return t;
    }

    // Collect interior holes for this segment (not touching d=0 within segment)
    const segTipHoles: Point2D[][] = [];
    for (const hPts of tipHolePoly) {
      let clipped = [...hPts];
      clipped = clipPolygonByLine(clipped, { x: segTMin - 0.1, y: 0 }, { x: -1, y: 0 });
      clipped = clipPolygonByLine(clipped, { x: segTMax + 0.1, y: 0 }, { x: 1, y: 0 });
      if (clipped.length < 3) continue;
      // Skip holes that touch d=0 within this segment (they caused the bend-line split)
      const nearBend = clipped.filter(v => v.y < DTOL && v.x > segTMin - 0.1 && v.x < segTMax + 0.1);
      if (nearBend.length >= 2) continue;
      segTipHoles.push(clipped);
    }

    // Create THREE.Shape from clipped tip polygon
    const segTipShape = new THREE.Shape();
    segTipShape.moveTo(segTipPoly[0].x, segTipPoly[0].y);
    for (let i = 1; i < segTipPoly.length; i++) {
      segTipShape.lineTo(segTipPoly[i].x, segTipPoly[i].y);
    }
    segTipShape.closePath();

    for (const ih of segTipHoles) {
      if (ih.length < 3) continue;
      const holePath = new THREE.Path();
      holePath.moveTo(ih[0].x, ih[0].y);
      for (let i = 1; i < ih.length; i++) {
        holePath.lineTo(ih[i].x, ih[i].y);
      }
      holePath.closePath();
      segTipShape.holes.push(holePath);
    }

    const segTipShapeGeo = new THREE.ShapeGeometry(segTipShape);
    const segTipPositions = segTipShapeGeo.getAttribute('position');
    const segTipShapeIndex = segTipShapeGeo.getIndex();

    // Map 2D (t,d) vertices to 3D for inner and outer surfaces
    const segTipInnerBase = tipVi;
    for (let vi = 0; vi < segTipPositions.count; vi++) {
      const t_raw = segTipPositions.getX(vi);
      const d = segTipPositions.getY(vi);
      const t = segTaperT(t_raw, d);
      addTipV(tipInner(t, d), nTipInner);
    }
    const segTipOuterBase = tipVi;
    for (let vi = 0; vi < segTipPositions.count; vi++) {
      const t_raw = segTipPositions.getX(vi);
      const d = segTipPositions.getY(vi);
      const t = segTaperT(t_raw, d);
      addTipV(tipOuter(t, d), nTipOuter);
    }

    if (segTipShapeIndex) {
      for (let i = 0; i < segTipShapeIndex.count; i += 3) {
        const a = segTipShapeIndex.getX(i);
        const b = segTipShapeIndex.getX(i + 1);
        const c = segTipShapeIndex.getX(i + 2);
        tipIdx.push(segTipInnerBase + a, segTipInnerBase + b, segTipInnerBase + c);
        tipIdx.push(segTipOuterBase + a, segTipOuterBase + c, segTipOuterBase + b);
      }
    }
    segTipShapeGeo.dispose();

    // Tip side walls — outer boundary
    const segTipLocs = segTipPoly.map(p => ({ t: segTaperT(p.x, p.y), d: p.y }));
    for (let i = 0; i < segTipLocs.length; i++) {
      const j = (i + 1) % segTipLocs.length;
      if (segTipLocs[i].d < DTOL && segTipLocs[j].d < DTOL) continue;
      const pII = tipInner(segTipLocs[i].t, segTipLocs[i].d);
      const pIJ = tipInner(segTipLocs[j].t, segTipLocs[j].d);
      const pOI = tipOuter(segTipLocs[i].t, segTipLocs[i].d);
      const pOJ = tipOuter(segTipLocs[j].t, segTipLocs[j].d);
      const e1 = new THREE.Vector3().subVectors(pIJ, pII);
      const e2 = new THREE.Vector3().subVectors(pOI, pII);
      const sideN = new THREE.Vector3().crossVectors(e1, e2).normalize();
      const sII = addTipV(pII, sideN);
      const sIJ = addTipV(pIJ, sideN);
      const sOJ = addTipV(pOJ, sideN);
      const sOI = addTipV(pOI, sideN);
      tipIdx.push(sII, sIJ, sOJ, sII, sOJ, sOI);
    }

    // Tip side walls — interior holes
    for (const hPts of segTipHoles) {
      for (let i = 0; i < hPts.length; i++) {
        const j = (i + 1) % hPts.length;
        if (hPts[i].y < DTOL && hPts[j].y < DTOL) continue;
        const pII = tipInner(hPts[i].x, hPts[i].y);
        const pIJ = tipInner(hPts[j].x, hPts[j].y);
        const pOI = tipOuter(hPts[i].x, hPts[i].y);
        const pOJ = tipOuter(hPts[j].x, hPts[j].y);
        const e1 = new THREE.Vector3().subVectors(pIJ, pII);
        const e2 = new THREE.Vector3().subVectors(pOI, pII);
        const sideN = new THREE.Vector3().crossVectors(e1, e2).normalize();
        const sII = addTipV(pII, sideN);
        const sIJ = addTipV(pIJ, sideN);
        const sOJ = addTipV(pOJ, sideN);
        const sOI = addTipV(pOI, sideN);
        tipIdx.push(sII, sIJ, sOJ, sII, sOJ, sOI);
      }
    }
  } // end per-segment loop

  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcVerts, 3));
  arcGeo.setAttribute('normal', new THREE.Float32BufferAttribute(arcNormals, 3));
  arcGeo.setIndex(arcIdx);

  const tipGeo = new THREE.BufferGeometry();
  tipGeo.setAttribute('position', new THREE.Float32BufferAttribute(tipVerts, 3));
  tipGeo.setAttribute('normal', new THREE.Float32BufferAttribute(tipNormals, 3));
  tipGeo.setIndex(tipIdx);

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

  const norm = getFoldNormal(fold, faceW, faceH);

  // Shift from drawn fold line to inner edge
  const off = foldLineToInnerEdgeOffset(fold.foldLocation, thickness);
  const fs = { x: minX + fold.lineStart.x - norm.x * off, y: minY + fold.lineStart.y - norm.y * off };
  const fe = { x: minX + fold.lineEnd.x - norm.x * off, y: minY + fold.lineEnd.y - norm.y * off };
  const edx = fe.x - fs.x;
  const edy = fe.y - fs.y;
  const eLen = Math.hypot(edx, edy);
  if (eLen < 0.01) return { bendStart: [], bendEnd: [] };

  const tang = { x: edx / eLen, y: edy / eLen };

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

  for (const fold of folds.filter(f => isBaseFaceFold(f))) {
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
  // Only base-face folds participate in hierarchical parent detection
  if (!isBaseFaceFold(fold)) return null;

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
    if (!isBaseFaceFold(other)) continue;
    const otherNorm = getFoldNormal(other, faceW, faceH);
    const otherFs = { x: minX + other.lineStart.x, y: minY + other.lineStart.y };

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

// ========== Non-Base Face Fold Helpers ==========

/**
 * Check if a fold is on the base face (top or bottom).
 */
export function isBaseFaceFold(fold: Fold): boolean {
  return !fold.faceId || fold.faceId === 'base_top' || fold.faceId === 'base_bot';
}

/**
 * Get the dimensions (width, height) of a face by its ID.
 */
export function getFaceDimensions(
  faceId: string,
  profile: Point2D[],
  thickness: number,
  flanges: Flange[],
  folds: Fold[],
): { width: number; height: number } | null {
  if (faceId === 'base_top' || faceId === 'base_bot') {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  if (faceId.startsWith('flange_face_')) {
    const flangeId = faceId.replace('flange_face_', '');
    const flange = flanges.find(f => f.id === flangeId);
    if (!flange) return null;
    const allEdges = getAllSelectableEdges(profile, thickness, flanges, folds);
    const parentEdge = allEdges.find(e => e.id === flange.edgeId);
    if (!parentEdge) return null;
    return { width: parentEdge.start.distanceTo(parentEdge.end), height: flange.height };
  }
  if (faceId.startsWith('fold_face_')) {
    const foldId = faceId.replace('fold_face_', '');
    const fold = folds.find(f => f.id === foldId);
    if (!fold) return null;
    const foldEdge = computeFoldEdge(profile, thickness, fold);
    const { startHeight, endHeight } = getFoldMovingHeights(profile, fold, thickness);
    return { width: foldEdge.start.distanceTo(foldEdge.end), height: Math.max(startHeight, endHeight) };
  }
  return null;
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

/**
 * Compute the 3D transformation matrix for a flange face.
 * Maps from face-local coordinates (x=along edge, y=along extension, z=surface normal)
 * to world coordinates. Origin is at the inner surface.
 */
export function computeFlangeFaceTransform(
  parentEdge: PartEdge,
  flange: Flange,
  thickness: number,
): THREE.Matrix4 {
  const bendAngleRad = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;
  const R = flange.bendRadius;
  const uDir = parentEdge.normal.clone().normalize();
  const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);
  const edgeDir = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();

  const sinA = Math.sin(bendAngleRad);
  const cosA = Math.cos(bendAngleRad);
  const arcEndU = R * sinA;
  const arcEndW = R * (1 - cosA);

  const flangeExtDir = uDir.clone().multiplyScalar(cosA).add(wDir.clone().multiplyScalar(sinA)).normalize();
  const flangeSurfaceNormal = uDir.clone().multiplyScalar(sinA).add(wDir.clone().multiplyScalar(-cosA)).normalize();

  // Origin at inner surface of flange (no thickness offset)
  const origin = parentEdge.start.clone()
    .add(uDir.clone().multiplyScalar(arcEndU))
    .add(wDir.clone().multiplyScalar(arcEndW));

  const m = new THREE.Matrix4();
  m.makeBasis(edgeDir, flangeExtDir, flangeSurfaceNormal);
  m.setPosition(origin);
  return m;
}

/**
 * Compute the 3D transformation matrix for a fold face.
 * Maps from face-local coordinates to world coordinates. Origin is at the inner surface.
 */
export function computeFoldFaceTransform(
  profile: Point2D[],
  fold: Fold,
  thickness: number,
): THREE.Matrix4 {
  const foldEdge = computeFoldEdge(profile, thickness, fold);
  const tangent = new THREE.Vector3().subVectors(foldEdge.end, foldEdge.start).normalize();
  const normal = foldEdge.normal.clone();
  const dSign = fold.direction === 'up' ? 1 : -1;
  const angleRad = fold.angle * Math.PI / 180;
  const q = new THREE.Quaternion().setFromAxisAngle(tangent, dSign * angleRad);
  const bentNormal = normal.clone().applyQuaternion(q);
  const bentUp = new THREE.Vector3(0, 0, dSign).applyQuaternion(q);

  const m = new THREE.Matrix4();
  m.makeBasis(tangent, bentNormal, bentUp);
  m.setPosition(foldEdge.start);
  return m;
}
