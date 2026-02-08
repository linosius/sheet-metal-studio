import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Check, X, MousePointer2 } from 'lucide-react';
import { generateId } from '@/lib/sheetmetal';
import { FaceSketchLine } from '@/lib/geometry';

interface FaceSketchEditorProps {
  faceId: string;
  faceWidth: number;
  faceHeight: number;
  existingLines: FaceSketchLine[];
  onFinish: (lines: FaceSketchLine[]) => void;
  onExit: () => void;
}

const GRID = 5;

export function FaceSketchEditor({
  faceId, faceWidth, faceHeight,
  existingLines, onFinish, onExit,
}: FaceSketchEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [lines, setLines] = useState<FaceSketchLine[]>([...existingLines]);
  const [lineAxis, setLineAxis] = useState<'x' | 'y'>('x');
  const [activeTool, setActiveTool] = useState<'select' | 'line'>('line');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(e => {
      const r = e[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const PAD = 70;
  const svgHeight = size.h - 40; // toolbar takes 40px
  const scale = useMemo(() => {
    const aw = size.w - PAD * 2;
    const ah = svgHeight - PAD * 2;
    if (aw <= 0 || ah <= 0) return 1;
    return Math.min(aw / faceWidth, ah / faceHeight, 10);
  }, [size.w, svgHeight, faceWidth, faceHeight]);

  // Face rectangle in SVG space
  const fx = (size.w - faceWidth * scale) / 2;
  const fy = (svgHeight - faceHeight * scale) / 2;

  // Y-flipped: face y=0 at SVG bottom, y=faceHeight at SVG top
  const toSvgX = useCallback((x: number) => fx + x * scale, [fx, scale]);
  const toSvgY = useCallback((y: number) => fy + (faceHeight - y) * scale, [fy, faceHeight, scale]);
  const fromSvgY = useCallback((sy: number) => faceHeight - (sy - fy) / scale, [fy, faceHeight, scale]);
  const fromSvgX = useCallback((sx: number) => (sx - fx) / scale, [fx, scale]);

  const snap = useCallback((v: number) => Math.round(v / GRID) * GRID, []);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool !== 'line' || editId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fxCoord = fromSvgX(e.clientX - rect.left);
    const fyCoord = fromSvgY(e.clientY - rect.top);

    if (fxCoord < 0 || fxCoord > faceWidth || fyCoord < 0 || fyCoord > faceHeight) return;

    let dim: number;
    if (lineAxis === 'x') {
      dim = snap(fyCoord);
      dim = Math.max(1, Math.min(faceHeight - 1, dim));
    } else {
      dim = snap(fxCoord);
      dim = Math.max(1, Math.min(faceWidth - 1, dim));
    }

    const line: FaceSketchLine = {
      id: generateId(),
      axis: lineAxis,
      dimension: dim,
      start: lineAxis === 'x' ? { x: 0, y: dim } : { x: dim, y: 0 },
      end: lineAxis === 'x' ? { x: faceWidth, y: dim } : { x: dim, y: faceHeight },
    };

    setLines(prev => [...prev, line]);
  }, [activeTool, lineAxis, fromSvgX, fromSvgY, faceWidth, faceHeight, snap, editId]);

  const handleDimSubmit = useCallback(() => {
    if (!editId) return;
    const v = parseFloat(editVal);
    if (isNaN(v) || v <= 0) { setEditId(null); return; }

    setLines(prev => prev.map(l => {
      if (l.id !== editId) return l;
      const max = l.axis === 'x' ? faceHeight - 1 : faceWidth - 1;
      const clamped = Math.max(1, Math.min(max, v));
      return {
        ...l,
        dimension: clamped,
        start: l.axis === 'x' ? { x: 0, y: clamped } : { x: clamped, y: 0 },
        end: l.axis === 'x' ? { x: faceWidth, y: clamped } : { x: clamped, y: faceHeight },
      };
    }));
    setEditId(null);
  }, [editId, editVal, faceWidth, faceHeight]);

  const removeLine = useCallback((id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  const gridLinesX = Math.floor(faceWidth / GRID);
  const gridLinesY = Math.floor(faceHeight / GRID);

  return (
    <div ref={containerRef} className="flex-1 bg-cad-surface relative select-none overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-cad-toolbar shrink-0">
        <Button variant={activeTool === 'select' ? 'default' : 'outline'}
          size="sm" className="h-7 text-xs gap-1"
          onClick={() => setActiveTool('select')}>
          <MousePointer2 className="h-3 w-3" /> Select
        </Button>
        <Button variant={activeTool === 'line' ? 'default' : 'outline'}
          size="sm" className="h-7 text-xs gap-1"
          onClick={() => setActiveTool('line')}>
          <Minus className="h-3 w-3" /> Line
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant={lineAxis === 'x' ? 'secondary' : 'ghost'}
          size="sm" className="h-7 text-[10px]"
          onClick={() => setLineAxis('x')}>
          Horizontal
        </Button>
        <Button variant={lineAxis === 'y' ? 'secondary' : 'ghost'}
          size="sm" className="h-7 text-[10px]"
          onClick={() => setLineAxis('y')}>
          Vertical
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground font-mono">
          {faceId} — {faceWidth.toFixed(0)} × {faceHeight.toFixed(0)} mm
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onExit}>
          <X className="h-3 w-3" /> Exit
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onFinish(lines)}>
          <Check className="h-3 w-3" /> Finish Sketch
        </Button>
      </div>

      {/* SVG canvas */}
      <svg
        width={size.w}
        height={svgHeight}
        className={activeTool === 'line' ? 'cursor-crosshair' : 'cursor-default'}
        onClick={handleClick}
      >
        {/* Face rectangle */}
        <rect x={fx} y={fy} width={faceWidth * scale} height={faceHeight * scale}
          fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth={1.5} />

        {/* Grid */}
        <g opacity={0.15}>
          {Array.from({ length: gridLinesX - 1 }, (_, i) => {
            const gx = toSvgX((i + 1) * GRID);
            return <line key={`gx${i}`} x1={gx} y1={fy} x2={gx} y2={fy + faceHeight * scale}
              stroke="hsl(var(--foreground))" strokeWidth={0.5} />;
          })}
          {Array.from({ length: gridLinesY - 1 }, (_, i) => {
            const gy = toSvgY((i + 1) * GRID);
            return <line key={`gy${i}`} x1={fx} y1={gy} x2={fx + faceWidth * scale} y2={gy}
              stroke="hsl(var(--foreground))" strokeWidth={0.5} />;
          })}
        </g>

        {/* Face dimension labels */}
        <text x={toSvgX(faceWidth / 2)} y={fy + faceHeight * scale + 20}
          fill="hsl(var(--muted-foreground))" fontSize={11} fontFamily="JetBrains Mono, monospace"
          textAnchor="middle">{faceWidth.toFixed(0)} mm</text>
        <text x={fx - 20} y={toSvgY(faceHeight / 2)}
          fill="hsl(var(--muted-foreground))" fontSize={11} fontFamily="JetBrains Mono, monospace"
          textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(-90, ${fx - 20}, ${toSvgY(faceHeight / 2)})`}>{faceHeight.toFixed(0)} mm</text>

        {/* Edge labels */}
        <text x={toSvgX(faceWidth / 2)} y={fy - 8}
          fill="hsl(var(--muted-foreground))" fontSize={9} textAnchor="middle" opacity={0.5}>TOP</text>
        <text x={toSvgX(faceWidth / 2)} y={fy + faceHeight * scale + 35}
          fill="hsl(var(--muted-foreground))" fontSize={9} textAnchor="middle" opacity={0.5}>BOTTOM</text>
        <text x={fx - 8} y={toSvgY(faceHeight / 2)}
          fill="hsl(var(--muted-foreground))" fontSize={9} textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(-90, ${fx - 8}, ${toSvgY(faceHeight / 2)})`} opacity={0.5}>LEFT</text>
        <text x={fx + faceWidth * scale + 8} y={toSvgY(faceHeight / 2)}
          fill="hsl(var(--muted-foreground))" fontSize={9} textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(90, ${fx + faceWidth * scale + 8}, ${toSvgY(faceHeight / 2)})`} opacity={0.5}>RIGHT</text>

        {/* Sketch lines */}
        {lines.map(line => {
          if (line.axis === 'x') {
            const sy = toSvgY(line.dimension);
            const dimMidY = (fy + faceHeight * scale + sy) / 2;
            return (
              <g key={line.id}>
                <line x1={fx} y1={sy} x2={fx + faceWidth * scale} y2={sy}
                  stroke="hsl(var(--cad-bend-line))" strokeWidth={2.5}
                  strokeDasharray="8 4" />
                {/* Dimension: distance from bottom */}
                <line x1={fx + faceWidth * scale + 15} y1={fy + faceHeight * scale}
                  x2={fx + faceWidth * scale + 15} y2={sy}
                  stroke="hsl(var(--cad-dimension))" strokeWidth={1} />
                <line x1={fx + faceWidth * scale + 10} y1={fy + faceHeight * scale}
                  x2={fx + faceWidth * scale + 20} y2={fy + faceHeight * scale}
                  stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                <line x1={fx + faceWidth * scale + 10} y1={sy}
                  x2={fx + faceWidth * scale + 20} y2={sy}
                  stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                {editId === line.id ? (
                  <foreignObject
                    x={fx + faceWidth * scale + 22} y={dimMidY - 12}
                    width={60} height={24}
                  >
                    <Input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleDimSubmit(); if (e.key === 'Escape') setEditId(null); }}
                      onBlur={handleDimSubmit}
                      className="h-6 w-14 text-[10px] font-mono px-1"
                      autoFocus
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={fx + faceWidth * scale + 30} y={dimMidY}
                    fill="hsl(var(--cad-dimension))"
                    fontSize={11} fontFamily="JetBrains Mono, monospace" fontWeight={600}
                    textAnchor="middle" dominantBaseline="middle"
                    className="cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setEditId(line.id); setEditVal(line.dimension.toString()); }}
                  >
                    {line.dimension}
                  </text>
                )}
                {/* Region labels */}
                <text x={toSvgX(faceWidth / 2)} y={(fy + faceHeight * scale + sy) / 2}
                  fill="hsl(var(--primary))" fontSize={9} fontWeight={600}
                  textAnchor="middle" dominantBaseline="middle" opacity={0.5}>
                  FOLD
                </text>
                <text x={toSvgX(faceWidth / 2)} y={(fy + sy) / 2}
                  fill="hsl(var(--accent))" fontSize={9} fontWeight={600}
                  textAnchor="middle" dominantBaseline="middle" opacity={0.5}>
                  FIXED
                </text>
                {/* Delete button (select mode) */}
                {activeTool === 'select' && (
                  <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); removeLine(line.id); }}>
                    <circle cx={fx + 15} cy={sy} r={8}
                      fill="hsl(var(--destructive))" opacity={0.8} />
                    <text x={fx + 15} y={sy}
                      fill="white" fontSize={10} textAnchor="middle" dominantBaseline="central">×</text>
                  </g>
                )}
              </g>
            );
          } else {
            const sx = toSvgX(line.dimension);
            const dimMidX = (fx + sx) / 2;
            return (
              <g key={line.id}>
                <line x1={sx} y1={fy} x2={sx} y2={fy + faceHeight * scale}
                  stroke="hsl(var(--cad-bend-line))" strokeWidth={2.5}
                  strokeDasharray="8 4" />
                {/* Dimension: distance from left */}
                <line x1={fx} y1={fy - 15} x2={sx} y2={fy - 15}
                  stroke="hsl(var(--cad-dimension))" strokeWidth={1} />
                <line x1={fx} y1={fy - 20} x2={fx} y2={fy - 10}
                  stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                <line x1={sx} y1={fy - 20} x2={sx} y2={fy - 10}
                  stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                {editId === line.id ? (
                  <foreignObject x={dimMidX - 30} y={fy - 38} width={60} height={24}>
                    <Input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleDimSubmit(); if (e.key === 'Escape') setEditId(null); }}
                      onBlur={handleDimSubmit}
                      className="h-6 w-14 text-[10px] font-mono px-1"
                      autoFocus
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={dimMidX} y={fy - 25}
                    fill="hsl(var(--cad-dimension))"
                    fontSize={11} fontFamily="JetBrains Mono, monospace" fontWeight={600}
                    textAnchor="middle"
                    className="cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setEditId(line.id); setEditVal(line.dimension.toString()); }}
                  >
                    {line.dimension}
                  </text>
                )}
                {/* Region labels */}
                <text x={(fx + sx) / 2} y={toSvgY(faceHeight / 2)}
                  fill="hsl(var(--accent))" fontSize={9} fontWeight={600}
                  textAnchor="middle" dominantBaseline="middle" opacity={0.5}>
                  FIXED
                </text>
                <text x={(sx + fx + faceWidth * scale) / 2} y={toSvgY(faceHeight / 2)}
                  fill="hsl(var(--primary))" fontSize={9} fontWeight={600}
                  textAnchor="middle" dominantBaseline="middle" opacity={0.5}>
                  FOLD
                </text>
                {activeTool === 'select' && (
                  <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); removeLine(line.id); }}>
                    <circle cx={sx} cy={fy + 15} r={8}
                      fill="hsl(var(--destructive))" opacity={0.8} />
                    <text x={sx} y={fy + 15}
                      fill="white" fontSize={10} textAnchor="middle" dominantBaseline="central">×</text>
                  </g>
                )}
              </g>
            );
          }
        })}
      </svg>

      {/* Status bar */}
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-cad-toolbar border-t flex items-center px-3">
        <span className="text-[10px] font-mono text-muted-foreground">
          Lines: {lines.length} | Grid: {GRID}mm |{' '}
          {activeTool === 'line'
            ? `Click to place ${lineAxis === 'x' ? 'horizontal' : 'vertical'} fold line`
            : 'Click × to delete a line'}
        </span>
      </div>
    </div>
  );
}
