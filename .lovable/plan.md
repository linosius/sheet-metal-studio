
# Umbau auf parametrisches Modell mit OpenCascade.js CAD-Kernel

## Warum der Umbau notwendig ist

Das aktuelle System baut 3D-Geometrie direkt als Dreiecks-Meshes auf (~2.865 Zeilen in `geometry.ts`). Jede Interaktion zwischen Folds und Cutouts erfordert manuelle Topologie-Hacks (Sidewall-Suppression, Crossing-Detection, Arc-Hole-Walls). Diese Hacks versagen bei Kreisen, schraegen Folds und komplexen Kombinationen, weil das System kein topologisches Modell hat -- es arbeitet nur mit Dreiecken und Polygonen.

Ein CAD-Kernel wie OpenCascade (OCCT) arbeitet mit **B-Rep** (Boundary Representation): Faces, Edges und Vertices als topologische Entitaeten. Operationen wie Extrusion, Boolean-Cut und Biegung sind mathematisch exakt. Das Mesh wird erst am Ende fuer die Visualisierung erzeugt (Tessellation).

## Technologie-Wahl: OpenCascade.js

**opencascade.js** ist ein WASM-Port der OpenCascade-Bibliothek (die auch FreeCAD und andere professionelle CAD-Tools verwenden). Es bietet:

- `BRepPrimAPI_MakePrism`: Extrusion eines 2D-Profils zu einem Solid
- `BRepAlgoAPI_Cut`: Boolean-Subtraktion fuer Cutouts (immer topologisch korrekt)
- `BRepBuilderAPI_Transform`: Geometrische Transformationen
- `BRepMesh_IncrementalMesh`: Tessellation zu Dreiecken fuer Three.js
- `BRepFilletAPI_MakeFillet`: Verrundungen

**Groesse**: ~30MB WASM (kann mit Custom Build auf ~5-10MB reduziert werden). Wird asynchron geladen.

## Architektur-Uebersicht

```text
+------------------+     +-------------------+     +------------------+
|  2D Sketch       | --> |  CAD Kernel       | --> |  Three.js        |
|  (besteht)       |     |  (NEU)            |     |  Viewer          |
|                  |     |                   |     |  (vereinfacht)   |
|  SketchEntities  |     |  B-Rep Solid      |     |  Tessellation    |
|  Fold-Defs       |     |  Boolean Ops      |     |  -> Mesh         |
|  Cutout-Defs     |     |  Bend/Transform   |     |  -> Edges        |
+------------------+     +-------------------+     +------------------+
```

## Implementierungsplan (4 Phasen)

### Phase 1: OpenCascade.js Integration + Base Face (Grundlage)

**Neue Dateien:**
- `src/lib/cadKernel.ts` -- Wrapper um OpenCascade.js API
- `src/lib/cadInit.ts` -- Asynchrones Laden des WASM-Moduls

**Aenderungen:**
- `package.json`: `opencascade.js` als Dependency hinzufuegen
- `vite.config.ts`: WASM-Support konfigurieren (Copy Plugin fuer .wasm Dateien)

**Kernfunktionen in `cadKernel.ts`:**
1. `initOCCT()` -- WASM laden, Singleton-Instanz bereitstellen
2. `createSheetFromProfile(profile, thickness)` -- 2D-Profil zu `TopoDS_Shape` extrudieren
3. `cutHoles(solid, cutouts[])` -- Boolean-Subtraktion fuer alle Cutouts
4. `tessellate(shape)` -- B-Rep zu Three.js BufferGeometry konvertieren
5. `extractEdges(shape)` -- Topologische Kanten extrahieren fuer Boundary-Lines

**Was das ersetzt:** `createBaseFaceMesh`, `buildBaseFaceManual`, `computeBoundaryEdges`, `profileToShape`, alle Sidewall-Logik (~500 Zeilen)

### Phase 2: Fold/Bend als B-Rep-Operation

**Neue Funktionen in `cadKernel.ts`:**
1. `applyBend(solid, foldLine, angle, radius, thickness)` -- Solid an der Foldlinie teilen, Biegezone als Sweep erzeugen, Teile zusammenfuegen
2. `splitSolidAtLine(solid, linePoint, lineNormal)` -- Solid mit einer Ebene teilen (BRepAlgoAPI_Section + BRepAlgoAPI_Cut)

