import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube, Grid, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Home, Bug, Loader2 } from 'lucide-react';
import { Point2D } from '@/lib/sheetmetal';
import {
  PartEdge, Flange, Fold, FaceSketch,
  FaceSketchLine, FaceSketchCircle, FaceSketchRect, FaceSketchEntity, FaceSketchTool,
  classifySketchLineAsFold, isEdgeOnFoldLine, isBaseFaceFold,
  ProfileCutout,
} from '@/lib/geometry';
import { buildModel, BuildModelResult } from '@/lib/metalHeroApi';
import { getFaceTransform, faceTransformToMatrix4, apiEdgeToPartEdge } from '@/lib/faceRegistry';
import { FaceSketchPlane } from './FaceSketchPlane';

// ========== Types ==========

interface SheetMetalMeshProps {
  profile: Point2D[];
  thickness: number;
  selectedEdgeId: string | null;
  onEdgeClick: (edgeId: string) => void;
  flanges: Flange[];
  folds: Fold[];
  interactionMode: 'edge' | 'sketch' | 'fold' | 'view';
  onFaceClick?: (faceId: string) => void;
  faceSketches: FaceSketch[];
  selectedSketchLineId: string | null;
  onSketchLineClick?: (lineId: string) => void;
  activeSketchFaceId?: string | null;
  cutouts?: ProfileCutout[];
  kFactor: number;
  modelResult: BuildModelResult | null;
  modelLoading: boolean;
}

const noopRaycast = () => {};

// Edge outline helper – renders dark wireframe lines along hard edges
function MeshEdgeOutline({ geometry, color = '#94a3b8', thresholdAngle = 20 }: {
  geometry: THREE.BufferGeometry; color?: string; thresholdAngle?: number;
}) {
  const edgesGeo = useMemo(() => {
    return new THREE.EdgesGeometry(geometry, thresholdAngle);
  }, [geometry, thresholdAngle]);
  return (
    <lineSegments geometry={edgesGeo} raycast={noopRaycast as any}>
      <lineBasicMaterial color={color} linewidth={1} />
    </lineSegments>
  );
}

// ========== Sketch Entity 3D Renderers ==========

function SketchLine3D({
  line, profile, thickness, isSelected, hasFold, isFoldMode, isFoldQualified, onSketchLineClick,
}: {
  line: FaceSketchLine; profile: Point2D[]; thickness: number;
  isSelected: boolean; hasFold: boolean; isFoldMode: boolean; isFoldQualified: boolean;
  onSketchLineClick?: (id: string) => void;
}) {
  const positions = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const z = thickness + 0.05;
    return {
      start: [minX + line.start.x, minY + line.start.y, z] as [number, number, number],
      end: [minX + line.end.x, minY + line.end.y, z] as [number, number, number],
    };
  }, [line, profile, thickness]);

  const { midpoint, quaternion, length } = useMemo(() => {
    const s = new THREE.Vector3(...positions.start);
    const e = new THREE.Vector3(...positions.end);
    const mid = s.clone().add(e).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(e, s).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    return { midpoint: mid, quaternion: quat, length: s.distanceTo(e) };
  }, [positions]);

  const color = hasFold ? '#22c55e' : isSelected ? '#a855f7' : '#ef4444';

  return (
    <group>
      <Line
        points={[positions.start, positions.end]}
        color={color}
        lineWidth={isSelected ? 3 : 2}
        dashed dashSize={2} gapSize={1}
      />
      {isFoldMode && !hasFold && (
        <mesh
          position={midpoint}
          quaternion={quaternion}
          onClick={(e) => { e.stopPropagation(); onSketchLineClick?.(line.id); }}
          onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'default'; }}
        >
          <boxGeometry args={[length, 4, 4]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

function SketchCircle3D({ entity, profile, thickness }: {
  entity: FaceSketchCircle; profile: Point2D[]; thickness: number;
}) {
  const points = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const z = thickness + 0.05;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push([minX + entity.center.x + Math.cos(a) * entity.radius, minY + entity.center.y + Math.sin(a) * entity.radius, z]);
    }
    return pts;
  }, [entity, profile, thickness]);
  return <Line points={points} color="#ef4444" lineWidth={2} />;
}

