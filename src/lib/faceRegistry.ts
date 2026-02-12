/**
 * Face Registry — stores face transforms and edges from the backend API.
 * This is the frontend's source of truth for face positioning after build-model calls.
 */

import * as THREE from 'three';
import { Point2D } from './sheetmetal';

// ========== Types ==========

export interface FaceTransform {
  faceId: string;
  origin: [number, number, number];
  xAxis: [number, number, number];
  yAxis: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
}

export interface ApiEdge {
  id: string;
  faceId: string;
  start: [number, number, number];
  end: [number, number, number];
  normal: [number, number, number];
  faceNormal: [number, number, number];
}

// ========== Registry State ==========

let _faces: Map<string, FaceTransform> = new Map();
let _edges: ApiEdge[] = [];

// ========== Update ==========

export function updateFaceRegistry(faces: FaceTransform[], edges: ApiEdge[]) {
  _faces = new Map(faces.map(f => [f.faceId, f]));
  _edges = edges;
}

export function clearFaceRegistry() {
  _faces.clear();
  _edges = [];
}

// ========== Queries ==========

export function getFaceTransform(faceId: string): FaceTransform | null {
  return _faces.get(faceId) ?? null;
}

export function getAllFaces(): FaceTransform[] {
  return Array.from(_faces.values());
}

export function getEdges(): ApiEdge[] {
  return _edges;
}

export function getFaceDimensionsFromRegistry(faceId: string): { width: number; height: number } | null {
  const face = _faces.get(faceId);
  if (!face) return null;
  return { width: face.width, height: face.height };
}

/**
 * Build a THREE.Matrix4 world transform from a FaceTransform.
 * Maps face-local (x,y,z) to world coordinates.
 */
export function faceTransformToMatrix4(ft: FaceTransform): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3(...ft.xAxis);
  const y = new THREE.Vector3(...ft.yAxis);
  const n = new THREE.Vector3(...ft.normal);
  m.makeBasis(x, y, n);
  m.setPosition(new THREE.Vector3(...ft.origin));
  return m;
}

/**
 * Convert an ApiEdge to the PartEdge interface used by the frontend.
 */
export function apiEdgeToPartEdge(e: ApiEdge): import('./geometry').PartEdge {
  return {
    id: e.id,
    faceId: e.faceId,
    start: new THREE.Vector3(...e.start),
    end: new THREE.Vector3(...e.end),
    normal: new THREE.Vector3(...e.normal),
    faceNormal: new THREE.Vector3(...e.faceNormal),
  };
}
