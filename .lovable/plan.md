

## Backend-Update im Frontend abbilden

Das Backend liefert jetzt echte FreeCAD-Faces und -Edges mit stabilen IDs. Das Frontend muss die Edge-Filterung im Edge-Modus an die neuen Namenskonventionen anpassen.

### Neue Edge-ID-Konventionen vom Backend

- **Base-Kanten**: `edge_top_*` / `edge_bot_*` (gepaart, Top/Bottom der Grundplatte)
- **Fold-Seitenkanten**: `edge_side_{s|m|e}_fold_*`
- **Fold-Tip-Kanten**: `edge_tip_{inner|outer}_fold_*`

### Anpassungen

**1. Edge-Filterung in Viewer3D.tsx umstellen (Zeile ~357)**

Statt `faceId.startsWith('base')` wird die Filterung auf `edge.id`-Muster umgestellt:
- Base-Kanten (`edge_top_*`, `edge_bot_*`) werden im Edge-Modus ausgeblendet -- diese sind nicht für Flansch-Operationen relevant
- `edge_tip_inner_*` und `edge_tip_outer_*` bleiben sichtbar und selektierbar (Flansch-Kandidaten)
- `edge_side_*` Kanten werden je nach Bedarf ein-/ausgeblendet

```text
Alte Logik:
  isBaseFaceEdge = !edge.faceId || edge.faceId.startsWith('base')

Neue Logik:
  isBaseFaceEdge = edge.id.startsWith('edge_top_') || edge.id.startsWith('edge_bot_')
```

**2. Fold-Linien-Erkennung aufräumen (Zeile ~174)**

`nonSelectableEdgeIds` ist aktuell immer leer (`new Set<string>()`). Da das Backend jetzt stabile Fold-IDs liefert, können wir hier optional `edge_side_*`-Kanten als nicht-selektierbar markieren, falls diese nicht als Flansch-Ziele dienen sollen.

**3. Farbkodierung der Tip-Kanten anpassen (Zeile ~358)**

Die bestehende `isInnerTip`-Erkennung (`edge.id.includes('_tip_inner_')`) passt bereits zum neuen Schema. Outer-Tip-Kanten (`edge_tip_outer_*`) könnten eine eigene Farbe bekommen, um sie visuell von Inner-Tips zu unterscheiden.

### Technische Details

Datei: `src/components/workspace/Viewer3D.tsx`

- Zeile ~357: `isBaseFaceEdge`-Check auf `edge.id`-basierte Erkennung umstellen
- Zeile ~174: Optional `nonSelectableEdgeIds` mit `edge_side_*`-Kanten befüllen, die nicht als Flansch-Ziele gelten
- Zeile ~356: `isInnerTip`-Check beibehalten, ggf. `isOuterTip` ergänzen

Datei: `src/lib/faceRegistry.ts` -- keine Änderungen nötig, die Registry ist bereits korrekt aufgebaut.

Datei: `src/lib/metalHeroApi.ts` -- keine Änderungen nötig, `updateFaceRegistry` wird bereits korrekt aufgerufen.

