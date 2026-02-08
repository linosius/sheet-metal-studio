import { useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube, Grid, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Home } from 'lucide-react';
import { Point2D } from '@/lib/sheetmetal';
import {
  createBaseFaceMesh, createFlangeMesh, createFoldMesh, computeBendLinePositions,
  getAllSelectableEdges, PartEdge, Flange, Fold, FaceSketch,
  FaceSketchLine, FaceSketchCircle, FaceSketchRect, FaceSketchEntity,
  classifySketchLineAsFold, isEdgeOnFoldLine,
  getFixedProfile, computeFoldEdge, getFoldParentId,
} from '@/lib/geometry';
import { FaceSketchPlane } from './FaceSketchPlane';

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
}

function FlangeMesh({ edge, flange, thickness, isSketchMode, onFaceClick }: {
  edge: PartEdge; flange: Flange; thickness: number;
  isSketchMode?: boolean; onFaceClick?: (faceId: string) => void;
}) {
  const geometry = useMemo(() => createFlangeMesh(edge, flange, thickness), [edge, flange, thickness]);
  const edgesGeo = useMemo(() => {
    if (!geometry || !geometry.attributes.position || geometry.attributes.position.count === 0) {
      return null;
    }
    return new THREE.EdgesGeometry(geometry, 15);
  }, [geometry]);
  const bendLines = useMemo(() => {
    const { bendStart, bendEnd } = computeBendLinePositions(edge, flange, thickness);
    const toTuples = (pts: THREE.Vector3[]) =>
      pts.map(p => [p.x, p.y, p.z] as [number, number, number]);
    return { start: toTuples(bendStart), end: toTuples(bendEnd) };
  }, [edge, flange, thickness]);

  const flangeFaceId = `flange_face_${flange.id}`;

  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={(e) => {
          if (isSketchMode && onFaceClick) {
            e.stopPropagation();
            onFaceClick(flangeFaceId);
          }
        }}
        onPointerOver={() => { if (isSketchMode) document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { if (isSketchMode) document.body.style.cursor = 'default'; }}
      >
        <meshStandardMaterial color="#e8ecf0" metalness={0.15} roughness={0.6} side={THREE.DoubleSide} flatShading />
      </mesh>
      {edgesGeo && (
        <lineSegments geometry={edgesGeo}>
          <lineBasicMaterial color="#475569" linewidth={1} />
        </lineSegments>
      )}
      <Line points={bendLines.start} color="#475569" lineWidth={1.5} />
      <Line points={bendLines.end} color="#475569" lineWidth={1.5} />
    </group>
  );
}

function FoldMesh({
  profile, fold, otherFolds, thickness, isSketchMode, onFaceClick,
}: {
  profile: Point2D[];
  fold: Fold;
  otherFolds: Fold[];
  thickness: number;
  isSketchMode?: boolean;
  onFaceClick?: (faceId: string) => void;
}) {
  const geometry = useMemo(
    () => createFoldMesh(profile, fold, otherFolds, thickness),
    [profile, fold, otherFolds, thickness],
  );
  const edgesGeo = useMemo(() => {
    if (!geometry || !geometry.attributes.position || geometry.attributes.position.count === 0) {
      return null;
    }
    return new THREE.EdgesGeometry(geometry, 15);
  }, [geometry]);

  const foldFaceId = `fold_face_${fold.id}`;

  if (!geometry) return null;

  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={(e) => {
          if (isSketchMode && onFaceClick) {
            e.stopPropagation();
            onFaceClick(foldFaceId);
          }
        }}
        onPointerOver={() => { if (isSketchMode) document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { if (isSketchMode) document.body.style.cursor = 'default'; }}
      >
        <meshStandardMaterial color="#e8ecf0" metalness={0.15} roughness={0.6} side={THREE.DoubleSide} flatShading />
      </mesh>
      {edgesGeo && (
        <lineSegments geometry={edgesGeo}>
          <lineBasicMaterial color="#475569" linewidth={1} />
        </lineSegments>
      )}
    </group>
  );
}

