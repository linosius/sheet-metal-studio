

## Fix: Replace Tip Earcut with Grid-Based Triangulation

### Root Cause

The arc grid IS working correctly (792 of 960 cells skipped). The visible material inside the cutout at the bend zone comes from the **tip (flange face) geometry**, which still uses `THREE.ShapeGeometry` (earcut triangulation).

When the cutout semicircle has its flat edge at `d=0.01` (the epsilon-inset fold line) and spans nearly the full width of the outer polygon, earcut produces **incorrect triangles** that fill the hole. These triangles at `d ~ 0` map to 3D positions at `theta = A` (the arc/tip junction), creating the visible curved strip of material.

This is fundamentally the same topology problem identified: the tip's outer boundary at `d=0` is continuous across the cutout, and earcut cannot reliably handle a hole that nearly coincides with the outer boundary across its full width.

### Solution

Replace the tip's `THREE.ShapeGeometry` (earcut) with a **manual grid-based triangulation** -- the same approach that already works for the arc. This completely eliminates earcut from the fold mesh pipeline.

### Technical Changes

**File: `src/lib/geometry.ts`** -- Tip geometry section (lines ~1627-1690)

Replace the ShapeGeometry-based tip with:

1. **Compute bounding box** of `movPoly` in `(t, d)` local space to get `[tMinTip, tMaxTip]` and `[dMin, dMax]`.

2. **Create a grid** with `GRID_T_TIP` (e.g., 40) cells along `t` and `GRID_D_TIP` (e.g., 40) cells along `d`.

3. **For each grid vertex**, compute `(t, d)` and map to 3D using `tipInner(t, d)` / `tipOuter(t, d)`.

4. **For each grid cell**, test the center point:
   - Is it inside `movPoly` (the outer polygon in t,d space)? If no, skip.
   - Is it inside any cutout polygon (in t,d space)? If yes, skip.
   - Otherwise, emit two triangles for inner surface, two for outer surface.

5. **Side walls**: Keep the existing side wall generation for the outer polygon boundary and hole boundaries.

6. **Remove** the `THREE.ShapeGeometry` / earcut code entirely for the tip.

### Pseudocode

```text
// Grid bounds from movPoly
tMinTip = min(locs.t), tMaxTip = max(locs.t)
dMinTip = 0, dMaxTip = max(locs.d)

GRID_T_TIP = 40
GRID_D_TIP = 40

// Build vertex grid
for it = 0..GRID_T_TIP:
  for id = 0..GRID_D_TIP:
    t = tMinTip + (tMaxTip - tMinTip) * it / GRID_T_TIP
    d = dMinTip + (dMaxTip - dMinTip) * id / GRID_D_TIP
    // Apply fold-line tapering for vertices near d=0
    tTapered = taperT(t, d)
    vertex = tipInner(tTapered, d)
    store vertex index

// Build triangles with cell-level hole testing
for it = 0..GRID_T_TIP-1:
  for id = 0..GRID_D_TIP-1:
    tc, dc = cell center
    if not pointInPolygon(tc, dc, movPolyLocs): continue  // outside face
    if pointInPolygon(tc, dc, cutoutLocs): continue       // inside hole
    emit triangles from 4 corner vertices
```

### Benefits

- **No earcut dependency** -- immune to boundary-touching holes
- **Consistent approach** -- same grid logic as the arc, proven to work
- **Clean topology** -- cells inside holes are simply never created, providing true topological separation
- **No epsilon hacks** -- no need for `TIP_HOLE_EPS` insets

### Cleanup

- Remove `TIP_HOLE_EPS` constant and epsilon-clamping logic
- Remove `THREE.ShapeGeometry` creation and disposal
- Remove the `[ARC-HOLE]` debug console.log statements
- Keep hole side wall generation (adjusted to use cutout polygons in `(t,d)` space)
