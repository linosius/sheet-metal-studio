

## Upgrade 2D Sketch Toolbar to Inventor-Style Ribbon

### Current State
The sketch toolbar is a narrow vertical sidebar (48px wide) with only 3 tools: Select, Line, Rectangle, plus Snap toggle and Clear. It feels minimal compared to Inventor's grouped ribbon layout.

### What Changes

**1. Replace vertical sidebar with horizontal ribbon toolbar**

Move the sketch toolbar from a narrow left sidebar to a full-width horizontal ribbon bar below the top header. This matches Inventor's layout and provides room for more tools organized in labeled groups.

Tool groups:
- **Create**: Line (L), Circle (C), Arc (A), Rectangle (R), Point (P)
- **Modify**: Move (M), Trim (T), Extend, Offset, Mirror
- **Dimension**: Dimension tool (D)
- **Utilities**: Snap toggle, Grid size selector, Clear all

Note: Not all tools will be fully functional immediately. Circle, Arc, Point, and the Modify tools will be added as UI placeholders first (showing a "Coming soon" toast when clicked), with Line and Rectangle remaining fully functional. This lets us establish the correct layout now and incrementally implement each tool.

**2. Add Circle tool (functional)**

Add a circle sketch entity (center + radius) to the data model and canvas rendering. Drawing: click center, drag/click to set radius.

**3. Add visual tool group labels**

Each group gets a subtle label underneath (like Inventor's "Create", "Modify", "Pattern", "Dimension").

### Technical Details

**Files changed:**

- `src/lib/sheetmetal.ts` -- Add `SketchCircle` type (center: Point2D, radius: number), add to `SketchEntity` union, add `SketchArc` and `SketchPoint` types for future use
- `src/hooks/useSketchStore.ts` -- Add `'circle' | 'arc' | 'point'` to `SketchTool` type, add `addCircle` method
- `src/components/workspace/SketchToolbar.tsx` -- Complete rewrite: horizontal ribbon with grouped tools (Create, Modify, Dimension sections), each group with a label below. Uses existing Button and Tooltip components
- `src/components/workspace/SketchCanvas.tsx` -- Add circle drawing interaction (click center, click radius), circle rendering (SVG `<circle>`), circle dimension display, circle preview while drawing
- `src/pages/Workspace.tsx` -- Move toolbar from left sidebar column to a horizontal bar above the canvas. Pass new `addCircle` callback. Layout changes: remove the `w-12 border-r` sidebar, add a horizontal toolbar row inside the sketch content area

**Layout change (Workspace.tsx):**

```text
Before:
+--------+------------------+--------+
| 12px   |                  | Props  |
| sidebar|   SketchCanvas   | Panel  |
| tools  |                  |        |
+--------+------------------+--------+

After:
+------------------------------------+--------+
| Ribbon Toolbar (Create|Modify|Dim) | Props  |
+------------------------------------+ Panel  |
|          SketchCanvas              |        |
+------------------------------------+--------+
```

**SketchToolbar ribbon structure:**
- Groups separated by vertical dividers
- Each group has icon+label buttons in a row, with a group label below
- Active tool highlighted with primary variant
- Placeholder tools show toast "Coming soon" on click
- Keyboard shortcuts shown in tooltips

