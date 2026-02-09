import { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube, Grid, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Home } from 'lucide-react';
import { Point2D } from '@/lib/sheetmetal';
import {
  createBaseFaceMesh, createFlangeMesh, createFoldMesh, computeBendLinePositions,
  computeFoldBendLines,
  getAllSelectableEdges, PartEdge, Flange, Fold, FaceSketch,
  FaceSketchLine, FaceSketchCircle, FaceSketchRect, FaceSketchEntity, FaceSketchTool,
  classifySketchLineAsFold, isEdgeOnFoldLine,
  getFixedProfile, computeFoldEdge, getFoldParentId, getFoldNormal,
  isBaseFaceFold, makeVirtualProfile, computeFlangeFaceTransform, computeFoldFaceTransform,
  getFaceDimensions, FlangeTipClipLine,
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
  cutouts?: { center: Point2D; radius: number }[];
}

const noopRaycast = () => {};

function FlangeMesh({ edge, flange, thickness, isSketchMode, isFoldMode, onFaceClick, showLines = true, activeSketchFaceId, childFolds }: {
  edge: PartEdge; flange: Flange; thickness: number;
  isSketchMode?: boolean; isFoldMode?: boolean; onFaceClick?: (faceId: string) => void;
  showLines?: boolean; activeSketchFaceId?: string | null;
  childFolds?: Fold[];
}) {
  const isActiveSketch = activeSketchFaceId === `flange_face_${flange.id}`;
  const [hovered, setHovered] = useState(false);

  // Build clip lines from child folds for tip clipping
  const clipLines = useMemo((): FlangeTipClipLine[] | undefined => {
    if (!childFolds || childFolds.length === 0) return undefined;
    const edgeLen = edge.start.distanceTo(edge.end);
    return childFolds.map(cf => {
      const normal = getFoldNormal(cf, edgeLen, flange.height);
      return {
        lineStart: cf.lineStart,
        lineEnd: cf.lineEnd,
        normal,
      };
    });
  }, [childFolds, edge, flange.height]);

  const geometry = useMemo(() => createFlangeMesh(edge, flange, thickness, clipLines), [edge, flange, thickness, clipLines]);
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
        userData={{ faceId: flangeFaceId }}
        raycast={(isActiveSketch || isFoldMode) ? noopRaycast as any : undefined}
        onClick={(e) => {
          if (isSketchMode && onFaceClick) {
            e.stopPropagation();
            onFaceClick(flangeFaceId);
          }
        }}
        onPointerOver={(e) => {
          if (isSketchMode) {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
            setHovered(true);
          }
        }}
        onPointerOut={() => {
          if (isSketchMode) {
            document.body.style.cursor = 'default';
            setHovered(false);
          }
        }}
      >
        <meshStandardMaterial
          color={isSketchMode && hovered ? '#93c5fd' : '#bcc2c8'}
          metalness={0.12} roughness={0.55} side={THREE.DoubleSide}
        />
      </mesh>
      {showLines && edgesGeo && (
        <lineSegments geometry={edgesGeo}>
          <lineBasicMaterial color="#475569" linewidth={1} />
        </lineSegments>
      )}
      {showLines && <Line points={bendLines.start} color="#475569" lineWidth={1.5} />}
      {showLines && <Line points={bendLines.end} color="#475569" lineWidth={1.5} />}
    </group>
  );
}

