

## Fix: Merge Boundary-Touching Cutouts Into Outer Polygon (Smooth Edges)

### Problem

The grid-based triangulation for the tip (and arc) creates visible **staircase/stepped edges** along curved cutouts. A 40x40 grid simply cannot approximate a circle smoothly -- each cell is either fully included or excluded, producing jagged rectangular steps.

The previous earcut approach had smooth edges but failed when hole boundaries coincided with the outer boundary at d=0.

### Root Cause (Why Earcut Fails)

Earcut treats holes as **separate interior polygons**. When a hole's vertices lie exactly on the outer boundary (at d=0, the fold line), earcut cannot determine "inside" vs "outside" and produces garbage triangles. This is a well-known limitation.

### Solution: Boundary Merging

Instead of adding the cutout as a hole, **merge it into the outer boundary polygon itself**. When a cutout crosses d=0:

- The outer polygon currently runs continuously along d=0
- The cutout has a flat edge at d=0 that overlaps with the outer boundary
- Solution: Route the outer polygon **around** the cutout opening

Before (fails):
```text
Outer: [A]--[B]--[C]--[D] (continuous along d=0)
Hole:  [H1]--[H2]--[H3]  (touching d=0 between B and C)
```

After (works):
```text
Single polygon: [A]--[B]--[H1]--[H2]--[H3]--[C]--[D]
(no hole needed -- cutout is part of the boundary)
```

Earcut handles this perfectly because it's just one polygon with a notch. Curved edges remain smooth because the cutout's original vertices (e.g., circle approximation points) are preserved exactly.

### Technical Changes

**File: `src/lib/geometry.ts`**

#### Part 1: Tip Geometry -- Replace grid with boundary-merged earcut

Remove the entire grid-based tip triangulation (lines ~1640-1717) and replace with:

1. Convert movPoly and cutouts to (t, d) local space (already done)
2. For each cutout that touches d=0:
   - Find the two "entry/exit" points where the cutout crosses d=0 (or the leftmost/rightmost points at d < DTOL)
   - Sort them by t-coordinate along the d=0 boundary
   - Split the outer polygon's d=0 edge at those points
   - Insert the cutout's d>0 vertices (in reverse order) between the split points
   - Result: single polygon, no holes
3. For cutouts entirely inside the tip (not touching d=0): keep as normal holes (earcut handles interior holes fine)
4. Create `THREE.Shape` from the merged polygon, add any interior-only holes
5. Use `THREE.ShapeGeometry` to triangulate -- smooth curved edges, no staircase
6. Map the 2D (t,d) vertices to 3D using tipInner/tipOuter (same as before)

Pseudocode:
```text
outerPoly = movPolyLocs (in t,d space)
interiorHoles = []

for each cutout:
  cutLocs = cutout mapped to (t,d) space
  touchingD0 = any vertex has d < DTOL

  if touchingD0:
    // Find entry/exit points on d=0 edge
    entryT, exitT = min/max t of vertices with d < DTOL
    // Get the d>0 arc of the cutout (sorted CCW)
    arcVertices = cutout vertices with d >= DTOL
    // Merge into outer polygon:
    // Split outer polygon's d=0 segment at entryT and exitT
    // Insert arcVertices between the split points
    outerPoly = mergeNotch(outerPoly, entryT, exitT, arcVertices)
  else:
    interiorHoles.push(cutLocs)

shape = new THREE.Shape(outerPoly)
for hole in interiorHoles:
  shape.holes.push(new THREE.Path(hole))

geo = new THREE.ShapeGeometry(shape)
// Map each vertex (t,d) -> tipInner(t,d) and tipOuter(t,d)
```

#### Part 2: Arc Geometry -- Replace grid with boundary-merged earcut in (t, theta) space

Same approach applied to the arc, in (t, theta) parameter space:

1. Define the arc outer boundary as a polygon in (t, theta) space:
   `[(tMin,0), (tMax,0), (tMax,A), (tMin,A)]` (with tapering applied)
2. For cutouts that touch theta=0 or theta=A, merge them into the boundary
3. For interior cutouts, add as holes
4. Triangulate with `THREE.ShapeGeometry` in (t, theta) space
5. Map each resulting vertex to 3D using arcInner(t, theta) / arcOuter(t, theta)

#### Part 3: Cleanup

- Remove grid constants `GRID_T_TIP`, `GRID_D_TIP`, `GRID_T`
- Remove `cellOverlapsHole`, `tipCellInsideHole`, multi-point sampling logic
- Remove grid vertex index arrays `tipInnerVIdx`, `tipOuterVIdx`, `innerVIdx`, `outerVIdx`
- Keep side wall generation for both outer boundary and hole boundaries

### Why This Works

- **Smooth edges**: The cutout's original vertices (circle approximation with many points) are used directly -- no grid discretization
- **No earcut failure**: No hole touches the outer boundary, because boundary-touching cutouts are merged INTO the boundary
- **Correct topology**: The merged polygon has a physical notch where the cutout is -- there is no continuous surface across the cutout
- **Performance**: ShapeGeometry is faster than a 40x40 grid with per-cell polygon tests
- **Same visual quality as Inventor**: Inventor uses the same conceptual approach (face splitting at cutout boundaries)

### Benefits Over Grid Approach

| Aspect | Grid (current) | Boundary Merge (proposed) |
|--------|---------------|--------------------------|
| Edge quality | Staircase/stepped | Smooth curves |
| Performance | 1600 cells x 5 polygon tests | Single earcut pass |
| Topology | Cell-level exclusion | True boundary separation |
| Complexity | High (sampling, thresholds) | Moderate (polygon merging) |