function SketchRect3D({ entity, profile, thickness }: {
  entity: FaceSketchRect; profile: Point2D[]; thickness: number;
}) {
  const points = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const z = thickness + 0.05;
    const { origin, width, height } = entity;
    return [
      [minX + origin.x, minY + origin.y, z],
      [minX + origin.x + width, minY + origin.y, z],
      [minX + origin.x + width, minY + origin.y + height, z],
      [minX + origin.x, minY + origin.y + height, z],
      [minX + origin.x, minY + origin.y, z],
    ] as [number, number, number][];
  }, [entity, profile, thickness]);
  return <Line points={points} color="#ef4444" lineWidth={2} />;
}

// ========== Main Sheet Metal Mesh (API-driven) ==========

function SheetMetalMesh({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds, interactionMode, onFaceClick,
  faceSketches, selectedSketchLineId, onSketchLineClick,
  activeSketchFaceId, modelResult, modelLoading,
}: SheetMetalMeshProps) {
  // Get edges from API result
  const edges = useMemo(() => {
    if (!modelResult) return [];
    return modelResult.edges.map(apiEdgeToPartEdge);
  }, [modelResult]);

  const edgeMap = useMemo(() => {
    const map = new Map<string, PartEdge>();
    edges.forEach(e => map.set(e.id, e));
    return map;
  }, [edges]);

  const flangedEdgeIds = useMemo(() => new Set(flanges.map(f => f.edgeId)), [flanges]);
  const baseFolds = useMemo(() => folds.filter(f => isBaseFaceFold(f)), [folds]);

  // Side edges of folds are not selectable as flange targets
  const nonSelectableEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    edges.forEach(e => {
      if (e.id.startsWith('edge_side_')) ids.add(e.id);
    });
    return ids;
  }, [edges]);

  // Base face entities for sketch visualization
  const allEntities = useMemo(() => {
    const sketches = faceSketches.filter(fs => {
      if (fs.faceId !== 'base_top' && fs.faceId !== 'base_bot') return false;
      if (activeSketchFaceId && fs.faceId === activeSketchFaceId) return false;
      return true;
    });
    return sketches.flatMap(fs => fs.entities);
  }, [faceSketches, activeSketchFaceId]);

  const allLines = useMemo(() => allEntities.filter((e): e is FaceSketchLine => e.type === 'line'), [allEntities]);
  const allCircles = useMemo(() => allEntities.filter((e): e is FaceSketchCircle => e.type === 'circle'), [allEntities]);
  const allRects = useMemo(() => allEntities.filter((e): e is FaceSketchRect => e.type === 'rect'), [allEntities]);

  const foldedLineIds = useMemo(() =>
    new Set(folds.filter(f => f.sketchLineId).map(f => f.sketchLineId!)),
    [folds],
  );

  const faceBounds = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }, [profile]);

   const [baseFaceHovered, setBaseFaceHovered] = useState(false);
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);

  const isSketchMode = interactionMode === 'sketch';
  const isFoldMode = interactionMode === 'fold';
  const isEdgeMode = interactionMode === 'edge';
  const isViewMode = interactionMode === 'view';

  if (!modelResult) return null;

  return (
    <group>
      {/* Solid base face from API */}
      <mesh
        geometry={modelResult.baseFace}
        userData={{ faceType: 'base' }}
        
        
        onClick={(e) => {
          console.log('[BaseFace] clicked, isSketchMode:', isSketchMode, 'onFaceClick:', !!onFaceClick, 'intersections:', e.intersections.length, e.intersections.map(i => i.object.userData));
          if (isSketchMode && onFaceClick) {
            const closest = e.intersections[0];
            if (closest && closest.object.userData?.faceId) return;
            e.stopPropagation();
            onFaceClick(e.point.z > thickness * 0.5 ? 'base_top' : 'base_bot');
          }
        }}
        onPointerOver={(e) => {
          if (isSketchMode) {
            const closest = e.intersections[0];
            if (closest && closest.object.userData?.faceId) return;
            document.body.style.cursor = 'pointer';
            setBaseFaceHovered(true);
          }
        }}
        onPointerOut={() => {
          if (isSketchMode) {
            document.body.style.cursor = 'default';
            setBaseFaceHovered(false);
          }
        }}
      >
        <meshStandardMaterial
          color={isSketchMode && baseFaceHovered ? '#93c5fd' : '#d4d8dd'}
          metalness={0.08} roughness={0.65} side={THREE.DoubleSide}
        />
      </mesh>
      {!isViewMode && <MeshEdgeOutline geometry={modelResult.baseFace} />}

      {/* Boundary edges from API – kept as data only, not rendered (ghost edge fix) */}
      {false && (
        <lineSegments geometry={modelResult.boundaryEdges}>
          <lineBasicMaterial color="#475569" linewidth={1} />
        </lineSegments>
      )}

      {/* Fold meshes from API */}
      {modelResult.folds.map(fold => {
        const foldFaceId = `fold_face_${fold.id}`;
        const isHovered = hoveredFaceId === foldFaceId;
        const isActive = activeSketchFaceId === foldFaceId;
        return (
          <group key={fold.id}>
            <mesh
              geometry={fold.arc}
              userData={{ faceId: foldFaceId }}
              
              
              onClick={(e) => {
                console.log('[FoldArc] clicked, faceId:', foldFaceId, 'isSketchMode:', isSketchMode);
                if (isSketchMode && onFaceClick) { e.stopPropagation(); onFaceClick(foldFaceId); }
              }}
              onPointerOver={() => {
                if (isSketchMode) { document.body.style.cursor = 'pointer'; setHoveredFaceId(foldFaceId); }
              }}
              onPointerOut={() => {
                if (isSketchMode) { document.body.style.cursor = 'default'; setHoveredFaceId(null); }
              }}
            >
              <meshStandardMaterial
                color={isSketchMode && isHovered ? '#93c5fd' : '#d4d8dd'}
                metalness={0.08} roughness={0.65} side={THREE.DoubleSide}
              />
            </mesh>
            {!isViewMode && <MeshEdgeOutline geometry={fold.arc} />}
            <mesh
              geometry={fold.tip}
              userData={{ faceId: foldFaceId }}
              
              
              onClick={(e) => {
                if (isSketchMode && onFaceClick) { e.stopPropagation(); onFaceClick(foldFaceId); }
              }}
              onPointerOver={() => {
                if (isSketchMode) { document.body.style.cursor = 'pointer'; setHoveredFaceId(foldFaceId); }
              }}
              onPointerOut={() => {
                if (isSketchMode) { document.body.style.cursor = 'default'; setHoveredFaceId(null); }
              }}
            >
              <meshStandardMaterial
                color={isSketchMode && isHovered ? '#93c5fd' : '#d4d8dd'}
                metalness={0.08} roughness={0.65} side={THREE.DoubleSide}
              />
            </mesh>
            {!isViewMode && <MeshEdgeOutline geometry={fold.tip} />}
          </group>
        );
      })}

      {/* Flange meshes from API */}
      {modelResult.flanges.map(flange => {
        const flangeFaceId = `flange_face_${flange.id}`;
        const isHovered = hoveredFaceId === flangeFaceId;
        const isActive = activeSketchFaceId === flangeFaceId;
        return (
          <group key={flange.id}>
            <mesh
              geometry={flange.mesh}
              userData={{ faceId: flangeFaceId }}
              
              
              onClick={(e) => {
                if (isSketchMode && onFaceClick) { e.stopPropagation(); onFaceClick(flangeFaceId); }
              }}
              onPointerOver={() => {
                if (isSketchMode) { document.body.style.cursor = 'pointer'; setHoveredFaceId(flangeFaceId); }
              }}
              onPointerOut={() => {
                if (isSketchMode) { document.body.style.cursor = 'default'; setHoveredFaceId(null); }
              }}
            >
              <meshStandardMaterial
                color={isSketchMode && isHovered ? '#93c5fd' : '#d4d8dd'}
                metalness={0.08} roughness={0.65} side={THREE.DoubleSide}
              />
            </mesh>
            {!isViewMode && <MeshEdgeOutline geometry={flange.mesh} />}
          </group>
        );
      })}

      {/* Selectable edges */}
      {edges.map((edge) => {
        const isSelected = selectedEdgeId === edge.id;
        const hasFlangeOnIt = flangedEdgeIds.has(edge.id);
        const isFoldLine = nonSelectableEdgeIds.has(edge.id);
        const edgeMid = new THREE.Vector3(
          (edge.start.x + edge.end.x) / 2,
          (edge.start.y + edge.end.y) / 2,
          (edge.start.z + edge.end.z) / 2,
        );
        const edgeLen = edge.start.distanceTo(edge.end);
        const edgeDir = new THREE.Vector3().subVectors(edge.end, edge.start).normalize();
        const edgeQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), edgeDir);
        const isInnerTip = edge.id.includes('_tip_inner_');
        const isOuterTip = edge.id.includes('_tip_outer_');
        const isBaseFaceEdge = edge.id.startsWith('edge_bot_');
        const edgeColor = isFoldLine ? '#ef4444' : hasFlangeOnIt ? '#22c55e' : isSelected ? '#a855f7' : isInnerTip ? '#f59e0b' : isOuterTip ? '#06b6d4' : '#3b82f6';
        const showEdgeLine = isEdgeMode && !isFoldLine && !isBaseFaceEdge;

        return (
          <group key={edge.id}>
            {showEdgeLine && (
              <Line
                points={[[edge.start.x, edge.start.y, edge.start.z], [edge.end.x, edge.end.y, edge.end.z]]}
                color={edgeColor}
                lineWidth={isSelected ? 3 : 2}
              />
            )}
            {isEdgeMode && !isFoldLine && !isBaseFaceEdge && (
              <mesh
                position={edgeMid} quaternion={edgeQuat}
                onClick={(e) => { e.stopPropagation(); onEdgeClick(edge.id); }}
                onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
                onPointerOut={() => { document.body.style.cursor = 'default'; }}
              >
                <boxGeometry args={[edgeLen, 3, 3]} />
                <meshBasicMaterial transparent opacity={0} />
              </mesh>
            )}
            {isSelected && (
              <arrowHelper args={[edge.normal, edgeMid, 10, 0xa855f7, 3, 2]} />
            )}
          </group>
        );
      })}

      {/* Sketch entities on base face */}
      {(isFoldMode || isSketchMode) && allLines.filter(line => !foldedLineIds.has(line.id)).map(line => {
        const classification = classifySketchLineAsFold(line, faceBounds.width, faceBounds.height);
        return (
          <SketchLine3D
            key={line.id} line={line} profile={profile} thickness={thickness}
            isSelected={selectedSketchLineId === line.id} hasFold={false}
            isFoldMode={isFoldMode} isFoldQualified={!!classification}
            onSketchLineClick={onSketchLineClick}
          />
        );
      })}
      {(isFoldMode || isSketchMode) && allCircles.map(entity => (
        <SketchCircle3D key={entity.id} entity={entity} profile={profile} thickness={thickness} />
      ))}
      {(isFoldMode || isSketchMode) && allRects.map(entity => (
        <SketchRect3D key={entity.id} entity={entity} profile={profile} thickness={thickness} />
      ))}

      {/* Sketch entities on fold/flange faces — use face registry transforms */}
      {(isFoldMode || isSketchMode) && faceSketches
        .filter(fs => (fs.faceId.startsWith('fold_face_') || fs.faceId.startsWith('flange_face_')) && fs.faceId !== activeSketchFaceId)
        .map(fs => {
          const ft = getFaceTransform(fs.faceId);
          if (!ft) return null;
          const m = faceTransformToMatrix4(ft);

          return (
            <group key={fs.faceId} matrixAutoUpdate={false} matrix={m}>
              {fs.entities.map(ent => {
                if (ent.type === 'line') {
                  const hasFoldOnIt = folds.some(f => f.sketchLineId === ent.id);
                  const color = hasFoldOnIt ? '#22c55e' : '#ef4444';
                  const s = new THREE.Vector3(ent.start.x, ent.start.y, 0.02);
                  const e = new THREE.Vector3(ent.end.x, ent.end.y, 0.02);
                  const mid = s.clone().add(e).multiplyScalar(0.5);
                  const dir = new THREE.Vector3().subVectors(e, s).normalize();
                  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
                  const len = s.distanceTo(e);
                  return (
                    <group key={ent.id}>
                      <Line points={[[ent.start.x, ent.start.y, 0.02], [ent.end.x, ent.end.y, 0.02]]}
                        color={color} lineWidth={2} dashed dashSize={2} gapSize={1} />
                      {isFoldMode && !hasFoldOnIt && (
                        <mesh position={mid} quaternion={quat}
                          onClick={(ev) => { ev.stopPropagation(); onSketchLineClick?.(ent.id); }}
                          onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
                          onPointerOut={() => { document.body.style.cursor = 'default'; }}>
                          <boxGeometry args={[len, 4, 4]} />
                          <meshBasicMaterial transparent opacity={0} />
                        </mesh>
                      )}
                    </group>
                  );
                }
                if (ent.type === 'circle') {
                  const pts: [number,number,number][] = [];
                  for (let i = 0; i <= 64; i++) {
                    const a = (i / 64) * Math.PI * 2;
                    pts.push([ent.center.x + Math.cos(a) * ent.radius, ent.center.y + Math.sin(a) * ent.radius, 0.02]);
                  }
                  return <Line key={ent.id} points={pts} color="#ef4444" lineWidth={2} />;
                }
                if (ent.type === 'rect') {
                  return (
                    <Line key={ent.id} points={[
                      [ent.origin.x, ent.origin.y, 0.02],
                      [ent.origin.x + ent.width, ent.origin.y, 0.02],
                      [ent.origin.x + ent.width, ent.origin.y + ent.height, 0.02],
                      [ent.origin.x, ent.origin.y + ent.height, 0.02],
                      [ent.origin.x, ent.origin.y, 0.02],
                    ]} color="#ef4444" lineWidth={2} />
                  );
                }
                return null;
              })}
            </group>
          );
        })}
    </group>
  );
}

