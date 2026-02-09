

## Folds Through Cutouts

### Problem
Currently, cutouts (holes) in the base face are only rendered on the base face mesh via `THREE.Shape.holes`. When a fold line crosses through a cutout, the fold mesh is created as a solid polygon -- the cutout is not carried into the folded portion. Additionally, only circles are supported as cutouts; rectangles and line-based closed shapes from the 2D sketch are not recognized.

### Solution

**1. Generalize the cutout data model**

Replace the current `{ center: Point2D; radius: number }[]` with a generic cutout type that supports:
- Circles (center + radius)
- Rectangles (origin + width + height)  
- Arbitrary closed polygons (from connected lines)

A unified `ProfileCutout` type with a `path: Point2D[]` polygon representation will be used internally, since all shapes can be approximated as polygons for clipping operations.

**2. Extract all interior shapes as cutouts during base face conversion**

In `handleConvertToBaseFace` (Workspace.tsx), detect and extract:
- Circles inside the profile
- Rectangles inside the profile
- Closed loops of lines inside the profile

Each gets converted to a polygon path for uniform handling.

**3. Split cutouts across fold lines**

When creating fold meshes and the fixed base face:
- For the **base face**: clip each cutout polygon by the fold line, keeping only the portion on the fixed side. Add these as holes to the base face shape.
- For the **fold mesh**: clip each cutout polygon by the fold line, keeping the portion on the moving side. Transform these cutout fragments into fold-local coordinates and subtract them from the fold tip geometry.

**4. Update `createBaseFaceMesh` to accept polygon-based cutouts**

Replace the circle-only `absarc` approach with `THREE.Path` from polygon points, supporting arbitrary hole shapes.

**5. Update `createFoldMesh` to accept and render cutouts**

The fold tip is currently built as a simple polygon fan. Cutout holes need to be subtracted from the tip geometry using `THREE.Shape` with holes (similar to the base face approach but in fold-local 2D space).

**6. Update the unfold viewer**

Render all cutout types (not just circles) in the flat pattern SVG, using `<polygon>` or `<path>` elements for non-circular cutouts.

### Technical Details

**New cutout type in `geometry.ts`:**
```typescript
export interface ProfileCutout {
  type: 'circle' | 'rect' | 'polygon';
  // Circle
  center?: Point2D;
  radius?: number;
  // Rect
  origin?: Point2D;
  width?: number;
  height?: number;
  // All types get a polygon approximation for clipping
  polygon: Point2D[];
}
```

**Cutout splitting logic (new function):**
- `splitCutoutsByFoldLine(cutouts, foldLinePoint, foldNormal)` returns `{ fixed: polygon[], moving: polygon[] }`
- Uses the existing `clipPolygonByLine` function for each cutout polygon against each fold line

**Fold mesh cutout integration:**
- The moving-side cutout polygons are transformed to fold-local (t, d) coordinates
- A `THREE.Shape` is created from the tip polygon with `.holes` from the transformed cutouts
- `THREE.ShapeGeometry` triangulates the shape with holes, then vertices are mapped to 3D via `tipInner`/`tipOuter`

**Files to modify:**
- `src/lib/geometry.ts` -- Generalized `ProfileCutout`, cutout splitting, fold mesh holes, base face polygon holes
- `src/pages/Workspace.tsx` -- Extract rects and line-loops as cutouts during conversion, updated state type
- `src/components/workspace/Viewer3D.tsx` -- Pass cutouts to fold meshes, updated type
- `src/components/workspace/UnfoldViewer.tsx` -- Render polygon/rect cutouts in SVG flat pattern

