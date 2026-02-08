

# Add Both Bend Lines to Flange Rendering

## Problem
In real sheet metal CAD (like Inventor), a bend zone is defined by **two tangent lines** on the outer surface:
1. **Bend start line** -- where the flat base face transitions into the curved bend arc
2. **Bend end line** -- where the curved bend arc transitions into the flat flange extension

Currently, the app only draws a single crease line near the bend start. This doesn't look realistic and doesn't match the standard CAD representation.

## Solution

### File: `src/components/workspace/Viewer3D.tsx`
Replace the single crease line with two properly computed bend lines:

**Bend Start Line (Line 1):**
- Located on the **outer surface** at the beginning of the bend arc (angle t=0)
- Position: edge start/end points offset by `thickness` in the `-w` direction (the outer surface at bend start)
- This line sits right where the flat base face ends and the curve begins

**Bend End Line (Line 2):**
- Located on the **outer surface** at the end of the bend arc (angle t=bendAngle)
- Position: calculated using the arc geometry -- at `u = R*sin(A) + thickness*sin(A)` and `w = R*(1-cos(A)) - thickness*cos(A)` relative to the edge
- This line sits where the curve ends and the flat flange extension begins

Both lines will be rendered as subtle dark lines (matching the wireframe color `#475569`) across the full edge length, giving the same visual as Inventor's bend zone indicators.

### File: `src/lib/geometry.ts`
Add a utility function `computeBendLinePositions` that returns the 3D coordinates of both bend lines for a given edge+flange combination. This keeps the math centralized and reusable (it will also be useful later for the unfold/flat pattern step).

## Technical Details

The bend line positions on the outer surface are computed in the same `(u, w)` coordinate system already used by `createFlangeMesh`:

```text
u = edge outward normal direction
w = Z * dirSign (up or down)

Bend Start (outer surface, t=0):
  u_start = thickness * sin(0) = 0
  w_start = R*(1-cos(0)) - thickness*cos(0) = -thickness

Bend End (outer surface, t=bendAngle):
  u_end = R*sin(A) + thickness*sin(A)
  w_end = R*(1-cos(A)) - thickness*cos(A)
```

Each line is drawn from `edge.start + offset` to `edge.end + offset` where offset uses the `uDir` and `wDir` vectors scaled by the computed `(u, w)` values.

### Files Changed
1. `src/lib/geometry.ts` -- Add `computeBendLinePositions()` helper
2. `src/components/workspace/Viewer3D.tsx` -- Replace single crease with two bend lines using the helper

