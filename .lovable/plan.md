
# Fix Unfold Flat Pattern and 3D Fold Rendering

## Problem Summary

Two visual bugs when folding a diagonal line on a 200x100mm base face:

1. **Unfold shows wrong dimensions (204.4 x 105.x instead of 200x100)** -- A displaced green triangle is created as a separate region, extending beyond the original face. Inventor's flat pattern is simply the original rectangle with a dashed bend line.

2. **3D bend looks unrealistic compared to Inventor** -- Visible gaps and shading inconsistencies at the fold junction due to Z-offsets and mismatched material settings.

---

## What Changes Visually

- The unfold view will show the original 200x100mm rectangle with bend lines drawn ON it -- no extra displaced regions, no size change
- The 3D fold will look seamless with the base face -- no visible gap or shading mismatch at the junction

---

## Technical Changes

### File 1: `src/lib/unfold.ts` -- Fix flat pattern for folds

The fold processing loop (lines 82-121) currently:
1. Clips the moving polygon from the profile
2. Shifts it outward by Bend Allowance (BA)
3. Adds it as a separate `flange`-type region

This is correct for edge flanges (adding new material) but wrong for folds (bending existing material).

**Fix:** Remove the displaced region creation for folds entirely. Keep only the bend line annotations:

- Remove lines 91-107 (movingPoly clipping, BA shift, and `regions.push`)
- Change bend line positions to use the ORIGINAL drawn fold line position (not shifted by foldLocation inner edge offset), since the flat pattern represents the original face
- Keep two bend lines (marking the bend zone width = BA) to match Inventor's convention
- The base region at line 52 already uses the full original profile -- this stays unchanged
- Overall dimensions will be exactly the original face size (200 x 100)

### File 2: `src/lib/geometry.ts` -- Remove micro-gap in fold mesh

In `createFoldMesh` (line 1036), `EPS = 0.01` adds a small Z-offset to all arc and tip vertices to prevent z-fighting with the base face. This creates a visible micro-gap between the base face surface and the fold arc start.

**Fix:** Set `EPS = 0` (or remove it entirely). Z-fighting is not an issue here because the fold arc starts at the fold line boundary, not overlapping the base face surface.

### File 3: `src/components/workspace/Viewer3D.tsx` -- Match material settings

The fold tip mesh (line 136) uses `flatShading` while the base face (line 329) does not. This creates inconsistent lighting at the junction.

**Fix:** Remove `flatShading` from the fold tip material to match the base face appearance. The smooth shading will make the transition between base face and fold look seamless, matching Inventor's rendering.

---

## Files Modified

1. `src/lib/unfold.ts` -- Remove displaced fold regions; keep only bend lines at original fold line positions
2. `src/lib/geometry.ts` -- Remove EPS offset in createFoldMesh for seamless junction
3. `src/components/workspace/Viewer3D.tsx` -- Remove flatShading from fold tip material

## Expected Result

- Unfold shows exactly 200.0 x 100.0 mm with two dashed bend lines along the diagonal
- 3D fold transitions seamlessly from base face to bend arc to folded flap
- Matches Inventor behavior for both views
