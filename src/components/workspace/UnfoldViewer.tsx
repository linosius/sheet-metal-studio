import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Point2D } from '@/lib/sheetmetal';
import { Flange, Fold } from '@/lib/geometry';
import { computeFlatPattern, FlatPattern } from '@/lib/unfold';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UnfoldViewerProps {
  profile: Point2D[];
  thickness: number;
  flanges: Flange[];
  kFactor: number;
  folds?: Fold[];
  cutouts?: { center: Point2D; radius: number }[];
}

const PADDING = 40;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 10;

export function UnfoldViewer({ profile, thickness, flanges, kFactor, folds = [], cutouts = [] }: UnfoldViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute flat pattern
  const pattern = useMemo<FlatPattern>(
    () => computeFlatPattern(profile, thickness, flanges, kFactor, folds),
    [profile, thickness, flanges, kFactor, folds],
  );

  // Fit-to-view transform
  const fitTransform = useMemo(() => {
    const { boundingBox } = pattern;
    const bw = boundingBox.maxX - boundingBox.minX;
    const bh = boundingBox.maxY - boundingBox.minY;
    if (bw < 0.01 || bh < 0.01) return { scale: 1, tx: 0, ty: 0 };

    const availW = containerSize.width - PADDING * 2;
    const availH = containerSize.height - PADDING * 2;
    const scale = Math.min(availW / bw, availH / bh);

    // Center the pattern
    const tx = (containerSize.width - bw * scale) / 2 - boundingBox.minX * scale;
    const ty = (containerSize.height - bh * scale) / 2 - boundingBox.minY * scale;

    return { scale, tx, ty };
  }, [pattern, containerSize]);

  const handleFitView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(z * 1.3, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(z / 1.3, MIN_ZOOM));
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)));
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Final transform: fitTransform + user zoom/pan
  const { scale: fitScale, tx: fitTx, ty: fitTy } = fitTransform;
  const finalScale = fitScale * zoom;

  // Build SVG transform
  const svgTransform = `translate(${fitTx + pan.x}, ${fitTy + pan.y}) scale(${finalScale})`;

  // Compute dimension annotations
  const dims = useMemo(() => {
    const { boundingBox, overallWidth, overallHeight } = pattern;
    return {
      width: overallWidth,
      height: overallHeight,
      bbox: boundingBox,
    };
  }, [pattern]);

  return (
    <div ref={containerRef} className="flex-1 bg-cad-surface relative select-none overflow-hidden">
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-card/90 rounded-lg border p-1 shadow-sm">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFitView} title="Fit to view">
          <Maximize className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] font-mono text-muted-foreground px-1.5">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Info badge */}
      <div className="absolute top-3 right-3 z-10 bg-card/90 rounded-lg border p-2 shadow-sm">
        <p className="text-[10px] font-mono text-muted-foreground">
          Flat: {dims.width.toFixed(1)} × {dims.height.toFixed(1)} mm
        </p>
        <p className="text-[10px] font-mono text-muted-foreground">
          Bends: {pattern.bendLines.length / 2}
        </p>
      </div>

      <svg
        width={containerSize.width}
        height={containerSize.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="cursor-grab active:cursor-grabbing"
      >
        {/* Background grid */}
        <defs>
          <pattern id="unfold-grid-sm" width={10 * finalScale} height={10 * finalScale} patternUnits="userSpaceOnUse">
            <path
              d={`M ${10 * finalScale} 0 L 0 0 0 ${10 * finalScale}`}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={0.3}
              opacity={0.3}
            />
          </pattern>
          <pattern id="unfold-grid-lg" width={50 * finalScale} height={50 * finalScale} patternUnits="userSpaceOnUse">
            <path
              d={`M ${50 * finalScale} 0 L 0 0 0 ${50 * finalScale}`}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
              opacity={0.4}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#unfold-grid-sm)" />
        <rect width="100%" height="100%" fill="url(#unfold-grid-lg)" />

        <g transform={svgTransform}>
          {/* Regions (filled polygons) */}
          {pattern.regions.map(region => {
            const d =
              region.polygon
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                .join(' ') + ' Z';

            return (
              <path
                key={region.id}
                d={d}
                fill={region.type === 'base' ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--accent) / 0.12)'}
                stroke="hsl(var(--foreground))"
                strokeWidth={1.5 / finalScale}
              />
            );
          })}

          {/* Cutout holes */}
          {cutouts.map((cutout, idx) => (
            <circle
              key={`cutout-${idx}`}
              cx={cutout.center.x}
              cy={cutout.center.y}
              r={cutout.radius}
              fill="hsl(var(--cad-surface))"
              stroke="hsl(var(--foreground))"
              strokeWidth={1.5 / finalScale}
            />
          ))}

          {/* Bend lines (dashed, in pairs) */}
          {pattern.bendLines.map((bl, idx) => (
            <g key={`bend-${idx}`}>
              <line
                x1={bl.start.x}
                y1={bl.start.y}
                x2={bl.end.x}
                y2={bl.end.y}
                stroke="hsl(var(--destructive))"
                strokeWidth={1 / finalScale}
                strokeDasharray={`${4 / finalScale} ${3 / finalScale}`}
              />
              {/* Label at midpoint (only for the first line of each pair) */}
              {idx % 2 === 0 && (
                <text
                  x={(bl.start.x + bl.end.x) / 2}
                  y={(bl.start.y + bl.end.y) / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="hsl(var(--destructive))"
                  fontSize={10 / finalScale}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {bl.label}: {bl.angle}° R{bl.radius}
                </text>
              )}
            </g>
          ))}

          {/* Dimension annotations — overall width */}
          <DimensionLine
            p1={{ x: dims.bbox.minX, y: dims.bbox.maxY }}
            p2={{ x: dims.bbox.maxX, y: dims.bbox.maxY }}
            offset={15 / finalScale}
            label={`${dims.width.toFixed(1)}`}
            scale={finalScale}
            direction="horizontal"
          />

          {/* Dimension annotations — overall height */}
          <DimensionLine
            p1={{ x: dims.bbox.maxX, y: dims.bbox.minY }}
            p2={{ x: dims.bbox.maxX, y: dims.bbox.maxY }}
            offset={15 / finalScale}
            label={`${dims.height.toFixed(1)}`}
            scale={finalScale}
            direction="vertical"
          />
        </g>
      </svg>
    </div>
  );
}