function SketchLine3D({
  line, profile, thickness, isSelected, hasFold, isFoldMode, isFoldQualified, onSketchLineClick,
}: {
  line: FaceSketchLine;
  profile: Point2D[];
  thickness: number;
  isSelected: boolean;
  hasFold: boolean;
  isFoldMode: boolean;
  isFoldQualified: boolean;
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
        dashed
        dashSize={2}
        gapSize={1}
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

function SheetMetalMesh({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds, interactionMode, onFaceClick,
  faceSketches, selectedSketchLineId, onSketchLineClick,
  activeSketchFaceId,
}: SheetMetalMeshProps) {
  const fixedProfile = useMemo(() => getFixedProfile(profile, folds), [profile, folds]);
  const geometry = useMemo(() => createBaseFaceMesh(fixedProfile, thickness), [fixedProfile, thickness]);
  const edges = useMemo(
    () => getAllSelectableEdges(profile, thickness, flanges, folds),
    [profile, thickness, flanges, folds],
  );
  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  const edgeMap = useMemo(() => {
    const map = new Map<string, PartEdge>();
    edges.forEach(e => map.set(e.id, e));
    return map;
  }, [edges]);

  const flangedEdgeIds = useMemo(() => new Set(flanges.map(f => f.edgeId)), [flanges]);

  const foldLineEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    folds.forEach(fold => ids.add(`fold_edge_${fold.id}`));
    // Also mark fixed profile edges that geometrically correspond to fold lines
    for (const edge of edges) {
      if (isEdgeOnFoldLine(edge, folds, profile)) {
        ids.add(edge.id);
      }
    }
    return ids;
  }, [folds, edges, profile]);

  // Only render base face entities in 3D (fold face entities need separate transform)
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

  const isSketchMode = interactionMode === 'sketch';
  const isFoldMode = interactionMode === 'fold';
  const isEdgeMode = interactionMode === 'edge';

  return (
    <group>
      {/* Solid base face */}
      <mesh
        geometry={geometry}
        onClick={(e) => {
          if (isSketchMode && onFaceClick) {
            e.stopPropagation();
            onFaceClick(e.point.z > thickness * 0.5 ? 'base_top' : 'base_bot');
          }
        }}
        onPointerOver={() => { if (isSketchMode) document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { if (isSketchMode) document.body.style.cursor = 'default'; }}
      >
        <meshStandardMaterial color="#e8ecf0" metalness={0.15} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Wireframe edges */}
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial color="#475569" linewidth={1} />
      </lineSegments>

      {/* Selectable edges (visible in edge mode, fold-line edges always visible) */}
      {edges.map((edge) => {
        const isSelected = selectedEdgeId === edge.id;
        const hasFlangeOnIt = flangedEdgeIds.has(edge.id);
        const isFoldLine = foldLineEdgeIds.has(edge.id);
        const edgeMid = new THREE.Vector3(
          (edge.start.x + edge.end.x) / 2,
          (edge.start.y + edge.end.y) / 2,
          (edge.start.z + edge.end.z) / 2,
        );
        const edgeLen = edge.start.distanceTo(edge.end);
        const edgeDir = new THREE.Vector3().subVectors(edge.end, edge.start).normalize();
        const edgeQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), edgeDir);

        const isInnerTip = edge.id.includes('_tip_inner_');
        const edgeColor = isFoldLine
          ? '#ef4444'
          : hasFlangeOnIt ? '#22c55e'
          : isSelected ? '#a855f7'
          : isInnerTip ? '#f59e0b'
          : '#3b82f6';

        // Only show colored edge highlights in edge mode (or fold-line edges always)
        const showEdgeLine = isEdgeMode || isFoldLine;

        return (
          <group key={edge.id}>
            {showEdgeLine && (
              <Line
                points={[
                  [edge.start.x, edge.start.y, edge.start.z],
                  [edge.end.x, edge.end.y, edge.end.z],
                ]}
                color={edgeColor}
                lineWidth={isSelected ? 3 : isFoldLine ? 2.5 : 2}
              />
            )}

            {isEdgeMode && (
              <mesh
                position={edgeMid}
                quaternion={edgeQuat}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdgeClick(edge.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = 'pointer';
                }}
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

      {/* Render sketch lines on 3D faces (hide lines that already have folds) */}
      {(isFoldMode || isSketchMode) && allLines.filter(line => !foldedLineIds.has(line.id)).map(line => {
        const classification = classifySketchLineAsFold(line, faceBounds.width, faceBounds.height);
        return (
          <SketchLine3D
            key={line.id}
            line={line}
            profile={profile}
            thickness={thickness}
            isSelected={selectedSketchLineId === line.id}
            hasFold={false}
            isFoldMode={isFoldMode}
            isFoldQualified={!!classification}
            onSketchLineClick={onSketchLineClick}
          />
        );
      })}

      {/* Render sketch circles on 3D faces */}
      {(isFoldMode || isSketchMode) && allCircles.map(entity => (
        <SketchCircle3D key={entity.id} entity={entity} profile={profile} thickness={thickness} />
      ))}

      {/* Render sketch rects on 3D faces */}
      {(isFoldMode || isSketchMode) && allRects.map(entity => (
        <SketchRect3D key={entity.id} entity={entity} profile={profile} thickness={thickness} />
      ))}

      {/* Render flanges */}
      {flanges.map((flange) => {
        const edge = edgeMap.get(flange.edgeId);
        if (!edge) return null;
        return (
          <FlangeMesh
            key={flange.id}
            edge={edge}
            flange={flange}
            thickness={thickness}
            isSketchMode={isSketchMode}
            onFaceClick={onFaceClick}
          />
        );
      })}

      {/* Render folds — child folds get parent's bend transform applied */}
      {folds.map((fold, i) => {
        const parentId = getFoldParentId(fold, folds, profile);
        const parentFold = parentId ? folds.find(f => f.id === parentId) : null;

        const mesh = (
          <FoldMesh
            profile={profile}
            fold={fold}
            otherFolds={folds.filter((_, j) => j !== i)}
            thickness={thickness}
            isSketchMode={isSketchMode}
            onFaceClick={onFaceClick}
          />
        );

        if (parentFold) {
          const parentEdge = computeFoldEdge(profile, thickness, parentFold);
          const pivot = parentEdge.start;
          const axis = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();
          const angleRad = (parentFold.direction === 'up' ? -1 : 1) * (parentFold.angle * Math.PI / 180);
          const quat = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);

          return (
            <group key={fold.id} position={[pivot.x, pivot.y, pivot.z]} quaternion={quat}>
              <group position={[-pivot.x, -pivot.y, -pivot.z]}>
                {mesh}
              </group>
            </group>
          );
        }

        return <group key={fold.id}>{mesh}</group>;
      })}
    </group>
  );
}

function CameraApi({ apiRef, defaultPos, defaultTarget }: {
  apiRef: React.MutableRefObject<{ reset: () => void }>;
  defaultPos: [number, number, number];
  defaultTarget: [number, number, number];
}) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls);
  apiRef.current.reset = () => {
    camera.position.set(...defaultPos);
    if (controls) {
      (controls as any).target.set(...defaultTarget);
      (controls as any).update();
    }
  };
  return null;
}

