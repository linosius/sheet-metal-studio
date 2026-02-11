/**
 * CAD Kernel wrapper around OpenCascade.js
 * 
 * Provides high-level operations for sheet metal modeling:
 * - Profile extrusion to solid
 * - Boolean subtraction for cutouts
 * - Tessellation to Three.js BufferGeometry
 * - Edge extraction for boundary visualization
 */

import * as THREE from 'three';
import { getOCCT } from './cadInit';
import type { OpenCascadeInstance } from './cadInit';
import type { Point2D } from './sheetmetal';

// ── Helper: cleanup OCCT objects ──

function safeDelete(...objs: any[]) {
  for (const o of objs) {
    try { if (o && typeof o.delete === 'function') o.delete(); } catch { /* ignore */ }
  }
}

// ── Profile → Wire → Face → Solid ──

/**
 * Create a closed wire from a 2D profile polygon.
 */
function profileToWire(oc: OpenCascadeInstance, profile: Point2D[]): any {
  const builder = new oc.BRepBuilderAPI_MakeWire_1();
  
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    const p0 = new oc.gp_Pnt_3(profile[i].x, profile[i].y, 0);
    const p1 = new oc.gp_Pnt_3(profile[j].x, profile[j].y, 0);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p0, p1);
    builder.Add_1(edgeMaker.Edge());
    safeDelete(p0, p1, edgeMaker);
  }
  
  const wire = builder.Wire();
  builder.delete();
  return wire;
}

/**
 * Create a planar face from a closed wire.
 */
function wireToFace(oc: OpenCascadeInstance, wire: any): any {
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
  const face = faceMaker.Face();
  faceMaker.delete();
  return face;
}

/**
 * Create a solid by extruding a face along Z.
 */
function extrudeFace(oc: OpenCascadeInstance, face: any, thickness: number): any {
  const vec = new oc.gp_Vec_4(0, 0, thickness);
  const prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
  const solid = prism.Shape();
  safeDelete(vec, prism);
  return solid;
}

/**
 * Create a sheet metal base face solid from a 2D profile.
 * Result is an extruded solid in the XY plane with given thickness along Z.
 */
export function createSheetFromProfile(profile: Point2D[], thickness: number): any {
  const oc = getOCCT();
  const wire = profileToWire(oc, profile);
  const face = wireToFace(oc, wire);
  const solid = extrudeFace(oc, face, thickness);
  safeDelete(wire, face);
  return solid;
}

// ── Boolean Subtraction (Cutouts) ──

/**
 * Create a cutout solid from a 2D polygon (extruded beyond the sheet thickness).
 */
function createCutoutSolid(oc: OpenCascadeInstance, polygon: Point2D[], thickness: number): any {
  const wire = profileToWire(oc, polygon);
  const face = wireToFace(oc, wire);
  
  // Extrude slightly beyond sheet bounds to ensure clean cut
  const margin = thickness * 2;
  
  // Translate face below Z=0
  const trsf = new oc.gp_Trsf_1();
  const translationVec = new oc.gp_Vec_4(0, 0, -margin);
  trsf.SetTranslation_1(translationVec);
  const transformer = new oc.BRepBuilderAPI_Transform_2(face, trsf, false);
  const movedFace = transformer.Shape();
  
  const extrudeVec = new oc.gp_Vec_4(0, 0, thickness + margin * 2);
  const prism = new oc.BRepPrimAPI_MakePrism_1(movedFace, extrudeVec, false, true);
  const cutSolid = prism.Shape();
  
  safeDelete(wire, face, trsf, translationVec, transformer, extrudeVec, prism);
  return cutSolid;
}

/**
 * Subtract all cutout polygons from a solid using boolean operations.
 * Returns the resulting solid with holes.
 */
export function cutHoles(solid: any, cutoutPolygons: Point2D[][], thickness: number): any {
  const oc = getOCCT();
  let result = solid;
  
  for (const polygon of cutoutPolygons) {
    if (polygon.length < 3) continue;
    
    const cutSolid = createCutoutSolid(oc, polygon, thickness);
    const progressRange = new oc.Message_ProgressRange_1();
    const cutter = new oc.BRepAlgoAPI_Cut_3(result, cutSolid, progressRange);
    
    if (cutter.IsDone()) {
      const newResult = cutter.Shape();
      if (result !== solid) {
        // Only delete intermediate results, not the original
        safeDelete(result);
      }
      result = newResult;
    }
    
    safeDelete(cutSolid, cutter, progressRange);
  }
  
  return result;
}

// ── Tessellation → Three.js BufferGeometry ──

/**
 * Tessellate a TopoDS_Shape into a Three.js BufferGeometry.
 * Uses OCCT's incremental mesh algorithm.
 */