// ========== Camera & Scene Components ==========

function CameraApi({ apiRef, defaultPos, defaultTarget }: {
  apiRef: React.MutableRefObject<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void }>;
  defaultPos: [number, number, number];
  defaultTarget: [number, number, number];
}) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls);
  apiRef.current.reset = () => {
    camera.position.set(...defaultPos);
    if (controls) { (controls as any).target.set(...defaultTarget); (controls as any).update(); }
  };
  apiRef.current.setFrontalView = () => {
    const [tx, ty, tz] = defaultTarget;
    const dist = Math.max(defaultPos[2] * 1.5, 200);
    camera.position.set(tx, ty, dist);
    if (controls) { (controls as any).target.set(tx, ty, tz); (controls as any).update(); }
  };
  apiRef.current.setViewToFace = (normal: [number,number,number], center: [number,number,number]) => {
    const dist = Math.max(defaultPos[2] * 1.5, 200);
    camera.position.set(center[0] + normal[0] * dist, center[1] + normal[1] * dist, center[2] + normal[2] * dist);
    const n = new THREE.Vector3(...normal);
    let upCandidate = new THREE.Vector3(0, 0, 1);
    if (Math.abs(n.dot(upCandidate)) > 0.9) upCandidate = new THREE.Vector3(0, 1, 0);
    camera.up.copy(upCandidate);
    if (controls) { (controls as any).target.set(...center); (controls as any).update(); }
  };
  return null;
}

