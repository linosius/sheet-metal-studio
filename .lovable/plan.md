

## Fix: Base-Top-Kanten im Edge-Modus sichtbar machen

### Problem

Alle Edges aus der API haben IDs wie `edge_top_*` oder `edge_bot_*`. Die aktuelle Filterung blendet beide aus, sodass im Edge-Modus keine einzige Kante selektierbar ist.

### Loesung

Nur `edge_bot_*`-Kanten ausblenden (diese sind die Unterseiten-Duplikate und nicht relevant fuer Flansch-Operationen). `edge_top_*`-Kanten bleiben sichtbar und selektierbar.

### Technische Aenderung

Datei: `src/components/workspace/Viewer3D.tsx`, Zeile 364

```text
Vorher:
  const isBaseFaceEdge = edge.id.startsWith('edge_top_') || edge.id.startsWith('edge_bot_');

Nachher:
  const isBaseFaceEdge = edge.id.startsWith('edge_bot_');
```

Eine einzelne Zeile wird geaendert. `edge_top_*`-Kanten werden nicht mehr als "Base Face Edge" eingestuft und erscheinen wieder im Edge-Modus.
