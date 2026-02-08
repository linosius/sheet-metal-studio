

# SheetMetal Online — Browser-Based Sheet Metal Design Tool

## Overview
A web-based sheet metal design tool for engineers and hobbyists that follows the classic Inventor workflow: sketch a 2D profile, convert it to a base face with material thickness, add flanges to edges, and generate accurate flat patterns for laser cutting and bend data for press brakes.

---

## Phase 1: Core MVP

### 1. Landing Page & Onboarding
- Clean landing page explaining what the tool does, with a "Start Designing" CTA
- Brief interactive tutorial overlay for first-time users explaining the workflow steps
- Contextual tooltips on all tools and panels

### 2. 2D Sketch Editor (Base Face Creation)
- Canvas-based 2D drawing area where users create the base face profile
- Drawing tools: line, rectangle, circle/arc, and dimension input
- Snap-to-grid and point snapping for precision
- Dimension annotations showing exact measurements (mm/inches)
- Ability to input exact coordinates and distances numerically
- "Convert to Base Face" button that extrudes the sketch into a 3D sheet metal face

### 3. 3D Sheet Metal Viewer
- Interactive 3D viewport using Three.js to display the sheet metal part
- Orbit, pan, and zoom controls
- Edge highlighting — click an edge to select it for adding a flange
- Visual indicators for bend lines and angles
- Toggle between folded (3D) view and flat pattern view

### 4. Flange Operations
- Select one or more edges on the 3D part
- Properties panel (inspired by the Inventor panel you shared):
  - **Height/Distance**: flange length in mm
  - **Bend Angle**: default 90°, adjustable
  - **Bend Direction**: inward/outward
  - **Placement**: adjacent, offset options
- Real-time 3D preview of the flange before confirming
- Support for adding multiple flanges sequentially

### 5. Sheet Metal Properties & Rules
- Global settings panel (like the "Sheet Metal Defaults" dialog you shared):
  - **Material**: dropdown (Steel, Aluminum, Stainless, Copper, custom)
  - **Thickness**: numerical input in mm
  - **Unfold Method**: K-Factor (linear) with editable value (default 0.44)
  - **Bend Radius**: inner bend radius setting
- These properties drive all bend calculations for accuracy

### 6. Flat Pattern / Unfold Engine
- Mathematically accurate unfolding using K-Factor or Bend Compensation methods
- Bend allowance calculation: `BA = π × (R + K × T) × (A / 180)`
- Visual flat pattern showing:
  - Cut outline (for laser)
  - Bend lines (dashed) with direction indicators
  - Dimensions and annotations

### 7. Export
- **DXF Export**: Flat pattern with bend lines — ready for laser cutter import
- **SVG Export**: Scalable vector flat pattern for versatile use
- **PDF Export**: Technical drawing with dimensions, bend lines, and annotations
- **Bend Table**: Downloadable report listing each bend with sequence number, angle, radius, direction, and K-factor

### 8. User Accounts & Project Saving (Supabase Backend)
- Email/password sign-up and login
- Save and load projects to the cloud
- Project list/dashboard showing saved designs with thumbnails
- Auto-save functionality

---

## Design Principles
- **Clean, uncluttered UI**: Left panel for tools/properties, center for the viewport, minimal toolbar on top
- **Accuracy first**: All calculations use proper engineering formulas so outputs are production-ready
- **Guided experience**: Step indicators showing the workflow (Sketch → Base Face → Flanges → Unfold → Export)
- **Responsive feedback**: Real-time 3D previews, dimension updates, and validation warnings

---

## Future Enhancements (Post-MVP)
- Corner relief options (square, round, tear)
- Hem and tab features
- Material library with pre-loaded bend tables from real suppliers
- Bend compensation method (as alternative to K-Factor)
- Undo/redo history
- Project sharing and collaboration
- Import existing DXF files as starting sketches

