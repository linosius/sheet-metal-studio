

# Fix Arc-to-Tip Tangency: Explicit Tip Normals

## Problem

The visible "kink" at the junction between the bend arc and the flat tip (flange) is a **shading discontinuity caused by mismatched normals**, not a geometric error. The positions are correct -- the user confirmed that positions and orientation are right.

Root cause in `createFoldMesh` (geometry.ts, lines 1184-1214):

1. The **arc** uses explicit per-vertex smooth normals computed from the cylindrical surface formula
2. The **tip** uses `toNonIndexed()` + `computeVertexNormals()`, which produces flat per-face normals from triangle geometry
3. At the junction edge (arc at theta=A meets tip at d=0), these normals **disagree in direction**, creating a visible lighting seam
4. The `toNonIndexed()` call means every triangle gets unique vertices, so `computeVertexNormals()` just gives face normals (effectively flat shading regardless of the material setting)

**Why the normals disagree:** The (T3, U3, W3) basis is left-handed for "up" folds (T3 x U3 = -W3), which flips the geometric face normal relative to the arc's inward-pointing normal convention. The arc inner normal at theta=A is `-sin(A)*U3 + cos(A)*W3`, while `computeVertexNormals()` produces `+sin(A)*U3 - cos(A)*W3` -- exactly opposite.

## Fix

Replace the auto-computed tip normals with explicit normals that match the arc convention:

### File: `src/lib/geometry.ts` (lines 1184-1214)

**Change `addTipV` to accept an explicit normal:**

```typescript
const tipNormals: number[] = [];
function addTipV(v: THREE.Vector3, n: THREE.Vector3): number {
  tipVerts.push(v.x, v.y, v.z);
  tipNormals.push(n.x, n.y, n.z);
  return tipVi++;
}
```

**Compute the tip surface normals from the arc formula at theta=A:**

```typescript
// Inner face normal matches arc inner normal at theta=A
const nTipInner = U3.clone().multiplyScalar(-sinA)
  .add(W3.clone().multiplyScalar(cosA));
// Outer face normal matches arc outer normal at theta=A
const nTipOuter = U3.clone().multiplyScalar(sinA)
  .add(W3.clone().multiplyScalar(-cosA));
```

**Use these normals when creating tip vertices:**

- Inner surface vertices (tI array): use `nTipInner`
- Outer surface vertices (tO array): use `nTipOuter`
- Side strip vertices: create NEW vertices with per-face normals computed from triangle edge cross products (because side surfaces are at different angles than inner/outer)

**Replace the final geometry construction:**

Remove `toNonIndexed()` and `computeVertexNormals()`. Instead build the geometry directly with the explicit position and normal arrays:

```typescript
const tipGeo = new THREE.BufferGeometry();
tipGeo.setAttribute('position',
  new THREE.Float32BufferAttribute(tipVerts, 3));
tipGeo.setAttribute('normal',
  new THREE.Float32BufferAttribute(tipNormals, 3));
tipGeo.setIndex(tipIdx);
```

**Side strip handling:** The current code reuses inner/outer vertex indices for side strips, but those vertices now carry inner/outer face normals. Side strips need their own vertices with side-face normals. For each side quad (lines 1201-1206):

```typescript
// Compute side face normal from edge cross product
const pII = tipInner(locs[i].t, locs[i].d);
const pIJ = tipInner(locs[j].t, locs[j].d);
const pOI = tipOuter(locs[i].t, locs[i].d);
const e1 = new THREE.Vector3().subVectors(pIJ, pII);
const e2 = new THREE.Vector3().subVectors(pOI, pII);
const sideN = new THREE.Vector3().crossVectors(e1, e2).normalize();

// Add NEW vertices with side normal (don't reuse tI/tO indices)
const sII = addTipV(pII, sideN);
const sIJ = addTipV(pIJ, sideN);
const sOJ = addTipV(tipOuter(locs[j].t, locs[j].d), sideN);
const sOI = addTipV(pOI, sideN);
tipIdx.push(sII, sIJ, sOJ, sII, sOJ, sOI);
```

## What Changes Visually

- The shading transition from the cylindrical arc surface to the flat tip surface becomes smooth and continuous -- no visible "kink" line at the junction
- Side edges of the tip retain sharp creases (correct -- they ARE geometric edges)
- Matches Inventor's seamless arc-to-flange rendering

## Files Modified

1. `src/lib/geometry.ts` -- Tip geometry section of `createFoldMesh` only (lines 1184-1214)

No other files are changed. The arc geometry, materials, and transform logic are all correct and untouched.

