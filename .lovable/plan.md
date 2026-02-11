

# Fix: Robust Fold-Cutout Interaction (3 Architectural Changes)

## Context

The current fold+cutout system has three fundamental flaws that cause stripes, incorrect hole walls, and topology errors when cutouts (especially circles) cross a fold line. Additionally, the base fix from the previous session (always populating `foldLineInfos` even without cutouts) was NOT applied -- lines 339-348 of `Viewer3D.tsx` still early-return `[]` when cutouts are empty.

---

## Change 0 -- Always populate foldLineInfos (prerequisite, still missing)

**File**: `src/components/workspace/Viewer3D.tsx` (lines 339-348)

The `foldLineInfos` memo still has `if (!cutouts || cutouts.length === 0) return [];` and `if (info && info.blocked.length > 0)`. This means:
- Without cutouts: foldLineInfos is empty, so ExtrudeGeometry is used (generates coplanar sidewalls = stripe)
- With cutouts but no blocked intervals: same problem

**Fix**: Remove the early return. Always iterate over all base folds and always push the info (not just when blocked.length > 0). This ensures `buildBaseFaceManual` is always used when folds exist.

---

## Change 1 -- Feed ALL cutouts into computeFoldLineInfo

**File**: `src/components/workspace/Viewer3D.tsx` (lines 343-346)

Currently only `getMovingCutouts(cutouts, fold, ...)` is passed. When a circle straddles the fold line, the moving-side clip may produce a small sliver or nothing, causing `blocked` to be incomplete.

**Fix**: Pass all cutout polygons (not just moving-side) to `computeFoldLineInfo`. The function's internal TD mapping (`toLocal`) and `computeFoldBlockedIntervalsTD` already handle arbitrary polygons crossing d=0 correctly -- they just need to see all of them.

```
// Before:
const movCutouts = getMovingCutouts(cutouts, fold, profile, thickness);
computeFoldLineInfo(fold, profile, thickness, movCutouts)

// After:
const allCutoutPolys = cutouts.map(c => c.polygon);
computeFoldLineInfo(fold, profile, thickness, allCutoutPolys)
```

---

## Change 2 -- Hole sidewalls: detect "crosses fold line" not "lies on fold line"

**File**: `src/lib/geometry.ts`, `buildBaseFaceManual` (lines 370-433) and `computeBoundaryEdges` (lines 471-496)

Currently hole-edge suppression only triggers when BOTH endpoints satisfy `abs(d) < foldDTol`. For a circle approximated as 32 polygon segments, virtually no segment has both endpoints on the fold line. The fold line cuts THROUGH the circle, crossing segments.

**Fix**: For each hole segment p0-p1, check if the segment **crosses** the fold line (d0 and d1 have different signs, or one is near zero). When a crossing is detected:
- Split the segment at the intersection point
- The sub-segment on the fold-line side (d near 0, within bend zone) should be suppressed (no sidewall/boundary emission)
- The sub-segment on the fixed side should be emitted normally

Specifically in `buildBaseFaceManual`:
```
// New logic for hole edges:
for each hole segment p0->p1:
  project to fold: d0, d1, t0, t1
  if both |d| < tol:  // existing case: segment ON fold line
    -> suppress using blocked/keep intervals (existing logic)
  else if d0 * d1 < 0:  // NEW: segment CROSSES fold line
    -> compute intersection point at d=0
    -> emit sidewall only for the portion on fixed side (d > threshold)
    -> skip the portion near d=0 (arc/fold mesh handles it)
  else:
    -> emit normally
```

Same logic applies to `computeBoundaryEdges` for hole loops.

---

## Change 3 -- Fold mesh generates curved hole walls in bend zone

**File**: `src/lib/geometry.ts`, `createFoldMesh` (around lines 2221-2238)

The fold mesh already generates arc-hole-walls for cutouts that overlap the arc zone (lines 2221-2238). However, this only works for the moving-side cutout pieces. The same curved hole-wall logic needs the full cutout polygons to correctly identify where the hole boundary enters and exits the bend zone.

**Fix**: In `createFoldMesh`, also accept all cutout polygons (not just moving cutouts) for the hole-wall sweep. The existing `holeLocs` / `segArcHoleLocs` pipeline already handles clipping to the arc zone -- it just needs complete input.

This is achieved by the same change as Change 1: passing all cutout polygons instead of just moving cutouts.

In `Viewer3D.tsx` where `FoldMesh` receives `movingCutouts`:
```
// Before:
const foldMovingCutouts = getMovingCutouts(cutouts, fold, profile, thickness);

// After:
const foldAllCutouts = cutouts.map(c => c.polygon);
```

---

## Files Changed

1. **`src/components/workspace/Viewer3D.tsx`**:
   - `foldLineInfos` memo: remove early return, always compute for all base folds, always push (Change 0)
   - `foldLineInfos` memo: pass all cutout polygons instead of moving-only (Change 1)
   - `FoldMesh` rendering: pass all cutout polygons instead of moving-only (Change 3)

2. **`src/lib/geometry.ts`**:
   - `buildBaseFaceManual` hole sidewalls: add crossing detection with segment splitting (Change 2)
   - `computeBoundaryEdges` hole loops: add crossing detection with segment splitting (Change 2)

## Why This Works

- Change 0: Eliminates the stripe on simple folds (no cutouts) by always using the manual builder
- Change 1: Ensures blocked intervals are correct regardless of cutout position relative to fold
- Change 2: Correctly suppresses hole walls in the bend zone for circles/arcs where no segment "lies on" the fold line
- Change 3: Ensures the fold mesh generates the curved replacement walls for the suppressed portions

