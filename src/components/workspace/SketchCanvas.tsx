import { useRef, useState, useCallback, useEffect } from 'react';
import { SketchEntity, Point2D, snapToGrid, distance2D, midpoint2D } from '@/lib/sheetmetal';
import { SketchTool } from '@/hooks/useSketchStore';
import { cn } from '@/lib/utils';

interface SketchCanvasProps {
  entities: SketchEntity[];
  selectedIds: string[];
  activeTool: SketchTool;
  gridSize: number;
  snapEnabled: boolean;
  onAddLine: (start: Point2D, end: Point2D) => void;
  onAddRect: (origin: Point2D, width: number, height: number) => void;
  onSelectEntity: (id: string, multi?: boolean) => void;
  onDeselectAll: () => void;
  onRemoveEntities: (ids: string[]) => void;
}

const CANVAS_SIZE = 2000; // virtual canvas mm
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;

export function SketchCanvas({
  entities,
  selectedIds,
  activeTool,
  gridSize,
  snapEnabled,
  onAddLine,
  onAddRect,
  onSelectEntity,
  onDeselectAll,
  onRemoveEntities,
}: SketchCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState({ x: -200, y: -200, w: 400, h: 400 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Drawing state
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);
  const [cursorPos, setCursorPos] = useState<Point2D>({ x: 0, y: 0 });

  const svgToWorld = useCallback((clientX: number, clientY: number): Point2D => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    return {
      x: viewBox.x + (clientX - rect.left) * scaleX,
      y: viewBox.y + (clientY - rect.top) * scaleY,
    };
  }, [viewBox]);

  const getSnappedPoint = useCallback((p: Point2D): Point2D => {
    return snapEnabled ? snapToGrid(p, gridSize) : p;
  }, [snapEnabled, gridSize]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or Alt+click = pan
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y });
      return;
    }

    if (e.button !== 0) return;

    const worldPos = svgToWorld(e.clientX, e.clientY);
    const snapped = getSnappedPoint(worldPos);

    if (activeTool === 'select') {
      onDeselectAll();
      return;
    }

    if (activeTool === 'line' || activeTool === 'rect') {
      if (!drawStart) {
        setDrawStart(snapped);
      } else {
        // Complete the shape
        if (activeTool === 'line') {
          if (distance2D(drawStart, snapped) > 0.5) {
            onAddLine(drawStart, snapped);
          }
        } else if (activeTool === 'rect') {
          const w = snapped.x - drawStart.x;
          const h = snapped.y - drawStart.y;
          if (Math.abs(w) > 0.5 && Math.abs(h) > 0.5) {
            onAddRect(
              { x: Math.min(drawStart.x, snapped.x), y: Math.min(drawStart.y, snapped.y) },
              Math.abs(w),
              Math.abs(h),
            );
          }
        }
        setDrawStart(null);
      }
    }
  }, [activeTool, drawStart, svgToWorld, getSnappedPoint, onAddLine, onAddRect, onDeselectAll, viewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const worldPos = svgToWorld(e.clientX, e.clientY);
    const snapped = getSnappedPoint(worldPos);
    setCursorPos(snapped);

    if (isPanning && panStart) {
      const dx = (e.clientX - panStart.x) * (viewBox.w / (svgRef.current?.getBoundingClientRect().width || 1));
      const dy = (e.clientY - panStart.y) * (viewBox.h / (svgRef.current?.getBoundingClientRect().height || 1));
      setViewBox(prev => ({ ...prev, x: panStart.vx - dx, y: panStart.vy - dy }));
    }
  }, [svgToWorld, getSnappedPoint, isPanning, panStart, viewBox.w, viewBox.h]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const worldPos = svgToWorld(e.clientX, e.clientY);

    setViewBox(prev => {
      const newW = Math.max(prev.w * ZOOM_MIN, Math.min(prev.w * factor, CANVAS_SIZE * ZOOM_MAX));
      const newH = Math.max(prev.h * ZOOM_MIN, Math.min(prev.h * factor, CANVAS_SIZE * ZOOM_MAX));
      const ratio = newW / prev.w;
      return {
        x: worldPos.x - (worldPos.x - prev.x) * ratio,
        y: worldPos.y - (worldPos.y - prev.y) * ratio,
        w: newW,
        h: newH,
      };
    });
  }, [svgToWorld]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawStart(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        onRemoveEntities(selectedIds);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Generate grid lines
  const gridLines = [];
  const majorGrid = gridSize * 5;
  const startX = Math.floor(viewBox.x / gridSize) * gridSize;
  const startY = Math.floor(viewBox.y / gridSize) * gridSize;
  const endX = viewBox.x + viewBox.w;
  const endY = viewBox.y + viewBox.h;

  for (let x = startX; x <= endX; x += gridSize) {
    const isMajor = Math.abs(x % majorGrid) < 0.01;
    gridLines.push(
      <line
        key={`gv${x}`}
        x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.h}
        stroke={isMajor ? 'hsl(var(--cad-grid-major))' : 'hsl(var(--cad-grid))'}
        strokeWidth={isMajor ? 0.5 : 0.2}
      />
    );
  }
  for (let y = startY; y <= endY; y += gridSize) {
    const isMajor = Math.abs(y % majorGrid) < 0.01;
    gridLines.push(
      <line
        key={`gh${y}`}
        x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.w} y2={y}
        stroke={isMajor ? 'hsl(var(--cad-grid-major))' : 'hsl(var(--cad-grid))'}
        strokeWidth={isMajor ? 0.5 : 0.2}
      />
    );
  }

  // Render entities
  const renderEntity = (entity: SketchEntity) => {
    const isSelected = selectedIds.includes(entity.id);
    const strokeColor = isSelected ? 'hsl(var(--cad-selection))' : 'hsl(var(--cad-sketch-line))';
    const strokeWidth = isSelected ? 1.2 : 0.8;

    if (entity.type === 'line') {
      const dist = distance2D(entity.start, entity.end);
      const mid = midpoint2D(entity.start, entity.end);
      const angle = Math.atan2(entity.end.y - entity.start.y, entity.end.x - entity.start.x);
      const offsetX = Math.sin(angle) * 4;
      const offsetY = -Math.cos(angle) * 4;

      return (
        <g key={entity.id} onClick={(e) => { e.stopPropagation(); onSelectEntity(entity.id, e.shiftKey); }}>
          <line
            x1={entity.start.x} y1={entity.start.y}
            x2={entity.end.x} y2={entity.end.y}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            className="cursor-pointer"
          />
          {/* Dimension label */}
          <text
            x={mid.x + offsetX}
            y={mid.y + offsetY}
            fill="hsl(var(--cad-dimension))"
            fontSize={3}
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {dist.toFixed(1)}
          </text>
          {/* Endpoints */}
          <circle cx={entity.start.x} cy={entity.start.y} r={1} fill={strokeColor} />
          <circle cx={entity.end.x} cy={entity.end.y} r={1} fill={strokeColor} />
        </g>
      );
    }

    if (entity.type === 'rect') {
      return (
        <g key={entity.id} onClick={(e) => { e.stopPropagation(); onSelectEntity(entity.id, e.shiftKey); }}>
          <rect
            x={entity.origin.x}
            y={entity.origin.y}
            width={entity.width}
            height={entity.height}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            className="cursor-pointer"
          />
          {/* Width dimension */}
          <text
            x={entity.origin.x + entity.width / 2}
            y={entity.origin.y - 3}
            fill="hsl(var(--cad-dimension))"
            fontSize={3}
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
          >
            {entity.width.toFixed(1)}
          </text>
          {/* Height dimension */}
          <text
            x={entity.origin.x + entity.width + 5}
            y={entity.origin.y + entity.height / 2}
            fill="hsl(var(--cad-dimension))"
            fontSize={3}
            fontFamily="JetBrains Mono, monospace"
            textAnchor="start"
            dominantBaseline="middle"
          >
            {entity.height.toFixed(1)}
          </text>
        </g>
      );
    }

    return null;
  };

  // Preview shape while drawing
  const renderPreview = () => {
    if (!drawStart) return null;

    if (activeTool === 'line') {
      return (
        <line
          x1={drawStart.x} y1={drawStart.y}
          x2={cursorPos.x} y2={cursorPos.y}
          stroke="hsl(var(--cad-sketch-line))"
          strokeWidth={0.6}
          strokeDasharray="2 1"
          opacity={0.7}
        />
      );
    }

    if (activeTool === 'rect') {
      const x = Math.min(drawStart.x, cursorPos.x);
      const y = Math.min(drawStart.y, cursorPos.y);
      const w = Math.abs(cursorPos.x - drawStart.x);
      const h = Math.abs(cursorPos.y - drawStart.y);
      return (
        <rect
          x={x} y={y} width={w} height={h}
          stroke="hsl(var(--cad-sketch-line))"
          strokeWidth={0.6}
          strokeDasharray="2 1"
          fill="hsl(var(--cad-sketch-line) / 0.05)"
          opacity={0.7}
        />
      );
    }

    return null;
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-cad-surface">
      {/* Coordinate display */}
      <div className="absolute bottom-3 left-3 z-10 bg-card/90 backdrop-blur border rounded px-2.5 py-1 font-mono text-xs text-muted-foreground">
        X: {cursorPos.x.toFixed(1)} &nbsp; Y: {cursorPos.y.toFixed(1)} mm
      </div>

      {/* Snap indicator */}
      {snapEnabled && (
        <div className="absolute bottom-3 right-3 z-10 bg-card/90 backdrop-blur border rounded px-2.5 py-1 text-xs text-cad-snap font-medium">
          SNAP: {gridSize}mm
        </div>
      )}

      <svg
        ref={svgRef}
        className={cn('w-full h-full', activeTool !== 'select' ? 'cad-canvas' : 'cursor-default')}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Grid */}
        {gridLines}

        {/* Origin axes */}
        <line x1={viewBox.x} y1={0} x2={viewBox.x + viewBox.w} y2={0}
          stroke="hsl(var(--cad-bend-line))" strokeWidth={0.3} opacity={0.5} />
        <line x1={0} y1={viewBox.y} x2={0} y2={viewBox.y + viewBox.h}
          stroke="hsl(var(--cad-snap))" strokeWidth={0.3} opacity={0.5} />

        {/* Entities */}
        {entities.map(renderEntity)}

        {/* Preview */}
        {renderPreview()}

        {/* Snap cursor */}
        {activeTool !== 'select' && (
          <g>
            <line
              x1={cursorPos.x - 3} y1={cursorPos.y}
              x2={cursorPos.x + 3} y2={cursorPos.y}
              stroke="hsl(var(--cad-snap))" strokeWidth={0.3}
            />
            <line
              x1={cursorPos.x} y1={cursorPos.y - 3}
              x2={cursorPos.x} y2={cursorPos.y + 3}
              stroke="hsl(var(--cad-snap))" strokeWidth={0.3}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
