

## Fix: Base Face Intercepting Flange Clicks

### Problem

When clicking on a flange face, the raycast hits both the base face and the flange. Because the base face mesh is a solid 3D shape, its surface is often geometrically closer to the camera than the flange face. The current guard only checks `e.intersections[0]` for a `faceId`, but that first intersection is the base face itself (which uses `faceType: "base"`, not `faceId`). So the guard never triggers and the click is handled as a base face click.

### Solution

Change the base face click handler (and hover handlers) to check if **any** intersection in the list has a `faceId`. If so, skip the base face event -- the user intended to click a specific named face (flange, fold, etc.).

### Technical Change

**File: `src/components/workspace/Viewer3D.tsx`**

**onClick handler (lines 225-233):**

```text
Before:
  const closest = e.intersections[0];
  if (closest && closest.object.userData?.faceId) return;

After:
  // If any intersection has a named faceId, skip base face — user intended that face
  const hasNamedFace = e.intersections.some(i => i.object.userData?.faceId);
  if (hasNamedFace) return;
```

**onPointerOver handler (lines 234-240):** Same pattern change:

```text
Before:
  const closest = e.intersections[0];
  if (closest && closest.object.userData?.faceId) return;

After:
  const hasNamedFace = e.intersections.some(i => i.object.userData?.faceId);
  if (hasNamedFace) return;
```

This ensures that whenever the ray passes through both the base face and a flange/fold face, the base face yields to the named face regardless of intersection order.
