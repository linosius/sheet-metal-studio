

## Fix: Clip Flange Face Where Sub-Folds Occur

### Problem
When a fold is applied to a sketch line on a flange face, the fold mesh correctly bends the material away, but the original flange mesh remains fully rendered underneath. This creates overlapping/double geometry where only the bent portion should exist.

### Root Cause
`createFlangeMesh` renders the full rectangular flange (bend arc + flat tip) regardless of any sub-folds. For base-face folds, `getFixedProfile` clips the base polygon -- but there is no equivalent clipping for the flange's flat tip region.

### Solution
Clip the flange mesh's flat tip region using the same Sutherland-Hodgman polygon clipping approach already used elsewhere. The flange's flat tip is essentially a rectangle (edge length x flange height). When child folds exist on this face, their fold lines divide this rectangle. We keep only the "fixed" portion (the side that doesn't bend away).

### Technical Details

**1. Modify `createFlangeMesh` in `src/lib/geometry.ts`**

Instead of the simple `clipHeightStart`/`clipHeightEnd` approach (which only works for edge-parallel folds), change the tip generation to:
- Build a 2D polygon representing the flange tip face: a rectangle `[0,0] -> [edgeLen, H]` in flange-face-local coordinates (x = along edge, y = along extension direction).
- For each child fold, clip this polygon by the fold line (using the existing `clipPolygonByLine`).
- Triangulate the resulting clipped polygon to build the tip geometry.
- The arc portion stays unchanged (it connects the base face to the start of the tip).

**2. Update `FlangeMesh` in `src/components/workspace/Viewer3D.tsx`**

- Compute the parent edge and edge length to pass to `createFlangeMesh`.
- Transform each child fold's face-local line coordinates so they can be used for clipping.
- Pass the child fold clipping data to `createFlangeMesh`.

**3. Clipping coordinate mapping**

Child folds have `lineStart`/`lineEnd` in flange-face-local coordinates where:
- x = along the parent edge direction (0 to edgeLength)
- y = along the flange extension direction (0 to flangeHeight)

This maps directly to the flange tip rectangle, so the fold line can be used as-is for polygon clipping of the tip face.

### Files Changed
- `src/lib/geometry.ts` -- Modify `createFlangeMesh` to accept child fold lines and clip the tip polygon
- `src/components/workspace/Viewer3D.tsx` -- Pass child fold data to `createFlangeMesh`, remove the `polygonOffset` workaround

