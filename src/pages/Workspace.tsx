import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkflowBar, WorkflowStep } from '@/components/workspace/WorkflowBar';
import { SketchToolbar } from '@/components/workspace/SketchToolbar';
import { SketchCanvas } from '@/components/workspace/SketchCanvas';
import { PropertiesPanel } from '@/components/workspace/PropertiesPanel';
import { useSketchStore } from '@/hooks/useSketchStore';

export default function Workspace() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('sketch');
  const sketch = useSketchStore();

  // Keyboard shortcuts for tools
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case 'v': sketch.setActiveTool('select'); break;
        case 'l': sketch.setActiveTool('line'); break;
        case 'r': sketch.setActiveTool('rect'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sketch]);

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

        <WorkflowBar currentStep={currentStep} onStepClick={setCurrentStep} />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">v0.1</span>
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

        {/* Canvas area */}
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
          />
        )}

        {currentStep !== 'sketch' && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">
                {currentStep === 'base-face' && '3D Base Face Viewer'}
                {currentStep === 'flanges' && 'Flange Editor'}
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
        />
      </div>
    </div>
  );
}