export function tessellate(shape: any, linearDeflection = 0.1): THREE.BufferGeometry {
  const oc = getOCCT();
  
  // Perform tessellation
  const mesh = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    linearDeflection,
    false,   // relative
    0.5,     // angular deflection
    false    // parallel
  );
  
  if (!mesh.IsDone()) {
    mesh.delete();
    console.warn("[CAD] Tessellation failed");
    return new THREE.BufferGeometry();
  }
  
  const positions: number[] = [];
  const normals: number[] = [];
  
  // Iterate over all faces in the shape
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );
  
  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    
    // meshPurpose: Poly_MeshPurpose_NONE = 0
    const triangulation = oc.BRep_Tool.Triangulation(face, location, 0 as any);
    
    if (!triangulation.IsNull()) {
      const tri = triangulation.get();
      const nbNodes = tri.NbNodes();
      const nbTriangles = tri.NbTriangles();
      const trsf = location.Transformation();
      
      // Check face orientation
      const faceOrientation = face.Orientation_1();
      const isReversed = faceOrientation === oc.TopAbs_Orientation.TopAbs_REVERSED;
      
      // Collect transformed nodes (OCCT is 1-indexed)
      const nodes: THREE.Vector3[] = [];
      for (let i = 1; i <= nbNodes; i++) {
        const node = tri.Node(i);
        const transformed = node.Transformed(trsf);
        nodes.push(new THREE.Vector3(transformed.X(), transformed.Y(), transformed.Z()));
        safeDelete(transformed);
      }
      
      // Collect triangles
      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = tri.Triangle(i);
        let n1 = triangle.Value(1) - 1;
        let n2 = triangle.Value(2) - 1;
        let n3 = triangle.Value(3) - 1;
        
        if (isReversed) {
          [n2, n3] = [n3, n2];
        }
        
        const v0 = nodes[n1];
        const v1 = nodes[n2];
        const v2 = nodes[n3];
        
        // Compute face normal
        const e1 = new THREE.Vector3().subVectors(v1, v0);
        const e2 = new THREE.Vector3().subVectors(v2, v0);
        const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
        
        positions.push(v0.x, v0.y, v0.z);
        positions.push(v1.x, v1.y, v1.z);
        positions.push(v2.x, v2.y, v2.z);
        normals.push(normal.x, normal.y, normal.z);
        normals.push(normal.x, normal.y, normal.z);
        normals.push(normal.x, normal.y, normal.z);
      }
    }
    
    safeDelete(location);
    explorer.Next();
  }
  
  safeDelete(explorer, mesh);
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  
  return geometry;
}

// ── Edge Extraction ──

/**
 * Extract all topological edges from a shape as line segments.
 * Uses the tessellation polygon on each edge.
 * Returns a BufferGeometry suitable for `<lineSegments>`.
 */
export function extractEdgeLines(shape: any, linearDeflection = 0.1): THREE.BufferGeometry {
  const oc = getOCCT();
  const verts: number[] = [];
  
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );
  
  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    
    // Try to get the 3D polygon from tessellation
    const polygon = oc.BRep_Tool.Polygon3D(edge, location);
    
    if (!polygon.IsNull()) {
      const poly = polygon.get();
      const nbNodes = poly.NbNodes();
      const trsf = location.Transformation();
      const nodesArr = poly.Nodes();
      
      for (let i = 1; i < nbNodes; i++) {
        const p0 = nodesArr.Value(i).Transformed(trsf);
        const p1 = nodesArr.Value(i + 1).Transformed(trsf);
        verts.push(p0.X(), p0.Y(), p0.Z());
        verts.push(p1.X(), p1.Y(), p1.Z());
        safeDelete(p0, p1);
      }
    }
    // If no polygon3D, skip this edge (tessellation should have produced polygons)
    
    safeDelete(location);
    explorer.Next();
  }
  
  safeDelete(explorer);
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geometry;
}

// ── High-level API ──

/**
 * Build the complete base face geometry using the CAD kernel.
 * This replaces createBaseFaceMesh from geometry.ts with a topologically
 * correct B-Rep approach.
 * 
 * @returns Object with mesh geometry and edge lines geometry
 */
export function buildBaseFace(
  profile: Point2D[],
  thickness: number,
  cutoutPolygons?: Point2D[][],
): { mesh: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  console.time("[CAD] buildBaseFace");
  
  // Step 1: Create extruded solid from profile
  let solid = createSheetFromProfile(profile, thickness);
  
  // Step 2: Boolean-subtract all cutouts
  if (cutoutPolygons && cutoutPolygons.length > 0) {
    solid = cutHoles(solid, cutoutPolygons, thickness);
  }
  
  // Step 3: Tessellate to Three.js geometry
  const meshGeo = tessellate(solid, 0.1);
  
  // Step 4: Extract edges for boundary visualization
  const edgesGeo = extractEdgeLines(solid, 0.1);
  
  console.timeEnd("[CAD] buildBaseFace");
  console.log(`[CAD] Base face: ${meshGeo.attributes.position?.count ?? 0} vertices, ${edgesGeo.attributes.position?.count ?? 0} edge vertices`);
  
  return { mesh: meshGeo, edges: edgesGeo };
}
