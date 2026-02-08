

# Inventor-Style Fold Workflow: 2D Sketch on Face

## Overview

Redesign the fold workflow to match Autodesk Inventor's approach: users click on a 3D face to open a full-viewport 2D sketch editor, draw fold lines with precise dimensions, then apply fold operations via a dedicated dialog with flip controls and fold location options. Stress relief cuts are added automatically where fold lines meet existing bends.

## Current State

The current system uses a small dialog (`FoldLineEditor`) to place fold lines by adjusting an offset slider. It lacks:
- A proper 2D sketch mode on faces (reusable for holes/cutouts later)
- Inventor-style fold dialog with flip controls and fold location options
- Automatic stress relief cuts
- Separation between sketch creation and fold application

## New Workflow (4 Steps)

```text
+-------------------+     +--------------------+     +-----------------+     +------------------+
| 1. Click face in  | --> | 2. 2D sketch opens | --> | 3. Finish sketch| --> | 4. Select line + |
|    3D viewer      |     |    draw line +      |     |    back to 3D   |     |    Fold dialog   |
|    (Fold mode)    |     |    add dimension    |     |                 |     |    -> Apply      |
+-------------------+     +--------------------+     +-----------------+     +------------------+
```

## Changes

### 1. New Data Model: Face Sketches

Add a `FaceSketch` structure to track sketch lines drawn on specific 3D faces. Each face can have multiple sketch lines (for future extensibility). A fold operation references a specific sketch line.

```text
FaceSketchLine {
  id: string
  start: Point2D        // face-local 2D coordinates
  end: Point2D
  dimension?: number    // constrained distance from reference edge
}

FaceSketch {
  faceId: string        // e.g. "base_top", "flange_outer_X"
  lines: FaceSketchLine[]
}

Fold (updated) {
  id: string
  sketchLineId: string  // references which sketch line this fold uses
  faceId: string        // which face
  offset: number        // position along axis
  axis: 'x' | 'y'
  angle: number
  direction: 'up' | 'down'
  bendRadius: number
  foldLocation: 'centerline' | 'material-inside' | 'material-outside'
}
```

**File**: `src/lib/geometry.ts`

### 2. New Component: `FaceSketchEditor` (replaces `FoldLineEditor`)

A full-viewport SVG editor that replaces the 3D viewer when active. Modeled after the existing `SketchCanvas` pattern but scoped to a single face.

