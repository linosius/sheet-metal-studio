

# Fix Child Fold Pivot, Angle Sign, and foldLocation Offsets

## Summary

Three bugs need fixing:
1. **Child folds use the fold line as a hinge** instead of rotating around the center of curvature, causing nested folds to land in wrong positions
2. **The rotation angle sign is hardcoded** using a simple up/down check that doesn't account for fold axis orientation
3. **`foldLocation` is stored but never used** -- the property exists on every Fold but no geometry function reads it

## What Will Change Visually

- Nested folds (a fold inside another fold's moving region) will land at the correct arc-end position instead of hinging around the fold line
- The `foldLocation` setting in the fold dialog (centerline / material-inside / material-outside) will actually affect geometry: shifting where the bend starts on the base face and adjusting the flat pattern accordingly
- Single folds without nesting will look the same as before

---

## Technical Details

### Bug 1 and 2: Pivot and Angle Sign (Viewer3D.tsx, lines 461-466)

**Current code:**
```typescript
const pivot = parentEdge.start;  // fold line point -- acts as hinge
const axis = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();
const angleRad = (parentFold.direction === 'up' ? -1 : 1) * (parentFold.angle * Math.PI / 180);
```

**Fixed code:**
```typescript
const axis = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();
const R = parentFold.bendRadius;

// Center of curvature = inner edge + R along face normal direction
// This matches the arc formula in createFoldMesh where the arc center is at O + R*W3
const pivot = parentEdge.start.clone().add(
  parentEdge.faceNormal.clone().multiplyScalar(R)
);

// Angle sign from triple product: ensures rotation direction matches arc parameterization
const crossUW = new THREE.Vector3().crossVectors(parentEdge.normal, parentEdge.faceNormal);
const signFactor = Math.sign(crossUW.dot(axis));
const angleRad = signFactor * (parentFold.angle * Math.PI / 180);
```

The pivot matches the arc formula's center of curvature (`O + R * W3`), and the triple product sign ensures the rigid rotation reproduces the arc endpoint positions for any fold axis orientation.

### Bug 3: foldLocation Offsets

A new helper function `foldLineToInnerEdgeOffset` converts the `foldLocation` setting into a physical distance:
- `material-inside`: 0 (drawn line = inner edge, no shift)
- `centerline`: thickness / 2
- `material-outside`: thickness

This offset shifts the clipping plane, arc origin, and edge position from the drawn fold line toward the fixed side (against the fold normal), so the bend zone starts at the correct physical location.

---

## Files Modified

### 1. `src/lib/geometry.ts`

**Add helper** (~line 548, after Fold interface):
- `foldLineToInnerEdgeOffset(foldLocation, thickness)` -- returns the offset distance

**Update `getFixedProfile`** (line 809):
- Add `thickness` parameter (default 0)
- Shift each fold's clip point by `foldLineToInnerEdgeOffset` in the `-normal` direction before clipping

**Update `createFoldMesh`** (line 939):
- Shift arc origin `O`, moving polygon clip point, and `toLocal` reference by the foldLocation offset

**Update `computeFoldEdge`** (line 772):
- Shift the 3D edge start/end by the foldLocation offset so `parentEdge.start` sits at the inner edge (needed for correct pivot calculation)

**Update `computeFoldBendLines`** (line 1177):
- Same offset shift for bend line positions

**Update `getFoldMovingHeights`** (line 834):
- Same offset shift for clip point and distance measurements

**Update `getAllSelectableEdges`** (line 386):
- Pass `thickness` to `getFixedProfile`

### 2. `src/components/workspace/Viewer3D.tsx`

**Fix pivot and angle sign** (lines 461-466):
- Change pivot from `parentEdge.start` to `parentEdge.start + R * parentEdge.faceNormal`
- Change angle sign from simple up/down check to triple-product formula

**Update `getFixedProfile` call** (line 258):
- Pass `thickness` as the new parameter

### 3. `src/lib/unfold.ts`

**Apply foldLocation offset to flat pattern** (lines 82-118):
- Import `foldLineToInnerEdgeOffset` from geometry
- Shift the clip point for each fold's moving polygon by the offset
- Shift bend line positions to match the inner edge
- BA shift direction (`+normal * BA`) remains unchanged

### 4. `src/pages/Workspace.tsx`

- No direct calls to `getFixedProfile` found in this file, so no changes needed here

## Verification After Implementation

1. Create a single 90-degree fold and verify it looks the same as before (offset = 0 for default centerline)
2. Create a nested fold (fold inside another fold's region) and verify the child lands at the arc endpoint instead of hinging
3. Toggle foldLocation between centerline / material-inside / material-outside and verify the bend start position shifts visibly
4. Check the flat pattern updates correctly with foldLocation changes

