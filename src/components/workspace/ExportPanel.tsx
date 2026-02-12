import { useState, useEffect, useRef, useMemo } from 'react';
import { FileDown, FileText, Image, File, Table2, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Point2D } from '@/lib/sheetmetal';
import { Flange, Fold, FaceSketch, ProfileCutout } from '@/lib/geometry';
import { unfoldModel, FlatPatternResult } from '@/lib/metalHeroApi';
import {
  exportFlatPatternSVG,
  exportFlatPatternDXF,
  exportFlatPatternPDF,
  generateBendTable,
  downloadText,
  downloadBlob,
  BendTableRow,
} from '@/lib/export';
import { toast } from 'sonner';

interface ExportPanelProps {
  profile: Point2D[];
  thickness: number;
  flanges: Flange[];
  folds: Fold[];
  kFactor: number;
  cutouts?: ProfileCutout[];
  faceSketches?: FaceSketch[];
}

const FORMATS = [
  { id: 'dxf', label: 'DXF', icon: FileDown, description: 'AutoCAD-compatible flat pattern' },
  { id: 'svg', label: 'SVG', icon: Image, description: 'Scalable vector graphic' },
  { id: 'pdf', label: 'PDF', icon: File, description: 'Flat pattern + bend table report' },
] as const;

type FormatId = typeof FORMATS[number]['id'];

export function ExportPanel({ profile, thickness, flanges, folds, kFactor, cutouts = [], faceSketches = [] }: ExportPanelProps) {
  const [exporting, setExporting] = useState<FormatId | null>(null);

  // Async unfold from API
  const [pattern, setPattern] = useState<FlatPatternResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await unfoldModel(profile, thickness, cutouts, folds, flanges, faceSketches, kFactor);
        setPattern(result);
      } catch (err: any) {
        console.error('[API] unfoldModel failed:', err);
        setError(err.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [profile, thickness, flanges, kFactor, folds, cutouts, faceSketches]);

  // Convert API pattern to export-compatible format
  const exportPattern = useMemo(() => {
    if (!pattern) return null;
    return {
      regions: pattern.regions.map(r => ({
        id: r.id,
        type: (r.id === 'base' ? 'base' : 'flange') as 'base' | 'flange',
        polygon: r.polygon,
      })),
      bendLines: pattern.bendLines.map(bl => ({
        start: bl.start,
        end: bl.end,
        angle: bl.angle,
        radius: bl.radius,
        label: bl.label,
      })),
      boundingBox: pattern.boundingBox,
      overallWidth: pattern.overallWidth,
      overallHeight: pattern.overallHeight,
    };
  }, [pattern]);

  const bendTable = useMemo(() => {
    if (!exportPattern) return [];
    return generateBendTable(exportPattern.bendLines);
  }, [exportPattern]);

  const handleExport = (format: FormatId) => {
    if (!exportPattern) return;
    setExporting(format);
    try {
      switch (format) {
        case 'svg': {
          const svg = exportFlatPatternSVG(exportPattern);
          downloadText(svg, 'flat-pattern.svg', 'image/svg+xml');
          toast.success('SVG exported');
          break;
        }
        case 'dxf': {
          const dxf = exportFlatPatternDXF(exportPattern);
          downloadText(dxf, 'flat-pattern.dxf', 'application/dxf');
          toast.success('DXF exported');
          break;
        }
        case 'pdf': {
          const pdf = exportFlatPatternPDF(exportPattern, bendTable);
          downloadBlob(pdf, 'flat-pattern-report.pdf');
          toast.success('PDF report exported');
          break;
        }
      }
    } catch (err) {
      toast.error('Export failed', { description: String(err) });
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Computing flat pattern...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 max-w-sm text-center">
          <p className="text-sm text-destructive font-medium">Unfold Error</p>
          <p className="text-xs text-destructive/80 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!exportPattern) return null;

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Export Flat Pattern</h2>
          <p className="text-sm text-muted-foreground">Download your unfolded sheet metal pattern in various formats</p>
        </div>

        <div className="flex items-center justify-center gap-6">
          <Stat label="Overall" value={`${exportPattern.overallWidth.toFixed(1)} × ${exportPattern.overallHeight.toFixed(1)} mm`} />
          <Separator orientation="vertical" className="h-8" />
          <Stat label="Bends" value={String(bendTable.length)} />
          <Separator orientation="vertical" className="h-8" />
          <Stat label="Flanges" value={String(flanges.length)} />
          <Separator orientation="vertical" className="h-8" />
          <Stat label="Thickness" value={`${thickness} mm`} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {FORMATS.map(fmt => {
            const Icon = fmt.icon;
            return (
              <Card key={fmt.id} className="p-4 flex flex-col items-center gap-3 hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => handleExport(fmt.id)}>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-sm">{fmt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmt.description}</p>
                </div>
                <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" disabled={exporting === fmt.id}>
                  <Download className="h-3 w-3" />
                  {exporting === fmt.id ? 'Exporting…' : 'Download'}
                </Button>
              </Card>
            );
          })}
        </div>

        {bendTable.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <Table2 className="h-4 w-4" />
                Bend Table
              </h3>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                const csv = bendTableToCSV(bendTable);
                downloadText(csv, 'bend-table.csv', 'text/csv');
                toast.success('Bend table CSV exported');
              }}>
                <FileText className="h-3 w-3" />
                Export CSV
              </Button>
            </div>
            <Card className="overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium">Bend</th>
                    <th className="text-right px-3 py-2 font-medium">Angle (°)</th>
                    <th className="text-right px-3 py-2 font-medium">Radius (mm)</th>
                    <th className="text-left px-3 py-2 font-medium">Direction</th>
                    <th className="text-right px-3 py-2 font-medium">Length (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {bendTable.map(row => (
                    <tr key={row.label} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-mono">{row.label}</td>
                      <td className="text-right px-3 py-1.5 font-mono">{row.angle.toFixed(1)}</td>
                      <td className="text-right px-3 py-1.5 font-mono">{row.radius.toFixed(2)}</td>
                      <td className="px-3 py-1.5">{row.direction}</td>
                      <td className="text-right px-3 py-1.5 font-mono">{row.length.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-medium">{value}</p>
    </div>
  );
}

function bendTableToCSV(rows: BendTableRow[]): string {
  const header = 'Bend,Angle (°),Radius (mm),Direction,Length (mm)';
  const lines = rows.map(r => `${r.label},${r.angle.toFixed(1)},${r.radius.toFixed(2)},${r.direction},${r.length.toFixed(2)}`);
  return [header, ...lines].join('\n');
}