function InventorBackground() {
  const { scene } = useThree();
  useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#c8d6e5');
    gradient.addColorStop(1, '#edf1f5');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    scene.background = tex;
  }, [scene]);
  return null;
}

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

// ========== Main Viewer3D Component ==========

interface Viewer3DProps {
  profile: Point2D[];
  thickness: number;
  selectedEdgeId: string | null;
  onEdgeClick: (edgeId: string) => void;
  flanges: Flange[];
  folds?: Fold[];
  interactionMode?: 'edge' | 'sketch' | 'fold' | 'view';
  onFaceClick?: (faceId: string) => void;
  faceSketches?: FaceSketch[];
  selectedSketchLineId?: string | null;
  onSketchLineClick?: (lineId: string) => void;
  children?: React.ReactNode;
  cutouts?: ProfileCutout[];
  kFactor: number;
  // Sketch plane props
  sketchPlaneActive?: boolean;
  sketchFaceId?: string | null;
  sketchFaceOrigin?: Point2D;
  sketchFaceWidth?: number;
  sketchFaceHeight?: number;
  sketchEntities?: FaceSketchEntity[];
  sketchActiveTool?: FaceSketchTool;
  sketchGridSize?: number;
  sketchSnapEnabled?: boolean;
  onSketchAddEntity?: (entity: FaceSketchEntity) => void;
  onSketchUpdateEntity?: (id: string, updates: Partial<FaceSketchEntity>) => void;
  onSketchRemoveEntity?: (id: string) => void;
  sketchSelectedIds?: string[];
  onSketchSelectEntity?: (id: string, multi?: boolean) => void;
  onSketchDeselectAll?: () => void;
  cameraApiRef?: React.MutableRefObject<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void } | null>;
}