**Algorithmus fuer Bend:**
```text
1. Ebene definieren an der Foldlinie
2. Solid in Fixed + Moving teilen (BRepAlgoAPI_Cut mit Half-Space)
3. Moving-Teil um Biegeachse rotieren (gp_Trsf Rotation)
4. Biegezone erzeugen: 
   - Querschnitt an der Foldlinie extrahieren
   - Entlang Kreisbogen sweepen (BRepOffsetAPI_MakePipe oder manuell)
5. Alle 3 Teile vereinigen (BRepAlgoAPI_Fuse)
6. Cutouts die durch die Biegezone gehen werden automatisch
   korrekt behandelt -- die Boolean-Ops arbeiten auf der Topologie
```

**Was das ersetzt:** `createFoldMesh` (~700 Zeilen), `computeFoldBlockedIntervalsTD`, `complementIntervals`, `computeFoldLineInfo`, `getFixedProfile`, `getMovingCutouts`, `getFixedCutouts`, alle Segment-basierte Topologie-Logik (~1.500 Zeilen)

### Phase 3: Flanges + Viewer-Vereinfachung

**Aenderungen in `cadKernel.ts`:**
1. `applyFlange(solid, edgeId, height, angle, radius)` -- Flange als Bend an einer Kante

**Aenderungen in `Viewer3D.tsx`:**
- Drastische Vereinfachung: Statt separate `FlangeMesh`, `FoldMesh`, `BaseFaceMesh` Komponenten wird ein einzelnes tesselliertes Mesh gerendert
- Edge-Highlighting direkt aus der B-Rep-Topologie
- Face-Selection ueber topologische Face-IDs

**Was das ersetzt:** `createFlangeMesh` (~200 Zeilen), `FlangeMesh` + `FoldMesh` Komponenten in Viewer3D.tsx

### Phase 4: Unfold aus B-Rep

**Aenderungen in `cadKernel.ts`:**
1. `unfoldSheet(solid, bendInfo[])` -- Flat Pattern aus dem B-Rep berechnen
   - Biegezonenlaenge ueber Bend Allowance (bestehende Formel)
   - Faces ruecktransformieren in die Ebene

**Was das ersetzt:** `src/lib/unfold.ts` (~200 Zeilen)

## Dateien die sich aendern

| Datei | Aenderung |
|---|---|
| `package.json` | +opencascade.js Dependency |
| `vite.config.ts` | WASM Config |
| `src/lib/cadKernel.ts` | NEU: Gesamter CAD-Kernel-Wrapper |
| `src/lib/cadInit.ts` | NEU: Async WASM Loader |
| `src/lib/geometry.ts` | Schrittweise ersetzen, am Ende ~500 Zeilen statt ~2.865 |
| `src/components/workspace/Viewer3D.tsx` | Drastisch vereinfacht (~400 Zeilen statt ~1.269) |
| `src/lib/unfold.ts` | Vereinfacht, nutzt cadKernel |
| `src/pages/Workspace.tsx` | Loading-State fuer WASM-Init |

## Risiken und Einschraenkungen

1. **WASM Bundle-Groesse**: ~30MB Download beim ersten Laden (kann mit Custom Build reduziert werden, aber nicht in Lovable moeglich -- muss als fertiges npm-Paket verwendet werden)
2. **Ladezeit**: OCCT-Initialisierung dauert 2-5 Sekunden -- braucht Loading-Indikator
3. **Sheet Metal Bending**: OCCT hat keine native Sheet-Metal-API. Biegung muss als Split + Rotate + Sweep implementiert werden. Das ist aber deutlich robuster als der aktuelle Mesh-Ansatz, weil Boolean-Ops die Topologie korrekt handhaben.
4. **Umfang**: Dies ist ein grosser Umbau. Empfehlung: Phase 1 zuerst implementieren und testen, dann schrittweise weiter.

## Empfohlene Reihenfolge

Phase 1 allein loest bereits das Cutout-Problem fuer die Base Face und beweist, dass der Ansatz funktioniert. Die Fold-Logik (Phase 2) ist der kritischste und aufwaendigste Teil, profitiert aber am meisten vom CAD-Kernel, weil die Boolean-Ops Cutouts an der Biegezone automatisch korrekt teilen.
