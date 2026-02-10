

## Bend-Line Splitting Pipeline: Topological Face Separation Before Fold

### Problem

The bend line runs continuously through cutouts. Even though individual triangles/cells are removed from the arc and tip surfaces, the geometry is still generated as one continuous piece spanning the full `tMin..tMax` range. This creates a topologically connected surface across the cutout -- a "steg" (bridge) that no amount of cell skipping or boundary merging can eliminate.

### Solution: Split Bend Segments at Cutout Boundaries

Instead of generating one arc+tip pair for the full `tMin..tMax` range and then trying to punch holes, generate **multiple separate arc+tip pairs** -- one per valid bend segment that doesn't pass through a cutout.

This is the user's pragmatic "Step 1" (bend-line clipping) which directly eliminates the steg without requiring a full half-edge planar graph.

### Algorithm

```text
Input:
  bendLine in (t,d) space: from (tMin, 0) to (tMax, 0)
  cutouts in (t,d) space

Step 1: Intersect bend line with each cutout polygon
  - For each cutout, find intersection parameters u where
    the line d=0 crosses the cutout boundary edges
  - Also check if tMin or tMax is inside a cutout

Step 2: Build valid bend segments
  - Collect all intersection t-values
  - Sort them along t
  - For each interval [t_i, t_{i+1}], test midpoint:
    if midpoint is inside any cutout -> drop segment
    else -> keep as valid bend segment

Step 3: For each valid bend segment [tSegMin, tSegMax]:
  - Generate arc geometry only for t in [tSegMin, tSegMax]
  - Generate tip geometry only for t in [tSegMin, tSegMax]
  - Generate side walls at segment boundaries

Result: Multiple disconnected arc+tip mesh pairs,
        no geometry bridges across cutouts
```

### Technical Changes

**File: `src/lib/geometry.ts`**

#### 1. New helper function: `splitBendLineByHoles`

Clips the bend line interval `[tMin, tMax]` at `d=0` against all cutout polygons in `(t,d)` space. Returns an array of valid `[tSegMin, tSegMax]` intervals.

- For each cutout polygon (in `(t,d)` local space), find the t-values where the cutout boundary crosses `d=0` (line-segment intersection with `d=0`)
- Also test whether `tMin` and `tMax` themselves are inside any cutout
- Sort all intersection t-values, test midpoints of each sub-interval with `pointInPolygon`, keep intervals where midpoint is NOT inside any hole

#### 2. Refactor `createFoldMesh` return type

Change from returning one `{ arc, tip }` to returning an array: `{ arc: BufferGeometry; tip: BufferGeometry }[]` -- one entry per valid bend segment.

Or simpler: merge all segment geometries into single arc/tip `BufferGeometry` objects (just concatenate vertex/index buffers). This avoids changing the component interface.

**Chosen approach**: Keep the single `{ arc, tip }` return. Internally, loop over each bend segment and accumulate vertices/indices into the existing `arcVerts/arcIdx` and `tipVerts/tipIdx` arrays. The segments are just sub-ranges of `t`, so the existing arc and tip generation code can be parameterized by `[tSegMin, tSegMax]` instead of using the global `[tMin, tMax]`.

#### 3. Modify arc generation

Currently the arc grid spans `tMin..tMax` uniformly. Change to:

```text
for each segment [tSegMin, tSegMax]:
  generate GRID_T subdivisions from tSegMin to tSegMax
  generate GRID_THETA subdivisions from 0 to A
  skip cells inside holes (keep existing cellOverlapsHole)
  add left/right side walls at tSegMin, tSegMax
```

The existing hole-cell-skipping remains as a safety net for cutouts that don't cross d=0 (fully interior holes).

#### 4. Modify tip generation

Same approach: for each bend segment, the tip outer polygon is clipped to the segment's t-range. The boundary-merge logic operates per segment, so each segment's tip polygon is a sub-portion of the full `movPoly` that only spans `[tSegMin, tSegMax]` along the fold line.

Concretely:
- Clip `movPoly` to `t >= tSegMin` and `t <= tSegMax` (using `clipPolygonByLine` with vertical lines in t,d space)
- Apply the existing boundary-merge + ShapeGeometry triangulation on this clipped sub-polygon
- The hole boundaries now don't touch the outer boundary's d=0 edge within this segment (because the segment ends at the hole boundary)

#### 5. Tapering adjustment

The tapering logic (`leftSlope`, `rightSlope`) currently uses the polygon vertices adjacent to the leftmost/rightmost fold-line vertices. With per-segment generation, each segment needs its own taper slopes computed from the polygon edges adjacent to its endpoints. For segments that end at a cutout boundary (not at the polygon edge), slope = 0 (no tapering -- the boundary is a vertical cut).

#### 6. Side walls at segment boundaries

At each bend segment's tMin/tMax, generate side wall quads connecting inner to outer surfaces (both for arc and tip). This creates the "cut face" visible when looking into the cutout from the side.

#### 7. Cleanup

- Remove `cellOverlapsHole` multi-point sampling (or keep as fallback for interior holes)
- Remove boundary-merge logic complexity (segments won't have boundary-touching holes by construction)
- Remove debug logs

### Why This Works

The bend line is physically split at cutout boundaries. Each segment generates geometry independently. There is no vertex, edge, or triangle connecting geometry across the cutout. The steg is eliminated by construction, not by triangle removal.

### Impact on Other Systems

- **Viewer3D.tsx**: No interface change needed (still receives `{ arc, tip }`)
- **Bend lines visual**: `computeFoldBendLines` should also be split per segment for correct visual display (bend lines should end at holes). This is a visual-only change, can be done as follow-up.
- **Unfold**: No impact (unfold works from the profile + cutouts separately)
- **Flange edges**: No impact (computed from fold geometry, not from mesh)

### Execution Order

1. Implement `splitBendLineByHoles(tMin, tMax, cutoutsInLocalSpace)` helper
2. Refactor arc generation into a per-segment loop
3. Refactor tip generation into a per-segment loop  
4. Adjust side wall generation for segment boundaries
5. Test with circular cutout crossing fold line
6. Remove dead code and debug logs

