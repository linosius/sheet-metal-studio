

# Fix Bend Zone Geometry to Match Inventor

## Problem

When a diagonal fold is made on a rectangular face, the moving region is triangular. Currently, the bend arc (cylindrical sweep) is always built as a **uniform rectangle** from `tMin` to `tMax` along the fold line. This causes the arc to extend beyond the sheet metal face boundary, creating an unrealistic shape that differs from Inventor.

In Inventor, the bend arc follows the actual polygon outline -- it tapers where the triangle narrows, producing a clean, bounded result.

## Solution

Modify the arc geometry builder in `createFoldMesh` (`src/lib/geometry.ts`) to compute a **variable t-range at each angular step**, matching the moving polygon's boundary.

### How it works

The arc sweeps through angles 0 to A (bend angle). At each angular step `ang`:
- The inner surface is at perpendicular distance `d = R * sin(ang)` from the fold line
- The outer surface is at `d = (R + T) * sin(ang)`

By intersecting these d-values with the moving polygon boundary (in the local t-d coordinate system), we get the correct t-range at each angular step. For a triangular moving region, this means the arc naturally tapers from full fold-line width at angle 0 to a narrower width at the bend angle, perfectly following the polygon boundary.

### Implementation Steps

**File: `src/lib/geometry.ts`**

1. **Add a helper function `getPolygonTRangeAtD(polygon, d)`** that takes the moving polygon in local (t, d) coordinates and a d-value, and returns `[tLeft, tRight]` by intersecting a horizontal line at that d with the polygon edges. Returns null if d is beyond the polygon extent.

2. **Refactor the arc inner/outer surface loops** in `createFoldMesh`:
   - At each angular step, compute `d_inner = R * sin(ang)` and `d_outer = (R + TH) * sin(ang)`
   - Call `getPolygonTRangeAtD` for each to get the actual t-bounds
   - Use these variable t-bounds instead of the fixed `tMin`/`tMax`
   - Skip segments where the polygon has zero width at that d

3. **Replace rectangular side caps** with polygon-boundary-following caps:
   - Instead of flat rectangular caps at tMin and tMax, build side surfaces that follow the actual polygon boundary edges
   - For each polygon edge connecting a fold-line vertex (d near 0) to a non-fold-line vertex (d > 0), trace the corresponding arc surface along that edge

4. **Update `computeFoldBendLines`** to use the same variable t-range logic for the bend-start and bend-end tangent lines, so they also follow the polygon shape.

### Visual Result

- For a diagonal fold creating a triangle, the arc will taper from the fold line width down to match the triangle shape
- Side caps will follow the diagonal face boundary edges
- The result will match Inventor's bend zone representation exactly

## Technical Details

```text
Current (incorrect):             Fixed (correct):

  tMin ──────── tMax              tMin ──────── tMax
  |              |                |              /
  |   Arc rect   |    -->         |   Arc      /
  |   (too wide) |                |   tapered /
  |              |                |         /
  tMin ──────── tMax              tMin ──  tApex
```

The key mathematical relationship:
- At arc angle `ang`, the inner radius traces `d = R * sin(ang)` in the polygon's local coordinate system
- By querying the polygon boundary at each d-value, the arc width adjusts automatically
- This works for any polygon shape (triangles, trapezoids, irregular) not just rectangles