export function Viewer3D({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds = [], interactionMode = 'view', onFaceClick,
  faceSketches = [], selectedSketchLineId = null, onSketchLineClick,
  children, cutouts, kFactor,
  sketchPlaneActive, sketchFaceId, sketchFaceOrigin,
  sketchFaceWidth, sketchFaceHeight,
  sketchEntities, sketchActiveTool, sketchGridSize, sketchSnapEnabled,
  onSketchAddEntity, onSketchUpdateEntity, onSketchRemoveEntity, sketchSelectedIds, onSketchSelectEntity, onSketchDeselectAll,
  cameraApiRef,
}: Viewer3DProps) {
  const cameraApi = useRef<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void }>({ reset: () => {}, setFrontalView: () => {}, setViewToFace: () => {} });

  // ── Async model loading from API ──
  const [modelResult, setModelResult] = useState<BuildModelResult | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setModelLoading(true);
      setModelError(null);
      try {
        const result = await buildModel(
          profile, thickness, cutouts ?? [], folds, flanges, faceSketches, kFactor,
        );
        setModelResult(result);
      } catch (err: any) {
        console.error('[API] buildModel failed:', err);
        setModelError(err.message ?? 'Unknown error');
      } finally {
        setModelLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [profile, thickness, cutouts, folds, flanges, faceSketches, kFactor]);

  const bounds = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY);
    return { cx, cy, size };
  }, [profile]);

  const defaultPos: [number, number, number] = [
    bounds.cx + bounds.size * 0.8,
    bounds.cy - bounds.size * 0.8,
    bounds.size * 1.2,
  ];
  const defaultTarget: [number, number, number] = [bounds.cx, bounds.cy, thickness / 2];

  useEffect(() => {
    if (cameraApiRef) cameraApiRef.current = cameraApi.current;
  });

  return (
    <div className="w-full h-full bg-cad-surface relative">
      {/* Loading overlay */}
      {modelLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/30 pointer-events-none">
          <div className="flex items-center gap-2 bg-card/90 border rounded-lg px-4 py-2 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Building model...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {modelError && !modelLoading && (
        <div className="absolute top-3 left-3 z-10 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 max-w-sm">
          <p className="text-xs text-destructive font-medium">API Error</p>
          <p className="text-xs text-destructive/80 mt-0.5">{modelError}</p>
        </div>
      )}

      <Canvas>
        <PerspectiveCamera makeDefault position={defaultPos} fov={45} near={0.1} far={10000} />
        <SceneSetup />
        <CameraApi apiRef={cameraApi} defaultPos={defaultPos} defaultTarget={defaultTarget} />

        <SheetMetalMesh
          profile={profile}
          thickness={thickness}
          selectedEdgeId={selectedEdgeId}
          onEdgeClick={onEdgeClick}
          flanges={flanges}
          folds={folds}
          interactionMode={interactionMode}
          onFaceClick={onFaceClick}
          faceSketches={faceSketches}
          selectedSketchLineId={selectedSketchLineId}
          onSketchLineClick={onSketchLineClick}
          activeSketchFaceId={sketchPlaneActive ? sketchFaceId : null}
          cutouts={cutouts}
          kFactor={kFactor}
          modelResult={modelResult}
          modelLoading={modelLoading}
        />

        {/* Sketch plane when active — uses face registry transforms */}
        {sketchPlaneActive && sketchFaceOrigin && onSketchAddEntity && onSketchRemoveEntity && onSketchSelectEntity && (() => {
          const isFoldFace = sketchFaceId?.startsWith('fold_face_');
          const isFlangeFace = sketchFaceId?.startsWith('flange_face_');

          if (isFoldFace || isFlangeFace) {
            const ft = getFaceTransform(sketchFaceId!);
            if (!ft) return null;
            const m = faceTransformToMatrix4(ft);

            return (
              <group matrixAutoUpdate={false} matrix={m}>
                <FaceSketchPlane
                  faceOrigin={{ x: 0, y: 0 }}
                  faceWidth={sketchFaceWidth!}
                  faceHeight={sketchFaceHeight!}
                  thickness={0}
                  surfaceZ={0.02}
                  worldTransform={m}
                  entities={sketchEntities || []}
                  activeTool={sketchActiveTool || 'line'}
                  gridSize={sketchGridSize || 5}
                  snapEnabled={sketchSnapEnabled ?? true}
                  onAddEntity={onSketchAddEntity}
                  onUpdateEntity={onSketchUpdateEntity}
                  onRemoveEntity={onSketchRemoveEntity}
                  selectedIds={sketchSelectedIds || []}
                  onSelectEntity={onSketchSelectEntity}
                  onDeselectAll={onSketchDeselectAll || (() => {})}
                />
              </group>
            );
          }

          // Base face sketch plane
          return (
            <FaceSketchPlane
              faceOrigin={sketchFaceOrigin!}
              faceWidth={sketchFaceWidth!}
              faceHeight={sketchFaceHeight!}
              thickness={thickness}
              entities={sketchEntities || []}
              activeTool={sketchActiveTool || 'line'}
              gridSize={sketchGridSize || 5}
              snapEnabled={sketchSnapEnabled ?? true}
              onAddEntity={onSketchAddEntity}
              onUpdateEntity={onSketchUpdateEntity}
              onRemoveEntity={onSketchRemoveEntity}
              selectedIds={sketchSelectedIds || []}
              onSelectEntity={onSketchSelectEntity}
              onDeselectAll={onSketchDeselectAll || (() => {})}
            />
          );
        })()}

        <Grid
          args={[500, 500]}
          cellSize={10} cellThickness={0.5} cellColor="#334155"
          sectionSize={50} sectionThickness={1} sectionColor="#475569"
          fadeDistance={300} fadeStrength={1}
          position={[bounds.cx, bounds.cy, -0.01]}
        />

        <OrbitControls makeDefault target={defaultTarget} enableDamping dampingFactor={0.1} />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewcube
            color="#e8ecf0" hoverColor="#c5cad0"
            textColor="#455a64" strokeColor="#90a4ae" opacity={1}
          />
        </GizmoHelper>
      </Canvas>

      <button
        onClick={() => cameraApi.current.reset()}
        className="absolute bottom-[136px] right-[64px] w-8 h-8 flex items-center justify-center rounded bg-card/80 border border-border/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shadow-sm"
        title="Reset to home view"
      >
        <Home className="h-4 w-4" />
      </button>

      {children}
    </div>
  );
}
