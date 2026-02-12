
# Umstellung: Frontend 2D + Backend 3D mit eindeutigem Face-Naming

## Grundprinzip

**Frontend (Lovable):** Nur 2D-Operationen -- Sketch, Profil-Extraktion, Cutout-Erkennung, Face-Sketch-Zeichnung. Keine Bend-Berechnungen, keine Mesh-Erzeugung, kein Unfold.

**Backend (api.metal-hero.com):** Alle 3D-Operationen -- Extrusion, Boolean-Cuts, Bend/Fold-Berechnung (inkl. Bend Allowance, K-Factor, Neutral Axis), Mesh-Tessellation, Unfold/Flat-Pattern.

## Face-Naming-Konvention (Shared Contract)

Jede Face hat eine eindeutige ID die sowohl Frontend als auch Backend kennen. Das Frontend nutzt diese IDs um Sketches einer Face zuzuordnen. Das Backend nutzt sie um Geometrie-Ergebnisse den richtigen Faces zuzuweisen.

```text
Format: {part}:{side}

Beispiele:
  base:top              -- Oberseite der Grundplatte
  base:bot              -- Unterseite der Grundplatte
  fold_{id}:top         -- Aussenseite des Fold-Tip-Panels
  fold_{id}:bot         -- Innenseite des Fold-Tip-Panels
  fold_{id}:left        -- Linke Seitenkante des Folds
  fold_{id}:right       -- Rechte Seitenkante des Folds
  flange_{id}:outer     -- Aussenseite der Flange
  flange_{id}:inner     -- Innenseite der Flange
  flange_{id}:left      -- Linke Seitenkante der Flange
  flange_{id}:right     -- Rechte Seitenkante der Flange
```

Das Backend gibt in der Response eine Liste aller existierenden Faces mit ihren Transforms zurueck, damit das Frontend weiss wo eine Face im 3D-Raum liegt (fuer die Sketch-Ebene).

## API-Dokumentation

### POST /api/v1/build-model

**Request:**
```json
{
  "profile": [
    { "x": 0, "y": 0 },
    { "x": 100, "y": 0 },
    { "x": 100, "y": 60 },
    { "x": 0, "y": 60 }
  ],
  "thickness": 1.0,
  "cutouts": [
    {
      "type": "circle",
      "center": { "x": 50, "y": 30 },
      "radius": 8,
      "polygon": [{ "x": 58, "y": 30 }, "..."]
    }
  ],
  "folds": [
    {
      "id": "fold_1",
      "lineStart": { "x": 0, "y": 20 },
      "lineEnd": { "x": 100, "y": 20 },
      "angle": 90,
      "direction": "up",
      "bendRadius": 1.0,
      "kFactor": 0.44,
      "foldLocation": "centerline",
      "parentFaceId": "base:top"
    }
  ],
  "flanges": [
    {
      "id": "flange_1",
      "edgeId": "edge_base_top_0",
      "height": 20,
      "angle": 90,
      "direction": "up",
      "bendRadius": 1.0,
      "kFactor": 0.44
    }
  ],
  "faceSketches": [
    {
      "faceId": "fold_1:top",
      "side": "top",
      "entities": [
        {
          "id": "circle_1",
          "type": "circle",
          "center": { "x": 50, "y": 10 },
          "radius": 5
        }
      ]
    }
  ],
  "bendTable": {
    "type": "kFactor",
    "defaultKFactor": 0.44,
    "overrides": []
  }
}
```

Wichtige Punkte:
- `faceSketches` referenziert Faces ueber die eindeutige `faceId` (z.B. `fold_1:top`)
- Alle Bend-Parameter (kFactor, bendRadius, bendTable) werden mitgeschickt -- das Backend rechnet
- Cutout-Polygone werden im Frontend aus Sketch-Entities erzeugt (Kreis -> Polygon, Rect -> 4 Punkte)
- Face-Sketches auf Fold/Flange-Faces werden als Cutouts oder Fold-Definitionen auf diesen Faces interpretiert

