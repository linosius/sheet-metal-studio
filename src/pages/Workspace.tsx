import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import { Box, ArrowLeft, ArrowRight, MousePointer2, Scissors, PenLine, Undo2, Redo2 } from 'lucide-react';
import { ExportPanel } from '@/components/workspace/ExportPanel';
import { Button } from '@/components/ui/button';
import { WorkflowBar, WorkflowStep } from '@/components/workspace/WorkflowBar';
import { SketchToolbar } from '@/components/workspace/SketchToolbar';
import { SketchCanvas } from '@/components/workspace/SketchCanvas';
import { PropertiesPanel } from '@/components/workspace/PropertiesPanel';
import { Viewer3D } from '@/components/workspace/Viewer3D';
import { UnfoldViewer } from '@/components/workspace/UnfoldViewer';
import { FaceSketchToolbar } from '@/components/workspace/FaceSketchToolbar';
import { FoldDialog } from '@/components/workspace/FoldDialog';
import { ActionTree } from '@/components/workspace/ActionTree';
import { useSketchStore } from '@/hooks/useSketchStore';
import { useActionHistory } from '@/hooks/useActionHistory';
import {
  extractProfile, getAllSelectableEdges, Flange, Fold, FaceSketch,
  FaceSketchLine, FaceSketchEntity, FaceSketchTool, classifySketchLineAsFold,
  getOppositeEdgeId, getUserFacingDirection, isEdgeOnFoldLine,
  computeFoldEdge, getFoldMovingHeights, getFaceDimensions,
  ProfileCutout, circleToPolygon, rectToPolygon,
} from '@/lib/geometry';
import { Point2D, generateId } from '@/lib/sheetmetal';
import { initOCCT, isOCCTReady } from '@/lib/cadInit';
import { toast } from 'sonner';
import * as THREE from 'three';

