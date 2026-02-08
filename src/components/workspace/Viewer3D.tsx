import { useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube, Grid, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Home } from 'lucide-react';
import { Point2D } from '@/lib/sheetmetal';
import {
  createBaseFaceMesh, createFlangeMesh, computeBendLinePositions,
  getAllSelectableEdges, PartEdge, Flange, Fold, FaceSketch,
  computeFoldEdge, getFixedProfile, getFoldMovingHeight,
} from '@/lib/geometry';

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
}

function FlangeMesh({ edge, flange, thickness }: { edge: PartEdge; flange: Flange; thickness: number }) {
  const geometry = useMemo(() => createFlangeMesh(edge, flange, thickness), [edge, flange, thickness]);
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry]);
  const bendLines = useMemo(() => {
    const { bendStart, bendEnd } = computeBendLinePositions(edge, flange, thickness);
    const toTuples = (pts: THREE.Vector3[]) =>
      pts.map(p => [p.x, p.y, p.z] as [number, number, number]);
    return { start: toTuples(bendStart), end: toTuples(bendEnd) };
  }, [edge, flange, thickness]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#e8ecf0" metalness={0.15} roughness={0.6} side={THREE.DoubleSide} flatShading />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color="#475569" linewidth={1} />
      </lineSegments>
      <Line points={bendLines.start} color="#475569" lineWidth={1.5} />
      <Line points={bendLines.end} color="#475569" lineWidth={1.5} />
    </group>
  );
}

function FoldMesh({
  profile, fold, thickness, isSketchMode, onFaceClick,
}: {
  profile: Point2D[];
  fold: Fold;
  thickness: number;
  isSketchMode?: boolean;
  onFaceClick?: (faceId: string) => void;
}) {
  const foldEdge = useMemo(() => computeFoldEdge(profile, thickness, fold), [profile, thickness, fold]);
  const movingHeight = useMemo(() => getFoldMovingHeight(profile, fold), [profile, fold]);

  const virtualFlange: Flange = useMemo(() => ({
    id: `fold_${fold.id}`,
    edgeId: foldEdge.id,
    height: movingHeight,
    angle: fold.angle,
    direction: 'up',
    bendRadius: fold.bendRadius,
  }), [fold, foldEdge, movingHeight]);

  const geometry = useMemo(
    () => createFlangeMesh(foldEdge, virtualFlange, thickness),
    [foldEdge, virtualFlange, thickness],
  );
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry]);
  const bendLines = useMemo(() => {
    const { bendStart, bendEnd } = computeBendLinePositions(foldEdge, virtualFlange, thickness);
    const toTuples = (pts: THREE.Vector3[]) =>
      pts.map(p => [p.x, p.y, p.z] as [number, number, number]);
    return { start: toTuples(bendStart), end: toTuples(bendEnd) };
  }, [foldEdge, virtualFlange, thickness]);

  const foldFaceId = `fold_face_${fold.id}`;

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
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color="#475569" linewidth={1} />
      </lineSegments>
      <Line points={bendLines.start} color="#475569" lineWidth={1.5} />
      <Line points={bendLines.end} color="#475569" lineWidth={1.5} />
    </group>
  );
}

function SketchLine3D({
  line, profile, thickness, isSelected, hasFold, isFoldMode, onSketchLineClick,
}: {
  line: { id: string; axis: 'x' | 'y'; dimension: number };
  profile: Point2D[];
  thickness: number;
  isSelected: boolean;
  hasFold: boolean;
  isFoldMode: boolean;
  onSketchLineClick?: (id: string) => void;
}) {
  const positions = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const z = thickness + 0.05;

    if (line.axis === 'x') {
      const y = minY + line.dimension;
      return {
        start: [minX, y, z] as [number, number, number],
        end: [maxX, y, z] as [number, number, number],
      };
    } else {
      const x = minX + line.dimension;
      return {
        start: [x, minY, z] as [number, number, number],
        end: [x, maxY, z] as [number, number, number],
      };
    }
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
          <boxGeometry args={[length, 3, 3]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

function SheetMetalMesh({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds, interactionMode, onFaceClick,
  faceSketches, selectedSketchLineId, onSketchLineClick,
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
    folds.forEach(fold => {
      const idx = fold.axis === 'x' ? 2 : 1;
      ids.add(`edge_top_${idx}`);
      ids.add(`edge_bot_${idx}`);
      // Also block the virtual fold edge itself
      ids.add(`fold_edge_${fold.id}`);
    });
    return ids;
  }, [folds]);

  const allSketchLines = useMemo(() =>
    faceSketches.flatMap(fs => fs.lines),
    [faceSketches],
  );

  const foldedLineIds = useMemo(() =>
    new Set(folds.filter(f => f.sketchLineId).map(f => f.sketchLineId!)),
    [folds],
  );

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

      {/* Selectable edges (edge mode only) */}
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

        return (
          <group key={edge.id}>
            <Line
              points={[
                [edge.start.x, edge.start.y, edge.start.z],
                [edge.end.x, edge.end.y, edge.end.z],
              ]}
              color={edgeColor}
              lineWidth={isSelected ? 3 : isFoldLine ? 2.5 : 2}
            />

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

      {/* Render sketch lines on 3D faces (fold & sketch modes) */}
      {(isFoldMode || isSketchMode) && allSketchLines.map(line => (
        <SketchLine3D
          key={line.id}
          line={line}
          profile={profile}
          thickness={thickness}
          isSelected={selectedSketchLineId === line.id}
          hasFold={foldedLineIds.has(line.id)}
          isFoldMode={isFoldMode}
          onSketchLineClick={onSketchLineClick}
        />
      ))}

      {/* Render flanges */}
      {flanges.map((flange) => {
        const edge = edgeMap.get(flange.edgeId);
        if (!edge) return null;
        return <FlangeMesh key={flange.id} edge={edge} flange={flange} thickness={thickness} />;
      })}

      {/* Render folds */}
      {folds.map((fold) => (
        <FoldMesh
          key={fold.id}
          profile={profile}
          fold={fold}
          thickness={thickness}
          isSketchMode={isSketchMode}
          onFaceClick={onFaceClick}
        />
      ))}
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
}

export function Viewer3D({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds = [], interactionMode = 'view', onFaceClick,
  faceSketches = [], selectedSketchLineId = null, onSketchLineClick,
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
        />

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
    </div>
  );
}
