import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { SheetMetalDefaults, MATERIALS } from '@/lib/sheetmetal';
import { Settings2, ArrowUpFromLine, ArrowDownFromLine, Trash2, Plus, Scissors } from 'lucide-react';
import { PartEdge, Flange, Fold, getUserFacingDirection } from '@/lib/geometry';

interface PropertiesPanelProps {
  defaults: SheetMetalDefaults;
  onDefaultsChange: (defaults: SheetMetalDefaults) => void;
  gridSize: number;
  onGridSizeChange: (size: number) => void;
  entityCount: number;
  mode?: 'sketch' | '3d';
  selectedEdge?: PartEdge | null;
  flanges?: Flange[];
  onAddFlange?: (height: number, angle: number, direction: 'up' | 'down') => void;
  onUpdateFlange?: (id: string, updates: Partial<Flange>) => void;
  onRemoveFlange?: (id: string) => void;
  folds?: Fold[];
  onRemoveFold?: (id: string) => void;
}

export function PropertiesPanel({
  defaults,
  onDefaultsChange,
  gridSize,
  onGridSizeChange,
  entityCount,
  mode = 'sketch',
  selectedEdge,
  flanges = [],
  onAddFlange,
  onUpdateFlange,
  onRemoveFlange,
  folds = [],
  onRemoveFold,
}: PropertiesPanelProps) {
  const [flangeHeight, setFlangeHeight] = useState(20);
  const [flangeAngle, setFlangeAngle] = useState(90);
  const [flangeDirection, setFlangeDirection] = useState<'up' | 'down'>('up');

  const existingFlange = selectedEdge
    ? flanges.find(f => f.edgeId === selectedEdge.id)
    : null;
  const edgeHasFlange = !!existingFlange;

  return (
    <div className="w-64 border-l bg-card overflow-y-auto flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">
            {mode === 'sketch' ? 'Sheet Metal Defaults' : 'Part Properties'}
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === 'sketch' ? 'Properties for bend calculations' : 'Edit flanges and properties'}
        </p>
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
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MATERIALS.map(m => (
                <SelectItem key={m.name} value={m.name} className="text-xs">{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Thickness */}
        <div className="space-y-1.5">
          <Label className="text-xs">Thickness (mm)</Label>
          <Input type="number" step={0.1} min={0.1} value={defaults.thickness}
            onChange={(e) => onDefaultsChange({ ...defaults, thickness: parseFloat(e.target.value) || 1 })}
            className="h-8 text-xs font-mono" />
        </div>

        {/* Bend Radius */}
        <div className="space-y-1.5">
          <Label className="text-xs">Bend Radius (mm)</Label>
          <Input type="number" step={0.1} min={0.1} value={defaults.bendRadius}
            onChange={(e) => onDefaultsChange({ ...defaults, bendRadius: parseFloat(e.target.value) || 1 })}
            className="h-8 text-xs font-mono" />
        </div>

        {/* K-Factor */}
        <div className="space-y-1.5">
          <Label className="text-xs">K-Factor</Label>
          <Input type="number" step={0.01} min={0} max={0.5} value={defaults.kFactor}
            onChange={(e) => onDefaultsChange({ ...defaults, kFactor: parseFloat(e.target.value) || 0.44 })}
            className="h-8 text-xs font-mono" />
          <p className="text-[10px] text-muted-foreground">Linear method (0.0 – 0.5)</p>
        </div>

        <Separator />

        {mode === 'sketch' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Grid Size (mm)</Label>
              <Input type="number" step={1} min={1} max={100} value={gridSize}
                onChange={(e) => onGridSizeChange(parseInt(e.target.value) || 10)}
                className="h-8 text-xs font-mono" />
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sketch Entities</p>
              <p className="text-lg font-mono font-bold">{entityCount}</p>
            </div>
          </>
        )}

        {/* ── 3D mode: edge / flange controls ── */}
        {mode === '3d' && selectedEdge && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Selected Edge</p>
              <p className="text-sm font-mono font-medium text-primary">{selectedEdge.id}</p>
              <p className="text-[10px] text-muted-foreground">
                Length: {selectedEdge.start.distanceTo(selectedEdge.end).toFixed(1)} mm
              </p>
            </div>

            {!edgeHasFlange && (
              <div className="p-3 rounded-lg bg-muted/50 border space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowUpFromLine className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold">Add Flange</p>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Height (mm)</Label>
                    <Input type="number" step={1} min={1} value={flangeHeight}
                      onChange={(e) => setFlangeHeight(parseFloat(e.target.value) || 20)}
                      className="h-7 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Bend Angle (°)</Label>
                    <Input type="number" step={1} min={1} max={180} value={flangeAngle}
                      onChange={(e) => setFlangeAngle(parseFloat(e.target.value) || 90)}
                      className="h-7 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Direction</Label>
                    <div className="flex gap-1">
                      <Button variant={flangeDirection === 'up' ? 'default' : 'outline'} size="sm"
                        className="flex-1 h-7 text-[10px] gap-1"
                        onClick={() => setFlangeDirection('up')}>
                        <ArrowUpFromLine className="h-3 w-3" /> Up
                      </Button>
                      <Button variant={flangeDirection === 'down' ? 'default' : 'outline'} size="sm"
                        className="flex-1 h-7 text-[10px] gap-1"
                        onClick={() => setFlangeDirection('down')}>
                        <ArrowDownFromLine className="h-3 w-3" /> Down
                      </Button>
                    </div>
                  </div>
                </div>
                <Button size="sm" className="w-full text-xs gap-1"
                  onClick={() => onAddFlange?.(flangeHeight, flangeAngle, flangeDirection)}>
                  <Plus className="h-3 w-3" /> Add Flange
                </Button>
              </div>
            )}

            {edgeHasFlange && existingFlange && (() => {
              const displayDirection = getUserFacingDirection(existingFlange.edgeId);
              return (
                <div className="p-3 rounded-lg bg-accent/10 border border-accent/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowUpFromLine className="h-4 w-4 text-accent" />
                      <p className="text-xs font-semibold">Flange</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                      onClick={() => onRemoveFlange?.(existingFlange.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Height (mm)</Label>
                      <Input type="number" step={1} min={1} value={existingFlange.height}
                        onChange={(e) => onUpdateFlange?.(existingFlange.id, { height: parseFloat(e.target.value) || 20 })}
                        className="h-7 text-xs font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Bend Angle (°)</Label>
                      <Input type="number" step={1} min={1} max={180} value={existingFlange.angle}
                        onChange={(e) => onUpdateFlange?.(existingFlange.id, { angle: parseFloat(e.target.value) || 90 })}
                        className="h-7 text-xs font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Direction</Label>
                      <div className="flex gap-1">
                        <Button variant={displayDirection === 'up' ? 'default' : 'outline'} size="sm"
                          className="flex-1 h-7 text-[10px] gap-1"
                          onClick={() => onUpdateFlange?.(existingFlange.id, { direction: 'up' })}>
                          <ArrowUpFromLine className="h-3 w-3" /> Up
                        </Button>
                        <Button variant={displayDirection === 'down' ? 'default' : 'outline'} size="sm"
                          className="flex-1 h-7 text-[10px] gap-1"
                          onClick={() => onUpdateFlange?.(existingFlange.id, { direction: 'down' })}>
                          <ArrowDownFromLine className="h-3 w-3" /> Down
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {mode === '3d' && !selectedEdge && (
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs text-muted-foreground text-center">
              Click an edge on the 3D part to select it for flange operations
            </p>
          </div>
        )}

        {/* ── Folds summary ── */}
        {mode === '3d' && folds.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Scissors className="h-3.5 w-3.5 text-destructive" />
                <p className="text-xs font-semibold">Folds ({folds.length})</p>
              </div>
              {folds.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-2 rounded bg-muted/30 border text-[10px]"
                >
                  <div className="font-mono">
                    <span className="text-muted-foreground">
                      {f.axis.toUpperCase()}-axis @ {f.offset}mm
                    </span>
                    <br />
                    {f.angle}° {f.direction}
                  </div>
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive"
                    onClick={() => onRemoveFold?.(f.id)}>
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Flanges summary ── */}
        {mode === '3d' && flanges.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-semibold">Flanges ({flanges.length})</p>
              {flanges.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-2 rounded bg-muted/30 border text-[10px]"
                >
                  <div className="font-mono">
                    <span className="text-muted-foreground">{f.edgeId}</span>
                    <br />
                    {f.height}mm × {f.angle}° {getUserFacingDirection(f.edgeId)}
                  </div>
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive"
                    onClick={() => onRemoveFlange?.(f.id)}>
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