function SceneSetup() {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[50, 50, 50]} intensity={0.8} />
      <directionalLight position={[-30, -20, 40]} intensity={0.4} />
    </>
  );
}

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
  // Sketch plane props
  sketchPlaneActive?: boolean;
  sketchFaceId?: string | null;
  sketchFaceOrigin?: Point2D;
  sketchFaceWidth?: number;
  sketchFaceHeight?: number;
  sketchEntities?: FaceSketchEntity[];
  sketchActiveTool?: 'select' | 'line' | 'circle' | 'rect';
  sketchGridSize?: number;
  sketchSnapEnabled?: boolean;
  onSketchAddEntity?: (entity: FaceSketchEntity) => void;
  onSketchRemoveEntity?: (id: string) => void;
  sketchSelectedIds?: string[];
  onSketchSelectEntity?: (id: string) => void;
}

export function Viewer3D({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds = [], interactionMode = 'view', onFaceClick,
  faceSketches = [], selectedSketchLineId = null, onSketchLineClick,
  children,
  sketchPlaneActive, sketchFaceId, sketchFaceOrigin,
  sketchFaceWidth, sketchFaceHeight,
  sketchEntities, sketchActiveTool, sketchGridSize, sketchSnapEnabled,
  onSketchAddEntity, onSketchRemoveEntity, sketchSelectedIds, onSketchSelectEntity,
}: Viewer3DProps) {
  const cameraApi = useRef({ reset: () => {} });

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

  return (
    <div className="flex-1 bg-cad-surface relative">
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
        />

        {/* Sketch plane when active */}
        {sketchPlaneActive && sketchFaceOrigin && onSketchAddEntity && onSketchRemoveEntity && onSketchSelectEntity && (() => {
          const isFoldFace = sketchFaceId?.startsWith('fold_face_');
          const isFlangeFace = sketchFaceId?.startsWith('flange_face_');
          
          if (isFoldFace) {
            const foldId = sketchFaceId!.replace('fold_face_', '');
            const fold = folds.find(f => f.id === foldId);
            if (!fold) return null;
            
            const foldEdge = computeFoldEdge(profile, thickness, fold);
            const tangent = new THREE.Vector3().subVectors(foldEdge.end, foldEdge.start).normalize();
            const normal = foldEdge.normal.clone();
            const dSign = fold.direction === 'up' ? 1 : -1;
            const angleRad = fold.angle * Math.PI / 180;
            
            const q = new THREE.Quaternion().setFromAxisAngle(tangent, -dSign * angleRad);
            const bentNormal = normal.clone().applyQuaternion(q);
            const bentUp = new THREE.Vector3(0, 0, dSign).applyQuaternion(q);
            
            const m = new THREE.Matrix4();
            m.makeBasis(tangent, bentNormal, bentUp);
            m.setPosition(foldEdge.start);
            
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
                  onRemoveEntity={onSketchRemoveEntity}
                  selectedIds={sketchSelectedIds || []}
                  onSelectEntity={onSketchSelectEntity}
                />
              </group>
            );
          }

          if (isFlangeFace) {
            const flangeId = sketchFaceId!.replace('flange_face_', '');
            const flange = flanges.find(f => f.id === flangeId);
            if (!flange) return null;

            // Find the parent edge for this flange
            const allEdges = getAllSelectableEdges(profile, thickness, flanges, folds);
            const parentEdge = allEdges.find(e => e.id === flange.edgeId);
            if (!parentEdge) return null;

            const bendAngleRad = (flange.angle * Math.PI) / 180;
            const dirSign = flange.direction === 'up' ? 1 : -1;
            const R = flange.bendRadius;

            const uDir = parentEdge.normal.clone().normalize();
            const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);
            const edgeDir = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();

            // Arc end position (inner surface)
            const sinA = Math.sin(bendAngleRad);
            const cosA = Math.cos(bendAngleRad);
            const arcEndU = R * sinA;
            const arcEndW = R * (1 - cosA);

            // Tangent direction at end of arc (flat extension direction)
            const flangeExtDir = uDir.clone().multiplyScalar(cosA).add(wDir.clone().multiplyScalar(sinA)).normalize();
            // Surface normal of the flange (perpendicular to flange surface)
            const flangeSurfaceNormal = uDir.clone().multiplyScalar(sinA).add(wDir.clone().multiplyScalar(-cosA)).normalize();

            // Origin of the flange flat surface (at arc end, inner surface)
            const flangeOrigin = parentEdge.start.clone()
              .add(uDir.clone().multiplyScalar(arcEndU))
              .add(wDir.clone().multiplyScalar(arcEndW + 0.01));

            // Build transform: X=edgeDir, Y=flangeExtDir, Z=flangeSurfaceNormal
            const m = new THREE.Matrix4();
            m.makeBasis(edgeDir, flangeExtDir, flangeSurfaceNormal);
            m.setPosition(flangeOrigin);

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
                  onRemoveEntity={onSketchRemoveEntity}
                  selectedIds={sketchSelectedIds || []}
                  onSelectEntity={onSketchSelectEntity}
                />
              </group>
            );
          }
          
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
              onRemoveEntity={onSketchRemoveEntity}
              selectedIds={sketchSelectedIds || []}
              onSelectEntity={onSketchSelectEntity}
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
