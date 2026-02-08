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
 * The flange bends from the top edge of the base face, rotating around the edge
 * by the bend angle, extending outward along the edge's normal direction.
 */
export function createFlangeMesh(
  edge: PartEdge,
  flange: Flange,
  thickness: number
): THREE.BufferGeometry {
  const edgeVec = new THREE.Vector3().subVectors(edge.end, edge.start);
  const edgeLen = edgeVec.length();
  const edgeDirNorm = edgeVec.clone().normalize();

  const angleRad = (flange.angle * Math.PI) / 180;
  const dirSign = flange.direction === 'up' ? 1 : -1;

  // The flange plane: starts at the edge, rotates by bend angle around the edge axis
  // The "up" direction from the base face is Z+
  // The "outward" direction is the edge normal (in XY plane)
  
  // Flange extends in a direction that is a rotation of Z+ around the edge axis
  // by the complement of the bend angle
  // For 90° bend: flange goes along the normal direction
  // For 0° bend: flange goes straight up (Z+)
  
  // The flange "height" direction after bending:
  const flangeDir = new THREE.Vector3();
  flangeDir.copy(edge.normal).multiplyScalar(Math.sin(angleRad));
  flangeDir.z += Math.cos(angleRad) * dirSign;
  flangeDir.normalize();

  // Build the flange as a flat quad, then extrude
  // Four corners of the flange face (outer surface):
  const p0 = edge.start.clone();
  const p1 = edge.end.clone();
  const p2 = edge.end.clone().add(flangeDir.clone().multiplyScalar(flange.height));
  const p3 = edge.start.clone().add(flangeDir.clone().multiplyScalar(flange.height));

  // The thickness direction is perpendicular to both edgeDir and flangeDir
  const thicknessDir = new THREE.Vector3().crossVectors(edgeDirNorm, flangeDir).normalize();
  const thicknessOffset = thicknessDir.clone().multiplyScalar(thickness);

  // Inner surface
  const p4 = p0.clone().add(thicknessOffset);
  const p5 = p1.clone().add(thicknessOffset);
  const p6 = p2.clone().add(thicknessOffset);
  const p7 = p3.clone().add(thicknessOffset);

  // Build geometry from 8 vertices, 6 faces (12 triangles)
  const vertices = new Float32Array([
    // Outer face (0,1,2,3)
    p0.x, p0.y, p0.z,
    p1.x, p1.y, p1.z,
    p2.x, p2.y, p2.z,
    p3.x, p3.y, p3.z,
    // Inner face (4,5,6,7)
    p4.x, p4.y, p4.z,
    p5.x, p5.y, p5.z,
    p6.x, p6.y, p6.z,
    p7.x, p7.y, p7.z,
  ]);

  const indices = [
    // Outer face
    0, 1, 2,  0, 2, 3,
    // Inner face (reversed winding)
    4, 6, 5,  4, 7, 6,
    // Top edge (far from base)
    3, 2, 6,  3, 6, 7,
    // Bottom edge (at base)
    0, 5, 1,  0, 4, 5,
    // Left side
    0, 3, 7,  0, 7, 4,
    // Right side
    1, 5, 6,  1, 6, 2,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}
