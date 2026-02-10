

## Fix: Cutout Material Remaining in Bend Zone

### Root Cause Analysis

After tracing through the entire rendering pipeline, I found **two distinct issues** causing material to remain visible inside the circular cutout at the bend zone:

**Issue 1: TIP geometry earcut failure (PRIMARY CAUSE)**

The tip (flat flange face) geometry at lines 1653-1676 uses `THREE.ShapeGeometry` (earcut triangulation) with the cutout hole added as a `THREE.Path`. The cutout hole boundary has vertices at `d=0` (the fold line), which is ALSO where the tip's outer polygon boundary lies. When hole edges coincide with the outer shape boundary, **earcut triangulation fails silently**, producing incorrect triangles that fill part of the hole.

These invalid triangles map to 3D positions at the arc-flange junction (theta=A), creating the visible curved strip of material inside the cutout at the bend zone.

**Issue 2: Arc grid may need validation**

The grid-based arc approach (lines 1470-1557) appears algorithmically correct, but I want to add validation to confirm cells are actually being skipped at runtime.

### Solution

**Part 1 - Fix tip geometry (main fix):**
Replace the `THREE.ShapeGeometry`-based triangulation of the tip with a grid-based approach (same as the arc), OR clip the hole polygon to avoid touching the outer boundary at `d=0` by insetting with a small epsilon, AND clip the movPoly's `d=0` boundary to `d=epsilon` as well so they don't share vertices.

The simpler and more robust approach: **clip the tip cutout holes to d >= epsilon** (e.g., `epsilon = 0.01`). This prevents the earcut boundary collision. The missing thin strip (0.01mm) is invisible.

**Part 2 - Ensure arc grid is working:**
Add a temporary triangle-count log to verify the grid is actually skipping cells. Remove debug logs once confirmed.

**Part 3 - Clean up dead code:**
Remove the unused `arcShape` / `arcOutlinePts` code (lines 1392-1414) that was left over from the old ShapeGeometry-based arc approach.

### Technical Changes

**File: `src/lib/geometry.ts`**

1. **Lines ~1662-1676 (tip cutout holes):** Before adding cutout holes to `tipShape`, clip each hole's vertices to `d >= EPS` (0.01). This prevents the hole boundary from touching the outer shape boundary at `d=0`:

```text
const TIP_HOLE_EPS = 0.01;
for (const cutPoly of movingCutouts) {
  const cutLocs = cutPoly.map(p => toLocal(p));
  if (cutLocs.length < 3) continue;
  // Clip hole to d >= EPS to avoid earcut failure when hole touches outer boundary
  const clippedLocs = cutLocs.map(l => ({
    t: l.t,
    d: Math.max(l.d, TIP_HOLE_EPS)
  }));
  const holePath = new THREE.Path();
  holePath.moveTo(clippedLocs[0].t, clippedLocs[0].d);
  for (let i = 1; i < clippedLocs.length; i++) {
    holePath.lineTo(clippedLocs[i].t, clippedLocs[i].d);
  }
  holePath.closePath();
  tipShape.holes.push(holePath);
  holeLocs.push(cutLocs); // keep original for side walls
}
```

2. **Lines ~1392-1414 (dead code):** Remove the unused `arcOutlinePts` and `arcShape` construction that was left from the old ShapeGeometry arc approach.

3. **Lines ~1416-1448 (debug logs):** Remove all `console.log('[ARC-DEBUG]...')` statements.

4. **Tip side walls at d=0 (lines 1711-1731):** The side wall strip at `d < DTOL` is already skipped (`if (tipLocs[i].d < DTOL && tipLocs[j].d < DTOL) continue`), so the fold-line boundary wall is correctly omitted. However, the HOLE side walls (lines 1734-1751) need to also handle the `d=0` boundary properly -- for hole vertices at `d=0`, the hole wall should connect to the arc geometry rather than creating a separate wall at the tip position.

### Why Previous Attempts Failed

- **ShapeGeometry with holes:** Failed because earcut cannot triangulate when hole vertices touch the outer boundary.
- **Epsilon inset on the arc:** Fixed the arc side but missed the tip geometry, which has the same earcut problem.
- **Grid-based arc:** Correctly solves the arc, but the tip still uses earcut with the boundary-touching hole, creating the visible artifact.

