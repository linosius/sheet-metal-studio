import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  MousePointer2, Minus, Square, Circle, Spline, Dot,
  Move, Scissors, ArrowRightFromLine, CopyMinus, FlipHorizontal2,
  Ruler, Magnet, Grid3X3, Trash2,
} from 'lucide-react';
import { SketchTool } from '@/hooks/useSketchStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SketchToolbarProps {
  activeTool: SketchTool;
  snapEnabled: boolean;
  gridSize: number;
  onToolChange: (tool: SketchTool) => void;
  onSnapToggle: () => void;
  onGridSizeChange: (size: number) => void;
  onClear: () => void;
}

interface ToolDef {
  id: SketchTool | string;
  icon: typeof MousePointer2;
  label: string;
  shortcut?: string;
  placeholder?: boolean;
}

const createTools: ToolDef[] = [
  { id: 'line', icon: Minus, label: 'Line', shortcut: 'L' },
  { id: 'circle', icon: Circle, label: 'Circle', shortcut: 'C' },
  { id: 'arc', icon: Spline, label: 'Arc', shortcut: 'A' },
  { id: 'rect', icon: Square, label: 'Rectangle', shortcut: 'R' },
  { id: 'point', icon: Dot, label: 'Point', shortcut: 'P' },
];

const modifyTools: ToolDef[] = [
  { id: 'move', icon: Move, label: 'Move', shortcut: 'M' },
  { id: 'trim', icon: Scissors, label: 'Trim', shortcut: 'T' },
  { id: 'extend', icon: ArrowRightFromLine, label: 'Extend' },
  { id: 'offset', icon: CopyMinus, label: 'Offset' },
  { id: 'mirror', icon: FlipHorizontal2, label: 'Mirror' },
];

const dimensionTools: ToolDef[] = [
  { id: 'dimension', icon: Ruler, label: 'Dimension', shortcut: 'D' },
];

const GRID_OPTIONS = [1, 2, 5, 10, 20, 50];

function ToolGroup({ label, tools, activeTool, onToolChange }: {
  label: string;
  tools: ToolDef[];
  activeTool: SketchTool;
  onToolChange: (tool: SketchTool) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-0.5">
        {tools.map((tool) => (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === tool.id ? 'default' : 'ghost'}
                size="icon"
                className={cn(
                  'h-8 w-8',
                  activeTool === tool.id && 'shadow-sm',
                )}
                onClick={() => {
                  onToolChange(tool.id as SketchTool);
                }}
              >
                <tool.icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {tool.label}{tool.shortcut ? ` (${tool.shortcut})` : ''}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">
        {label}
      </span>
    </div>
  );
}

export function SketchToolbar({
  activeTool,
  snapEnabled,
  gridSize,
  onToolChange,
  onSnapToggle,
  onGridSizeChange,
  onClear,
}: SketchToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-cad-toolbar shrink-0">
      {/* Select */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={activeTool === 'select' ? 'default' : 'ghost'}
            size="icon"
            className={cn('h-8 w-8', activeTool === 'select' && 'shadow-sm')}
            onClick={() => onToolChange('select')}
          >
            <MousePointer2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Select (V)</TooltipContent>
      </Tooltip>

      <div className="w-px h-8 bg-border mx-1.5" />

      {/* Create */}
      <ToolGroup label="Create" tools={createTools} activeTool={activeTool} onToolChange={onToolChange} />

      <div className="w-px h-8 bg-border mx-1.5" />

      {/* Modify */}
      <ToolGroup label="Modify" tools={modifyTools} activeTool={activeTool} onToolChange={onToolChange} />

      <div className="w-px h-8 bg-border mx-1.5" />

      {/* Dimension */}
      <ToolGroup label="Dimension" tools={dimensionTools} activeTool={activeTool} onToolChange={onToolChange} />

      <div className="flex-1" />

      {/* Utilities */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={snapEnabled ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={onSnapToggle}
              >
                <Magnet className={cn('h-4 w-4', snapEnabled && 'text-cad-snap')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Snap ({snapEnabled ? 'On' : 'Off'})
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  const idx = GRID_OPTIONS.indexOf(gridSize);
                  const next = GRID_OPTIONS[(idx + 1) % GRID_OPTIONS.length];
                  onGridSizeChange(next);
                }}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Grid: {gridSize}mm (click to cycle)
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onClear}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Clear All</TooltipContent>
          </Tooltip>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">
          Utilities
        </span>
      </div>
    </div>
  );
}
