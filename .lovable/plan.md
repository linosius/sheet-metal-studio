

## Problem

Die 3D-Oberflächen erscheinen komplett schwarz, weil die Geometrie keine Normalen hat. Ohne Normalen kann das Licht nicht korrekt auf den Oberflächen berechnet werden -- daher wird alles dunkel dargestellt.

## Ursache

In der Funktion `meshDataToBufferGeometry` (Datei `src/lib/metalHeroApi.ts`) werden Normalen nur gesetzt, wenn die API sie mitliefert. Falls die API keine Normalen zurückgibt, wird `computeVertexNormals()` nie aufgerufen -- die Geometrie bleibt ohne Lichtinformation.

## Loesung

1. **Normalen-Berechnung als Fallback hinzufuegen** (`src/lib/metalHeroApi.ts`)
   - Nach dem Setzen der Position und Indizes wird geprueft, ob Normalen vorhanden sind
   - Falls nicht, wird automatisch `geo.computeVertexNormals()` aufgerufen
   - Das stellt sicher, dass alle Meshes korrekt beleuchtet werden

2. **Beleuchtung zurueck auf bewährte Werte setzen** (`src/components/workspace/Viewer3D.tsx`)
   - `ambientLight` Intensitaet auf `0.9` erhoehen fuer gleichmaessige Grundhelligkeit
   - `directionalLight` Intensitaet auf `0.8` reduzieren fuer sanftere Schatten
   - Schatten optional deaktivieren (`castShadow`/`receiveShadow` entfernen), da sie bei flachen Blechen wenig Mehrwert bringen und Probleme verursachen koennen

## Technische Details

### Aenderung 1: `src/lib/metalHeroApi.ts` (Zeile ~121-129)

Fallback-Normalen hinzufuegen:

```typescript
export function meshDataToBufferGeometry(data: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.indices && data.indices.length > 0) {
    geo.setIndex(data.indices);
  }
  if (data.normals && data.normals.length > 0) {
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  } else {
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
```

### Aenderung 2: `src/components/workspace/Viewer3D.tsx` – SceneSetup

Beleuchtung anpassen und Schatten entfernen:

```typescript
function SceneSetup() {
  return (
    <>
      <InventorBackground />
      <ambientLight intensity={0.9} />
      <directionalLight position={[80, 120, 100]} intensity={0.8} />
      <directionalLight position={[-60, -40, 80]} intensity={0.35} />
      <directionalLight position={[0, 60, -50]} intensity={0.2} />
      <hemisphereLight args={['#dce4ed', '#8a9bb0', 0.3]} />
    </>
  );
}
```

- `castShadow` und `receiveShadow` von allen Mesh-Elementen entfernen
- `<Canvas shadows>` zu `<Canvas>` aendern (ohne shadows)

## Erwartetes Ergebnis

- Alle Oberflaechen werden in hellem Grau dargestellt
- Biegungen sind durch natuerliche Licht-/Schatten-Abstufungen an den Rundungen erkennbar
- Keine schwarzen Flaechen mehr

