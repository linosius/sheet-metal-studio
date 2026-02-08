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
 * Compute the tip edge of a flange — the free edge at the end of the flat extension.
 * This edge can be selected to add a cascading flange.
 */
export function computeFlangeTipEdge(
  parentEdge: PartEdge,
  flange: Flange,
  thickness: number
): PartEdge {
  const A = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;
  const R = flange.bendRadius;
  const H = flange.height;

  const uDir = parentEdge.normal.clone().normalize();
  const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);

  const sinA = Math.sin(A);
  const cosA = Math.cos(A);

  // Arc end position (inner surface)
  const arcEndU = R * sinA;
  const arcEndW = R * (1 - cosA);

  // Tangent at end of arc (direction of flat extension)
  const tanU = cosA;
  const tanW = sinA;

  // Tip position (end of flat extension, inner surface)
  const tipU = arcEndU + H * tanU;
  const tipW = arcEndW + H * tanW;

  const tipStart = parentEdge.start.clone()
    .add(uDir.clone().multiplyScalar(tipU))
    .add(wDir.clone().multiplyScalar(tipW));
  const tipEnd = parentEdge.end.clone()
    .add(uDir.clone().multiplyScalar(tipU))
    .add(wDir.clone().multiplyScalar(tipW));

  // Tip edge normal = tangent direction (direction a new flange would extend)
  const tipNormal = uDir.clone().multiplyScalar(tanU)
    .add(wDir.clone().multiplyScalar(tanW))
    .normalize();

  // Tip face normal = perpendicular to the flange surface at the tip,
  // pointing OUTWARD (away from the concave side of the bend).
  // This ensures cascading flanges with "up" direction bend away from existing geometry.
  const tipFaceNormal = uDir.clone().multiplyScalar(sinA)
    .add(wDir.clone().multiplyScalar(-cosA))
    .normalize();

  return {
    id: `flange_tip_${flange.id}`,
    start: tipStart,
    end: tipEnd,
    faceId: `flange_${flange.id}`,
    normal: tipNormal,
    faceNormal: tipFaceNormal,
  };
}

/**
 * Get all selectable edges: base profile edges + flange tip edges.
 * Supports nested flanges (flange on flange).
 */
export function getAllSelectableEdges(
  profile: Point2D[],
  thickness: number,
  flanges: Flange[]
): PartEdge[] {
  const baseEdges = extractEdges(profile, thickness);
  const edgeMap = new Map<string, PartEdge>();
  baseEdges.forEach(e => edgeMap.set(e.id, e));

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
        const tipEdge = computeFlangeTipEdge(parentEdge, flange, thickness);
        edgeMap.set(tipEdge.id, tipEdge);
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
