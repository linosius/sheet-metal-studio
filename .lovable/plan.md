

## Fix: Arc Cutout Hole Touching Boundary

### Root Cause

The debug logs show the clipped cutout polygon has vertices at exactly `y=0` and `y=1.5708` (= A), which are the exact boundaries of the arc outline shape. THREE.js uses the earcut algorithm for triangulating shapes with holes, and **earcut fails when hole edges coincide with or touch the outer shape boundary**. This causes the triangulation to produce incorrect or incomplete results, leaving parts of the arc visible inside the hole.

### Solution: Inset Hole Boundaries

Instead of clipping the cutout polygon to the exact arc boundaries, inset it by a small epsilon (e.g., 0.005) so the hole never touches the outer shape:

- Clip at theta = +epsilon instead of theta = 0
- Clip at theta = A - epsilon instead of theta = A  
- Clip at t = tMin + epsilon instead of tMin - 0.1
- Clip at t = tMax - epsilon instead of tMax + 0.1

This tiny inset (imperceptible visually) ensures earcut triangulation works correctly.

### Alternative Approach (if inset alone isn't enough)

If the cutout spans the full theta range (0 to A), it essentially splits the arc into separate regions. In that case, instead of using a hole, **reconstruct the arc outline** to go around the cutout — effectively creating an arc shape that already excludes the cutout area without needing holes at all. This is more robust but more complex.

We'll start with the inset approach as it's simpler and should solve the problem.

### Changes

**File: `src/lib/geometry.ts`** (lines ~1436-1444)

- Change clipping boundaries to use epsilon inset:
  - `y: 0` becomes `y: EPS` (clip theta >= EPS)
  - `y: A` becomes `y: A - EPS` (clip theta <= A - EPS)
  - `x: tMin - 0.1` becomes `x: tMin + EPS` (clip t >= tMin + EPS)
  - `x: tMax + 0.1` becomes `x: tMax - EPS` (clip t <= tMax - EPS)
- Remove debug console.log statements after confirming the fix works.

### Technical Detail

```
const EPS = 0.005;
// Clip to arc interior (not touching boundary)
clippedArcCut = clipPolygonByLine(clippedArcCut, { x: 0, y: EPS }, { x: 0, y: -1 });
clippedArcCut = clipPolygonByLine(clippedArcCut, { x: 0, y: A - EPS }, { x: 0, y: 1 });
clippedArcCut = clipPolygonByLine(clippedArcCut, { x: tMin + EPS, y: 0 }, { x: -1, y: 0 });
clippedArcCut = clipPolygonByLine(clippedArcCut, { x: tMax - EPS, y: 0 }, { x: 1, y: 0 });
```

