
## Add Functionality to All Sketch Tools

Currently only **Line**, **Rectangle**, **Circle**, and **Select** are functional. The following tools show "coming soon": Arc, Point, Move, Trim, Extend, Offset, Mirror, and Dimension. This plan implements all of them.

---

### Tools to Implement

**Create tools:**
1. **Arc** -- Three-click interaction: center, start angle (radius), end angle. Renders as SVG `<path>` arc.
2. **Point** -- Single click to place a construction point. Renders as a small cross/dot.

**Modify tools:**
3. **Move** -- Select entities, then click-drag to translate them by a delta vector.
4. **Trim** -- Click on a line/arc segment near an intersection to remove the portion between intersections.
5. **Extend** -- Click an entity endpoint to extend it to the nearest intersecting entity.
6. **Offset** -- Select an entity, click a side to create a parallel copy at a prompted distance.
7. **Mirror** -- Select entities, then click two points to define a mirror axis; creates mirrored copies.

**Dimension tool:**
8. **Dimension** -- Click an entity to add/edit a driving dimension (editable value that resizes the entity).

---

### Technical Details

**1. Data model updates (`src/lib/sheetmetal.ts`)**
- Add geometry helpers: `lineLineIntersection`, `pointOnSegment`, `offsetLine`, `mirrorPoint`, `arcPath` utilities
- No new entity types needed (SketchArc and SketchPoint already exist)

**2. Store updates (`src/hooks/useSketchStore.ts`)**
- Expand `SketchTool` type to include: `'arc' | 'point' | 'move' | 'trim' | 'extend' | 'offset' | 'mirror' | 'dimension'`
- Add `addArc(center, radius, startAngle, endAngle)` method
- Add `addPoint(position)` method
- Add `updateEntity(id, updates)` method for Move/Dimension (mutating position/size)
- Add `addEntities(entities[])` for bulk insert (Mirror, Offset results)

**3. Toolbar update (`src/components/workspace/SketchToolbar.tsx`)**
- Remove `placeholder: true` from all tools
- All tools now call `onToolChange(tool.id)` directly

**4. Canvas interactions (`src/components/workspace/SketchCanvas.tsx`)**
- This is the bulk of the work. Add drawing/interaction state machines for each tool:

| Tool | Interaction | Result |
|------|------------|--------|
| Arc | Click center, click start point (sets radius + start angle), click end point (sets end angle) | Adds SketchArc entity |
| Point | Single click | Adds SketchPoint entity |
| Move | With selected entities: click start point, click end point; translates all selected entities by delta | Updates entity positions |
| Trim | Click on a segment near intersection; finds intersecting entities, removes the clicked portion | Splits/shortens the clicked entity |
| Extend | Click near an endpoint of a line; finds nearest entity it could intersect and extends to it | Updates line endpoint |
| Offset | Click an entity, then click a side to indicate direction; prompts for distance (or uses drag distance) | Adds parallel copy of entity |
| Mirror | With selected entities: click two points to define mirror axis; creates mirrored copies | Adds mirrored entities |
| Dimension | Click an entity to show its dimension; click the dimension text to edit the value inline | Updates entity geometry |

- New props needed: `onAddArc`, `onAddPoint`, `onUpdateEntity`, `onAddEntities`
- Add SVG rendering for `arc` (SVG arc path) and `point` (small cross marker) entity types
- Add preview rendering for arc (showing radius line and arc sweep while drawing)

**5. Keyboard shortcuts (`src/pages/Workspace.tsx`)**
- Add shortcuts: `A` for Arc, `P` for Point, `M` for Move, `T` for Trim, `D` for Dimension
- Pass new store methods to SketchCanvas

**6. Geometry helpers for Modify tools (`src/lib/sheetmetal.ts`)**
- `lineLineIntersection(l1, l2)` -- returns intersection point or null
- `trimLineAtIntersections(line, allEntities, clickPoint)` -- finds intersections, returns trimmed segment
- `extendLineToNearest(line, endpoint, allEntities)` -- extends line to nearest intersection
- `offsetEntity(entity, distance, side)` -- creates parallel copy
- `mirrorEntity(entity, axisStart, axisEnd)` -- mirrors an entity across an axis
- `getEntityIntersections(entity, allEntities)` -- finds all intersection points

### Implementation Priority
All tools will be implemented in a single pass. The Modify tools (Trim, Extend, Offset, Mirror) involve intersection math but use standard 2D geometry algorithms. Move is the simplest modify tool. Dimension is the most complex as it requires inline text editing in SVG.
