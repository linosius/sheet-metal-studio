

# Fix: Bi-directional Flange Bending via Edge Remapping

## Problem
The direction toggle (Up/Down) in the properties panel does not work. Selecting "Down" produces self-intersecting geometry because the bend arc curves into the existing material. The current workaround forces all bends to "Up," making the toggle useless.

## Root Cause
The geometry engine sweeps the bend arc along `wDir = faceNormal * dirSign`. When `dirSign = -1` (down), the arc goes INTO the part body, creating invalid overlap. This is a fundamental mathematical constraint — you cannot flip the arc direction on the same edge without self-intersection.

## Solution: Edge Remapping
Instead of changing the arc math, when the user selects "Down," we transparently remap the flange to the **opposite face's edge** with direction "Up." This produces the exact geometry the user expects:

```text
User Intent                    Internal Mapping
-------------------------------------------------------------
edge_top_0 + Down      --->   edge_bot_0 + Up
edge_bot_0 + Down      --->   edge_top_0 + Up
flange_tip_outer_X + Down -->  flange_tip_inner_X + Up
flange_tip_inner_X + Down -->  flange_tip_outer_X + Up
side edges + Down      --->   Keep as Up (no opposite face)
```

## Changes

### 1. New helper function in `src/lib/geometry.ts`

Add a `getOppositeEdgeId()` function that maps edge IDs to their counterpart on the opposite face:

- `edge_top_N` maps to `edge_bot_N` (and vice versa)
- `flange_tip_outer_X` maps to `flange_tip_inner_X` (and vice versa)
- Side edges return `null` (no geometric opposite)

This is a pure string operation using the existing naming convention.

### 2. Update `handleAddFlange` in `src/pages/Workspace.tsx`

Replace the current "always force up" logic with the edge-remapping approach:

- When `direction === 'down'`:
  1. Call `getOppositeEdgeId(selectedEdgeId)` to find the opposite edge
  2. Verify the opposite edge exists in the current edge set and doesn't already have a flange
  3. Store the flange on the opposite edge with `direction: 'up'`
  4. Show a toast explaining what happened (e.g., "Flange placed on bottom edge to achieve downward bend")
- When `direction === 'up'`: keep existing behavior (no change)
- For side edges where no opposite exists: keep as "up" with a toast

### 3. Update direction display in `PropertiesPanel`

When viewing an existing flange, show the **user-facing direction** rather than the internal "up" value. Since the flange is always stored as "up" internally, the displayed direction should be derived from which face the edge belongs to:

- Flanges on `edge_top_*` or `flange_tip_outer_*` edges show as "Up"
- Flanges on `edge_bot_*` or `flange_tip_inner_*` edges show as "Down"

This ensures the UI matches what the user selected.

### 4. Allow editing direction on existing flanges

When the user toggles direction on an existing flange, apply the same remapping logic: remove the flange from its current edge and re-add it on the opposite edge.

## What Does NOT Change

- **Geometry engine** (`createFlangeMesh`, `computeFlangeTipEdges`, `computeBendLinePositions`) — no math changes needed
- **Edge selection and rendering** in `Viewer3D.tsx` — inner tip edges remain visible and selectable
- **Unfold logic** — flat pattern computation stays the same since stored flanges always use `direction: 'up'`

## Technical Details

The `getOppositeEdgeId` function:

```text
function getOppositeEdgeId(edgeId: string): string | null
  if edgeId starts with "edge_top_" -> replace with "edge_bot_"
  if edgeId starts with "edge_bot_" -> replace with "edge_top_"
  if edgeId contains "_tip_outer_" -> replace with "_tip_inner_"
  if edgeId contains "_tip_inner_" -> replace with "_tip_outer_"
  otherwise -> return null (side edges, unknown)
```

Edge existence validation is important: the opposite edge must exist in `getAllSelectableEdges()` and must not already have a flange attached.

