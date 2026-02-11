/**
 * CAD Kernel wrapper — stub.
 * OpenCascade.js WASM is not available in this environment.
 * All functions throw so callers fall back to legacy geometry.
 */

import * as THREE from 'three';
import type { Point2D } from './sheetmetal';

export function createSheetFromProfile(_profile: Point2D[], _thickness: number): any {
  throw new Error("CAD kernel not available");
}

export function cutHoles(_solid: any, _cutoutPolygons: Point2D[][], _thickness: number): any {
  throw new Error("CAD kernel not available");
}

export function tessellate(_shape: any, _linearDeflection = 0.1): THREE.BufferGeometry {
  throw new Error("CAD kernel not available");
}

export function extractEdgeLines(_shape: any, _linearDeflection = 0.1): THREE.BufferGeometry {
  throw new Error("CAD kernel not available");
}

export function buildBaseFace(
  _profile: Point2D[],
  _thickness: number,
  _cutoutPolygons?: Point2D[][],
): { mesh: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  throw new Error("CAD kernel not available");
}
