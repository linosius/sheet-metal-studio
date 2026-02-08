

# Fix Flange Rendering and Align with Inventor Parameters

## Problems Identified

### 1. Three Different Colors on the 3D Model
The base face and flange meshes use different material colors:
- Base face: `#c8cdd3`
- Flange: `#a8b8c8`
- Additionally, `computeVertexNormals()` on the flange geometry averages normals across the bend arc, creating shading gradients that make different faces appear as different colors.

### 2. Geometry Rendering at Small Angles
At small sweep angles (like 10 degrees), the bend arc is tiny and the flat extension goes nearly horizontal. The geometry is mathematically correct but visually hard to distinguish from the base face due to:
- Very similar surface normals between base and flange at shallow angles
- Averaged vertex normals creating a gradient that obscures the bend transition

### 3. Current Calculations vs. Inventor
The current inputs (Material, Thickness, Bend Radius, K-Factor) already match Inventor's core parameters. The Inventor screenshots show additional unfold-specific parameters (Spline Factor, Bend Compensation equations with angle ranges) that are used for flat pattern calculations -- these belong in the Unfold step, not the flange step.

---

## Plan

### Step 1: Unify Material Appearance
**File: `src/components/workspace/Viewer3D.tsx`**
- Change the flange `meshStandardMaterial` color from `#a8b8c8` to `#c8cdd3` (same as the base face)
- Both base face and all flanges will render with identical material properties (same metalness, roughness, color)

### Step 2: Fix Flange Normals for Clean Shading
**File: `src/lib/geometry.ts`**
- Replace `computeVertexNormals()` with manually computed flat normals per quad face
- Each face of the flange (inner surface, outer surface, left side, right side, tip cap, base cap) gets its own correct flat normal
- This eliminates the shading gradient across the bend and gives each face a clean, uniform appearance -- matching how real sheet metal looks in CAD software

### Step 3: Add a Visible Bend Crease Line
**File: `src/components/workspace/Viewer3D.tsx`**
- Draw a visible crease line at the bend start (where the flange meets the base face edge) using a colored `Line` element
- This makes the bend transition visually obvious even at very shallow angles (like 10 degrees)
- The crease line will be a subtle accent color (e.g., a slightly darker shade) along the inner bend edge

### Step 4: Z-Fighting Prevention
**File: `src/lib/geometry.ts`**
- Add a tiny epsilon offset (0.01mm) to the flange starting position so its base cap doesn't overlap with the base face's edge face
- This prevents flickering/z-fighting artifacts where the two meshes share the same plane

---

## Technical Details

### Flat Normal Calculation Approach
Instead of `geometry.computeVertexNormals()` which averages normals across shared vertices (creating smooth shading across the bend), each quad strip will use non-indexed geometry with per-face normals:

```text
For each segment [i, i+1] of the profile:
  Inner face normal = cross(edge_direction, profile_tangent) pointing inward
  Outer face normal = opposite of inner
  Side normals = perpendicular to the edge at each end
```

This gives a faceted appearance matching real-world sheet metal in CAD viewers.

### Files Changed
1. **`src/lib/geometry.ts`** -- Fix normals, add epsilon offset
2. **`src/components/workspace/Viewer3D.tsx`** -- Unify colors, add bend crease line

