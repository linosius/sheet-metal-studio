
# Fix: Remove Overlapping Geometry at Fold Junction

## Problem
The visible stripe at the fold-base junction is caused by **double geometry**: both the base face and the arc generate surfaces and boundary edge lines at the exact same location (the fold line at ang=0).

Specifically:
- `buildBaseFaceManual` emits sidewall quads for bend-segment intervals on the fold line
- The arc's side walls (left/right) at ang=0 cover the same area
- `computeBoundaryEdges` emits top/bottom/vertical edge lines at the fold line
- Arc boundary edges also emit inner-to-outer connectors at ang=0

Both create coplanar surfaces and doubled edge lines = visible stripe.

## Solution

Two targeted changes in `src/lib/geometry.ts`:

### 1. Remove base face sidewalls at fold lines

In `buildBaseFaceManual` (around line 356): change the fold-line sidewall logic to **NOT** emit sidewalls for bend-segment intervals. The arc provides this closure. Only emit sidewalls for the GAPS (blocked intervals where cutouts cross the fold line).

Current logic: `keep = clipIntervalByAllowed([t0,t1], bendSegments)` then emit quads for `keep`.
New logic: **Skip sidewall emission entirely** for edges on fold lines where bend segments exist. The arc's side walls + base cap handle this boundary.

### 2. Remove base face boundary edges at fold lines

In `computeBoundaryEdges` (around line 500): for edges on fold lines, **do NOT emit** top/bottom/vertical boundary edge lines for the bend-segment intervals. The arc boundary edges already cover this junction.

Current logic: emit `addEdge` for each `keep` interval on fold edges.
New logic: Skip boundary edge emission for fold-line edges entirely (the arc boundary edges at ang=0 already draw the connecting lines there).

## Files Changed
- `src/lib/geometry.ts`: Modify fold-line handling in both `buildBaseFaceManual` and `computeBoundaryEdges` to skip emission where the arc provides coverage.

## Why This Works
- Removes the only source of coplanar double-geometry at the fold junction
- Arc's left/right side walls already close the volume at the fold line boundary
- Arc's boundary edges at ang=0 already draw the inner-to-outer connectors
- No new geometry needed — just stop generating duplicate geometry
