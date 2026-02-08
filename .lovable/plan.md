
# In-3D Face Sketch Editor with Multi-Entity Support

## Overview

Replace the current separate 2D SVG sketch editor with an in-scene 3D sketch system where users draw directly on face planes while seeing the full 3D part. Support arbitrary-direction lines, circles, and rectangles as sketch entities. Only lines can be used as fold bend edges; circles and rectangles are reserved for future operations (holes, cutouts).

## What Changes

### Current Behavior
- Clicking a face in sketch mode opens a separate full-screen SVG editor (`FaceSketchEditor.tsx`) that replaces the 3D view entirely
- Only horizontal and vertical lines are supported
- No circles or rectangles on faces
- The 3D model is hidden while sketching

### New Behavior
- Clicking a face in sketch mode keeps the 3D viewer visible with the full model
- A transparent sketch plane is placed on the selected face
- Mouse clicks raycast against the sketch plane to get face-local 2D coordinates
- Users can draw lines in any direction, circles, and rectangles directly on the face
- An overlay toolbar appears at the top of the 3D viewport with sketch tools (Line, Circle, Rectangle, Select, Dimension, Finish, Exit)
- Grid and snap indicators are rendered on the sketch plane in 3D
- Dimension labels float above the sketch plane using drei's `Html` component

## Data Model Changes

**File: `src/lib/geometry.ts`**

Replace the current `FaceSketchLine` (which only supports axis-aligned lines) with a more general entity system:

```
FaceSketchEntity = FaceSketchLine | FaceSketchCircle | FaceSketchRect

FaceSketchLine {
  id: string
  type: 'line'
  start: Point2D       // face-local coordinates
  end: Point2D         // face-local coordinates
}

FaceSketchCircle {
  id: string
  type: 'circle'
  center: Point2D
  radius: number
}

FaceSketchRect {
  id: string
  type: 'rect'
  origin: Point2D
  width: number
  height: number
}

FaceSketch {
  faceId: string
  entities: FaceSketchEntity[]    // was: lines: FaceSketchLine[]
}
```

The `Fold` interface changes: instead of referencing `sketchLineId` with `axis` and `dimension`, it references a `FaceSketchLine` entity. The fold offset and axis are computed from the line's start/end points (a line that spans full width horizontally becomes an x-axis fold, vertically becomes a y-axis fold).

Add a helper function `classifySketchLineAsFold(line, faceWidth, faceHeight)` that determines if a line qualifies as a fold line (must span edge-to-edge, either horizontally or vertically within a tolerance). Returns `{ axis, offset }` or `null` if not a valid fold line.

### Fold Qualification Rules
A sketch line qualifies as a fold line if:
- It spans the full face width (horizontal: start.x near 0, end.x near faceWidth, start.y approximately equals end.y)
- OR it spans the full face height (vertical: start.y near 0, end.y near faceHeight, start.x approximately equals end.x)
- Tolerance: endpoints must be within 1mm of the face edges

## Component Changes

### 1. Delete `FaceSketchEditor.tsx`

The standalone SVG editor is no longer needed. All sketching happens inside the 3D viewer.

### 2. New Component: `FaceSketchPlane.tsx`

A React Three Fiber component rendered inside the `Canvas`. This is the core of the in-3D sketching system.

**Responsibilities:**
- Renders a semi-transparent grid plane on the selected face (at z = thickness for top face, z = 0 for bottom face)
- Handles raycasting: mouse events on the plane are converted to face-local 2D coordinates
- Renders sketch entities as 3D line/circle/rectangle geometries on the face surface
- Shows dimension labels using drei's `Html` component
- Renders a snap cursor crosshair at the current mouse position
- Supports snapping to grid and to existing entity endpoints

**Props:**
- `faceId`, `faceOrigin`, `faceWidth`, `faceHeight`, `thickness`
- `entities: FaceSketchEntity[]`
- `activeTool: 'select' | 'line' | 'circle' | 'rect'`
- `gridSize: number`, `snapEnabled: boolean`
- `onAddEntity(entity: FaceSketchEntity)`
- `onRemoveEntity(id: string)`
- `selectedIds: string[]`, `onSelectEntity(id: string)`

**Face-local coordinate mapping:**
- For `base_top`: face plane at z = thickness, origin at (minX, minY), U = +X, V = +Y
- For `base_bot`: face plane at z = 0, same UV mapping
- Raycast hit point `(wx, wy, wz)` maps to face-local `(wx - minX, wy - minY)`

**Rendering sketch entities in 3D:**
- Lines: `<Line points={[start3d, end3d]} />` from drei, with dimension label at midpoint
- Circles: `THREE.EllipseCurve` rendered as a line loop, with radius dimension label
- Rectangles: Four `<Line>` segments forming the rectangle, with width/height labels

### 3. New Component: `FaceSketchToolbar.tsx`

An HTML overlay toolbar positioned at the top of the 3D viewport (using absolute positioning, not inside the Canvas).

**Tools:**
- Select (pointer icon) - click entities to select/delete
- Line (line icon) - click two points to draw a line
- Circle (circle icon) - click center, then click to set radius
- Rectangle (rectangle icon) - click corner, drag to opposite corner
- Separator
- Face info label (e.g., "base_top -- 100 x 60 mm")
- Separator
- Finish Sketch button
- Exit button

