

# Fix Bend Zone 3D Rendering and Flat Pattern Unfold

## Problems Identified

### Problem 1: Unfold is mirrored to the WRONG side
The current unfold code mirrors the moving polygon ACROSS the fold line to the fixed side, causing it to overlap with the base face. The formula `v - normal * (2*d + BA)` takes a vertex at distance `d` on the moving side and places it at distance `d + BA` on the FIXED side.

**Correct behavior** (matching Inventor): The moving polygon should stay on the moving side, simply shifted outward by the Bend Allowance (BA). The correct formula is `v + normal * BA`.

### Problem 2: Arc geometry incorrectly tapers
The current arc uses `getPolygonTRangeAtD` to narrow the cylindrical arc at each angular step based on the polygon's boundary. In real sheet metal (and in Inventor), the bend arc is a **uniform cylinder** along the full fold line width. The tapering should only affect the tip face, not the arc itself.

---

## Fix 1: Unfold Logic (`src/lib/unfold.ts`)

**What changes:**
- Replace the mirror formula with a simple outward shift
- Fix bend line offset direction

Current (wrong):
```typescript
const offset = 2 * d + BA;
return { x: v.x - normal.x * offset, y: v.y - normal.y * offset };
```

Fixed:
```typescript
return { x: v.x + normal.x * BA, y: v.y + normal.y * BA };
```

This means:
- Fold-line vertices (d=0) shift by BA to the moving side, creating the correct BA gap
- Vertices further from the fold line stay on the moving side, shifted slightly outward
- No overlap with the base face

Also fix the second bend line offset direction from `-normal * BA` to `+normal * BA` so it sits at the start of the unfolded region (on the moving side).

---

## Fix 2: Uniform Arc Geometry (`src/lib/geometry.ts`)

**What changes in `createFoldMesh`:**
- Remove the `getPolygonTRangeAtD` call from the arc step computation
- Use uniform `[tMin, tMax]` for ALL arc angular steps (both inner and outer surfaces)
- Simplify side surfaces back to flat rectangles at tMin and tMax

The arc becomes a clean cylindrical sweep along the fold line, matching Inventor. The tip geometry already correctly uses the actual moving polygon shape.

**What changes in `computeFoldBendLines`:**
- Remove the variable t-range logic for the bend-end line
- Use the same tMin/tMax for bend-end as for bend-start (uniform cylinder ends)

The `getPolygonTRangeAtD` helper function can be removed entirely since it will no longer be used.

---

## Files to Edit

1. **`src/lib/unfold.ts`** -- Fix the mirror formula and bend line offset direction
2. **`src/lib/geometry.ts`** -- Remove arc tapering, use uniform cylinder, clean up unused helper

## Expected Result

- **3D view**: The bend arc will be a uniform-width cylinder along the fold line, with clean flat side surfaces, matching Inventor's rendering
- **Unfold view**: The folded region will extend outward from the fold line (on the moving side) with a BA-sized gap, preserving the full base face dimensions, matching Inventor's flat pattern