export default function Workspace() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('sketch');
  const sketch = useSketchStore();
  const [occtReady, setOcctReady] = useState(isOCCTReady());

  // Initialize OCCT WASM in background
  useEffect(() => {
    if (!occtReady) {
      initOCCT()
        .then(() => setOcctReady(true))
        .catch(err => {
          console.error("[CAD] Failed to initialize OpenCascade:", err);
          toast.error("CAD kernel failed to load", {
            description: "3D modeling will use fallback geometry.",
          });
        });
    }
  }, [occtReady]);

  // 3D state
  const [profile, setProfile] = useState<Point2D[] | null>(null);
  const [cutouts, setCutouts] = useState<import('@/lib/geometry').ProfileCutout[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Action history (replaces individual flanges/folds/faceSketches state)
  const history = useActionHistory();
  const { flanges, folds, faceSketches } = history.currentState;

  // Sub-mode & face sketch state
  const [subMode, setSubMode] = useState<'edge' | 'sketch' | 'fold'>('edge');
  const [activeFaceSketch, setActiveFaceSketch] = useState<string | null>(null);
  const [selectedSketchLineId, setSelectedSketchLineId] = useState<string | null>(null);
  const [foldDialogOpen, setFoldDialogOpen] = useState(false);

  // In-3D sketch plane state
  const [sketchTool, setSketchTool] = useState<FaceSketchTool>('line');
  const [sketchEntities, setSketchEntities] = useState<FaceSketchEntity[]>([]);
  const [sketchSelectedIds, setSketchSelectedIds] = useState<string[]>([]);
  const cameraApiRef = useRef<{ reset: () => void; setFrontalView: () => void; setViewToFace: (normal: [number,number,number], center: [number,number,number]) => void } | null>(null);

  const canConvert = useMemo(() => {
    return extractProfile(sketch.entities) !== null;
  }, [sketch.entities]);

  const handleConvertToBaseFace = useCallback(() => {
    const p = extractProfile(sketch.entities);
    if (!p) {
      toast.error('Cannot create base face', {
        description: 'Draw a closed shape (rectangle or connected lines) first.',
      });
      return;
    }
    // Extract all interior shapes as cutouts
    const extractedCutouts: ProfileCutout[] = [];

    // Circles
    for (const e of sketch.entities) {
      if (e.type === 'circle') {
        extractedCutouts.push({
          type: 'circle',
          center: e.center,
          radius: e.radius,
          polygon: circleToPolygon(e.center, e.radius),
        });
      }
    }

    // Rectangles (not the profile rect itself)
    const rects = sketch.entities.filter(e => e.type === 'rect');
    for (const e of rects) {
      if (e.type !== 'rect') continue;
      // Skip if this rect IS the profile
      const isProfile = p.length === 4 &&
        Math.abs(p[0].x - e.origin.x) < 0.5 && Math.abs(p[0].y - e.origin.y) < 0.5 &&
        Math.abs(p[2].x - (e.origin.x + e.width)) < 0.5 && Math.abs(p[2].y - (e.origin.y + e.height)) < 0.5;
      if (isProfile) continue;
      extractedCutouts.push({
        type: 'rect',
        origin: e.origin,
        width: e.width,
        height: e.height,
        polygon: rectToPolygon(e.origin, e.width, e.height),
      });
    }

    // Closed line loops (lines not used by the profile)
    const profileLines = sketch.entities.filter(e => e.type === 'line');
    const usedLineIds = new Set<string>();
    // Try to find closed loops from remaining lines
    const remainingLines = profileLines.filter(e => e.type === 'line' && !usedLineIds.has(e.id));
    const tolerance = 1.0;
    const foundLoops: Point2D[][] = [];
    const globalUsed = new Set<string>();

    for (const startLine of remainingLines) {
      if (globalUsed.has(startLine.id) || startLine.type !== 'line') continue;
      const loopPts: Point2D[] = [startLine.start, startLine.end];
      const loopUsed = new Set([startLine.id]);
      let closed = false;
      let maxIter = remainingLines.length * 2;

      while (!closed && maxIter > 0) {
        maxIter--;
        const last = loopPts[loopPts.length - 1];
        let found = false;
        for (const line of remainingLines) {
          if (loopUsed.has(line.id) || globalUsed.has(line.id) || line.type !== 'line') continue;
          const dS = Math.hypot(line.start.x - last.x, line.start.y - last.y);
          const dE = Math.hypot(line.end.x - last.x, line.end.y - last.y);
          if (dS < tolerance) {
            const dClose = Math.hypot(line.end.x - loopPts[0].x, line.end.y - loopPts[0].y);
            if (dClose < tolerance && loopUsed.size >= 2) { closed = true; }
            else { loopPts.push(line.end); }
            loopUsed.add(line.id);
            found = true;
            break;
          } else if (dE < tolerance) {
            const dClose = Math.hypot(line.start.x - loopPts[0].x, line.start.y - loopPts[0].y);
            if (dClose < tolerance && loopUsed.size >= 2) { closed = true; }
            else { loopPts.push(line.start); }
            loopUsed.add(line.id);
            found = true;
            break;
          }
        }
        if (!found) break;
      }

      if (closed && loopPts.length >= 3) {
        // Check if this loop is the profile itself
        const isProfileLoop = loopPts.length === p.length && loopPts.every((lp, idx) =>
          Math.hypot(lp.x - p[idx].x, lp.y - p[idx].y) < tolerance
        );
        if (!isProfileLoop) {
          foundLoops.push(loopPts);
          loopUsed.forEach(id => globalUsed.add(id));
        }
      }
    }

    for (const loop of foundLoops) {
      extractedCutouts.push({ type: 'polygon', polygon: loop });
    }

    setProfile(p);
    setCutouts(extractedCutouts);
    history.pushAction('Base Face Created', 'base-face', { flanges: [], folds: [], faceSketches: [] });
    setSelectedEdgeId(null);
    setSelectedSketchLineId(null);
    setActiveFaceSketch(null);
    setSketchEntities([]);
    setSketchSelectedIds([]);
    setCurrentStep('fold-flanges');
    toast.success('Base face created', {
      description: `Profile with ${p.length} vertices${extractedCutouts.length > 0 ? `, ${extractedCutouts.length} cutout(s)` : ''}, thickness: ${sketch.sheetMetalDefaults.thickness}mm`,
    });
  }, [sketch.entities, sketch.sheetMetalDefaults.thickness, history]);

  const handleStepClick = useCallback((step: WorkflowStep) => {
    if ((step === 'fold-flanges' || step === 'unfold') && !profile) {
      toast.error('Convert your sketch to a base face first');
      return;
    }
    setCurrentStep(step);
  }, [profile]);

  const profileBounds = useMemo(() => {
    if (!profile) return null;
    const xs = profile.map(p => p.x);
    const ys = profile.map(p => p.y);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      origin: { x: Math.min(...xs), y: Math.min(...ys) } as Point2D,
    };
  }, [profile]);

  // ── Face click handler (sketch sub-mode: open in-3D sketch) ──
  const handleFaceClick = useCallback((faceId: string) => {
    if (subMode !== 'sketch' || currentStep !== 'fold-flanges') return;
    if (activeFaceSketch) return; // Already sketching

    // Support base faces, fold faces, and flange faces
    if (faceId === 'base_top' || faceId === 'base_bot' || faceId.startsWith('fold_face_') || faceId.startsWith('flange_face_')) {
      const existing = faceSketches.find(fs => fs.faceId === faceId);
      setSketchEntities(existing ? [...existing.entities] : []);
      setActiveFaceSketch(faceId);
      setSketchTool('line');
      setSketchSelectedIds([]);

      // Orient camera to face the sketch plane
      if (profile && cameraApiRef.current) {
        const t = sketch.sheetMetalDefaults.thickness;
        if (faceId === 'base_top') {
          const cx = profileBounds ? profileBounds.origin.x + profileBounds.width / 2 : 0;
          const cy = profileBounds ? profileBounds.origin.y + profileBounds.height / 2 : 0;
          cameraApiRef.current.setViewToFace([0, 0, 1], [cx, cy, t]);
        } else if (faceId === 'base_bot') {
          const cx = profileBounds ? profileBounds.origin.x + profileBounds.width / 2 : 0;
          const cy = profileBounds ? profileBounds.origin.y + profileBounds.height / 2 : 0;
          cameraApiRef.current.setViewToFace([0, 0, -1], [cx, cy, 0]);
        } else if (faceId.startsWith('fold_face_')) {
          const foldId = faceId.replace('fold_face_', '');
          const fold = folds.find(f => f.id === foldId);
          if (fold) {
            const foldEdge = computeFoldEdge(profile, t, fold);
            const tangent = new THREE.Vector3().subVectors(foldEdge.end, foldEdge.start).normalize();
            const normal = foldEdge.normal.clone();
            const dSign = fold.direction === 'up' ? 1 : -1;
            const angleRad = fold.angle * Math.PI / 180;
            const q = new THREE.Quaternion().setFromAxisAngle(tangent, -dSign * angleRad);
            const bentUp = new THREE.Vector3(0, 0, dSign).applyQuaternion(q);
            const mid = foldEdge.start.clone().add(foldEdge.end).multiplyScalar(0.5);
            cameraApiRef.current.setViewToFace(
              [bentUp.x, bentUp.y, bentUp.z],
              [mid.x, mid.y, mid.z],
            );
          }
        } else if (faceId.startsWith('flange_face_')) {
          const flangeId = faceId.replace('flange_face_', '');
          const flange = flanges.find(f => f.id === flangeId);
          if (flange) {
            const allEdges = getAllSelectableEdges(profile, t, flanges, folds);
            const parentEdge = allEdges.find(e => e.id === flange.edgeId);
            if (parentEdge) {
              const bendAngleRad = (flange.angle * Math.PI) / 180;
              const dirSign = flange.direction === 'up' ? 1 : -1;
              const uDir = parentEdge.normal.clone().normalize();
              const wDir = parentEdge.faceNormal.clone().multiplyScalar(dirSign);
              const sinA = Math.sin(bendAngleRad);
              const cosA = Math.cos(bendAngleRad);
              const flangeSurfaceNormal = uDir.clone().multiplyScalar(sinA).add(wDir.clone().multiplyScalar(-cosA)).normalize();
              const arcEndU = flange.bendRadius * sinA;
              const arcEndW = flange.bendRadius * (1 - cosA);
              const flangeOrigin = parentEdge.start.clone()
                .add(uDir.clone().multiplyScalar(arcEndU))
                .add(wDir.clone().multiplyScalar(arcEndW));
              const mid = flangeOrigin.clone().add(parentEdge.end.clone().sub(parentEdge.start).multiplyScalar(0.5));
              cameraApiRef.current.setViewToFace(
                [flangeSurfaceNormal.x, flangeSurfaceNormal.y, flangeSurfaceNormal.z],
                [mid.x, mid.y, mid.z],
              );
            }
          }
        }
      }
    }
  }, [subMode, currentStep, activeFaceSketch, faceSketches, profile, profileBounds, folds, flanges, sketch.sheetMetalDefaults.thickness]);

  // ── In-3D sketch plane handlers ──
  const handleSketchAddEntity = useCallback((entity: FaceSketchEntity) => {
    setSketchEntities(prev => [...prev, entity]);
  }, []);

  const handleSketchRemoveEntity = useCallback((id: string) => {
    setSketchEntities(prev => prev.filter(e => e.id !== id));
    setSketchSelectedIds(prev => prev.filter(sid => sid !== id));
  }, []);

  const handleSketchSelectEntity = useCallback((id: string, multi?: boolean) => {
    setSketchSelectedIds(prev => multi ? [...prev, id] : [id]);
  }, []);

  const handleSketchUpdateEntity = useCallback((id: string, updates: Partial<FaceSketchEntity>) => {
    setSketchEntities(prev => prev.map(e => e.id === id ? { ...e, ...updates } as FaceSketchEntity : e));
  }, []);

  const handleSketchDeselectAll = useCallback(() => {
    setSketchSelectedIds([]);
  }, []);

  const handleFinishSketch = useCallback(() => {
    if (!activeFaceSketch) return;
    const updated = [
      ...faceSketches.filter(fs => fs.faceId !== activeFaceSketch),
      { faceId: activeFaceSketch, entities: sketchEntities },
    ];
    history.pushAction(`Sketch on ${activeFaceSketch}`, 'sketch', { flanges, folds, faceSketches: updated });
    setActiveFaceSketch(null);
    setSketchEntities([]);
    setSketchSelectedIds([]);
    toast.success('Sketch saved', { description: `${sketchEntities.length} entity(s) on ${activeFaceSketch}` });
  }, [activeFaceSketch, sketchEntities, flanges, folds, faceSketches, history]);

  const handleExitSketch = useCallback(() => {
    setActiveFaceSketch(null);
    setSketchEntities([]);
    setSketchSelectedIds([]);
  }, []);

  // Compute sketch face info (supports base faces and fold faces)
  const sketchFaceInfo = useMemo(() => {
    if (!activeFaceSketch || !profile) return null;

    if (activeFaceSketch === 'base_top' || activeFaceSketch === 'base_bot') {
      return {
        origin: profileBounds?.origin ?? { x: 0, y: 0 },
        width: profileBounds?.width ?? 0,
        height: profileBounds?.height ?? 0,
      };
    }

    if (activeFaceSketch.startsWith('fold_face_')) {
      const foldId = activeFaceSketch.replace('fold_face_', '');
      const fold = folds.find(f => f.id === foldId);
      if (!fold) return null;

      const foldEdge = computeFoldEdge(profile, sketch.sheetMetalDefaults.thickness, fold);
      const lineLen = foldEdge.start.distanceTo(foldEdge.end);
      const { startHeight, endHeight } = getFoldMovingHeights(profile, fold, sketch.sheetMetalDefaults.thickness);

      return {
        origin: { x: 0, y: 0 } as Point2D,
        width: lineLen,
        height: Math.max(startHeight, endHeight),
      };
    }

    if (activeFaceSketch.startsWith('flange_face_')) {
      const flangeId = activeFaceSketch.replace('flange_face_', '');
      const flange = flanges.find(f => f.id === flangeId);
      if (!flange) return null;

      const edges = getAllSelectableEdges(profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
      const parentEdge = edges.find(e => e.id === flange.edgeId);
      if (!parentEdge) return null;

      const edgeLen = parentEdge.start.distanceTo(parentEdge.end);

      return {
        origin: { x: 0, y: 0 } as Point2D,
        width: edgeLen,
        height: flange.height,
      };
    }

    return null;
  }, [activeFaceSketch, profile, profileBounds, folds, sketch.sheetMetalDefaults.thickness]);

  // ── Sketch line click handler (fold sub-mode) ──
  const handleSketchLineClick = useCallback((lineId: string) => {
    if (subMode !== 'fold') return;
    if (!profile) return;
    if (folds.some(f => f.sketchLineId === lineId)) {
      toast.error('This line already has a fold applied');
      return;
    }

    // Determine which face this sketch line belongs to
    const parentFace = faceSketches.find(fs =>
      fs.entities.some(e => e.id === lineId)
    );
    const faceId = parentFace?.faceId ?? 'base_top';

    // Get face dimensions for classification
    const faceDims = getFaceDimensions(faceId, profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
    if (!faceDims) {
      toast.error('Cannot determine face dimensions');
      return;
    }

    // Validate fold qualification
    const sketchLine = parentFace?.entities.find(e => e.id === lineId && e.type === 'line') as FaceSketchLine | undefined;
    if (sketchLine) {
      const classification = classifySketchLineAsFold(sketchLine, faceDims.width, faceDims.height);
      if (!classification) {
        toast.error('Invalid fold line', {
          description: 'Line must span edge-to-edge (full width or height) to be used as a fold line.',
        });
        return;
      }
    }

    setSelectedSketchLineId(lineId);
    setFoldDialogOpen(true);
  }, [subMode, folds, profile, faceSketches, flanges, sketch.sheetMetalDefaults.thickness]);

  // ── Apply fold from dialog ──
  const handleApplyFold = useCallback((params: {
    angle: number;
    direction: 'up' | 'down';
    bendRadius: number;
    foldLocation: 'centerline' | 'material-inside' | 'material-outside';
  }) => {
    if (!selectedSketchLineId || !profile) return;

    // Find parent face
    const parentFace = faceSketches.find(fs =>
      fs.entities.some(e => e.id === selectedSketchLineId)
    );
    const faceId = parentFace?.faceId ?? 'base_top';

    const faceDims = getFaceDimensions(faceId, profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
    if (!faceDims) return;

    const sketchLine = faceSketches
      .flatMap(fs => fs.entities)
      .find(e => e.id === selectedSketchLineId && e.type === 'line') as FaceSketchLine | undefined;
    if (!sketchLine) return;

    const classification = classifySketchLineAsFold(sketchLine, faceDims.width, faceDims.height);
    if (!classification) {
      toast.error('Invalid fold line', {
        description: 'Line must span edge-to-edge (opposite boundaries) to be used as a fold line.',
      });
      setFoldDialogOpen(false);
      setSelectedSketchLineId(null);
      return;
    }

    const fold: Fold = {
      id: generateId(),
      lineStart: classification.lineStart,
      lineEnd: classification.lineEnd,
      angle: params.angle,
      direction: params.direction,
      bendRadius: params.bendRadius,
      sketchLineId: selectedSketchLineId,
      faceId: faceId,
      foldLocation: params.foldLocation,
    };

    history.pushAction(
      `Fold ${params.angle}° ${params.direction}`,
      'fold',
      { flanges, folds: [...folds, fold], faceSketches },
    );
    setFoldDialogOpen(false);
    setSelectedSketchLineId(null);
    toast.success('Fold applied', {
      description: `${params.angle}° ${params.direction} on ${faceId}`,
    });
  }, [selectedSketchLineId, profile, faceSketches, flanges, folds, history, sketch.sheetMetalDefaults.thickness]);

  // ── Remove fold (NO LONGER clears flanges) ──
  const handleRemoveFold = useCallback((id: string) => {
    history.pushAction('Fold removed', 'remove-fold', {
      flanges, folds: folds.filter(f => f.id !== id), faceSketches,
    });
    toast.success('Fold removed');
  }, [flanges, folds, faceSketches, history]);

  // ── Flange operations ──
  const handleAddFlange = useCallback((height: number, angle: number, direction: 'up' | 'down') => {
    if (!selectedEdgeId || !profile) return;

    const edges = getAllSelectableEdges(profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
    const selectedEdgeObj = edges.find(e => e.id === selectedEdgeId);
    if (selectedEdgeObj && isEdgeOnFoldLine(selectedEdgeObj, folds, profile)) {
      toast.error('Cannot add flange on a fold line edge');
      return;
    }
    let targetEdgeId = selectedEdgeId;

    if (direction === 'down') {
      const oppositeId = getOppositeEdgeId(selectedEdgeId);
      if (!oppositeId) {
        toast.info('No opposite face for this edge', {
          description: 'Side edges cannot bend downward. Using "Up" direction.',
        });
      } else {
        const oppositeExists = edges.some(e => e.id === oppositeId);
        if (!oppositeExists) {
          toast.error('Opposite edge not found');
          return;
        }
        if (flanges.some(f => f.edgeId === oppositeId)) {
          toast.error('Opposite edge already has a flange');
          return;
        }
        targetEdgeId = oppositeId;
        toast.info('Flange placed on opposite face');
      }
    }

    if (flanges.some(f => f.edgeId === targetEdgeId)) {
      toast.error('Edge already has a flange');
      return;
    }

    const flange: Flange = {
      id: generateId(),
      edgeId: targetEdgeId,
      height,
      angle,
      direction: 'up',
      bendRadius: sketch.sheetMetalDefaults.bendRadius,
    };
    history.pushAction(
      `Flange ${height}mm`,
      'flange',
      { flanges: [...flanges, flange], folds, faceSketches },
    );
    const displayDir = getUserFacingDirection(targetEdgeId);
    toast.success('Flange added', {
      description: `${height}mm × ${angle}° ${displayDir} on ${targetEdgeId}`,
    });
  }, [selectedEdgeId, profile, flanges, folds, faceSketches, sketch.sheetMetalDefaults.thickness, sketch.sheetMetalDefaults.bendRadius, history]);

  const handleUpdateFlange = useCallback((id: string, updates: Partial<Flange>) => {
    if (updates.direction && profile) {
      const flange = flanges.find(f => f.id === id);
      if (!flange) return;
      const currentDisplayDir = getUserFacingDirection(flange.edgeId);
      if (updates.direction !== currentDisplayDir) {
        const oppositeId = getOppositeEdgeId(flange.edgeId);
        if (!oppositeId) { toast.info('No opposite face for this edge'); return; }
        const edges = getAllSelectableEdges(profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
        if (!edges.some(e => e.id === oppositeId)) { toast.error('Opposite edge not available'); return; }
        if (flanges.some(f => f.id !== id && f.edgeId === oppositeId)) { toast.error('Opposite edge already has a flange'); return; }
        history.pushAction('Flange moved', 'update-flange', {
          flanges: flanges.map(f =>
            f.id === id ? { ...f, ...updates, edgeId: oppositeId, direction: 'up' } : f
          ),
          folds, faceSketches,
        });
        toast.info(`Flange moved to ${oppositeId}`);
        return;
      }
      return;
    }
    history.pushAction('Flange updated', 'update-flange', {
      flanges: flanges.map(f => f.id === id ? { ...f, ...updates } : f),
      folds, faceSketches,
    });
  }, [flanges, folds, faceSketches, profile, sketch.sheetMetalDefaults.thickness, history]);

  const handleRemoveFlange = useCallback((id: string) => {
    history.pushAction('Flange removed', 'remove-flange', {
      flanges: flanges.filter(f => f.id !== id), folds, faceSketches,
    });
    toast.success('Flange removed');
  }, [flanges, folds, faceSketches, history]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Undo/Redo
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          history.redo();
        } else {
          history.undo();
        }
        return;
      }
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        history.redo();
        return;
      }

      // Sketch plane shortcuts
      if (activeFaceSketch) {
        switch (e.key.toLowerCase()) {
          case 'v': setSketchTool('select'); break;
          case 'l': setSketchTool('line'); break;
          case 'c': setSketchTool('circle'); break;
          case 'r': setSketchTool('rect'); break;
          case 'p': setSketchTool('point'); break;
          case 'm': setSketchTool('move'); break;
          case 'delete':
          case 'backspace':
            if (sketchSelectedIds.length > 0) {
              setSketchEntities(prev => prev.filter(ent => !sketchSelectedIds.includes(ent.id)));
              setSketchSelectedIds([]);
            }
            break;
        }
        return;
      }

      if (currentStep !== 'sketch') return;
      switch (e.key.toLowerCase()) {
        case 'v': sketch.setActiveTool('select'); break;
        case 'l': sketch.setActiveTool('line'); break;
        case 'c': sketch.setActiveTool('circle'); break;
        case 'r': sketch.setActiveTool('rect'); break;
        case 'a': sketch.setActiveTool('arc'); break;
        case 'p': sketch.setActiveTool('point'); break;
        case 'm': sketch.setActiveTool('move'); break;
        case 't': sketch.setActiveTool('trim'); break;
        case 'd': sketch.setActiveTool('dimension'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStep, sketch.setActiveTool, activeFaceSketch, sketchSelectedIds, history]);

  const is3DStep = currentStep === 'fold-flanges';
  const isUnfoldStep = currentStep === 'unfold';

  const selectedEdge = useMemo(() => {
    if (!is3DStep || !profile || !selectedEdgeId) return null;
    const edges = getAllSelectableEdges(profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
    return edges.find(e => e.id === selectedEdgeId) || null;
  }, [is3DStep, profile, selectedEdgeId, sketch.sheetMetalDefaults.thickness, flanges, folds]);

  const selectedSketchLine = useMemo(() => {
    if (!selectedSketchLineId) return null;
    for (const fs of faceSketches) {
      const entity = fs.entities.find(e => e.id === selectedSketchLineId);
      if (entity && entity.type === 'line') return entity as FaceSketchLine;
    }
    return null;
  }, [selectedSketchLineId, faceSketches]);

  // Viewer interaction mode
  const viewerMode = useMemo((): 'edge' | 'sketch' | 'fold' | 'view' => {
    if (currentStep === 'fold-flanges') return subMode;
    return 'view';
  }, [currentStep, subMode]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* ── Top bar ── */}
      <header className="h-12 border-b bg-cad-toolbar flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <Box className="h-3 w-3 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">SheetMetal Online</span>
          </div>
          <div className="w-px h-6 bg-border mx-1" />
          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8"
              disabled={!history.canUndo} onClick={history.undo} title="Undo (Ctrl+Z)">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8"
              disabled={!history.canRedo} onClick={history.redo} title="Redo (Ctrl+Shift+Z)">
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="w-px h-6 bg-border mx-1" />
          <span className="text-xs text-muted-foreground font-mono">Untitled Project</span>
        </div>

        <WorkflowBar currentStep={currentStep} onStepClick={handleStepClick} />

        <div className="flex items-center gap-2">
          {currentStep === 'sketch' && (
            <Button
              size="sm" className="h-8 text-xs gap-1.5"
              disabled={!canConvert} onClick={handleConvertToBaseFace}
            >
              Convert to Base Face
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {is3DStep && (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs"
                onClick={() => setCurrentStep('sketch')}>
                Back to Sketch
              </Button>
              {currentStep === 'fold-flanges' && (
                <Button size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => setCurrentStep('unfold')}>
                  Unfold
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
          {isUnfoldStep && (
            <Button size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => setCurrentStep('export')}>
              Export
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Content column */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sketch ribbon toolbar */}
          {currentStep === 'sketch' && (
            <SketchToolbar
              activeTool={sketch.activeTool}
              snapEnabled={sketch.snapEnabled}
              gridSize={sketch.gridSize}
              onToolChange={sketch.setActiveTool}
              onSnapToggle={() => sketch.setSnapEnabled(!sketch.snapEnabled)}
              onGridSizeChange={sketch.setGridSize}
              onClear={sketch.clearAll}
            />
          )}

          {/* Sub-mode toolbar for Fold & Flanges step */}
          {currentStep === 'fold-flanges' && !activeFaceSketch && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 shrink-0">
              <span className="text-xs font-medium text-muted-foreground">Mode:</span>
              <Button
                variant={subMode === 'edge' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => { setSubMode('edge'); setSelectedSketchLineId(null); }}
              >
                <MousePointer2 className="h-3 w-3" />
                Edge
              </Button>
              <Button
                variant={subMode === 'sketch' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => { setSubMode('sketch'); setSelectedEdgeId(null); setSelectedSketchLineId(null); }}
              >
                <PenLine className="h-3 w-3" />
                2D Sketch
              </Button>
              <Button
                variant={subMode === 'fold' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => { setSubMode('fold'); setSelectedEdgeId(null); }}
              >
                <Scissors className="h-3 w-3" />
                Fold
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
              <span className="text-xs text-muted-foreground">
                {subMode === 'edge' && 'Select an edge to add a flange'}
                {subMode === 'sketch' && 'Click a face to open the sketch editor'}
                {subMode === 'fold' && 'Select a sketch line to apply fold'}
              </span>
            </div>
          )}

          {/* Sketch canvas */}
          {currentStep === 'sketch' && (
            <SketchCanvas
              entities={sketch.entities}
              selectedIds={sketch.selectedIds}
              activeTool={sketch.activeTool}
              gridSize={sketch.gridSize}
              snapEnabled={sketch.snapEnabled}
              onAddLine={sketch.addLine}
              onAddRect={sketch.addRect}
              onAddCircle={sketch.addCircle}
              onAddArc={sketch.addArc}
              onAddPoint={sketch.addPoint}
              onUpdateEntity={sketch.updateEntity}
              onAddEntities={sketch.addEntities}
              onSelectEntity={sketch.selectEntity}
              onDeselectAll={sketch.deselectAll}
              onRemoveEntities={sketch.removeEntities}
            />
          )}

          {/* 3D Viewer with history sidebar */}
          {is3DStep && profile && (
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left history panel */}
              {history.entries.length > 1 && (
                <div className="w-48 border-r bg-card/50 flex flex-col shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 border-b">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold">History ({history.entries.length - 1})</p>
                  </div>
                  <div className="p-2 flex-1 overflow-y-auto">
                    <ActionTree
                      entries={history.entries}
                      currentIndex={history.currentIndex}
                      onGoTo={history.goTo}
                    />
                  </div>
                </div>
              )}
              <div className="flex-1 relative min-h-0 h-full">
                <Viewer3D
                  profile={profile}
                  thickness={sketch.sheetMetalDefaults.thickness}
                  cutouts={cutouts}
                  selectedEdgeId={selectedEdgeId}
                  onEdgeClick={setSelectedEdgeId}
                  flanges={flanges}
                  folds={folds}
                  interactionMode={viewerMode}
                  onFaceClick={handleFaceClick}
                  faceSketches={faceSketches}
                  selectedSketchLineId={selectedSketchLineId}
                  onSketchLineClick={handleSketchLineClick}
                  sketchPlaneActive={!!activeFaceSketch}
                  sketchFaceId={activeFaceSketch}
                  sketchFaceOrigin={sketchFaceInfo?.origin}
                  sketchFaceWidth={sketchFaceInfo?.width}
                  sketchFaceHeight={sketchFaceInfo?.height}
                  sketchEntities={sketchEntities}
                  sketchActiveTool={sketchTool}
                  sketchGridSize={sketch.gridSize}
                  sketchSnapEnabled={sketch.snapEnabled}
                  onSketchAddEntity={handleSketchAddEntity}
                  onSketchRemoveEntity={handleSketchRemoveEntity}
                  onSketchUpdateEntity={handleSketchUpdateEntity}
                  onSketchDeselectAll={handleSketchDeselectAll}
                  sketchSelectedIds={sketchSelectedIds}
                  onSketchSelectEntity={handleSketchSelectEntity}
                  cameraApiRef={cameraApiRef}
                  useCADKernel={occtReady}
                >
                  {activeFaceSketch && sketchFaceInfo && (
                    <FaceSketchToolbar
                      activeTool={sketchTool}
                      onToolChange={setSketchTool}
                      faceId={activeFaceSketch}
                      faceWidth={sketchFaceInfo.width}
                      faceHeight={sketchFaceInfo.height}
                      onFinish={handleFinishSketch}
                      onExit={handleExitSketch}
                    />
                  )}
                </Viewer3D>
              </div>
            </div>
          )}

          {/* Unfold Viewer */}
          {isUnfoldStep && profile && (
            <UnfoldViewer
              profile={profile}
              thickness={sketch.sheetMetalDefaults.thickness}
              flanges={flanges}
              kFactor={sketch.sheetMetalDefaults.kFactor}
              folds={folds}
              cutouts={cutouts}
            />
          )}

          {/* Export panel */}
          {currentStep === 'export' && profile && (
            <ExportPanel
              profile={profile}
              thickness={sketch.sheetMetalDefaults.thickness}
              flanges={flanges}
              folds={folds}
              kFactor={sketch.sheetMetalDefaults.kFactor}
            />
          )}
        </div>

        {/* Right properties panel */}
        <PropertiesPanel
          defaults={sketch.sheetMetalDefaults}
          onDefaultsChange={sketch.setSheetMetalDefaults}
          gridSize={sketch.gridSize}
          onGridSizeChange={sketch.setGridSize}
          entityCount={sketch.entities.length}
          mode={is3DStep ? '3d' : 'sketch'}
          selectedEdge={selectedEdge}
          flanges={flanges}
          onAddFlange={handleAddFlange}
          onUpdateFlange={handleUpdateFlange}
          onRemoveFlange={handleRemoveFlange}
          folds={folds}
          onRemoveFold={handleRemoveFold}
          subMode={currentStep === 'fold-flanges' ? subMode : undefined}
          faceSketches={faceSketches}
          selectedSketchLine={selectedSketchLine}
        />
      </div>

      {/* Fold Dialog */}
      {foldDialogOpen && selectedSketchLine && (
        <FoldDialog
          open={foldDialogOpen}
          sketchLine={selectedSketchLine}
          defaultBendRadius={sketch.sheetMetalDefaults.bendRadius}
          onApply={handleApplyFold}
          onClose={() => { setFoldDialogOpen(false); setSelectedSketchLineId(null); }}
        />
      )}
    </div>
  );
}
