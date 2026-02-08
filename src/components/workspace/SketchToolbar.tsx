import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MousePointer2, Minus, Square, Magnet, Trash2 } from 'lucide-react';
import { SketchTool } from '@/hooks/useSketchStore';
import { cn } from '@/lib/utils';

interface SketchToolbarProps {
  activeTool: SketchTool;
  snapEnabled: boolean;
  onToolChange: (tool: SketchTool) => void;
  onSnapToggle: () => void;
  onClear: () => void;
}

const tools: { id: SketchTool; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { id: 'line', icon: Minus, label: 'Line', shortcut: 'L' },
  { id: 'rect', icon: Square, label: 'Rectangle', shortcut: 'R' },
];

export function SketchToolbar({
  activeTool,
  snapEnabled,
  onToolChange,
  onSnapToggle,
  onClear,
}: SketchToolbarProps) {
  return (
    <>
      {tools.map((tool) => (
        <Tooltip key={tool.id}>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === tool.id ? 'default' : 'ghost'}
              size="icon"
              className={cn('h-8 w-8', activeTool === tool.id && 'shadow-sm')}
              onClick={() => onToolChange(tool.id)}
            >
              <tool.icon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {tool.label} ({tool.shortcut})
          </TooltipContent>
        </Tooltip>
      ))}

      <div className="h-px w-6 bg-border my-1" />

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
        <TooltipContent side="right" className="text-xs">
          Snap to Grid ({snapEnabled ? 'On' : 'Off'})
        </TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onClear}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          Clear All
        </TooltipContent>
      </Tooltip>
    </>
  );
}