### 4. Updated `Viewer3D.tsx`

When `activeFaceSketch` is set:
- Render `FaceSketchPlane` inside the Canvas alongside the existing model geometry
- The 3D model remains fully visible (not hidden)
- OrbitControls remain active so the user can rotate the view while sketching
- Highlight the selected face with a slightly different material color or edge highlight

New props:
- `sketchPlaneActive: boolean`
- `sketchFaceId: string | null`
- `sketchEntities: FaceSketchEntity[]`
- `sketchActiveTool: string`
- `onSketchAddEntity`, `onSketchRemoveEntity`, `onSketchSelectEntity`
- `sketchSelectedIds: string[]`

### 5. Updated `Workspace.tsx`

State management changes:
- `activeFaceSketch` no longer causes a full viewport swap (no more conditional rendering between FaceSketchEditor and Viewer3D)
- Instead, it adds props to `Viewer3D` to activate the sketch plane
- New state: `sketchTool: 'select' | 'line' | 'circle' | 'rect'` for the active face-sketch tool
- New state: `sketchSelectedIds: string[]` for selected entities within the face sketch
- `FaceSketchToolbar` renders as an overlay when `activeFaceSketch` is set

The `handleSketchFinish` callback now receives `FaceSketchEntity[]` instead of `FaceSketchLine[]` and stores them in the updated `FaceSketch` structure.

When applying a fold, the system finds the selected sketch line, runs `classifySketchLineAsFold()` to validate it qualifies, and extracts `axis` and `offset` for the `Fold` data.

### 6. Updated `FoldDialog.tsx`

The dialog currently shows "Horizontal @ Xmm" or "Vertical @ Xmm". Update it to work with the new `FaceSketchLine` type:
- Compute axis and dimension from line start/end points
- Show line info: "Line from (x1, y1) to (x2, y2)" with computed offset

### 7. Updated `PropertiesPanel.tsx`

- Update references from `FaceSketchLine` to `FaceSketchEntity`
- Show entity type icons (line, circle, rectangle) in the sketch entities list
- Only show the fold indicator for line entities that qualify as fold lines
- Show count of each entity type

### 8. Updated `SketchLine3D` in `Viewer3D.tsx`

Update to handle the new `FaceSketchLine` format (which now has arbitrary start/end points instead of axis + dimension). The 3D positions are computed by mapping face-local coordinates to world space using the face origin and orientation.

### 9. Updated `Workspace.tsx` Fold Logic

The `handleApplyFold` function needs to:
1. Find the selected sketch line entity
2. Call `classifySketchLineAsFold(line, faceWidth, faceHeight)` to get axis/offset
3. If not a valid fold line, show an error: "This line does not span edge-to-edge and cannot be used as a fold line"
4. If valid, create the `Fold` with the computed axis and offset

## Files Summary

| File | Action |
|------|--------|
| `src/lib/geometry.ts` | Update data model: `FaceSketchEntity` union type, update `FaceSketch`, add `classifySketchLineAsFold()` |
| `src/components/workspace/FaceSketchEditor.tsx` | Delete -- replaced by in-3D sketch system |
| `src/components/workspace/FaceSketchPlane.tsx` | Create -- Three.js component for sketch plane raycasting and entity rendering |
| `src/components/workspace/FaceSketchToolbar.tsx` | Create -- HTML overlay toolbar for sketch tools |
| `src/components/workspace/Viewer3D.tsx` | Update -- integrate FaceSketchPlane, update SketchLine3D for new data model |
| `src/pages/Workspace.tsx` | Update -- remove FaceSketchEditor swap, add sketch plane state, overlay toolbar |
| `src/components/workspace/FoldDialog.tsx` | Update -- work with new FaceSketchLine format |
| `src/components/workspace/PropertiesPanel.tsx` | Update -- show multi-entity types, fold qualification badges |

## Technical Details

**Raycasting on the sketch plane:**
A `THREE.Plane` is created at the face position (e.g., z = thickness for top face). On mouse move/click, `raycaster.ray.intersectPlane(plane, intersectPoint)` gives the world-space hit point. Subtract the face origin to get face-local coordinates. Snap to grid if enabled.

**Drawing interactions:**
- Line tool: First click sets start point, mouse move shows preview line, second click sets end point and creates the entity. Line chaining: after completing a line, the next line starts from the previous endpoint.
- Circle tool: First click sets center, mouse move shows preview circle with dynamic radius, second click finalizes radius.
- Rectangle tool: First click sets one corner, mouse move shows preview rectangle, second click sets opposite corner.
- Select tool: Click on an entity to select it. Delete/Backspace removes selected entities.
- Escape cancels the current drawing operation.

**Entity hit detection in 3D:**
For selection, invisible "hitbox" meshes are placed along sketch entities (similar to the existing edge hitbox approach). Lines get thin box hitboxes, circles get torus hitboxes, rectangles get four line hitboxes.

**Dimension rendering:**
Use drei's `Html` component positioned at entity midpoints to show dimension labels. These float above the sketch plane and always face the camera. Labels show: line length, circle radius, rectangle width/height.

**Grid on sketch plane:**
Render a semi-transparent grid on the face using `<Grid>` from drei or custom line geometry. This gives visual feedback for snap points. The grid is only visible when the sketch plane is active.
