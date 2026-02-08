import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ArrowLeft, ArrowRight, MousePointer2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkflowBar, WorkflowStep } from '@/components/workspace/WorkflowBar';
import { SketchToolbar } from '@/components/workspace/SketchToolbar';
import { SketchCanvas } from '@/components/workspace/SketchCanvas';
import { PropertiesPanel } from '@/components/workspace/PropertiesPanel';
import { Viewer3D } from '@/components/workspace/Viewer3D';
import { UnfoldViewer } from '@/components/workspace/UnfoldViewer';
import { FoldLineEditor } from '@/components/workspace/FoldLineEditor';
import { useSketchStore } from '@/hooks/useSketchStore';
import { extractProfile, getAllSelectableEdges, Flange, Fold, getOppositeEdgeId, getUserFacingDirection } from '@/lib/geometry';
import { Point2D, generateId } from '@/lib/sheetmetal';
import { toast } from 'sonner';

export default function Workspace() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('sketch');
  const sketch = useSketchStore();

  // 3D state
  const [profile, setProfile] = useState<Point2D[] | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [flanges, setFlanges] = useState<Flange[]>([]);
  const [folds, setFolds] = useState<Fold[]>([]);
  const [subMode, setSubMode] = useState<'edge' | 'fold'>('edge');
  const [showFoldEditor, setShowFoldEditor] = useState(false);

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
    setProfile(p);
    setFlanges([]);
    setFolds([]);
    setSelectedEdgeId(null);
    setCurrentStep('base-face');
    toast.success('Base face created', {
      description: `Profile with ${p.length} vertices, thickness: ${sketch.sheetMetalDefaults.thickness}mm`,
    });
  }, [sketch.entities, sketch.sheetMetalDefaults.thickness]);

  const handleStepClick = useCallback((step: WorkflowStep) => {
    if ((step === 'base-face' || step === 'fold-flanges' || step === 'unfold') && !profile) {
      toast.error('Convert your sketch to a base face first');
      return;
    }
    setCurrentStep(step);
  }, [profile]);

  // ── Face click handler (fold mode) ──
  const handleFaceClick = useCallback((faceId: string) => {
    if (subMode !== 'fold' || currentStep !== 'fold-flanges') return;
    if (faceId === 'base_top' || faceId === 'base_bot') {
      setShowFoldEditor(true);
    }
  }, [subMode, currentStep]);

  // ── Fold handlers ──
  const handleAddFold = useCallback((data: {
    offset: number; axis: 'x' | 'y'; angle: number;
    direction: 'up' | 'down'; bendRadius: number;
  }) => {
    if (!profile) return;
    // Clear flanges — profile geometry changes
    if (flanges.length > 0) {
      setFlanges([]);
      toast.info('Flanges cleared', {
        description: 'Flanges were removed because the base profile changed.',
      });
    }
    const fold: Fold = { id: generateId(), ...data };
    setFolds(prev => [...prev, fold]);
    setShowFoldEditor(false);
    toast.success('Fold added', {
      description: `${data.axis.toUpperCase()}-axis @ ${data.offset}mm, ${data.angle}° ${data.direction}`,
    });
  }, [profile, flanges.length]);

  const handleRemoveFold = useCallback((id: string) => {
    setFolds(prev => prev.filter(f => f.id !== id));
    if (flanges.length > 0) {
      setFlanges([]);
      toast.info('Flanges cleared due to fold removal');
    }
    toast.success('Fold removed');
  }, [flanges.length]);

  // ── Flange operations — edge remapping for "down" direction ──
  const handleAddFlange = useCallback((height: number, angle: number, direction: 'up' | 'down') => {
    if (!selectedEdgeId || !profile) return;

    // Prevent flange on fold-line edges
    const foldLineEdgeIds = folds.flatMap(fold => {
      const idx = fold.axis === 'x' ? 2 : 1;
      return [`edge_top_${idx}`, `edge_bot_${idx}`];
    });
    if (foldLineEdgeIds.includes(selectedEdgeId)) {
      toast.error('Cannot add flange on a fold line edge');
      return;
    }

    const edges = getAllSelectableEdges(profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
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
          toast.error('Opposite edge not found', {
            description: `Expected ${oppositeId} but it doesn't exist yet.`,
          });
          return;
        }
        if (flanges.some(f => f.edgeId === oppositeId)) {
          toast.error('Opposite edge already has a flange', {
            description: `Cannot place downward flange — ${oppositeId} is already used.`,
          });
          return;
        }
        targetEdgeId = oppositeId;
        toast.info('Flange placed on opposite face', {
          description: `Remapped to ${oppositeId} to achieve downward bend.`,
        });
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
    setFlanges(prev => [...prev, flange]);
    const displayDir = getUserFacingDirection(targetEdgeId);
    toast.success('Flange added', {
      description: `${height}mm × ${angle}° ${displayDir} on ${targetEdgeId}`,
    });
  }, [selectedEdgeId, profile, flanges, folds, sketch.sheetMetalDefaults.thickness, sketch.sheetMetalDefaults.bendRadius]);

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
        setFlanges(prev => prev.map(f =>
          f.id === id ? { ...f, ...updates, edgeId: oppositeId, direction: 'up' } : f
        ));
        toast.info(`Flange moved to ${oppositeId}`);
        return;
      }
      return;
    }
    setFlanges(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, [flanges, profile, folds, sketch.sheetMetalDefaults.thickness]);

  const handleRemoveFlange = useCallback((id: string) => {
    setFlanges(prev => prev.filter(f => f.id !== id));
    toast.success('Flange removed');
  }, []);

  // Keyboard shortcuts for sketch tools
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (currentStep !== 'sketch') return;
      switch (e.key.toLowerCase()) {
        case 'v': sketch.setActiveTool('select'); break;
        case 'l': sketch.setActiveTool('line'); break;
        case 'r': sketch.setActiveTool('rect'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStep, sketch.setActiveTool]);

  const is3DStep = currentStep === 'base-face' || currentStep === 'fold-flanges';
  const isUnfoldStep = currentStep === 'unfold';

  // Profile bounds for fold editor
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

  const selectedEdge = useMemo(() => {
    if (!is3DStep || !profile || !selectedEdgeId) return null;
    const edges = getAllSelectableEdges(profile, sketch.sheetMetalDefaults.thickness, flanges, folds);
    return edges.find(e => e.id === selectedEdgeId) || null;
  }, [is3DStep, profile, selectedEdgeId, sketch.sheetMetalDefaults.thickness, flanges, folds]);

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
              {currentStep === 'base-face' && (
                <Button size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => setCurrentStep('fold-flanges')}>
                  Fold &amp; Flanges
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
              {currentStep === 'fold-flanges' && (
                <Button size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => setCurrentStep('unfold')}>
                  Unfold
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left toolbar (sketch) */}
        {currentStep === 'sketch' && (
          <div className="w-12 border-r bg-cad-toolbar flex flex-col items-center py-3 gap-2 shrink-0">
            <SketchToolbar
              activeTool={sketch.activeTool}
              snapEnabled={sketch.snapEnabled}
              onToolChange={sketch.setActiveTool}
              onSnapToggle={() => sketch.setSnapEnabled(!sketch.snapEnabled)}
              onClear={sketch.clearAll}
            />
          </div>
        )}

        {/* Content column */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sub-mode toolbar for Fold & Flanges step */}
          {currentStep === 'fold-flanges' && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 shrink-0">
              <span className="text-xs font-medium text-muted-foreground">Mode:</span>
              <Button
                variant={subMode === 'edge' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => setSubMode('edge')}
              >
                <MousePointer2 className="h-3 w-3" />
                Edge
              </Button>
              <Button
                variant={subMode === 'fold' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => setSubMode('fold')}
              >
                <Scissors className="h-3 w-3" />
                Fold
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
              <span className="text-xs text-muted-foreground">
                {subMode === 'edge'
                  ? 'Select an edge to add a flange'
                  : 'Click a face to place a fold line'}
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
              onSelectEntity={sketch.selectEntity}
              onDeselectAll={sketch.deselectAll}
              onRemoveEntities={sketch.removeEntities}
            />
          )}

          {/* 3D Viewer */}
          {is3DStep && profile && (
            <Viewer3D
              profile={profile}
              thickness={sketch.sheetMetalDefaults.thickness}
              selectedEdgeId={selectedEdgeId}
              onEdgeClick={setSelectedEdgeId}
              flanges={flanges}
              folds={folds}
              foldMode={subMode === 'fold' && currentStep === 'fold-flanges'}
              onFaceClick={handleFaceClick}
            />
          )}

          {/* Unfold Viewer */}
          {isUnfoldStep && profile && (
            <UnfoldViewer
              profile={profile}
              thickness={sketch.sheetMetalDefaults.thickness}
              flanges={flanges}
              kFactor={sketch.sheetMetalDefaults.kFactor}
              folds={folds}
            />
          )}

          {/* Export placeholder */}
          {currentStep === 'export' && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <p className="text-lg font-medium mb-2">Export Options</p>
                <p className="text-sm">Coming in the next iteration</p>
              </div>
            </div>
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
        />
      </div>

      {/* Fold Line Editor Dialog */}
      {showFoldEditor && profileBounds && (
        <FoldLineEditor
          open={showFoldEditor}
          faceWidth={profileBounds.width}
          faceHeight={profileBounds.height}
          faceOrigin={profileBounds.origin}
          defaultBendRadius={sketch.sheetMetalDefaults.bendRadius}
          onApply={handleAddFold}
          onClose={() => setShowFoldEditor(false)}
        />
      )}
    </div>
  );
}
