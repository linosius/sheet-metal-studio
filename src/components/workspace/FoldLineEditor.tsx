import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowUpFromLine, ArrowDownFromLine } from 'lucide-react';
import { Point2D } from '@/lib/sheetmetal';

interface FoldLineEditorProps {
  open: boolean;
  faceWidth: number;
  faceHeight: number;
  faceOrigin: Point2D;
  defaultBendRadius: number;
  onApply: (data: {
    offset: number;
    axis: 'x' | 'y';
    angle: number;
    direction: 'up' | 'down';
    bendRadius: number;
  }) => void;
  onClose: () => void;
}

export function FoldLineEditor({
  open,
  faceWidth,
  faceHeight,
  faceOrigin,
  defaultBendRadius,
  onApply,
  onClose,
}: FoldLineEditorProps) {
  const [axis, setAxis] = useState<'x' | 'y'>('x');
  const [offset, setOffset] = useState(Math.round((axis === 'x' ? faceHeight : faceWidth) / 2));
  const [angle, setAngle] = useState(90);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [bendRadius, setBendRadius] = useState(defaultBendRadius);

  const maxOffset = axis === 'x' ? faceHeight : faceWidth;

  // SVG sizing
  const padding = 50;
  const maxSvgDim = 280;
  const scale = Math.min(maxSvgDim / faceWidth, maxSvgDim / faceHeight);
  const svgW = faceWidth * scale + padding * 2;
  const svgH = faceHeight * scale + padding * 2;

  const faceX = padding;
  const faceY = padding;
  const faceW = faceWidth * scale;
  const faceH = faceHeight * scale;

  // Fold line position in SVG
  const foldLineSvg =
    axis === 'x'
      ? { x1: faceX, y1: faceY + offset * scale, x2: faceX + faceW, y2: faceY + offset * scale }
      : { x1: faceX + offset * scale, y1: faceY, x2: faceX + offset * scale, y2: faceY + faceH };

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (axis === 'x') {
        const y = (e.clientY - rect.top - padding) / scale;
        setOffset(Math.max(1, Math.min(Math.round(faceHeight) - 1, Math.round(y))));
      } else {
        const x = (e.clientX - rect.left - padding) / scale;
        setOffset(Math.max(1, Math.min(Math.round(faceWidth) - 1, Math.round(x))));
      }
    },
    [axis, scale, faceWidth, faceHeight],
  );

  const handleAxisChange = (newAxis: 'x' | 'y') => {
    const newMax = newAxis === 'x' ? faceHeight : faceWidth;
    setAxis(newAxis);
    setOffset(Math.min(offset, Math.round(newMax) - 1));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Place Fold Line</DialogTitle>
        </DialogHeader>

        <div className="flex gap-6">
          {/* SVG Canvas */}
          <div className="flex-1 flex items-center justify-center">
            <svg
              width={svgW}
              height={svgH}
              className="bg-muted/20 rounded-lg border cursor-crosshair select-none"
              onClick={handleSvgClick}
            >
              {/* Face fill — fixed region */}
              {axis === 'x' ? (
                <>
                  <rect x={faceX} y={faceY} width={faceW} height={offset * scale}
                    fill="hsl(172 66% 45% / 0.08)" stroke="none" />
                  <rect x={faceX} y={faceY + offset * scale} width={faceW} height={faceH - offset * scale}
                    fill="hsl(217 91% 55% / 0.08)" stroke="none" />
                </>
              ) : (
                <>
                  <rect x={faceX} y={faceY} width={offset * scale} height={faceH}
                    fill="hsl(172 66% 45% / 0.08)" stroke="none" />
                  <rect x={faceX + offset * scale} y={faceY} width={faceW - offset * scale} height={faceH}
                    fill="hsl(217 91% 55% / 0.08)" stroke="none" />
                </>
              )}

              {/* Face outline */}
              <rect
                x={faceX} y={faceY} width={faceW} height={faceH}
                fill="none" stroke="hsl(var(--border))" strokeWidth={1.5}
              />

              {/* Grid lines */}
              <g opacity={0.15}>
                {Array.from({ length: Math.floor(faceWidth / 10) - 1 }, (_, i) => (
                  <line key={`gx${i}`}
                    x1={faceX + (i + 1) * 10 * scale} y1={faceY}
                    x2={faceX + (i + 1) * 10 * scale} y2={faceY + faceH}
                    stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                ))}
                {Array.from({ length: Math.floor(faceHeight / 10) - 1 }, (_, i) => (
                  <line key={`gy${i}`}
                    x1={faceX} y1={faceY + (i + 1) * 10 * scale}
                    x2={faceX + faceW} y2={faceY + (i + 1) * 10 * scale}
                    stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                ))}
              </g>

              {/* Fold line */}
              <line
                x1={foldLineSvg.x1} y1={foldLineSvg.y1}
                x2={foldLineSvg.x2} y2={foldLineSvg.y2}
                stroke="hsl(var(--cad-bend-line))" strokeWidth={2.5}
                strokeDasharray="8 4"
              />

              {/* Dimension annotation */}
              {axis === 'x' ? (
                <g>
                  {/* Vertical dimension line */}
                  <line x1={faceX - 20} y1={faceY} x2={faceX - 20} y2={foldLineSvg.y1}
                    stroke="hsl(var(--cad-dimension))" strokeWidth={1} />
                  {/* Extension lines */}
                  <line x1={faceX - 25} y1={faceY} x2={faceX - 15} y2={faceY}
                    stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                  <line x1={faceX - 25} y1={foldLineSvg.y1} x2={faceX - 15} y2={foldLineSvg.y1}
                    stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                  {/* Label */}
                  <text
                    x={faceX - 30}
                    y={(faceY + foldLineSvg.y1) / 2}
                    fill="hsl(var(--cad-dimension))"
                    fontSize={11} fontFamily="JetBrains Mono, monospace" fontWeight={600}
                    textAnchor="middle" dominantBaseline="middle"
                    transform={`rotate(-90, ${faceX - 30}, ${(faceY + foldLineSvg.y1) / 2})`}
                  >
                    {offset}mm
                  </text>
                </g>
              ) : (
                <g>
                  <line x1={faceX} y1={faceY - 20} x2={foldLineSvg.x1} y2={faceY - 20}
                    stroke="hsl(var(--cad-dimension))" strokeWidth={1} />
                  <line x1={faceX} y1={faceY - 25} x2={faceX} y2={faceY - 15}
                    stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                  <line x1={foldLineSvg.x1} y1={faceY - 25} x2={foldLineSvg.x1} y2={faceY - 15}
                    stroke="hsl(var(--cad-dimension))" strokeWidth={0.8} />
                  <text
                    x={(faceX + foldLineSvg.x1) / 2}
                    y={faceY - 30}
                    fill="hsl(var(--cad-dimension))"
                    fontSize={11} fontFamily="JetBrains Mono, monospace" fontWeight={600}
                    textAnchor="middle"
                  >
                    {offset}mm
                  </text>
                </g>
              )}

              {/* Face dimension labels */}
              <text
                x={faceX + faceW / 2} y={faceY + faceH + 18}
                fill="hsl(var(--muted-foreground))" fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                textAnchor="middle"
              >
                {faceWidth.toFixed(0)}mm
              </text>
              <text
                x={faceX + faceW + 18} y={faceY + faceH / 2}
                fill="hsl(var(--muted-foreground))" fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                textAnchor="middle"
                transform={`rotate(90, ${faceX + faceW + 18}, ${faceY + faceH / 2})`}
              >
                {faceHeight.toFixed(0)}mm
              </text>

              {/* Region labels */}
              {axis === 'x' ? (
                <>
                  <text x={faceX + faceW / 2} y={faceY + offset * scale / 2}
                    fill="hsl(var(--accent))" fontSize={9} fontWeight={600}
                    textAnchor="middle" dominantBaseline="middle" opacity={0.7}>
                    FIXED
                  </text>
                  <text x={faceX + faceW / 2} y={faceY + offset * scale + (faceH - offset * scale) / 2}
                    fill="hsl(var(--primary))" fontSize={9} fontWeight={600}
                    textAnchor="middle" dominantBaseline="middle" opacity={0.7}>
                    FOLD
                  </text>
                </>
              ) : (
                <>
                  <text x={faceX + offset * scale / 2} y={faceY + faceH / 2}
                    fill="hsl(var(--accent))" fontSize={9} fontWeight={600}
                    textAnchor="middle" dominantBaseline="middle" opacity={0.7}>
                    FIXED
                  </text>
                  <text x={faceX + offset * scale + (faceW - offset * scale) / 2} y={faceY + faceH / 2}
                    fill="hsl(var(--primary))" fontSize={9} fontWeight={600}
                    textAnchor="middle" dominantBaseline="middle" opacity={0.7}>
                    FOLD
                  </text>
                </>
              )}
            </svg>
          </div>

          {/* Controls */}
          <div className="w-44 space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Fold Axis</Label>
              <div className="flex gap-1">
                <Button
                  variant={axis === 'x' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 h-7 text-[10px]"
                  onClick={() => handleAxisChange('x')}
                >
                  Horizontal
                </Button>
                <Button
                  variant={axis === 'y' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 h-7 text-[10px]"
                  onClick={() => handleAxisChange('y')}
                >
                  Vertical
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Offset (mm)</Label>
              <Input
                type="number"
                step={1}
                min={1}
                max={maxOffset - 1}
                value={offset}
                onChange={(e) => setOffset(Math.max(1, Math.min(maxOffset - 1, parseFloat(e.target.value) || 1)))}
                className="h-7 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Max: {(maxOffset - 1).toFixed(0)}mm
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Bend Angle (°)</Label>
              <Input
                type="number"
                step={1}
                min={1}
                max={180}
                value={angle}
                onChange={(e) => setAngle(parseFloat(e.target.value) || 90)}
                className="h-7 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Direction</Label>
              <div className="flex gap-1">
                <Button
                  variant={direction === 'up' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 h-7 text-[10px] gap-1"
                  onClick={() => setDirection('up')}
                >
                  <ArrowUpFromLine className="h-3 w-3" />
                  Up
                </Button>
                <Button
                  variant={direction === 'down' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 h-7 text-[10px] gap-1"
                  onClick={() => setDirection('down')}
                >
                  <ArrowDownFromLine className="h-3 w-3" />
                  Down
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Bend Radius (mm)</Label>
              <Input
                type="number"
                step={0.1}
                min={0.1}
                value={bendRadius}
                onChange={(e) => setBendRadius(parseFloat(e.target.value) || 1)}
                className="h-7 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApply({ offset, axis, angle, direction, bendRadius })}>
            Apply Fold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
