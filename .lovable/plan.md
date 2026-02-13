

## Fix: Flange Face ID Mismatch between Frontend and Backend

### Problem

The frontend constructs flange face IDs as `flange_face_${flange.id}` (e.g., `flange_face_e_12345_abc`), but the backend registers them with a numeric suffix: `flange_face_e_12345_abc_0`, `flange_face_e_12345_abc_1`, etc.

This causes two failures:
1. The `userData.faceId` on the rendered mesh does not match any entry in the face registry
2. `getFaceTransform(faceId)` returns `null`, so the sketch plane cannot be positioned and the camera cannot orient to the face

### Solution

Update `Viewer3D.tsx` to look up actual face IDs from the face registry that belong to a given flange, instead of constructing a synthetic ID.

### Technical Changes

**File: `src/components/workspace/Viewer3D.tsx`**

At line 318-319, where flange meshes are rendered:

```text
Before:
  const flangeFaceId = `flange_face_${flange.id}`;

After:
  // Find the actual face ID from the registry that matches this flange
  const allFaces = getAllFaces();
  const matchingFace = allFaces.find(f => f.faceId.startsWith(`flange_face_${flange.id}`));
  const flangeFaceId = matchingFace ? matchingFace.faceId : `flange_face_${flange.id}`;
```

This requires importing `getAllFaces` from `faceRegistry.ts` (already exported, line 14 already imports from faceRegistry but may need `getAllFaces` added).

**File: `src/components/workspace/Viewer3D.tsx`, line 14**

Add `getAllFaces` to the existing import:

```text
Before:
  import { getFaceTransform, faceTransformToMatrix4, apiEdgeToPartEdge } from '@/lib/faceRegistry';

After:
  import { getFaceTransform, faceTransformToMatrix4, apiEdgeToPartEdge, getAllFaces } from '@/lib/faceRegistry';
```

### Why This Works

- The face registry is populated by `updateFaceRegistry()` immediately after each `buildModel` call
- `getAllFaces()` returns all registered faces including `flange_face_<id>_0`, `flange_face_<id>_1`, etc.
- By matching with `startsWith`, the first matching face for a given flange is used as the click target
- `getFaceTransform()` then returns valid transform data, enabling sketch plane positioning and camera orientation
