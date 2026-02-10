

# Fix: Replace ExtrudeGeometry with ShapeGeometry in buildBaseFaceManual

## Problem
The current `buildBaseFaceManual` (lines 181-307) still uses `ExtrudeGeometry` and filters triangles by `allSameZ` -- this causes missing surfaces and "sail" artifacts because ExtrudeGeometry sidewall triangles get misclassified as face triangles.

## Solution
Rewrite `buildBaseFaceManual` to use `THREE.ShapeGeometry` for top/bottom faces (which never generates sidewalls) and keep manual fold-aware sidewall construction. This is based on the user's provided reference implementation.

## Changes (single file: `src/lib/geometry.ts`)

### Replace `buildBaseFaceManual` (lines 181-307) with:

1. **Shape + Holes setup** -- Build `THREE.Shape` from profile, add cutout holes as `THREE.Path` (same as current)

2. **Top/Bottom faces via ShapeGeometry**:
   - `new THREE.ShapeGeometry(shape)` produces only flat 2D triangles at z=0, no sidewalls
   - Top face: copy positions with z=thickness, explicit normals (0,0,1)
   - Bottom face: copy positions with z=0, reversed winding (a,c,b), explicit normals (0,0,-1)
   - Vertices duplicated between top/bottom -- no sharing, ensuring flat normals

3. **Manual sidewalls** (refined from current code):
   - **Outer edges**: For each profile edge, project to fold TD space. If near fold line, clip against `bendSegments` (unblocked intervals) and only emit quads for kept segments. Otherwise emit full quad.
   - **Hole edges**: For each cutout polygon edge, project to fold TD space. If near fold line, compute complement of `blocked` intervals and only emit quads for unblocked segments. Otherwise emit full quad.
   - **Sidewall normals**: computed per quad via cross product (flat shading)

4. **MeshBuilder helper class**: Accumulates vertices + normals, emits non-indexed geometry with explicit flat normals per triangle. No `computeVertexNormals()` call needed.

5. **Helper functions**: `projectToFold` (existing), `clamp01`, `lerp2`, `triNormal`, interval math (`mergeIntervals`, `complementIntervalsForSidewalls`, `clipIntervalByAllowed`).

### No changes to `Viewer3D.tsx`
The integration (lines 332-352) stays the same -- `createBaseFaceMesh` receives `foldLineInfos` and delegates to the new `buildBaseFaceManual`.

## Why This Fixes the Issues
- `ShapeGeometry` never generates sidewalls -- no "sail" artifacts, no missing faces
- Explicit flat normals per group -- no smoothing artifacts, clean `EdgesGeometry` at angle threshold 15 degrees
- Sidewall clipping uses the same TD projection as arc/tip -- consistent behavior
- Hole edges near fold line are clipped against blocked intervals, not just skipped -- prevents over-aggressive removal

## Technical Details

Key tolerance values:
- `foldDTol = thickness * 0.25` for detecting if an edge is "near" a fold line
- Interval epsilon `1e-9` for merge/complement operations
- Sidewall quad winding: (v00, v10, v11) + (v00, v11, v01) with shared face normal

