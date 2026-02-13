

## Fix: Wrong Face Selected for Flange Sketch Plane

### Problem

When clicking a flange face, the correct faceId is detected (confirmed by console logs), but the sketch plane and camera orient to what looks like the base face. This happens because:

1. The backend registers **multiple faces per flange** with numeric suffixes (e.g., `flange_face_X_0`, `flange_face_X_1`) for inner and outer surfaces
2. The current code uses `.find()` which returns the **first** match -- this may be the **inner** face whose normal points inward (toward the base)
3. The camera aligns to this inward-facing normal, making it look like the base face was selected

### Solution

When resolving the flange faceId from the registry, select the face whose normal points **away from the base face center** (the outer/visible face), not just the first match.

### Technical Changes

**File: `src/components/workspace/Viewer3D.tsx`** (lines 319-322)

Replace the simple `.find()` with logic that picks the outward-facing face:

```typescript
// Find ALL matching faces for this flange
const allFaces = getAllFaces();
const matchingFaces = allFaces.filter(f => f.faceId.startsWith(`flange_face_${flange.id}`));

let flangeFaceId: string;
if (matchingFaces.length > 1) {
  // Pick the face whose normal points AWAY from the base face center
  const baseCx = (Math.min(...profile.map(p => p.x)) + Math.max(...profile.map(p => p.x))) / 2;
  const baseCy = (Math.min(...profile.map(p => p.y)) + Math.max(...profile.map(p => p.y))) / 2;
  const baseCz = thickness / 2;

  // Choose face where (origin + normal) moves further from base center
  const best = matchingFaces.reduce((a, b) => {
    const distA = Math.hypot(
      a.origin[0] + a.normal[0] - baseCx,
      a.origin[1] + a.normal[1] - baseCy,
      a.origin[2] + a.normal[2] - baseCz
    );
    const distB = Math.hypot(
      b.origin[0] + b.normal[0] - baseCx,
      b.origin[1] + b.normal[1] - baseCy,
      b.origin[2] + b.normal[2] - baseCz
    );
    return distA >= distB ? a : b;
  });
  flangeFaceId = best.faceId;
} else if (matchingFaces.length === 1) {
  flangeFaceId = matchingFaces[0].faceId;
} else {
  flangeFaceId = `flange_face_${flange.id}`;
}
```

This ensures the **outer** (user-visible) face is always selected for both the 3D mesh interaction and the sketch plane.

### Why This Works

- When the user clicks a flange, they see the outer surface
- The outer face's normal points away from the part center
- By comparing which face's normal direction moves further from the base center, we consistently pick the correct (outer) face
- The sketch plane and camera will then align to this outward-facing surface

### Additional Logging

Add a debug log in `handleFaceClick` (Workspace.tsx) to confirm the transform data:

```typescript
const ft = getFaceTransform(faceId);
console.log('[Workspace] face transform for', faceId, ft);
```

This helps verify the fix is working correctly.

