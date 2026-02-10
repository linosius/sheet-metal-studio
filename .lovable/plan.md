
# Fix: Internal Triangulation Lines on All Surfaces

## Problem
The `mergeVertices` call doesn't actually merge adjacent coplanar vertices because it compares ALL attributes, including normals. With `toNonIndexed()` + `computeVertexNormals()`, adjacent triangles on curved surfaces get slightly different smoothed normals, so `mergeVertices` treats them as distinct vertices. `EdgesGeometry` then still sees every triangle edge as a boundary.

This affects all three mesh types: base face, flanges, and fold tips.

## Root Cause (confirmed via Three.js source and StackOverflow)
`BufferGeometryUtils.mergeVertices()` hashes ALL vertex attributes (position + normal + uv). Two vertices at the same position but with different normals will NOT be merged. Since the geometry is non-indexed with per-vertex normals, this defeats the merge.

## Solution
**Delete the normal attribute before merging, then recompute after.** This forces `mergeVertices` to only consider position, producing a properly indexed geometry. Then `computeVertexNormals()` gives `EdgesGeometry` the angle information it needs.

Create a shared helper function and apply it everywhere `EdgesGeometry` is created.

## Changes

### File: `src/components/workspace/Viewer3D.tsx`

**Add helper function** (near top, after imports):
```typescript
function createCleanEdgesGeometry(geometry: THREE.BufferGeometry, angle = 15): THREE.EdgesGeometry {
  const clone = geometry.clone();
  clone.deleteAttribute('normal');
  if (clone.hasAttribute('uv')) clone.deleteAttribute('uv');
  const merged = mergeVertices(clone, 1e-4);
  merged.computeVertexNormals();
  return new THREE.EdgesGeometry(merged, angle);
}
```

**FlangeMesh** (line 64-69) -- replace:
```typescript
// Before:
return new THREE.EdgesGeometry(geometry, 15);

// After:
return createCleanEdgesGeometry(geometry);
```

**FoldMesh tipEdgesGeo** (line 144-149) -- replace:
```typescript
// Before:
return new THREE.EdgesGeometry(result.tip, 15);

// After:
return createCleanEdgesGeometry(result.tip);
```

**Base face edgesGeometry** (line 353-357) -- simplify to use the same helper:
```typescript
// Before:
const merged = mergeVertices(geometry.clone(), 1e-4);
merged.computeVertexNormals();
return new THREE.EdgesGeometry(merged, 15);

// After:
return createCleanEdgesGeometry(geometry);
```

### No changes to `geometry.ts`

## Why This Works
- Deleting normals before merge means `mergeVertices` only compares positions
- Vertices at the same XYZ position (within tolerance 1e-4) get merged into a single vertex
- After merging, `computeVertexNormals()` produces averaged normals that correctly reflect surface angles
- `EdgesGeometry` then sees that adjacent coplanar triangles share vertices with the same normal direction (angle = 0 degrees, below the 15-degree threshold) and hides internal edges
- Sharp edges (face-to-sidewall at 90 degrees) remain visible

## Files Changed
- `src/components/workspace/Viewer3D.tsx`: Add helper function + update 3 EdgesGeometry call sites