Features:
- Shows the selected face as a rectangle with the face dimensions
- Displays existing bend lines and flanges as context (grey dashed lines, like Inventor's projected geometry in image 26)
- Line drawing tool: click two points to draw a line across the face
- Lines snap to edges and grid points
- Dimension annotations show the distance from the nearest edge (editable via click)
- Toolbar at top with: Line tool, dimension display, Finish button, and Exit button
- Coordinate readout at bottom (face-local coordinates)

The editor constrains fold lines to span the full face width or height (edge-to-edge), since partial fold lines are not valid for sheet metal folding.

**File**: `src/components/workspace/FaceSketchEditor.tsx` (new, replaces `FoldLineEditor.tsx`)

### 3. New Component: `FoldDialog`

A dialog that appears after the user selects a sketch line and clicks "Fold". Matches the Inventor dialog from the screenshot:

- **Bend Line**: Shows which sketch line is selected
- **Flip Controls**: Two buttons to flip which side folds (left/right or up/down)
- **Fold Location**: Three options with icons:
  - Centerline: bend center sits on the sketch line
  - Material Inside: material stays inside the bend
  - Material Outside: material stays outside the bend
- **Fold Angle**: Numeric input (default 90 degrees)
- **Bend Radius**: Numeric input (defaults to sheet metal default)
- **OK / Cancel / Apply** buttons

**File**: `src/components/workspace/FoldDialog.tsx` (new)

### 4. Updated Sub-mode Toolbar

Replace the current "Edge | Fold" toggle with an Inventor-style toolbar:

```text
[ Edge (flanges) ] [ 2D Sketch ] [ Fold ]
```

- **Edge mode**: Select edges to add flanges (existing behavior)
- **2D Sketch mode**: Click a face to open the face sketch editor
- **Fold mode**: Select a sketch line in the 3D view, then open the fold dialog

When in 2D Sketch mode and a face is selected, show a toolbar similar to Inventor's:
```text
[ Line ] | [ Dimension ] | ................. [ Finish ] [ Exit ]
```

**File**: `src/components/workspace/WorkflowBar.tsx` (minor label updates)

### 5. Workspace State Management Updates

Add new state variables and handlers:

- `faceSketches: FaceSketch[]` -- all sketch data per face
- `activeFaceSketch: string | null` -- which face is currently being sketched (when set, shows FaceSketchEditor instead of Viewer3D)
- `selectedSketchLineId: string | null` -- which sketch line is selected for fold operation
- `foldDialogOpen: boolean` -- whether the fold dialog is showing
- Sub-mode expanded to: `'edge' | 'sketch' | 'fold'`

Flow:
1. User switches to "2D Sketch" sub-mode
2. User clicks a face in 3D -> `activeFaceSketch` is set to that face ID
3. Viewport switches from `Viewer3D` to `FaceSketchEditor`
4. User draws lines, adds dimensions
5. User clicks "Finish" -> back to 3D, lines are stored in `faceSketches`
6. User switches to "Fold" sub-mode
7. Sketch lines are rendered on 3D faces as red dashed lines
8. User clicks a sketch line in 3D -> `selectedSketchLineId` is set
9. User clicks "Apply Fold" in properties panel or fold dialog opens automatically
10. Fold parameters configured, fold applied

**File**: `src/pages/Workspace.tsx`

### 6. 3D Viewer Updates

- In "Fold" sub-mode, render sketch lines on faces as dashed red lines in 3D space
- Sketch lines are clickable (selectable) in fold sub-mode
- When a sketch line is selected, show it highlighted (thicker, different color)
- Fold-line edges (from applied folds) continue to be shown in red and blocked from flanges

**File**: `src/components/workspace/Viewer3D.tsx`

### 7. Automatic Stress Relief Cuts

When a fold line meets an existing flange or another fold at the edge boundary, automatically add stress relief cuts. These are small rectangular notches at the intersection points to prevent material tearing.

Computation:
- At each endpoint of a fold line, check if a flange exists on the adjacent edge
- If yes, add a rectangular relief cut (width = material thickness, depth = bend radius + thickness)
- Relief cuts are stored as part of the fold data and rendered in both 3D and flat pattern views

For the initial implementation, relief cuts will be represented as visual indicators (notch geometry at fold-flange intersections). The flat pattern will show them as small rectangular cutouts.

**File**: `src/lib/geometry.ts` (new `computeStressRelief` function)

### 8. Properties Panel Updates

When in "Fold" sub-mode with a sketch line selected:
- Show the selected sketch line info (position, axis)
- Show "Apply Fold" button that opens the `FoldDialog`

When viewing applied folds:
- Show fold details including fold location type
- Show stress relief indicator

**File**: `src/components/workspace/PropertiesPanel.tsx`

### 9. Unfold Integration

The flat pattern logic already handles folds. Updates needed:
- Account for fold location offset (centerline vs material-inside vs material-outside shifts the bend allowance calculation slightly)
- Show stress relief cut notches in the flat pattern as rectangular cutouts

**File**: `src/lib/unfold.ts`

## Files Summary

| File | Action |
|------|--------|
| `src/lib/geometry.ts` | Update `Fold` interface, add `FaceSketch`/`FaceSketchLine` types, add `computeStressRelief()` |
| `src/components/workspace/FoldLineEditor.tsx` | Delete (replaced by FaceSketchEditor) |
| `src/components/workspace/FaceSketchEditor.tsx` | Create -- full-viewport 2D sketch editor for faces |
| `src/components/workspace/FoldDialog.tsx` | Create -- Inventor-style fold parameter dialog |
| `src/pages/Workspace.tsx` | Major update -- new state for face sketches, sub-modes, workflow logic |
| `src/components/workspace/Viewer3D.tsx` | Render sketch lines on faces, make them clickable in fold mode |
| `src/components/workspace/PropertiesPanel.tsx` | Add fold sub-mode controls, sketch line selection UI |
| `src/lib/unfold.ts` | Handle fold location offset, stress relief in flat pattern |
| `src/components/workspace/WorkflowBar.tsx` | Minor -- already labeled "Fold & Flanges" |

## Technical Considerations

- **Face coordinate system**: For the base face (top/bottom), the 2D sketch coordinates map directly to XY. For flange faces, a local coordinate transformation is needed (rotation from the flange plane to 2D). Initially focus on base faces; flange face sketching can use the flange's local UV space.

- **Edge-to-edge constraint**: Fold lines must span the full face width or height. When the user draws a line, it auto-extends to the face boundaries along the nearest axis (horizontal or vertical).

- **Fold location offset**: "Centerline" means the fold line is the neutral axis. "Material inside" shifts the geometry inward by half thickness. "Material outside" shifts outward. This affects the effective offset used in `getFixedProfile`.

- **Stress relief sizing**: Standard relief is a rectangular notch with width = thickness and depth = bend radius + thickness, placed at each fold line endpoint where it meets a bend. This follows standard sheet metal fabrication practice.

