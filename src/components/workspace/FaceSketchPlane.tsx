import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Point2D, generateId } from '@/lib/sheetmetal';
import { FaceSketchEntity, FaceSketchLine, FaceSketchCircle, FaceSketchRect, FaceSketchTool } from '@/lib/geometry';

interface FaceSketchPlaneProps {
  faceOrigin: Point2D;
  faceWidth: number;
  faceHeight: number;
  thickness: number;
  surfaceZ?: number;
  worldTransform?: THREE.Matrix4;
  entities: FaceSketchEntity[];
  activeTool: FaceSketchTool;
  gridSize: number;
  snapEnabled: boolean;
  onAddEntity: (entity: FaceSketchEntity) => void;
  onUpdateEntity: (id: string, updates: Partial<FaceSketchEntity>) => void;
  onRemoveEntity: (id: string) => void;
  selectedIds: string[];
  onSelectEntity: (id: string, multi?: boolean) => void;
  onDeselectAll: () => void;
}

export function FaceSketchPlane({
  faceOrigin, faceWidth, faceHeight, thickness,
  surfaceZ: surfaceZProp, worldTransform,
  entities, activeTool, gridSize, snapEnabled,
  onAddEntity, onUpdateEntity, onRemoveEntity, selectedIds, onSelectEntity, onDeselectAll,
}: FaceSketchPlaneProps) {
  const [cursorPos, setCursorPos] = useState<Point2D | null>(null);
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);

  // Move state
  const [moveStart, setMoveStart] = useState<Point2D | null>(null);
  const [moveDragging, setMoveDragging] = useState(false);

  const z = surfaceZProp ?? (thickness + 0.01);
  const ox = faceOrigin.x;
  const oy = faceOrigin.y;

  const inverseTransform = useMemo(() => {
    if (!worldTransform) return null;
    return worldTransform.clone().invert();
  }, [worldTransform]);

  // Cancel drawing on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawStart(null);
        setCursorPos(null);
        setMoveStart(null);
        setMoveDragging(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const snap = useCallback((v: number) => {
    if (!snapEnabled) return v;
    return Math.round(v / gridSize) * gridSize;
  }, [snapEnabled, gridSize]);

  const toLocal = useCallback((worldPoint: THREE.Vector3): Point2D => {
    let p = worldPoint.clone();
    if (inverseTransform) {
      p.applyMatrix4(inverseTransform);
    }
    return {
      x: snap(p.x - ox),
      y: snap(p.y - oy),
    };
  }, [ox, oy, snap, inverseTransform]);

  const clamp = useCallback((p: Point2D): Point2D => ({
    x: Math.max(0, Math.min(faceWidth, p.x)),
    y: Math.max(0, Math.min(faceHeight, p.y)),
  }), [faceWidth, faceHeight]);

  // Find nearest entity for move pick
  const findNearestEntity = useCallback((p: Point2D): FaceSketchEntity | null => {
    let best: FaceSketchEntity | null = null;
    let bestDist = 10;
    for (const ent of entities) {
      let d = Infinity;
      if (ent.type === 'line') {
        const dx = ent.end.x - ent.start.x, dy = ent.end.y - ent.start.y;
        const len2 = dx * dx + dy * dy;
        if (len2 > 0) {
          const t = Math.max(0, Math.min(1, ((p.x - ent.start.x) * dx + (p.y - ent.start.y) * dy) / len2));
          const proj = { x: ent.start.x + t * dx, y: ent.start.y + t * dy };
          d = Math.hypot(p.x - proj.x, p.y - proj.y);
        }
      } else if (ent.type === 'rect') {
        const corners = [
          ent.origin,
          { x: ent.origin.x + ent.width, y: ent.origin.y },
          { x: ent.origin.x + ent.width, y: ent.origin.y + ent.height },
          { x: ent.origin.x, y: ent.origin.y + ent.height },
        ];
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          const ddx = b.x - a.x, ddy = b.y - a.y;
          const len2 = ddx * ddx + ddy * ddy;
          if (len2 > 0) {
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * ddx + (p.y - a.y) * ddy) / len2));
            const proj = { x: a.x + t * ddx, y: a.y + t * ddy };
            d = Math.min(d, Math.hypot(p.x - proj.x, p.y - proj.y));
          }
        }
      } else if (ent.type === 'circle') {
        d = Math.abs(Math.hypot(p.x - ent.center.x, p.y - ent.center.y) - ent.radius);
      } else if (ent.type === 'point') {
        d = Math.hypot(p.x - ent.position.x, p.y - ent.position.y);
      }
      if (d < bestDist) { bestDist = d; best = ent; }
    }
    return best;
  }, [entities]);

  const moveEntities = useCallback((dx: number, dy: number) => {
    for (const id of selectedIds) {
      const ent = entities.find(e => e.id === id);
      if (!ent) continue;
      if (ent.type === 'line') {
        onUpdateEntity(id, { start: { x: ent.start.x + dx, y: ent.start.y + dy }, end: { x: ent.end.x + dx, y: ent.end.y + dy } });
      } else if (ent.type === 'rect') {
        onUpdateEntity(id, { origin: { x: ent.origin.x + dx, y: ent.origin.y + dy } });
      } else if (ent.type === 'circle') {
        onUpdateEntity(id, { center: { x: ent.center.x + dx, y: ent.center.y + dy } });
      } else if (ent.type === 'point') {
        onUpdateEntity(id, { position: { x: ent.position.x + dx, y: ent.position.y + dy } });
      }
    }
  }, [selectedIds, entities, onUpdateEntity]);

  const handlePointerMove = useCallback((e: any) => {
    if (activeTool === 'select' && !moveDragging) return;
    e.stopPropagation();
    setCursorPos(clamp(toLocal(e.point)));
  }, [activeTool, toLocal, clamp, moveDragging]);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    const local = clamp(toLocal(e.point));

    if (activeTool === 'select') {
      onDeselectAll();
      return;
    }

    if (activeTool === 'point') {
      onAddEntity({ id: generateId(), type: 'point', position: local });
      return;
    }

    if (activeTool === 'move') {
      if (moveDragging && moveStart) {
        const dx = local.x - moveStart.x, dy = local.y - moveStart.y;
        moveEntities(dx, dy);
        setMoveStart(null);
        setMoveDragging(false);
      } else if (selectedIds.length > 0) {
        setMoveStart(local);
        setMoveDragging(true);
      } else {
        const nearest = findNearestEntity(local);
        if (nearest) {
          onSelectEntity(nearest.id, false);
          setMoveStart(local);
          setMoveDragging(true);
        }
      }
      return;
    }

    if (activeTool === 'line') {
      if (!drawStart) {
        setDrawStart(local);
      } else {
        if (Math.hypot(local.x - drawStart.x, local.y - drawStart.y) > 1) {
          onAddEntity({ id: generateId(), type: 'line', start: drawStart, end: local });
        }
        setDrawStart(local);
      }
    } else if (activeTool === 'circle') {
      if (!drawStart) {
        setDrawStart(local);
      } else {
        const radius = Math.hypot(local.x - drawStart.x, local.y - drawStart.y);
        if (radius > 1) {
          onAddEntity({ id: generateId(), type: 'circle', center: drawStart, radius });
        }
        setDrawStart(null);
      }
    } else if (activeTool === 'rect') {
      if (!drawStart) {
        setDrawStart(local);
      } else {
        const w = Math.abs(local.x - drawStart.x);
        const h = Math.abs(local.y - drawStart.y);
        if (w > 1 && h > 1) {
          onAddEntity({
            id: generateId(), type: 'rect',
            origin: { x: Math.min(drawStart.x, local.x), y: Math.min(drawStart.y, local.y) },
            width: w, height: h,
          });
        }
        setDrawStart(null);
      }
    }
  }, [activeTool, drawStart, toLocal, clamp, onAddEntity, onDeselectAll, selectedIds, moveStart, moveDragging, moveEntities, findNearestEntity, onSelectEntity]);

  // Reset draw state when tool changes
  useEffect(() => {
    setDrawStart(null);
    setCursorPos(null);
    setMoveStart(null);
    setMoveDragging(false);
  }, [activeTool]);

  const gridLines = useMemo(() => {
    const lines: { s: [number, number, number]; e: [number, number, number] }[] = [];
    for (let x = gridSize; x < faceWidth; x += gridSize) {
      lines.push({ s: [ox + x, oy, z], e: [ox + x, oy + faceHeight, z] });
    }
    for (let y = gridSize; y < faceHeight; y += gridSize) {
      lines.push({ s: [ox, oy + y, z], e: [ox + faceWidth, oy + y, z] });
    }
    return lines;
  }, [ox, oy, faceWidth, faceHeight, gridSize, z]);

  const getCirclePoints = useCallback((center: Point2D, radius: number, segments = 64) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([ox + center.x + Math.cos(a) * radius, oy + center.y + Math.sin(a) * radius, z + 0.01]);
    }
    return pts;
  }, [ox, oy, z]);

  return (
    <group>
      {/* Semi-transparent face highlight */}
      <mesh position={[ox + faceWidth / 2, oy + faceHeight / 2, z - 0.005]}>
        <planeGeometry args={[faceWidth, faceHeight]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>

      {/* Face outline */}
      <Line
        points={[
          [ox, oy, z], [ox + faceWidth, oy, z],
          [ox + faceWidth, oy + faceHeight, z], [ox, oy + faceHeight, z], [ox, oy, z],
        ]}
        color="#3b82f6" lineWidth={2}
      />

      {/* Grid */}
      {gridLines.map((gl, i) => (
        <Line key={`g${i}`} points={[gl.s, gl.e]} color="#3b82f6" lineWidth={0.5} transparent opacity={0.15} />
      ))}

      {/* Invisible hit plane for raycasting */}
      <mesh
        position={[ox + faceWidth / 2, oy + faceHeight / 2, z]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursorPos(null)}
      >
        <planeGeometry args={[faceWidth + 2, faceHeight + 2]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* Cursor crosshair */}
      {cursorPos && activeTool !== 'select' && (
        <group>
          <Line points={[[ox + cursorPos.x - 3, oy + cursorPos.y, z + 0.02], [ox + cursorPos.x + 3, oy + cursorPos.y, z + 0.02]]} color="#22c55e" lineWidth={1.5} />
          <Line points={[[ox + cursorPos.x, oy + cursorPos.y - 3, z + 0.02], [ox + cursorPos.x, oy + cursorPos.y + 3, z + 0.02]]} color="#22c55e" lineWidth={1.5} />
        </group>
      )}

      {/* Preview: line */}
      {drawStart && cursorPos && activeTool === 'line' && (
        <Line
          points={[[ox + drawStart.x, oy + drawStart.y, z + 0.01], [ox + cursorPos.x, oy + cursorPos.y, z + 0.01]]}
          color="#3b82f6" lineWidth={1.5} dashed dashSize={2} gapSize={1}
        />
      )}

      {/* Preview: circle */}
      {drawStart && cursorPos && activeTool === 'circle' && (() => {
        const r = Math.hypot(cursorPos.x - drawStart.x, cursorPos.y - drawStart.y);
        return <Line points={getCirclePoints(drawStart, r)} color="#3b82f6" lineWidth={1.5} dashed dashSize={2} gapSize={1} />;
      })()}

      {/* Preview: rect */}
      {drawStart && cursorPos && activeTool === 'rect' && (
        <Line
          points={[
            [ox + drawStart.x, oy + drawStart.y, z + 0.01],
            [ox + cursorPos.x, oy + drawStart.y, z + 0.01],
            [ox + cursorPos.x, oy + cursorPos.y, z + 0.01],
            [ox + drawStart.x, oy + cursorPos.y, z + 0.01],
            [ox + drawStart.x, oy + drawStart.y, z + 0.01],
          ]}
          color="#3b82f6" lineWidth={1.5} dashed dashSize={2} gapSize={1}
        />
      )}

      {/* Preview: move ghost */}
      {moveDragging && moveStart && cursorPos && activeTool === 'move' && (() => {
        const dx = cursorPos.x - moveStart.x;
        const dy = cursorPos.y - moveStart.y;
        return (
          <group>
            <Line
              points={[[ox + moveStart.x, oy + moveStart.y, z + 0.02], [ox + cursorPos.x, oy + cursorPos.y, z + 0.02]]}
              color="#22c55e" lineWidth={1} dashed dashSize={2} gapSize={1}
            />
            {selectedIds.map(id => {
              const ent = entities.find(e => e.id === id);
              if (!ent) return null;
              if (ent.type === 'line') {
                return <Line key={`mv-${id}`}
                  points={[[ox + ent.start.x + dx, oy + ent.start.y + dy, z + 0.02], [ox + ent.end.x + dx, oy + ent.end.y + dy, z + 0.02]]}
                  color="#22c55e" lineWidth={1.5} dashed dashSize={2} gapSize={1} />;
              }
              if (ent.type === 'rect') {
                return <Line key={`mv-${id}`}
                  points={[
                    [ox + ent.origin.x + dx, oy + ent.origin.y + dy, z + 0.02],
                    [ox + ent.origin.x + ent.width + dx, oy + ent.origin.y + dy, z + 0.02],
                    [ox + ent.origin.x + ent.width + dx, oy + ent.origin.y + ent.height + dy, z + 0.02],
                    [ox + ent.origin.x + dx, oy + ent.origin.y + ent.height + dy, z + 0.02],
                    [ox + ent.origin.x + dx, oy + ent.origin.y + dy, z + 0.02],
                  ]}
                  color="#22c55e" lineWidth={1.5} dashed dashSize={2} gapSize={1} />;
              }
              if (ent.type === 'circle') {
                return <Line key={`mv-${id}`}
                  points={getCirclePoints({ x: ent.center.x + dx, y: ent.center.y + dy }, ent.radius)}
                  color="#22c55e" lineWidth={1.5} dashed dashSize={2} gapSize={1} />;
              }
              return null;
            })}
          </group>
        );
      })()}

      {/* Rendered entities */}
      {entities.map(entity => {
        const isSelected = selectedIds.includes(entity.id);
        const color = isSelected ? '#a855f7' : '#ef4444';
        const lw = isSelected ? 3 : 2;

        if (entity.type === 'line') {
          const mx = ox + (entity.start.x + entity.end.x) / 2;
          const my = oy + (entity.start.y + entity.end.y) / 2;
          const len = Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
          const s3 = new THREE.Vector3(ox + entity.start.x, oy + entity.start.y, z);
          const e3 = new THREE.Vector3(ox + entity.end.x, oy + entity.end.y, z);
          const mid = s3.clone().add(e3).multiplyScalar(0.5);
          const dir = new THREE.Vector3().subVectors(e3, s3).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);

          return (
            <group key={entity.id}>
              <Line points={[[s3.x, s3.y, s3.z + 0.01], [e3.x, e3.y, e3.z + 0.01]]} color={color} lineWidth={lw} />
              <Html position={[mx, my, z + 0.5]} center>
                <div className="bg-card/90 border border-border px-1.5 py-0.5 rounded text-[10px] font-mono text-foreground whitespace-nowrap pointer-events-none">
                  {len.toFixed(1)} mm
                </div>
              </Html>
              {(activeTool === 'select' || activeTool === 'move') && (
                <mesh position={mid} quaternion={quat}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id, ev.shiftKey); }}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                  onPointerOut={() => { document.body.style.cursor = 'default'; }}>
                  <boxGeometry args={[len, 3, 3]} />
                  <meshBasicMaterial transparent opacity={0} />
                </mesh>
              )}
            </group>
          );
        }

        if (entity.type === 'circle') {
          const pts = getCirclePoints(entity.center, entity.radius);
          return (
            <group key={entity.id}>
              <Line points={pts} color={color} lineWidth={lw} />
              <Html position={[ox + entity.center.x + entity.radius, oy + entity.center.y, z + 0.5]} center>
                <div className="bg-card/90 border border-border px-1.5 py-0.5 rounded text-[10px] font-mono text-foreground whitespace-nowrap pointer-events-none">
                  R{entity.radius.toFixed(1)}
                </div>
              </Html>
              {(activeTool === 'select' || activeTool === 'move') && (
                <mesh position={[ox + entity.center.x, oy + entity.center.y, z]}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id, ev.shiftKey); }}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                  onPointerOut={() => { document.body.style.cursor = 'default'; }}>
                  <torusGeometry args={[entity.radius, 2, 4, 32]} />
                  <meshBasicMaterial transparent opacity={0} />
                </mesh>
              )}
            </group>
          );
        }

        if (entity.type === 'rect') {
          const { origin, width, height } = entity;
          return (
            <group key={entity.id}>
              <Line
                points={[
                  [ox + origin.x, oy + origin.y, z + 0.01],
                  [ox + origin.x + width, oy + origin.y, z + 0.01],
                  [ox + origin.x + width, oy + origin.y + height, z + 0.01],
                  [ox + origin.x, oy + origin.y + height, z + 0.01],
                  [ox + origin.x, oy + origin.y, z + 0.01],
                ]}
                color={color} lineWidth={lw}
              />
              <Html position={[ox + origin.x + width / 2, oy + origin.y + height, z + 0.5]} center>
                <div className="bg-card/90 border border-border px-1.5 py-0.5 rounded text-[10px] font-mono text-foreground whitespace-nowrap pointer-events-none">
                  {width.toFixed(1)} × {height.toFixed(1)}
                </div>
              </Html>
              {(activeTool === 'select' || activeTool === 'move') && (
                <mesh position={[ox + origin.x + width / 2, oy + origin.y + height / 2, z]}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id, ev.shiftKey); }}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                  onPointerOut={() => { document.body.style.cursor = 'default'; }}>
                  <boxGeometry args={[width, height, 2]} />
                  <meshBasicMaterial transparent opacity={0} />
                </mesh>
              )}
            </group>
          );
        }

        if (entity.type === 'point') {
          return (
            <group key={entity.id}>
              <Line points={[[ox + entity.position.x - 2, oy + entity.position.y, z + 0.01], [ox + entity.position.x + 2, oy + entity.position.y, z + 0.01]]} color={color} lineWidth={lw} />
              <Line points={[[ox + entity.position.x, oy + entity.position.y - 2, z + 0.01], [ox + entity.position.x, oy + entity.position.y + 2, z + 0.01]]} color={color} lineWidth={lw} />
              {(activeTool === 'select' || activeTool === 'move') && (
                <mesh position={[ox + entity.position.x, oy + entity.position.y, z]}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id, ev.shiftKey); }}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                  onPointerOut={() => { document.body.style.cursor = 'default'; }}>
                  <sphereGeometry args={[2]} />
                  <meshBasicMaterial transparent opacity={0} />
                </mesh>
              )}
            </group>
          );
        }

        return null;
      })}
    </group>
  );
}
