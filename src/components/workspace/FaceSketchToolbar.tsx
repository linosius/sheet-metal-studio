import { Button } from '@/components/ui/button';
import { MousePointer2, Minus, Circle, Square, Check, X, Dot, Move } from 'lucide-react';
import { FaceSketchTool } from '@/lib/geometry';

interface FaceSketchToolbarProps {
  activeTool: FaceSketchTool;
  onToolChange: (tool: FaceSketchTool) => void;
  faceId: string;
  faceWidth: number;
  faceHeight: number;
  onFinish: () => void;
  onExit: () => void;
}

export function FaceSketchToolbar({
  activeTool, onToolChange, faceId, faceWidth, faceHeight, onFinish, onExit,
}: FaceSketchToolbarProps) {
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-card/95 border border-border shadow-lg backdrop-blur-sm">
      <Button variant={activeTool === 'select' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs gap-1"
        onClick={() => onToolChange('select')}>
        <MousePointer2 className="h-3 w-3" /> Select
      </Button>
      <Button variant={activeTool === 'line' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs gap-1"
        onClick={() => onToolChange('line')}>
        <Minus className="h-3 w-3" /> Line
      </Button>
      <Button variant={activeTool === 'circle' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs gap-1"
        onClick={() => onToolChange('circle')}>
        <Circle className="h-3 w-3" /> Circle
      </Button>
      <Button variant={activeTool === 'rect' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs gap-1"
        onClick={() => onToolChange('rect')}>
        <Square className="h-3 w-3" /> Rect
      </Button>
      <Button variant={activeTool === 'point' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs gap-1"
        onClick={() => onToolChange('point')}>
        <Dot className="h-3 w-3" /> Point
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <Button variant={activeTool === 'move' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs gap-1"
        onClick={() => onToolChange('move')}>
        <Move className="h-3 w-3" /> Move
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <span className="text-[10px] font-mono text-muted-foreground">
        {faceId} — {faceWidth.toFixed(0)} × {faceHeight.toFixed(0)} mm
      </span>
      <div className="w-px h-5 bg-border mx-1" />
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onExit}>
        <X className="h-3 w-3" /> Exit
      </Button>
      <Button size="sm" className="h-7 text-xs gap-1" onClick={onFinish}>
        <Check className="h-3 w-3" /> Finish
      </Button>
    </div>
  );
}
