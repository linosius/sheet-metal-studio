
# Fix: Replace EdgesGeometry with Explicit Boundary Edge Rendering

## Problem
`THREE.EdgesGeometry` combined with `mergeVertices` is unreliable for hiding internal triangulation lines on complex geometries (e.g., faces with circular holes). The hash-grid vertex merging has boundary edge cases, and angle-based edge detection fails with numerical precision issues. This has been attempted multiple times with different merge strategies, none of which work consistently.

## Solution
**Bypass EdgesGeometry entirely.** Instead, compute boundary edges directly from the known polygon outlines and render them as explicit line segments. This is deterministic -- only real boundary edges are drawn, and internal triangulation is never exposed.

## Changes

### 1. New helper: `computeBoundaryEdges` (in `src/lib/geometry.ts`)

Create a function that generates a `THREE.BufferGeometry` containing only boundary line segments for a given profile and optional cutout polygons:

```text
Input: profile polygon, thickness, cutout polygons (optional)
Output: BufferGeometry of line segments (pairs of vertices)

Logic:
- For each edge of the profile: emit line at z=0 and z=thickness
- For each edge of each cutout: emit line at z=0 and z=thickness  
- For each vertex of the profile: emit vertical line from z=0 to z=thickness
- For each vertex of each cutout: emit vertical line from z=0 to z=thickness
```

### 2. Extend `createFoldMesh` return type (in `src/lib/geometry.ts`)

Add `tipBoundaryEdges: THREE.BufferGeometry` to the return object. This contains line segments computed from the tip polygon boundaries (segTipPoly + holes), mapped through `tipInner`/`tipOuter`, plus connecting vertical edges.

### 3. Extend `createFlangeMesh` return type (in `src/lib/geometry.ts`)

Change from returning a single `BufferGeometry` to returning `{ mesh: BufferGeometry, boundaryEdges: BufferGeometry }`. The boundary edges come from the tipPoly outline + arc cross-section boundary.

### 4. Update `SheetMetalMesh` (in `src/components/workspace/Viewer3D.tsx`)

Replace:
```
const edgesGeometry = useMemo(() => createCleanEdgesGeometry(geometry), [geometry]);
```
With:
```
const edgesGeometry = useMemo(() => computeBoundaryEdges(fixedProfile, thickness, fixedCutoutPolygons), [...]);
```

### 5. Update `FoldMesh` (in `src/components/workspace/Viewer3D.tsx`)

Replace `createCleanEdgesGeometry(result.tip)` with `result.tipBoundaryEdges`.

### 6. Update `FlangeMesh` (in `src/components/workspace/Viewer3D.tsx`)

Use the returned `boundaryEdges` geometry instead of `createCleanEdgesGeometry(geometry)`.

### 7. Remove `createCleanEdgesGeometry` function

No longer needed once all edge rendering uses explicit boundaries.

## Technical Details

### Base face boundary edges
```text
For profile with N vertices and M cutouts:
- Top outline: N line segments at z=thickness
- Bottom outline: N line segments at z=0
- Vertical edges: N line segments connecting z=0 to z=thickness
- Per cutout: same pattern (top + bottom + vertical)
- Fold-aware: skip profile edges on fold lines (same logic as sidewall clipping)
```

### Fold tip boundary edges
```text
Per bend segment:
- Inner surface: segTipPoly outline mapped through tipInner()
- Outer surface: segTipPoly outline mapped through tipOuter()
- Connecting edges at each polygon vertex (tipInner to tipOuter)
- Skip edges at d=0 (bend line boundary, handled by bend line rendering)
- Interior holes: same inner/outer/connecting pattern
```

### Flange boundary edges
```text
- Arc cross-section at start and end of edge (inner+outer profile curves)
- Tip polygon outline mapped through tipPointTo3D for inner and outer
- Connecting vertical edges between inner and outer at polygon corners
```

## Why This Works
- Only real geometric boundaries are rendered -- no reliance on triangulation detection
- Polygon outlines are already known (profile, cutouts, tipPoly) -- no geometry analysis needed
- Completely deterministic -- same polygon = same edges, always
- No dependency on mergeVertices, hash grids, or angle thresholds

## Files Changed
- `src/lib/geometry.ts`: Add `computeBoundaryEdges`, modify `createFoldMesh` and `createFlangeMesh` return types
- `src/components/workspace/Viewer3D.tsx`: Update edge rendering in SheetMetalMesh, FoldMesh, FlangeMesh; remove `createCleanEdgesGeometry`