**Response:**
```json
{
  "success": true,
  "model": {
    "meshes": {
      "baseFace": {
        "positions": [0, 0, 0, "..."],
        "normals": [0, 0, 1, "..."],
        "indices": [0, 1, 2, "..."]
      },
      "folds": [
        {
          "id": "fold_1",
          "arc": { "positions": ["..."], "normals": ["..."], "indices": ["..."] },
          "tip": { "positions": ["..."], "normals": ["..."], "indices": ["..."] }
        }
      ],
      "flanges": [
        {
          "id": "flange_1",
          "mesh": { "positions": ["..."], "normals": ["..."], "indices": ["..."] }
        }
      ]
    },
    "boundaryEdges": {
      "positions": [0, 0, 0, 100, 0, 0, "..."]
    },
    "faces": [
      {
        "faceId": "base:top",
        "origin": [0, 0, 1],
        "xAxis": [1, 0, 0],
        "yAxis": [0, 1, 0],
        "normal": [0, 0, 1],
        "width": 100,
        "height": 60
      },
      {
        "faceId": "base:bot",
        "origin": [0, 0, 0],
        "xAxis": [1, 0, 0],
        "yAxis": [0, 1, 0],
        "normal": [0, 0, -1],
        "width": 100,
        "height": 60
      },
      {
        "faceId": "fold_1:top",
        "origin": [0, 20, 1],
        "xAxis": [1, 0, 0],
        "yAxis": [0, 0, 1],
        "normal": [0, -1, 0],
        "width": 100,
        "height": 40
      },
      {
        "faceId": "fold_1:bot",
        "origin": [0, 20, 0],
        "xAxis": [1, 0, 0],
        "yAxis": [0, 0, 1],
        "normal": [0, 1, 0],
        "width": 100,
        "height": 40
      }
    ],
    "edges": [
      {
        "id": "edge_base_top_0",
        "faceId": "base:top",
        "start": [0, 0, 1],
        "end": [100, 0, 1],
        "normal": [0, -1, 0],
        "faceNormal": [0, 0, 1]
      }
    ]
  }
}
```

Die `faces`-Liste ist entscheidend: Sie liefert dem Frontend fuer jede Face ein lokales Koordinatensystem (origin, xAxis, yAxis, normal, Dimensionen). Damit kann `FaceSketchPlane` die Sketch-Ebene exakt positionieren, ohne selbst Bend-Geometrie berechnen zu muessen.

---

### POST /api/v1/unfold

**Request:**
```json
{
  "profile": [{ "x": 0, "y": 0 }, "..."],
  "thickness": 1.0,
  "cutouts": ["..."],
  "folds": ["..."],
  "flanges": ["..."],
  "faceSketches": ["..."],
  "bendTable": {
    "type": "kFactor",
    "defaultKFactor": 0.44
  }
}
```

(Identisch mit build-model, damit das Backend den gleichen Modellzustand hat.)

**Response:**
```json
{
  "success": true,
  "flatPattern": {
    "regions": [
      {
        "id": "base",
        "faceId": "base:top",
        "polygon": [{ "x": 0, "y": 0 }, "..."],
        "cutouts": [{ "type": "circle", "center": { "x": 50, "y": 30 }, "radius": 8 }]
      },
      {
        "id": "fold_1_tip",
        "faceId": "fold_1:top",
        "polygon": [{ "x": 0, "y": 20.5 }, "..."],
        "cutouts": []
      }
    ],
    "bendLines": [
      {
        "foldId": "fold_1",
        "start": { "x": 0, "y": 20 },
        "end": { "x": 100, "y": 20 },
        "angle": 90,
        "radius": 1.0,
        "label": "F1"
      }
    ],
    "boundingBox": { "minX": 0, "minY": 0, "maxX": 100, "maxY": 100 }
  }
}
```

---

## Aenderungen im Frontend

### Neue Datei: `src/lib/metalHeroApi.ts`
API-Client mit:
- `buildModel(params)` -- POST /api/v1/build-model
- `unfoldModel(params)` -- POST /api/v1/unfold
- Response-Arrays zu `THREE.BufferGeometry` konvertieren
- Face-Liste parsen und als `Map<string, FaceTransform>` bereitstellen
- API-Key aus Secret lesen
- Error Handling, Retry, Debouncing

### Neue Datei: `src/lib/faceRegistry.ts`
Zentrale Face-Verwaltung:
- `FaceTransform`-Typ: origin, xAxis, yAxis, normal, width, height
- Face-Map wird nach jedem `build-model`-Call aktualisiert
- `getFaceTransform(faceId)` fuer FaceSketchPlane
- `getSelectableEdges(faceId)` fuer Flange-Erstellung

