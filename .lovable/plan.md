

# Fix: Internal Triangulation Lines + Diagnostic Logging

## Problem
Two issues visible in the screenshot:
1. **Grid pattern on faces**: `EdgesGeometry` sees non-indexed geometry from `MeshBuilder` and treats every triangle edge as a boundary edge, showing the full triangulation grid on top/bottom surfaces.
2. **Stripe along fold line**: Either base sidewalls aren't being clipped, or arc/tip seams are generating full-length walls, or both are overlapping.

## Changes

### 1. Fix EdgesGeometry grid lines (`src/components/workspace/Viewer3D.tsx`, line 352)

Add import for `mergeVertices` from Three.js BufferGeometryUtils, then clone + merge vertices before creating `EdgesGeometry`:

```
// Before:
const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry]);

// After:
const edgesGeometry = useMemo(() => {
  const merged = mergeVertices(geometry.clone(), 1e-4);
  merged.computeVertexNormals();
  return new THREE.EdgesGeometry(merged, 15);
}, [geometry]);
```

**Why this works**: `mergeVertices` creates an indexed geometry where adjacent coplanar triangles share vertices. `EdgesGeometry` then correctly identifies that internal edges have 0-degree angle between neighbors (both normals point the same direction) and hides them. Only sharp edges (face-to-sidewall at 90 degrees) remain visible.

The original non-indexed geometry with flat normals is still used for rendering -- only the `EdgesGeometry` input is affected.

### 2. Add diagnostic logging to identify stripe source (`src/lib/geometry.ts`)

Add temporary `console.warn` calls inside `buildBaseFaceManual` to report:
- How many outer edges were detected as fold-near vs total
- How many hole edges were detected as fold-near vs total  
- The `foldDTol` value and number of fold line infos

This will immediately reveal if the fold-near detection is triggering at all. If `foldNearCount = 0`, the sidewall clipping never activates and the full wall is emitted along the fold line.

```
// At end of outer sidewall loop:
console.warn("[BASE] outer edges", { total: profile.length, foldNear: foldNearCount, foldDTol, foldLines: foldLineInfos.length });

// At end of hole sidewall loop:
console.warn("[BASE] hole edges", { total: totalHoleEdges, foldNear: holeNearCount });
```

### Files changed
- `src/components/workspace/Viewer3D.tsx`: Add `mergeVertices` import + modify `edgesGeometry` computation (line 352)
- `src/lib/geometry.ts`: Add diagnostic logging in `buildBaseFaceManual` sidewall loops (temporary, for debugging)

