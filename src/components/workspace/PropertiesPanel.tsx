import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { SheetMetalDefaults, MATERIALS } from '@/lib/sheetmetal';
import { Settings2, RotateCcw, ArrowUpFromLine } from 'lucide-react';
import { PartEdge } from '@/lib/geometry';

interface PropertiesPanelProps {
  defaults: SheetMetalDefaults;
  onDefaultsChange: (defaults: SheetMetalDefaults) => void;
  gridSize: number;
  onGridSizeChange: (size: number) => void;
  entityCount: number;
  /** If in base-face or flanges step */
  mode?: 'sketch' | '3d';
  selectedEdge?: PartEdge | null;
  onAddFlange?: (height: number, angle: number, direction: 'up' | 'down') => void;
}

export function PropertiesPanel({
  defaults,
  onDefaultsChange,
  gridSize,
  onGridSizeChange,
  entityCount,
  mode = 'sketch',
  selectedEdge,
  onAddFlange,
}: PropertiesPanelProps) {
  return (
    <div className="w-64 border-l bg-card overflow-y-auto flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Sheet Metal Defaults</h3>
        </div>
        <p className="text-xs text-muted-foreground">Properties for bend calculations</p>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Material */}
        <div className="space-y-1.5">
          <Label className="text-xs">Material</Label>
          <Select
            value={defaults.material}
            onValueChange={(val) => {
              const mat = MATERIALS.find(m => m.name === val);
              onDefaultsChange({
                ...defaults,
                material: val,
                kFactor: mat ? mat.defaultK : defaults.kFactor,
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATERIALS.map(m => (
                <SelectItem key={m.name} value={m.name} className="text-xs">
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Thickness */}
        <div className="space-y-1.5">
          <Label className="text-xs">Thickness (mm)</Label>
          <Input
            type="number"
            step={0.1}
            min={0.1}
            value={defaults.thickness}
            onChange={(e) => onDefaultsChange({ ...defaults, thickness: parseFloat(e.target.value) || 1 })}
            className="h-8 text-xs font-mono"
          />
        </div>

        {/* Bend Radius */}
        <div className="space-y-1.5">
          <Label className="text-xs">Bend Radius (mm)</Label>
          <Input
            type="number"
            step={0.1}
            min={0.1}
            value={defaults.bendRadius}
            onChange={(e) => onDefaultsChange({ ...defaults, bendRadius: parseFloat(e.target.value) || 1 })}
            className="h-8 text-xs font-mono"
          />
        </div>

        {/* K-Factor */}
        <div className="space-y-1.5">
          <Label className="text-xs">K-Factor</Label>
          <Input
            type="number"
            step={0.01}
            min={0}
            max={0.5}
            value={defaults.kFactor}
            onChange={(e) => onDefaultsChange({ ...defaults, kFactor: parseFloat(e.target.value) || 0.44 })}
            className="h-8 text-xs font-mono"
          />
          <p className="text-[10px] text-muted-foreground">Linear method (0.0 – 0.5)</p>
        </div>

        <Separator />

        {mode === 'sketch' && (
          <>
            {/* Grid Size */}
            <div className="space-y-1.5">
              <Label className="text-xs">Grid Size (mm)</Label>
              <Input
                type="number"
                step={1}
                min={1}
                max={100}
                value={gridSize}
                onChange={(e) => onGridSizeChange(parseInt(e.target.value) || 10)}
                className="h-8 text-xs font-mono"
              />
            </div>

            <Separator />

            {/* Info */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sketch Entities</p>
              <p className="text-lg font-mono font-bold">{entityCount}</p>
            </div>
          </>
        )}

        {mode === '3d' && selectedEdge && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Selected Edge</p>
              <p className="text-sm font-mono font-medium text-primary">{selectedEdge.id}</p>
              <p className="text-[10px] text-muted-foreground">
                Length: {selectedEdge.start.distanceTo(selectedEdge.end).toFixed(1)} mm
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 border space-y-3">
              <div className="flex items-center gap-2">
                <ArrowUpFromLine className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold">Add Flange</p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Click an edge in the 3D view, then add a flange here.
              </p>
              <Button
                size="sm"
                className="w-full text-xs"
                onClick={() => onAddFlange?.(20, 90, 'up')}
              >
                Add Flange (90° × 20mm)
              </Button>
            </div>
          </>
        )}

        {mode === '3d' && !selectedEdge && (
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs text-muted-foreground text-center">
              Click an edge on the 3D part to select it for flange operations
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