### Geaendert: `src/lib/geometry.ts` (~2865 -> ~400 Zeilen)
Entfernt:
- Alle 3D-Mesh-Builder (`buildBaseFaceManual`, `createBaseFaceMesh`, `createFoldMesh`, `createFlangeMesh`, `MeshBuilder`, alle Sidewall/Crossing-Logik)
- Alle Bend-Berechnungen (`computeFoldBendLines`, `computeBendLinePositions`, `computeFoldBlockedIntervalsTD`)
- `computeBoundaryEdges`, `getAllSelectableEdges` (kommt vom Backend)
- `computeFlangeFaceTransform`, `computeFoldFaceTransform` (kommt vom Backend)

Behalten:
- Typ-Definitionen (`PartEdge`, `Flange`, `Fold`, `FaceSketch`, `FaceSketchEntity`, `ProfileCutout`)
- `extractProfile`, `extractEdges` (2D-Profil aus Sketch-Entities)
- `circleToPolygon`, `rectToPolygon` (2D-Cutout-Konvertierung)
- `classifySketchLineAsFold` (2D-Klassifizierung ob eine Linie ein Fold ist)

Face-ID-Schema anpassen: `base_top` -> `base:top`, `base_bot` -> `base:bot`, etc.

### Geaendert: `src/components/workspace/Viewer3D.tsx`
- `SheetMetalMesh` wird async: `useEffect` + `useState` statt `useMemo`
- Ruft `metalHeroApi.buildModel()` auf
- Rendert einzelnes Mesh aus Response (kein separates `FlangeMesh`, `FoldMesh`)
- Face-Liste aus Response wird in `faceRegistry` gespeichert
- Loading-Spinner waehrend API-Call
- Debounce: 300ms nach letzter Aenderung

### Geaendert: `src/components/workspace/FaceSketchPlane.tsx`
- Liest `worldTransform` aus `faceRegistry.getFaceTransform(faceId)` statt lokaler Berechnung
- Face-Dimensionen kommen aus der Face-Registry

### Geaendert: `src/components/workspace/UnfoldViewer.tsx`
- Ruft `metalHeroApi.unfoldModel()` auf statt lokales `computeFlatPattern()`
- Loading-State

### Geaendert: `src/pages/Workspace.tsx`
- Entfernt: WASM-Init (`initOCCT`, `isOCCTReady`, `occtReady`)
- API-Key Konfiguration

### Entfernt: `src/lib/unfold.ts`
Typen (`FlatPattern`, `FlatRegion`, `BendLine`) werden in `geometry.ts` behalten.

### Entfernt: `src/lib/cadInit.ts`
Kein WASM-Laden mehr.

### Geaendert: `src/lib/cadKernel.ts`
Entfernt oder zu reinem Re-Export von `metalHeroApi` umgewandelt.

## Implementierungsreihenfolge

1. `faceRegistry.ts` erstellen (Face-Naming-Konvention, Typen)
2. `metalHeroApi.ts` erstellen (API-Client)
3. `Viewer3D.tsx` auf async API-Calls umbauen
4. `FaceSketchPlane.tsx` auf Face-Registry umstellen
5. `UnfoldViewer.tsx` auf API umstellen
6. `geometry.ts` aufraeumen (3D-Code entfernen)
7. `cadInit.ts`, `cadKernel.ts`, `unfold.ts` entfernen/vereinfachen
8. `Workspace.tsx` vereinfachen

## Technische Details

| Datei | Aktion |
|---|---|
| `src/lib/faceRegistry.ts` | NEU |
| `src/lib/metalHeroApi.ts` | NEU |
| `src/lib/geometry.ts` | Reduziert: ~2865 -> ~400 Zeilen |
| `src/lib/cadKernel.ts` | ENTFERNT oder Stub |
| `src/lib/cadInit.ts` | ENTFERNT |
| `src/lib/unfold.ts` | ENTFERNT (Typen verschoben) |
| `src/components/workspace/Viewer3D.tsx` | Umgebaut: Async + Face-Registry |
| `src/components/workspace/FaceSketchPlane.tsx` | Umgebaut: Face-Registry |
| `src/components/workspace/UnfoldViewer.tsx` | Umgebaut: Async API |
| `src/pages/Workspace.tsx` | Vereinfacht |