function FoldMesh({
  profile, fold, otherFolds, thickness, isSketchMode, isFoldMode, onFaceClick, showLines = true, activeSketchFaceId,
  childFolds,
}: {
  profile: Point2D[];
  fold: Fold;
  otherFolds: Fold[];
  thickness: number;
  isSketchMode?: boolean;
  isFoldMode?: boolean;
  onFaceClick?: (faceId: string) => void;
  showLines?: boolean;
  activeSketchFaceId?: string | null;
  childFolds?: Fold[];
}) {
  const isActiveSketch = activeSketchFaceId === `fold_face_${fold.id}`;
  const [hovered, setHovered] = useState(false);
  const result = useMemo(
    () => createFoldMesh(profile, fold, otherFolds, thickness, childFolds),
    [profile, fold, otherFolds, thickness, childFolds],
  );

  const tipEdgesGeo = useMemo(() => {
    if (!result?.tip || !result.tip.attributes.position || result.tip.attributes.position.count === 0) {
      return null;
    }
    return new THREE.EdgesGeometry(result.tip, 15);
  }, [result]);

  const bendLines = useMemo(() => {
    const { bendStart, bendEnd } = computeFoldBendLines(profile, fold, thickness);
    const toTuples = (pts: THREE.Vector3[]) =>
      pts.map(p => [p.x, p.y, p.z] as [number, number, number]);
    return { start: toTuples(bendStart), end: toTuples(bendEnd) };
  }, [profile, fold, thickness]);

  const foldFaceId = `fold_face_${fold.id}`;

  if (!result) return null;

  const handleClick = (e: any) => {
    if (isSketchMode && onFaceClick) {
      e.stopPropagation();
      onFaceClick(foldFaceId);
    }
  };

  const handlePointerOver = (e: any) => {
    if (isSketchMode) {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
      setHovered(true);
    }
  };

  const handlePointerOut = () => {
    if (isSketchMode) {
      document.body.style.cursor = 'default';
      setHovered(false);
    }
  };

  const matColor = isSketchMode && hovered ? '#93c5fd' : '#bcc2c8';

  return (
    <group>
      {/* Arc (bend zone) */}
      <mesh
        geometry={result.arc}
        userData={{ faceId: foldFaceId }}
        raycast={(isActiveSketch || isFoldMode) ? noopRaycast as any : undefined}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <meshStandardMaterial color={matColor} metalness={0.12} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      {/* Tip (flat faces) */}
      <mesh
        geometry={result.tip}
        userData={{ faceId: foldFaceId }}
        raycast={(isActiveSketch || isFoldMode) ? noopRaycast as any : undefined}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <meshStandardMaterial color={matColor} metalness={0.12} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      {showLines && tipEdgesGeo && (
        <lineSegments geometry={tipEdgesGeo}>
          <lineBasicMaterial color="#475569" linewidth={1} />
        </lineSegments>
      )}
      {showLines && bendLines.start.length > 0 && <Line points={bendLines.start} color="#475569" lineWidth={1.5} />}
      {showLines && bendLines.end.length > 0 && <Line points={bendLines.end} color="#475569" lineWidth={1.5} />}
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
  activeSketchFaceId, cutouts,
}: SheetMetalMeshProps) {
  const fixedProfile = useMemo(() => getFixedProfile(profile, folds, thickness), [profile, folds, thickness]);
  const geometry = useMemo(() => createBaseFaceMesh(fixedProfile, thickness, cutouts), [fixedProfile, thickness, cutouts]);
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

  const baseFolds = useMemo(() => folds.filter(f => isBaseFaceFold(f)), [folds]);
  const nonBaseFolds = useMemo(() => folds.filter(f => !isBaseFaceFold(f)), [folds]);

  const nonSelectableEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    // Mark explicit fold edges (base folds only)
    baseFolds.forEach(fold => ids.add(`fold_edge_${fold.id}`));
    // Mark fixed profile edges that geometrically correspond to fold lines
    for (const edge of edges) {
      if (isEdgeOnFoldLine(edge, baseFolds, profile)) {
        ids.add(edge.id);
      }
    }
    // Mark fold side and tip edges (not useful for flanges on base face)
    for (const edge of edges) {
      if (edge.id.includes('_side_s_fold_') || edge.id.includes('_side_e_fold_') ||
          edge.id.includes('_tip_outer_fold_') || edge.id.includes('_tip_inner_fold_')) {
        ids.add(edge.id);
      }
    }
    // Mark edges that are collinear with any base fold's inner edge
    for (const fold of baseFolds) {
      const foldEdge = computeFoldEdge(profile, thickness, fold);
      const foldDir = new THREE.Vector3().subVectors(foldEdge.end, foldEdge.start).normalize();
      for (const edge of edges) {
        if (ids.has(edge.id)) continue;
        const edgeDir = new THREE.Vector3().subVectors(edge.end, edge.start).normalize();
        const cross = Math.abs(foldDir.x * edgeDir.y - foldDir.y * edgeDir.x);
        if (cross > 0.05) continue;
        const mid = edge.start.clone().add(edge.end).multiplyScalar(0.5);
        const toMid = new THREE.Vector3().subVectors(mid, foldEdge.start);
        const perpDist = Math.abs(toMid.x * (-foldDir.y) + toMid.y * foldDir.x);
        if (perpDist < 1.5) {
          ids.add(edge.id);
        }
      }
    }
    return ids;
  }, [baseFolds, edges, profile, thickness]);

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

  const [baseFaceHovered, setBaseFaceHovered] = useState(false);

  const isSketchMode = interactionMode === 'sketch';
  const isFoldMode = interactionMode === 'fold';
  const isEdgeMode = interactionMode === 'edge';
  const isViewMode = interactionMode === 'view';

  return (
    <group>
      {/* Solid base face */}
      <mesh
        geometry={geometry}
        userData={{ faceType: 'base' }}
        raycast={(activeSketchFaceId === 'base_top' || activeSketchFaceId === 'base_bot' || isFoldMode) ? noopRaycast as any : undefined}
        onClick={(e) => {
          if (isSketchMode && onFaceClick) {
            // Skip if a fold/flange face was hit closer
            const closest = e.intersections[0];
            if (closest && closest.object.userData?.faceId) return;
            e.stopPropagation();
            onFaceClick(e.point.z > thickness * 0.5 ? 'base_top' : 'base_bot');
          }
        }}
        onPointerOver={(e) => {
          if (isSketchMode) {
            // Don't highlight if a fold/flange face is closer
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
          color={isSketchMode && baseFaceHovered ? '#93c5fd' : '#bcc2c8'}
          metalness={0.12} roughness={0.55} side={THREE.DoubleSide}
        />
      </mesh>

      {/* Wireframe edges — only in sketch/fold mode, hidden in view and edge mode */}
      {!isViewMode && !isEdgeMode && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color="#475569" linewidth={1} />
        </lineSegments>
      )}

      {/* Selectable edges (visible in edge mode, fold-line edges always visible) */}
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
        const edgeColor = isFoldLine
          ? '#ef4444'
          : hasFlangeOnIt ? '#22c55e'
          : isSelected ? '#a855f7'
          : isInnerTip ? '#f59e0b'
          : '#3b82f6';

        // Only show colored edge highlights in edge mode, hide fold-line edges (not actionable)
        const showEdgeLine = isEdgeMode && !isFoldLine;

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

            {isEdgeMode && !isFoldLine && (
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

      {/* Render saved sketch entities on fold faces */}
      {(isFoldMode || isSketchMode) && faceSketches
        .filter(fs => fs.faceId.startsWith('fold_face_') && fs.faceId !== activeSketchFaceId)
        .map(fs => {
          const foldId = fs.faceId.replace('fold_face_', '');
          const fold = folds.find(f => f.id === foldId);
          if (!fold) return null;

          const foldEdge = computeFoldEdge(profile, thickness, fold);
          const tangent = new THREE.Vector3().subVectors(foldEdge.end, foldEdge.start).normalize();
          const normal = foldEdge.normal.clone();
          const dSign = fold.direction === 'up' ? 1 : -1;
          const angleRad = fold.angle * Math.PI / 180;
          const q = new THREE.Quaternion().setFromAxisAngle(tangent, dSign * angleRad);
          const bentNormal = normal.clone().applyQuaternion(q);
          const bentUp = new THREE.Vector3(0, 0, dSign).applyQuaternion(q);

          const m = new THREE.Matrix4();
          m.makeBasis(tangent, bentNormal, bentUp);
          m.setPosition(foldEdge.start.clone().add(bentUp.clone().multiplyScalar(thickness)));

          return (
            <group key={fs.faceId} matrixAutoUpdate={false} matrix={m}>
              {fs.entities.map(ent => {
                if (ent.type === 'line') {
                  const s = new THREE.Vector3(ent.start.x, ent.start.y, 0.02);
                  const e = new THREE.Vector3(ent.end.x, ent.end.y, 0.02);
                  const mid = s.clone().add(e).multiplyScalar(0.5);
                  const dir = new THREE.Vector3().subVectors(e, s).normalize();
                  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
                  const len = s.distanceTo(e);
                  const hasFoldOnIt = folds.some(f => f.sketchLineId === ent.id);
                  const color = hasFoldOnIt ? '#22c55e' : '#ef4444';
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

      {/* Render saved sketch entities on flange faces */}
      {(isFoldMode || isSketchMode) && faceSketches
        .filter(fs => fs.faceId.startsWith('flange_face_') && fs.faceId !== activeSketchFaceId)
        .map(fs => {
          const flangeId = fs.faceId.replace('flange_face_', '');
          const flange = flanges.find(f => f.id === flangeId);
          if (!flange) return null;

          const parentEdge = edges.find(e => e.id === flange.edgeId);
          if (!parentEdge) return null;

          const bendAngleRad = (flange.angle * Math.PI) / 180;
          const dirSign = flange.direction === 'up' ? 1 : -1;
          const R = flange.bendRadius;
          const uDir = parentEdge.normal.clone().normalize();
          const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);
          const edgeDir = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();

          const sinA = Math.sin(bendAngleRad);
          const cosA = Math.cos(bendAngleRad);
          const arcEndU = R * sinA;
          const arcEndW = R * (1 - cosA);

          const flangeExtDir = uDir.clone().multiplyScalar(cosA).add(wDir.clone().multiplyScalar(sinA)).normalize();
          const flangeSurfaceNormal = uDir.clone().multiplyScalar(sinA).add(wDir.clone().multiplyScalar(-cosA)).normalize();

          const flangeOrigin = parentEdge.start.clone()
            .add(uDir.clone().multiplyScalar(arcEndU))
            .add(wDir.clone().multiplyScalar(arcEndW))
            .add(flangeSurfaceNormal.clone().multiplyScalar(thickness));

          const m = new THREE.Matrix4();
          m.makeBasis(edgeDir, flangeExtDir, flangeSurfaceNormal);
          m.setPosition(flangeOrigin);

          return (
            <group key={fs.faceId} matrixAutoUpdate={false} matrix={m}>
              {fs.entities.map(ent => {
                if (ent.type === 'line') {
                  const s = new THREE.Vector3(ent.start.x, ent.start.y, 0.02);
                  const e = new THREE.Vector3(ent.end.x, ent.end.y, 0.02);
                  const mid = s.clone().add(e).multiplyScalar(0.5);
                  const dir = new THREE.Vector3().subVectors(e, s).normalize();
                  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
                  const len = s.distanceTo(e);
                  const hasFoldOnIt = folds.some(f => f.sketchLineId === ent.id);
                  const color = hasFoldOnIt ? '#22c55e' : '#ef4444';
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

      {/* Render flanges */}
      {flanges.map((flange) => {
        const edge = edgeMap.get(flange.edgeId);
        if (!edge) return null;
        const flangeChildFolds = nonBaseFolds.filter(f => f.faceId === `flange_face_${flange.id}`);
        return (
          <FlangeMesh
            key={flange.id}
            edge={edge}
            flange={flange}
            thickness={thickness}
            isSketchMode={isSketchMode}
            isFoldMode={isFoldMode}
            onFaceClick={onFaceClick}
            showLines={!isViewMode && !isEdgeMode}
            activeSketchFaceId={activeSketchFaceId}
            childFolds={flangeChildFolds.length > 0 ? flangeChildFolds : undefined}
          />
        );
      })}

      {/* Render base-face folds — child folds get parent's bend transform applied */}
      {baseFolds.map((fold, i) => {
        const parentId = getFoldParentId(fold, folds, profile);
        const parentFold = parentId ? folds.find(f => f.id === parentId) : null;
        const foldChildFolds = nonBaseFolds.filter(f => f.faceId === `fold_face_${fold.id}`);

        const mesh = (
          <FoldMesh
            profile={profile}
            fold={fold}
            otherFolds={baseFolds.filter((_, j) => j !== i)}
            thickness={thickness}
            isSketchMode={isSketchMode}
            isFoldMode={isFoldMode}
            onFaceClick={onFaceClick}
            showLines={!isViewMode && !isEdgeMode}
            activeSketchFaceId={activeSketchFaceId}
            childFolds={foldChildFolds.length > 0 ? foldChildFolds : undefined}
          />
        );

        if (parentFold) {
          const parentEdge = computeFoldEdge(profile, thickness, parentFold);
          const axis = new THREE.Vector3().subVectors(parentEdge.end, parentEdge.start).normalize();
          const R = parentFold.bendRadius;

          const pivot = parentEdge.start.clone().add(
            parentEdge.faceNormal.clone().multiplyScalar(R)
          );

          const crossUW = new THREE.Vector3().crossVectors(parentEdge.normal, parentEdge.faceNormal);
          const signFactor = Math.sign(crossUW.dot(axis));
          const angleRad = signFactor * (parentFold.angle * Math.PI / 180);
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

      {/* Render non-base-face folds with virtual profile + transform */}
      {nonBaseFolds.map((fold) => {
        const faceId = fold.faceId!;
        const faceDims = getFaceDimensions(faceId, profile, thickness, flanges, folds);
        if (!faceDims) return null;

        const virtualProfile = makeVirtualProfile(faceDims.width, faceDims.height);

        // Compute transform from virtual XY space to world coordinates
        let transform: THREE.Matrix4 | null = null;
        if (faceId.startsWith('flange_face_')) {
          const flangeId = faceId.replace('flange_face_', '');
          const flange = flanges.find(f => f.id === flangeId);
          if (!flange) return null;
          const parentEdge = edges.find(e => e.id === flange.edgeId);
          if (!parentEdge) return null;
          transform = computeFlangeFaceTransform(parentEdge, flange, thickness);
        } else if (faceId.startsWith('fold_face_')) {
          const parentFoldId = faceId.replace('fold_face_', '');
          const parentFold = folds.find(f => f.id === parentFoldId);
          if (!parentFold) return null;
          transform = computeFoldFaceTransform(profile, parentFold, thickness);
        }
        if (!transform) return null;

        // Same-face folds for clipping
        const sameFaceFolds = nonBaseFolds.filter(f => f.faceId === faceId && f.id !== fold.id);

        return (
          <group key={fold.id} matrixAutoUpdate={false} matrix={transform}>
            <FoldMesh
              profile={virtualProfile}
              fold={fold}
              otherFolds={sameFaceFolds}
              thickness={thickness}
              isSketchMode={isSketchMode}
              onFaceClick={onFaceClick}
              showLines={!isViewMode && !isEdgeMode}
              activeSketchFaceId={activeSketchFaceId}
            />
          </group>
        );
      })}
    </group>
  );
}

function CameraApi({ apiRef, defaultPos, defaultTarget }: {
  apiRef: React.MutableRefObject<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void }>;
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
  apiRef.current.setFrontalView = () => {
    const [tx, ty, tz] = defaultTarget;
    const dist = Math.max(defaultPos[2] * 1.5, 200);
    camera.position.set(tx, ty, dist);
    if (controls) {
      (controls as any).target.set(tx, ty, tz);
      (controls as any).update();
    }
  };
  apiRef.current.setViewToFace = (normal: [number,number,number], center: [number,number,number]) => {
    const dist = Math.max(defaultPos[2] * 1.5, 200);
    camera.position.set(
      center[0] + normal[0] * dist,
      center[1] + normal[1] * dist,
      center[2] + normal[2] * dist,
    );
    // Set up vector: pick one that's not parallel to the normal
    const n = new THREE.Vector3(...normal);
    let upCandidate = new THREE.Vector3(0, 0, 1);
    if (Math.abs(n.dot(upCandidate)) > 0.9) {
      upCandidate = new THREE.Vector3(0, 1, 0);
    }
    camera.up.copy(upCandidate);
    if (controls) {
      (controls as any).target.set(...center);
      (controls as any).update();
    }
  };
  return null;
}

function InventorBackground() {
  const { scene } = useThree();
  useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#c8d6e5');   // top: soft blue
    gradient.addColorStop(1, '#edf1f5');   // bottom: near-white
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
      <ambientLight intensity={0.85} />
      <directionalLight position={[50, 80, 60]} intensity={0.5} />
      <directionalLight position={[-40, -30, 50]} intensity={0.3} />
      <directionalLight position={[0, 50, -40]} intensity={0.15} />
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
  cutouts?: { center: Point2D; radius: number }[];
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
  // Camera control
  cameraApiRef?: React.MutableRefObject<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void } | null>;
}

export function Viewer3D({
  profile, thickness, selectedEdgeId, onEdgeClick,
  flanges, folds = [], interactionMode = 'view', onFaceClick,
  faceSketches = [], selectedSketchLineId = null, onSketchLineClick,
  children, cutouts,
  sketchPlaneActive, sketchFaceId, sketchFaceOrigin,
  sketchFaceWidth, sketchFaceHeight,
  sketchEntities, sketchActiveTool, sketchGridSize, sketchSnapEnabled,
  onSketchAddEntity, onSketchUpdateEntity, onSketchRemoveEntity, sketchSelectedIds, onSketchSelectEntity, onSketchDeselectAll,
  cameraApiRef,
}: Viewer3DProps) {
  const cameraApi = useRef<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void }>({ reset: () => {}, setFrontalView: () => {}, setViewToFace: () => {} });

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

  // Sync internal camera API to external ref
  useEffect(() => {
    if (cameraApiRef) {
      cameraApiRef.current = cameraApi.current;
    }
  });

  return (
    <div className="w-full h-full bg-cad-surface relative">
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
            // Position at fold edge, offset to outer surface
            const outerOrigin = foldEdge.start.clone().add(bentUp.clone().multiplyScalar(thickness));
            m.setPosition(outerOrigin);
            
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

            // Origin of the flange flat surface (at arc end, outer surface facing camera)
            const flangeOrigin = parentEdge.start.clone()
              .add(uDir.clone().multiplyScalar(arcEndU))
              .add(wDir.clone().multiplyScalar(arcEndW))
              .add(flangeSurfaceNormal.clone().multiplyScalar(thickness));

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
                  onUpdateEntity={onSketchUpdateEntity}
                  onRemoveEntity={onSketchRemoveEntity}
                  selectedIds={sketchSelectedIds || []}
                  onSelectEntity={onSketchSelectEntity}
                  onDeselectAll={onSketchDeselectAll || (() => {})}
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
