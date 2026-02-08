import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Point2D, generateId } from '@/lib/sheetmetal';
import { FaceSketchEntity, FaceSketchLine, FaceSketchCircle, FaceSketchRect } from '@/lib/geometry';

interface FaceSketchPlaneProps {
  faceOrigin: Point2D;
  faceWidth: number;
  faceHeight: number;
  thickness: number;
  entities: FaceSketchEntity[];
  activeTool: 'select' | 'line' | 'circle' | 'rect';
  gridSize: number;
  snapEnabled: boolean;
  onAddEntity: (entity: FaceSketchEntity) => void;
  onRemoveEntity: (id: string) => void;
  selectedIds: string[];
  onSelectEntity: (id: string) => void;
}

export function FaceSketchPlane({
  faceOrigin, faceWidth, faceHeight, thickness,
  entities, activeTool, gridSize, snapEnabled,
  onAddEntity, onRemoveEntity, selectedIds, onSelectEntity,
}: FaceSketchPlaneProps) {
  const [cursorPos, setCursorPos] = useState<Point2D | null>(null);
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);

  const z = thickness + 0.01;
  const ox = faceOrigin.x;
  const oy = faceOrigin.y;

  // Cancel drawing on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawStart(null);
        setCursorPos(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const snap = useCallback((v: number) => {
    if (!snapEnabled) return v;
    return Math.round(v / gridSize) * gridSize;
  }, [snapEnabled, gridSize]);

  const toLocal = useCallback((worldPoint: THREE.Vector3): Point2D => ({
    x: snap(worldPoint.x - ox),
    y: snap(worldPoint.y - oy),
  }), [ox, oy, snap]);

  const clamp = useCallback((p: Point2D): Point2D => ({
    x: Math.max(0, Math.min(faceWidth, p.x)),
    y: Math.max(0, Math.min(faceHeight, p.y)),
  }), [faceWidth, faceHeight]);

  const handlePointerMove = useCallback((e: any) => {
    if (activeTool === 'select') return;
    e.stopPropagation();
    setCursorPos(clamp(toLocal(e.point)));
  }, [activeTool, toLocal, clamp]);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    const local = clamp(toLocal(e.point));

    if (activeTool === 'select') return;

    if (activeTool === 'line') {
      if (!drawStart) {
        setDrawStart(local);
      } else {
        if (Math.hypot(local.x - drawStart.x, local.y - drawStart.y) > 1) {
          onAddEntity({ id: generateId(), type: 'line', start: drawStart, end: local });
        }
        setDrawStart(local); // chain lines
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
  }, [activeTool, drawStart, toLocal, clamp, onAddEntity]);

  // Reset draw state when tool changes
  useEffect(() => {
    setDrawStart(null);
    setCursorPos(null);
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
              {activeTool === 'select' && (
                <mesh position={mid} quaternion={quat}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id); }}
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
              {activeTool === 'select' && (
                <mesh position={[ox + entity.center.x, oy + entity.center.y, z]}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id); }}
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
              {activeTool === 'select' && (
                <mesh position={[ox + origin.x + width / 2, oy + origin.y + height / 2, z]}
                  onClick={(ev) => { ev.stopPropagation(); onSelectEntity(entity.id); }}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                  onPointerOut={() => { document.body.style.cursor = 'default'; }}>
                  <boxGeometry args={[width, height, 2]} />
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
