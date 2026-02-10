

## Debug and Fix: Bend-Line Splitting Not Working

### Diagnosis Approach

The bend-line splitting logic at lines 1334-1368 should split `bendSegments` when a cutout crosses `d=0`, but the screenshot shows the arc still has a material bridge. To identify the root cause, we need to add targeted `console.log` statements at key decision points.

### Step 1: Add diagnostic logging in `createFoldMesh`

**File: `src/lib/geometry.ts`** -- Add after line 1368 (after `bendSegments` is computed):

```typescript
console.log('[FOLD-DEBUG]', {
  tMin, tMax,
  tipHolePolyCount: tipHolePoly.length,
  tipHolePolyVerts: tipHolePoly.map(h => h.length),
  blocked,
  bendSegments,
  movingCutoutsCount: movingCutouts?.length ?? 0,
});
```

Also add after line 1331 (inside the cutout loop), to see the `d` values:

```typescript
console.log('[FOLD-DEBUG] cutout locs d-values:', cutLocs.map(l => l.d.toFixed(4)));
```

### Step 2: Likely root causes to investigate

Based on code analysis, there are several possible failure modes:

**A) `movingCutouts` might be empty or undefined**
- The cutout might not survive the `getMovingCutouts` clipping
- If the circle doesn't actually cross the fold line (e.g., it's entirely on the fixed side), `movingCutouts` would be empty

**B) The cutout `d` values might all be > DTOL (1.0)**
- If the circle radius is small relative to the circle's distance from the fold line
- Or if floating-point precision causes the clip intersection points to have `d` slightly above 0

**C) `nearBend.length < 2` -- not enough vertices near `d=0`**
- If `clipPolygonByLine` produces intersection points with `d` not exactly 0

**D) The cutout might not be passed at all**
- `cutouts` in `Viewer3D.tsx` might be empty or not include this particular cutout

### Step 3: Fix based on findings

Once the console.log reveals the issue, apply the appropriate fix:

- If `movingCutouts` is empty: fix `getMovingCutouts` clipping direction
- If `d` values are slightly negative (not caught by `d < DTOL`): use `Math.abs(d) < DTOL`
- If `nearBend` is insufficient: lower `DTOL` tolerance or use a different detection method (intersect the `d=0` line with cutout polygon edges directly, rather than checking vertex positions)

### Most Likely Fix: Use line-segment intersection instead of vertex filtering

The current approach filters vertices by `d < DTOL`, which is fragile. A more robust approach is to directly compute where each cutout polygon's edges cross `d=0`:

```typescript
// Instead of filtering vertices near d=0, intersect cutout edges with d=0 line
const crossings: number[] = [];
for (let i = 0; i < hPts.length; i++) {
  const j = (i + 1) % hPts.length;
  const d1 = hPts[i].y, d2 = hPts[j].y;
  // Edge crosses d=0 if signs differ (or one is exactly 0)
  if ((d1 <= 0 && d2 > 0) || (d1 > 0 && d2 <= 0)) {
    const frac = d1 / (d1 - d2);
    const tCross = hPts[i].x + frac * (hPts[j].x - hPts[i].x);
    crossings.push(tCross);
  }
}
if (crossings.length >= 2) {
  const bMin = Math.min(...crossings);
  const bMax = Math.max(...crossings);
  if (bMax > tMin && bMin < tMax) {
    blocked.push([Math.max(bMin, tMin), Math.min(bMax, tMax)]);
  }
}
```

This directly finds where the cutout boundary crosses the bend line, which is geometrically exact and doesn't depend on whether vertices happen to be near `d=0`.

### Implementation Plan

1. Add console.log diagnostics (Step 1)
2. Replace vertex-based `nearBend` detection with edge-intersection-based crossing detection (Step 3)
3. Also add a `pointInPolygon` midpoint check: for each sub-interval of the bend line, test if the midpoint is inside the cutout (belt-and-suspenders)
4. Remove debug logs after confirming the fix works

### Technical Details

**File: `src/lib/geometry.ts`**

Replace lines 1334-1345 (the `blocked` computation) with the edge-intersection approach that:
1. For each cutout polygon in `tipHolePoly`, iterates over edges
2. Finds t-values where edges cross `d=0` (the bend line)
3. Also tests if tMin or tMax is inside the cutout via `pointInPolygon`
4. Computes blocked intervals from crossings + containment

This is more robust than filtering vertices by proximity to `d=0`.

