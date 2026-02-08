import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SheetMetalDefaults, MATERIALS } from '@/lib/sheetmetal';
import { Settings2 } from 'lucide-react';

interface PropertiesPanelProps {
  defaults: SheetMetalDefaults;
  onDefaultsChange: (defaults: SheetMetalDefaults) => void;
  gridSize: number;
  onGridSizeChange: (size: number) => void;
  entityCount: number;
}

export function PropertiesPanel({
  defaults,
  onDefaultsChange,
  gridSize,
  onGridSizeChange,
  entityCount,
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
      </div>
    </div>
  );
}