/** Simple linear dimension line renderer */
function DimensionLine({
  p1,
  p2,
  offset,
  label,
  scale,
  direction,
}: {
  p1: Point2D;
  p2: Point2D;
  offset: number;
  label: string;
  scale: number;
  direction: 'horizontal' | 'vertical';
}) {
  const arrowSize = 5 / scale;
  const fontSize = 9 / scale;
  const extLen = offset + 5 / scale;

  if (direction === 'horizontal') {
    const y = p1.y + offset;
    return (
      <g>
        {/* Extension lines */}
        <line x1={p1.x} y1={p1.y} x2={p1.x} y2={y + 3 / scale}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.5 / scale} />
        <line x1={p2.x} y1={p2.y} x2={p2.x} y2={y + 3 / scale}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.5 / scale} />
        {/* Dimension line */}
        <line x1={p1.x + arrowSize} y1={y} x2={p2.x - arrowSize} y2={y}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.5 / scale} />
        {/* Arrows */}
        <polygon points={`${p1.x},${y} ${p1.x + arrowSize},${y - arrowSize / 2} ${p1.x + arrowSize},${y + arrowSize / 2}`}
          fill="hsl(var(--muted-foreground))" />
        <polygon points={`${p2.x},${y} ${p2.x - arrowSize},${y - arrowSize / 2} ${p2.x - arrowSize},${y + arrowSize / 2}`}
          fill="hsl(var(--muted-foreground))" />
        {/* Label */}
        <text x={(p1.x + p2.x) / 2} y={y - 3 / scale}
          textAnchor="middle" dominantBaseline="auto"
          fill="hsl(var(--muted-foreground))" fontSize={fontSize} fontFamily="monospace">
          {label}
        </text>
      </g>
    );
  }

  // Vertical
  const x = p1.x + offset;
  return (
    <g>
      <line x1={p1.x} y1={p1.y} x2={x + 3 / scale} y2={p1.y}
        stroke="hsl(var(--muted-foreground))" strokeWidth={0.5 / scale} />
      <line x1={p2.x} y1={p2.y} x2={x + 3 / scale} y2={p2.y}
        stroke="hsl(var(--muted-foreground))" strokeWidth={0.5 / scale} />
      <line x1={x} y1={p1.y + arrowSize} x2={x} y2={p2.y - arrowSize}
        stroke="hsl(var(--muted-foreground))" strokeWidth={0.5 / scale} />
      <polygon points={`${x},${p1.y} ${x - arrowSize / 2},${p1.y + arrowSize} ${x + arrowSize / 2},${p1.y + arrowSize}`}
        fill="hsl(var(--muted-foreground))" />
      <polygon points={`${x},${p2.y} ${x - arrowSize / 2},${p2.y - arrowSize} ${x + arrowSize / 2},${p2.y - arrowSize}`}
        fill="hsl(var(--muted-foreground))" />
      <text x={x + 5 / scale} y={(p1.y + p2.y) / 2}
        textAnchor="start" dominantBaseline="central"
        fill="hsl(var(--muted-foreground))" fontSize={fontSize} fontFamily="monospace">
        {label}
      </text>
    </g>
  );
}
