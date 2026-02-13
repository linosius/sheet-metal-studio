

## Redesign: Detect Largest Closed Loop as Base Face, Others as Cutouts

### Problem

The current system uses fragile, hard-coded logic:
- `extractProfile()` picks the first rectangle or the first chain of connected lines as the profile
- `handleConvertToBaseFace()` then separately detects additional closed loops and tries to filter out the profile with a strict order-sensitive comparison

This breaks when:
- The base face is drawn with lines (not a rect) and the loop traversal starts at a different vertex
- There are multiple closed loops and the outer one isn't detected first
- Mixed geometry types (arcs, circles, polylines) form part of the boundary

### Solution

Replace the current approach with a unified loop detection algorithm:

1. Find **all** closed loops from all geometry entities (lines, rects, circles, arcs)
2. Compute the **area** of each closed loop
3. The loop with the **largest area** becomes the base face profile
4. All other closed loops become cutouts

### Technical Changes

**File: `src/lib/geometry.ts`**

1. Add a new function `findAllClosedLoops(entities): Point2D[][]` that:
   - Converts all entity types (line, rect, circle, arc) into a unified edge list (start/end point pairs)
   - Uses a graph traversal to find all closed loops
   - Returns an array of polygons (point arrays)

2. Add a helper `polygonArea(pts: Point2D[]): number` using the shoelace formula to compute signed area

3. Add a new function `extractProfileAndCutouts(entities): { profile: Point2D[], cutouts: ProfileCutout[] } | null` that:
   - Calls `findAllClosedLoops`
   - Also includes standalone circles and rects as loops
   - Picks the largest-area loop as the profile
   - Returns remaining loops as polygon cutouts, and standalone circles as circle cutouts

**File: `src/pages/Workspace.tsx`**

4. Replace the body of `handleConvertToBaseFace`:
   - Remove the separate `extractProfile()` call and manual loop detection (lines 55-129)
   - Call the new `extractProfileAndCutouts(sketch.entities)` instead
   - Use its returned `profile` and `cutouts` directly

5. Update `canConvert` to use the new function (or keep `extractProfile` as a lightweight check)

### Algorithm Detail: `findAllClosedLoops`

```text
1. Build an adjacency graph from all line segments (including rect edges and arc approximations)
2. For each unvisited edge, attempt to trace a closed loop:
   - Follow connected edges until returning to the start point
   - Mark used edges to avoid duplicates
3. Standalone circles are added directly as circular loops
4. Return all found loops
```

### Algorithm Detail: Largest Loop Selection

```text
1. Compute area of each loop using shoelace formula: |sum((x_i * y_{i+1}) - (x_{i+1} * y_i)) / 2|
2. Sort loops by area descending
3. First loop = base face profile
4. Remaining loops = cutouts
```

### Existing `extractProfile` Function

Keep the existing `extractProfile()` function for backward compatibility (used in `canConvert` check), but the main conversion logic will use the new unified function.

### Edge Cases Handled

- Base face drawn with lines in any order/direction -- loop detection is direction-agnostic
- Multiple internal cutouts of different types (circles, rects, polygons)
- Circle entities used as the outer profile (unlikely but handled)
- Rectangles used as cutouts inside a line-drawn profile
- Mixed geometry where arcs form part of the boundary (approximated as line segments)

