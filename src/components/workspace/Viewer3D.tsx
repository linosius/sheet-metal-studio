import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Point2D } from '@/lib/sheetmetal';
import { createBaseFaceMesh, extractEdges, createFlangeMesh, computeBendLinePositions, PartEdge, Flange } from '@/lib/geometry';

interface SheetMetalMeshProps {
  profile: Point2D[];
  thickness: number;
  selectedEdgeId: string | null;
  onEdgeClick: (edgeId: string) => void;
  flanges: Flange[];
}

function FlangeMesh({ edge, flange, thickness }: { edge: PartEdge; flange: Flange; thickness: number }) {
  const geometry = useMemo(
    () => createFlangeMesh(edge, flange, thickness),
    [edge, flange, thickness]
  );
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry]);

  // Compute both bend lines as closed loops around the cross-section
  const bendLines = useMemo(() => {
    const { bendStart, bendEnd } = computeBendLinePositions(edge, flange, thickness);
    const toTuples = (pts: THREE.Vector3[]) =>
      pts.map(p => [p.x, p.y, p.z] as [number, number, number]);
    return {
      start: toTuples(bendStart),
      end: toTuples(bendEnd),
    };
  }, [edge, flange, thickness]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#e8ecf0"
          metalness={0.15}
          roughness={0.6}
          side={THREE.DoubleSide}
          flatShading
        />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color="#475569" linewidth={1} />
      </lineSegments>
      {/* Bend start line (where flat base meets bend arc) */}
      <Line points={bendLines.start} color="#475569" lineWidth={1.5} />
      {/* Bend end line (where bend arc meets flat flange) */}
      <Line points={bendLines.end} color="#475569" lineWidth={1.5} />
    </group>
  );
}

function SheetMetalMesh({ profile, thickness, selectedEdgeId, onEdgeClick, flanges }: SheetMetalMeshProps) {
  const geometry = useMemo(() => createBaseFaceMesh(profile, thickness), [profile, thickness]);
  const edges = useMemo(() => extractEdges(profile, thickness), [profile, thickness]);
  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  // Map edges by id for flange rendering
  const edgeMap = useMemo(() => {
    const map = new Map<string, PartEdge>();
    edges.forEach(e => map.set(e.id, e));
    return map;
  }, [edges]);

  // Edges that already have a flange
  const flangedEdgeIds = useMemo(() => new Set(flanges.map(f => f.edgeId)), [flanges]);

  return (
    <group>
      {/* Solid base face */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#e8ecf0"
          metalness={0.15}
          roughness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Wireframe edges */}
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial color="#475569" linewidth={1} />
      </lineSegments>

      {/* Selectable top edges */}
      {edges.map((edge) => {
        const isSelected = selectedEdgeId === edge.id;
        const hasFlangeOnIt = flangedEdgeIds.has(edge.id);
        const edgeMid = new THREE.Vector3(
          (edge.start.x + edge.end.x) / 2,
          (edge.start.y + edge.end.y) / 2,
          (edge.start.z + edge.end.z) / 2,
        );
        const edgeLen = edge.start.distanceTo(edge.end);
        const edgeDir = new THREE.Vector3().subVectors(edge.end, edge.start).normalize();
        const angle = Math.atan2(edgeDir.y, edgeDir.x);

        const edgeColor = hasFlangeOnIt ? '#22c55e' : isSelected ? '#a855f7' : '#3b82f6';

        return (
          <group key={edge.id}>
            <Line
              points={[
                [edge.start.x, edge.start.y, edge.start.z],
                [edge.end.x, edge.end.y, edge.end.z],
              ]}
              color={edgeColor}
              lineWidth={isSelected ? 3 : 2}
            />

            <mesh
              position={edgeMid}
              rotation={[0, 0, angle]}
              onClick={(e) => {
                e.stopPropagation();
                onEdgeClick(edge.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'default';
              }}
            >
              <boxGeometry args={[edgeLen, 3, 3]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>

            {isSelected && (
              <arrowHelper
                args={[edge.normal, edgeMid, 10, 0xa855f7, 3, 2]}
              />
            )}
          </group>
        );
      })}

      {/* Render flanges */}
      {flanges.map((flange) => {
        const edge = edgeMap.get(flange.edgeId);
        if (!edge) return null;
        return <FlangeMesh key={flange.id} edge={edge} flange={flange} thickness={thickness} />;
      })}
    </group>
  );
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
}

export function Viewer3D({ profile, thickness, selectedEdgeId, onEdgeClick, flanges }: Viewer3DProps) {
  const bounds = useMemo(() => {
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY);
    return { cx, cy, size };
  }, [profile]);

  return (
    <div className="flex-1 bg-cad-surface">
      <Canvas>
        <PerspectiveCamera
          makeDefault
          position={[bounds.cx + bounds.size * 0.8, bounds.cy - bounds.size * 0.8, bounds.size * 1.2]}
          fov={45}
          near={0.1}
          far={10000}
        />
        <SceneSetup />

        <SheetMetalMesh
          profile={profile}
          thickness={thickness}
          selectedEdgeId={selectedEdgeId}
          onEdgeClick={onEdgeClick}
          flanges={flanges}
        />

        <Grid
          args={[500, 500]}
          cellSize={10}
          cellThickness={0.5}
          cellColor="#334155"
          sectionSize={50}
          sectionThickness={1}
          sectionColor="#475569"
          fadeDistance={300}
          fadeStrength={1}
          position={[bounds.cx, bounds.cy, -0.01]}
        />

        <OrbitControls
          target={[bounds.cx, bounds.cy, thickness / 2]}
          enableDamping
          dampingFactor={0.1}
        />

        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
