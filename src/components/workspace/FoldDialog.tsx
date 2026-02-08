import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowUpFromLine, ArrowDownFromLine } from 'lucide-react';
import { FaceSketchLine } from '@/lib/geometry';

interface FoldDialogProps {
  open: boolean;
  sketchLine: FaceSketchLine;
  defaultBendRadius: number;
  onApply: (params: {
    angle: number;
    direction: 'up' | 'down';
    bendRadius: number;
    foldLocation: 'centerline' | 'material-inside' | 'material-outside';
  }) => void;
  onClose: () => void;
}

type FoldLocation = 'centerline' | 'material-inside' | 'material-outside';

export function FoldDialog({ open, sketchLine, defaultBendRadius, onApply, onClose }: FoldDialogProps) {
  const [angle, setAngle] = useState(90);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [bendRadius, setBendRadius] = useState(defaultBendRadius);
  const [foldLocation, setFoldLocation] = useState<FoldLocation>('centerline');

  // Derive orientation from line geometry
  const isHoriz = Math.abs(sketchLine.start.y - sketchLine.end.y) < 1;
  const orientation = isHoriz ? 'Horizontal' : Math.abs(sketchLine.start.x - sketchLine.end.x) < 1 ? 'Vertical' : 'Diagonal';
  const offset = isHoriz
    ? ((sketchLine.start.y + sketchLine.end.y) / 2).toFixed(1)
    : ((sketchLine.start.x + sketchLine.end.x) / 2).toFixed(1);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Fold</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bend line info */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs text-muted-foreground mb-1">Bend Line</p>
            <p className="text-sm font-mono font-medium">
              {orientation} @ {offset}mm
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              ({sketchLine.start.x.toFixed(1)}, {sketchLine.start.y.toFixed(1)}) → ({sketchLine.end.x.toFixed(1)}, {sketchLine.end.y.toFixed(1)})
            </p>
          </div>

          {/* Flip direction */}
          <div className="space-y-1.5">
            <Label className="text-xs">Fold Direction</Label>
            <div className="flex gap-1">
              <Button variant={direction === 'up' ? 'default' : 'outline'} size="sm"
                className="flex-1 h-8 text-xs gap-1.5"
                onClick={() => setDirection('up')}>
                <ArrowUpFromLine className="h-3.5 w-3.5" /> Up
              </Button>
              <Button variant={direction === 'down' ? 'default' : 'outline'} size="sm"
                className="flex-1 h-8 text-xs gap-1.5"
                onClick={() => setDirection('down')}>
                <ArrowDownFromLine className="h-3.5 w-3.5" /> Down
              </Button>
            </div>
          </div>

          {/* Fold location */}
          <div className="space-y-1.5">
            <Label className="text-xs">Fold Location</Label>
            <div className="grid grid-cols-3 gap-1">
              {([
                { value: 'centerline' as const, label: 'Centerline', icon: '┃' },
                { value: 'material-inside' as const, label: 'Mat. Inside', icon: '┫' },
                { value: 'material-outside' as const, label: 'Mat. Outside', icon: '┣' },
              ]).map(opt => (
                <Button key={opt.value}
                  variant={foldLocation === opt.value ? 'default' : 'outline'}
                  size="sm" className="h-9 text-[10px] flex-col gap-0.5 py-1"
                  onClick={() => setFoldLocation(opt.value)}>
                  <span className="text-sm font-mono leading-none">{opt.icon}</span>
                  <span>{opt.label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Fold angle */}
          <div className="space-y-1.5">
            <Label className="text-xs">Fold Angle (°)</Label>
            <Input type="number" step={1} min={1} max={180} value={angle}
              onChange={(e) => setAngle(parseFloat(e.target.value) || 90)}
              className="h-8 text-xs font-mono" />
          </div>

          {/* Bend radius */}
          <div className="space-y-1.5">
            <Label className="text-xs">Bend Radius (mm)</Label>
            <Input type="number" step={0.1} min={0.1} value={bendRadius}
              onChange={(e) => setBendRadius(parseFloat(e.target.value) || 1)}
              className="h-8 text-xs font-mono" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onApply({ angle, direction, bendRadius, foldLocation })}>
            Apply Fold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
