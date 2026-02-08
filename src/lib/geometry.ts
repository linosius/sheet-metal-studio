import * as THREE from 'three';
import { SketchEntity, Point2D } from '@/lib/sheetmetal';

// ========== 3D Part Model ==========

export interface PartEdge {
  id: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** Which face this edge belongs to */
  faceId: string;
  /** Direction the flange would extend (outward normal) */
  normal: THREE.Vector3;
}

export interface Flange {
  id: string;
  edgeId: string;
  height: number;       // mm
  angle: number;        // degrees (default 90)
  direction: 'up' | 'down'; // relative to face normal
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
 * Extract selectable edges from a profile (the "top" edges at z=thickness).
 * Each edge of the profile polygon becomes a selectable edge for flange placement.
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

    edges.push({
      id: `edge_${i}`,
      start: new THREE.Vector3(curr.x, curr.y, thickness),
      end: new THREE.Vector3(next.x, next.y, thickness),
      faceId: 'base',
      normal: new THREE.Vector3(nx, ny, 0).normalize(),
    });
  }

  return edges;
}

/**
 * Create a flange mesh for a given edge.
 */
export function createFlangeMesh(
  edge: PartEdge,
  flangeHeight: number,
  thickness: number,
  angleDeg: number,
  direction: 'up' | 'down'
): THREE.BufferGeometry {
  // Edge vector
  const edgeDir = new THREE.Vector3().subVectors(edge.end, edge.start);
  const edgeLen = edgeDir.length();

  // Create a rectangular flange profile in local space
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(edgeLen, 0);
  shape.lineTo(edgeLen, flangeHeight);
  shape.lineTo(0, flangeHeight);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });

  // Orient the flange: rotate around the edge axis by bend angle
  const angleRad = (angleDeg * Math.PI) / 180;
  const dirSign = direction === 'up' ? 1 : -1;

  // Build transformation matrix
  const matrix = new THREE.Matrix4();

  // 1. Align edge direction with X axis
  const edgeDirNorm = edgeDir.clone().normalize();
  const up = new THREE.Vector3(0, 0, dirSign);
  const side = new THREE.Vector3().crossVectors(edgeDirNorm, up).normalize();

  // Rotation to align flange along edge normal at bend angle
  const bendNormal = edge.normal.clone().multiplyScalar(Math.sin(angleRad));
  bendNormal.z += Math.cos(angleRad) * dirSign;
  bendNormal.normalize();

  const rotMatrix = new THREE.Matrix4().makeBasis(
    edgeDirNorm,
    bendNormal,
    new THREE.Vector3().crossVectors(edgeDirNorm, bendNormal).normalize()
  );

  matrix.multiply(new THREE.Matrix4().makeTranslation(edge.start.x, edge.start.y, edge.start.z));
  matrix.multiply(rotMatrix);

  geometry.applyMatrix4(matrix);

  return geometry;
}
