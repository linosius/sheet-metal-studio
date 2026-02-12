/**
 * Metal Hero API Client
 * Central API client for communicating with api.metal-hero.com
 * Handles 3D model building and unfolding.
 */

import * as THREE from 'three';
import { Point2D } from './sheetmetal';
import { Flange, Fold, ProfileCutout, FaceSketch } from './geometry';
import { FaceTransform, ApiEdge, updateFaceRegistry } from './faceRegistry';

const API_BASE = 'https://api.metal-hero.com';

// ========== Request Types ==========

export interface BuildModelRequest {
  profile: Point2D[];
  thickness: number;
  cutouts: {
    type: string;
    center?: Point2D;
    radius?: number;
    origin?: Point2D;
    width?: number;
    height?: number;
    polygon: Point2D[];
  }[];
  folds: {
    id: string;
    lineStart: Point2D;
    lineEnd: Point2D;
    angle: number;
    direction: 'up' | 'down';
    bendRadius: number;
    kFactor: number;
    foldLocation: string;
    parentFaceId: string;
  }[];
  flanges: {
    id: string;
    edgeId: string;
    height: number;
    angle: number;
    direction: 'up' | 'down';
    bendRadius: number;
    kFactor: number;
  }[];
  faceSketches: {
    faceId: string;
    side: string;
    entities: any[];
  }[];
  bendTable: {
    type: string;
    defaultKFactor: number;
    overrides: any[];
  };
}

export interface MeshData {
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface FoldMeshData {
  id: string;
  arc: MeshData;
  tip: MeshData;
}

export interface FlangeMeshData {
  id: string;
  mesh: MeshData;
}

export interface BuildModelResponse {
  success: boolean;
  error?: string;
  model?: {
    meshes: {
      baseFace: MeshData;
      folds: FoldMeshData[];
      flanges: FlangeMeshData[];
    };
    boundaryEdges: {
      positions: number[];
    };
    faces: FaceTransform[];
    edges: ApiEdge[];
  };
}

export interface UnfoldResponse {
  success: boolean;
  error?: string;
  flatPattern?: {
    regions: {
      id: string;
      faceId: string;
      polygon: Point2D[];
      cutouts: any[];
    }[];
    bendLines: {
      foldId?: string;
      start: Point2D;
      end: Point2D;
      angle: number;
      radius: number;
      label: string;
    }[];
    boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  };
}

// ========== Geometry Conversion ==========

export function meshDataToBufferGeometry(data: MeshData): THREE.BufferGeometry {
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));

  if (data.indices && data.indices.length > 0) {
    geo.setIndex(Array.from(data.indices));
  }

  // Prefer API-provided normals (they preserve hard edges from the B-Rep kernel)
  if (data.normals && data.normals.length > 0) {
    let allZero = true;
    for (let i = 0; i < Math.min(data.normals.length, 30); i++) {
      if (data.normals[i] !== 0) { allZero = false; break; }
    }
    if (!allZero) {
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    } else {
      if (geo.index) geo = geo.toNonIndexed();
      geo.computeVertexNormals();
    }
  } else {
    // No normals — convert to non-indexed for proper flat face normals
    if (geo.index) geo = geo.toNonIndexed();
    geo.computeVertexNormals();
  }

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function edgePositionsToBufferGeometry(positions: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

// ========== API Calls ==========

function buildRequestPayload(
  profile: Point2D[],
  thickness: number,
  cutouts: ProfileCutout[],
  folds: Fold[],
  flanges: Flange[],
  faceSketches: FaceSketch[],
  kFactor: number,
): BuildModelRequest {
  return {
    profile,
    thickness,
    cutouts: cutouts.map(c => ({
      type: c.type,
      center: c.center,
      radius: c.radius,
      origin: c.origin,
      width: c.width,
      height: c.height,
      polygon: c.polygon,
    })),
    folds: folds.map(f => ({
      id: f.id,
      lineStart: f.lineStart,
      lineEnd: f.lineEnd,
      angle: f.angle,
      direction: f.direction,
      bendRadius: f.bendRadius,
      kFactor,
      foldLocation: f.foldLocation ?? 'centerline',
      parentFaceId: f.faceId ?? 'base:top',
    })),
    flanges: flanges.map(f => ({
      id: f.id,
      edgeId: f.edgeId,
      height: f.height,
      angle: f.angle,
      direction: f.direction,
      bendRadius: f.bendRadius,
      kFactor,
    })),
    faceSketches: faceSketches.map(fs => ({
      faceId: fs.faceId,
      side: fs.faceId.includes('top') || fs.faceId.includes('outer') ? 'top' : 'bot',
      entities: fs.entities,
    })),
    bendTable: {
      type: 'kFactor',
      defaultKFactor: kFactor,
      overrides: [],
    },
  };
}

export interface BuildModelResult {
  baseFace: THREE.BufferGeometry;
  folds: { id: string; arc: THREE.BufferGeometry; tip: THREE.BufferGeometry }[];
  flanges: { id: string; mesh: THREE.BufferGeometry }[];
  boundaryEdges: THREE.BufferGeometry;
  faces: FaceTransform[];
  edges: ApiEdge[];
}

export async function buildModel(
  profile: Point2D[],
  thickness: number,
  cutouts: ProfileCutout[],
  folds: Fold[],
  flanges: Flange[],
  faceSketches: FaceSketch[],
  kFactor: number,
): Promise<BuildModelResult> {
  const payload = buildRequestPayload(profile, thickness, cutouts, folds, flanges, faceSketches, kFactor);

  const response = await fetch(`${API_BASE}/api/v1/build-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data: BuildModelResponse = await response.json();
  if (!data.success || !data.model) {
    throw new Error(data.error ?? 'Build model failed');
  }

  const { model } = data;

  // Update face registry
  updateFaceRegistry(model.faces, model.edges);

  return {
    baseFace: meshDataToBufferGeometry(model.meshes.baseFace),
    folds: model.meshes.folds.map(f => ({
      id: f.id,
      arc: meshDataToBufferGeometry(f.arc),
      tip: meshDataToBufferGeometry(f.tip),
    })),
    flanges: model.meshes.flanges.map(f => ({
      id: f.id,
      mesh: meshDataToBufferGeometry(f.mesh),
    })),
    boundaryEdges: edgePositionsToBufferGeometry(model.boundaryEdges.positions),
    faces: model.faces,
    edges: model.edges,
  };
}

export interface FlatPatternResult {
  regions: {
    id: string;
    faceId: string;
    polygon: Point2D[];
    cutouts: any[];
  }[];
  bendLines: {
    foldId?: string;
    start: Point2D;
    end: Point2D;
    angle: number;
    radius: number;
    label: string;
  }[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  overallWidth: number;
  overallHeight: number;
}

export async function unfoldModel(
  profile: Point2D[],
  thickness: number,
  cutouts: ProfileCutout[],
  folds: Fold[],
  flanges: Flange[],
  faceSketches: FaceSketch[],
  kFactor: number,
): Promise<FlatPatternResult> {
  const payload = buildRequestPayload(profile, thickness, cutouts, folds, flanges, faceSketches, kFactor);

  const response = await fetch(`${API_BASE}/api/v1/unfold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data: UnfoldResponse = await response.json();
  if (!data.success || !data.flatPattern) {
    throw new Error(data.error ?? 'Unfold failed');
  }

  const { flatPattern } = data;
  const bb = flatPattern.boundingBox;

  return {
    ...flatPattern,
    overallWidth: bb.maxX - bb.minX,
    overallHeight: bb.maxY - bb.minY,
  };
}
