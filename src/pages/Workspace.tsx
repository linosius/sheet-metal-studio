import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkflowBar, WorkflowStep } from '@/components/workspace/WorkflowBar';
import { SketchToolbar } from '@/components/workspace/SketchToolbar';
import { SketchCanvas } from '@/components/workspace/SketchCanvas';
import { PropertiesPanel } from '@/components/workspace/PropertiesPanel';
import { Viewer3D } from '@/components/workspace/Viewer3D';
import { useSketchStore } from '@/hooks/useSketchStore';
import { extractProfile, extractEdges } from '@/lib/geometry';
import { Point2D } from '@/lib/sheetmetal';
import { toast } from 'sonner';

export default function Workspace() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('sketch');
  const sketch = useSketchStore();

  // 3D state
  const [profile, setProfile] = useState<Point2D[] | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Try to extract profile from sketch entities
  const canConvert = useMemo(() => {
    return extractProfile(sketch.entities) !== null;
  }, [sketch.entities]);

  const handleConvertToBaseFace = () => {
    const p = extractProfile(sketch.entities);
    if (!p) {
      toast.error('Cannot create base face', {
        description: 'Draw a closed shape (rectangle or connected lines) first.',
      });
      return;
    }
    setProfile(p);
    setCurrentStep('base-face');
    toast.success('Base face created', {
      description: `Profile with ${p.length} vertices, thickness: ${sketch.sheetMetalDefaults.thickness}mm`,
    });
  };

  const handleStepClick = (step: WorkflowStep) => {
    if ((step === 'base-face' || step === 'flanges') && !profile) {
      toast.error('Convert your sketch to a base face first');
      return;
    }
    setCurrentStep(step);
  };

  // Keyboard shortcuts for tools
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
  }, [sketch, currentStep]);

  const is3DStep = currentStep === 'base-face' || currentStep === 'flanges';

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
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
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={!canConvert}
              onClick={handleConvertToBaseFace}
            >
              Convert to Base Face
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {is3DStep && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setCurrentStep('sketch')}
            >
              Back to Sketch
            </Button>
          )}
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left toolbar (sketch tools) */}
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
          />
        )}

        {/* Unfold / Export placeholders */}
        {(currentStep === 'unfold' || currentStep === 'export') && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">
                {currentStep === 'unfold' && 'Flat Pattern View'}
                {currentStep === 'export' && 'Export Options'}
              </p>
              <p className="text-sm">Coming in the next iteration</p>
            </div>
          </div>
        )}

        {/* Right properties panel */}
        <PropertiesPanel
          defaults={sketch.sheetMetalDefaults}
          onDefaultsChange={sketch.setSheetMetalDefaults}
          gridSize={sketch.gridSize}
          onGridSizeChange={sketch.setGridSize}
          entityCount={sketch.entities.length}
          mode={is3DStep ? '3d' : 'sketch'}
          selectedEdge={
            is3DStep && profile && selectedEdgeId
              ? extractEdges(profile, sketch.sheetMetalDefaults.thickness).find(e => e.id === selectedEdgeId) || null
              : null
          }
        />
      </div>
    </div>
  );
}
