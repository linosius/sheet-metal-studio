import { useRef, useState, useCallback, useEffect } from 'react';
import {
  SketchEntity, Point2D, snapToGrid, distance2D, midpoint2D,
  arcSvgPath, trimLineAtIntersections, extendLineToNearest, closestEndpoint,
  offsetLine, offsetRect, offsetCircle, pointSideOfLine, mirrorEntity,
  generateId,
} from '@/lib/sheetmetal';
import { SketchTool } from '@/hooks/useSketchStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SketchCanvasProps {
  entities: SketchEntity[];
  selectedIds: string[];
  activeTool: SketchTool;
  gridSize: number;
  snapEnabled: boolean;
  onAddLine: (start: Point2D, end: Point2D) => void;
  onAddRect: (origin: Point2D, width: number, height: number) => void;
  onAddCircle: (center: Point2D, radius: number) => void;
  onAddArc: (center: Point2D, radius: number, startAngle: number, endAngle: number) => void;
  onAddPoint: (position: Point2D) => void;
  onUpdateEntity: (id: string, updates: Partial<SketchEntity>) => void;
  onAddEntities: (entities: SketchEntity[]) => void;
  onSelectEntity: (id: string, multi?: boolean) => void;
  onDeselectAll: () => void;
  onRemoveEntities: (ids: string[]) => void;
}

const CANVAS_SIZE = 2000;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;

type ArcPhase = 'center' | 'radius' | 'end';
type MirrorPhase = 'axis1' | 'axis2';

// Check if a point is inside a box (min/max normalized)
function pointInBox(p: Point2D, b1: Point2D, b2: Point2D): boolean {
  const minX = Math.min(b1.x, b2.x), maxX = Math.max(b1.x, b2.x);
  const minY = Math.min(b1.y, b2.y), maxY = Math.max(b1.y, b2.y);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

// Check if entity is fully enclosed in selection box
function entityInBox(ent: SketchEntity, b1: Point2D, b2: Point2D): boolean {
  if (ent.type === 'line') return pointInBox(ent.start, b1, b2) && pointInBox(ent.end, b1, b2);
  if (ent.type === 'rect') {
    const corners = [
      ent.origin,
      { x: ent.origin.x + ent.width, y: ent.origin.y },
      { x: ent.origin.x + ent.width, y: ent.origin.y + ent.height },
      { x: ent.origin.x, y: ent.origin.y + ent.height },
    ];
    return corners.every(c => pointInBox(c, b1, b2));
  }
  if (ent.type === 'circle') {
    return pointInBox({ x: ent.center.x - ent.radius, y: ent.center.y - ent.radius }, b1, b2)
      && pointInBox({ x: ent.center.x + ent.radius, y: ent.center.y + ent.radius }, b1, b2);
  }
  if (ent.type === 'arc') return pointInBox(ent.center, b1, b2);
  if (ent.type === 'point') return pointInBox(ent.position, b1, b2);
  return false;
}

// Check if entity crosses (any key point inside) the selection box
function entityCrossesBox(ent: SketchEntity, b1: Point2D, b2: Point2D): boolean {
  if (ent.type === 'line') return pointInBox(ent.start, b1, b2) || pointInBox(ent.end, b1, b2);
  if (ent.type === 'rect') {
    const corners = [
      ent.origin,
      { x: ent.origin.x + ent.width, y: ent.origin.y },
      { x: ent.origin.x + ent.width, y: ent.origin.y + ent.height },
      { x: ent.origin.x, y: ent.origin.y + ent.height },
    ];
    return corners.some(c => pointInBox(c, b1, b2));
  }
  if (ent.type === 'circle') return pointInBox(ent.center, b1, b2);
  if (ent.type === 'arc') return pointInBox(ent.center, b1, b2);
  if (ent.type === 'point') return pointInBox(ent.position, b1, b2);
  return false;
}

export function SketchCanvas({
  entities,
  selectedIds,
  activeTool,
  gridSize,
  snapEnabled,
  onAddLine,
  onAddRect,
  onAddCircle,
  onAddArc,
  onAddPoint,
  onUpdateEntity,
  onAddEntities,
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

  // Arc state
  const [arcPhase, setArcPhase] = useState<ArcPhase>('center');
  const [arcCenter, setArcCenter] = useState<Point2D | null>(null);
  const [arcRadius, setArcRadius] = useState<number>(0);
  const [arcStartAngle, setArcStartAngle] = useState<number>(0);

  // Move state
  const [moveStart, setMoveStart] = useState<Point2D | null>(null);
  const [moveDragging, setMoveDragging] = useState(false); // entities attached to cursor

  // Mirror state
  const [mirrorPhase, setMirrorPhase] = useState<MirrorPhase>('axis1');
  const [mirrorAxis1, setMirrorAxis1] = useState<Point2D | null>(null);

  // Dimension editing
  const [editingDimId, setEditingDimId] = useState<string | null>(null);
  const [dimInputValue, setDimInputValue] = useState('');

  // Precision input for rect (W x H), line (Length, Angle), move (dX, dY)
  const [precisionMode, setPrecisionMode] = useState(false);
  const [precInput1, setPrecInput1] = useState('');
  const [precInput2, setPrecInput2] = useState('');
  const precInput1Ref = useRef<HTMLInputElement>(null);

  // Window selection box
  const [selBoxStart, setSelBoxStart] = useState<Point2D | null>(null);
  const [selBoxEnd, setSelBoxEnd] = useState<Point2D | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const svgToWorld = useCallback((clientX: number, clientY: number): Point2D => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  const getSnappedPoint = useCallback((p: Point2D): Point2D => {
    return snapEnabled ? snapToGrid(p, gridSize) : p;
  }, [snapEnabled, gridSize]);

  // Precision input submit
  const handlePrecisionSubmit = useCallback(() => {
    const v1 = parseFloat(precInput1);
    const v2 = parseFloat(precInput2);
    if (isNaN(v1) || isNaN(v2)) { toast.error('Ungültige Eingabe'); return; }

    if (activeTool === 'move' && moveDragging && moveStart) {
      // v1 = dX, v2 = dY
      for (const id of selectedIds) {
        const ent = entities.find(e => e.id === id);
        if (!ent) continue;
        if (ent.type === 'line') {
          onUpdateEntity(id, { start: { x: ent.start.x + v1, y: ent.start.y + v2 }, end: { x: ent.end.x + v1, y: ent.end.y + v2 } });
        } else if (ent.type === 'rect') {
          onUpdateEntity(id, { origin: { x: ent.origin.x + v1, y: ent.origin.y + v2 } });
        } else if (ent.type === 'circle') {
          onUpdateEntity(id, { center: { x: ent.center.x + v1, y: ent.center.y + v2 } });
        } else if (ent.type === 'arc') {
          onUpdateEntity(id, { center: { x: ent.center.x + v1, y: ent.center.y + v2 } });
        } else if (ent.type === 'point') {
          onUpdateEntity(id, { position: { x: ent.position.x + v1, y: ent.position.y + v2 } });
        }
      }
      setMoveStart(null);
      setMoveDragging(false);
      toast.success('Entities moved');
    } else if (activeTool === 'rect' && drawStart) {
      if (v1 <= 0 || v2 <= 0) { toast.error('Breite und Höhe müssen > 0 sein'); return; }
      onAddRect(drawStart, v1, v2);
      setDrawStart(null);
    } else if (activeTool === 'line' && drawStart) {
      if (v1 <= 0) { toast.error('Länge muss > 0 sein'); return; }
      const angleRad = (v2 * Math.PI) / 180;
      const end: Point2D = {
        x: drawStart.x + v1 * Math.cos(angleRad),
        y: drawStart.y + v1 * Math.sin(angleRad),
      };
      onAddLine(drawStart, end);
      setDrawStart(end);
    }
    setPrecisionMode(false);
    setPrecInput1('');
    setPrecInput2('');
  }, [drawStart, precInput1, precInput2, activeTool, onAddRect, onAddLine, onUpdateEntity, moveStart, moveDragging, selectedIds, entities]);

  // Reset tool state on tool change
  useEffect(() => {
    setDrawStart(null);
    setArcPhase('center');
    setArcCenter(null);
    setMoveStart(null);
    setMoveDragging(false);
    setMirrorPhase('axis1');
    setMirrorAxis1(null);
    setEditingDimId(null);
    setPrecisionMode(false);
    setPrecInput1('');
    setPrecInput2('');
    setSelBoxStart(null);
    setSelBoxEnd(null);
    setIsSelecting(false);
  }, [activeTool]);

  // Find nearest entity to a point
  const findNearestEntity = useCallback((p: Point2D): SketchEntity | null => {
    let best: SketchEntity | null = null;
    let bestDist = 15;
    for (const ent of entities) {
      let d = Infinity;
      if (ent.type === 'line') {
        const dx = ent.end.x - ent.start.x, dy = ent.end.y - ent.start.y;
        const len2 = dx * dx + dy * dy;
        if (len2 > 0) {
          const t = Math.max(0, Math.min(1, ((p.x - ent.start.x) * dx + (p.y - ent.start.y) * dy) / len2));
          const proj = { x: ent.start.x + t * dx, y: ent.start.y + t * dy };
          d = distance2D(p, proj);
        }
      } else if (ent.type === 'rect') {
        const corners = [
          { x: ent.origin.x, y: ent.origin.y },
          { x: ent.origin.x + ent.width, y: ent.origin.y },
          { x: ent.origin.x + ent.width, y: ent.origin.y + ent.height },
          { x: ent.origin.x, y: ent.origin.y + ent.height },
        ];
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          const dx = b.x - a.x, dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 > 0) {
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
            const proj = { x: a.x + t * dx, y: a.y + t * dy };
            d = Math.min(d, distance2D(p, proj));
          }
        }
      } else if (ent.type === 'circle') {
        d = Math.abs(distance2D(p, ent.center) - ent.radius);
      } else if (ent.type === 'arc') {
        d = Math.abs(distance2D(p, ent.center) - ent.radius);
      } else if (ent.type === 'point') {
        d = distance2D(p, ent.position);
      }
      if (d < bestDist) { bestDist = d; best = ent; }
    }
    return best;
  }, [entities]);

  // Complete window selection
  const completeWindowSelection = useCallback((start: Point2D, end: Point2D, forMove = false) => {
    const isLeftToRight = end.x >= start.x;
    const selected: string[] = [];
    for (const ent of entities) {
      const inBox = isLeftToRight ? entityInBox(ent, start, end) : entityCrossesBox(ent, start, end);
      if (inBox) selected.push(ent.id);
    }
    if (selected.length > 0) {
      onDeselectAll();
      selected.forEach(id => onSelectEntity(id, true));
      if (forMove) {
        // Compute center of selection as base point
        setMoveStart(getSnappedPoint({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }));
        setMoveDragging(true);
      }
    }
    setSelBoxStart(null);
    setSelBoxEnd(null);
    setIsSelecting(false);
  }, [entities, onDeselectAll, onSelectEntity, getSnappedPoint]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y });
      return;
    }
    if (e.button !== 0) return;

    const worldPos = svgToWorld(e.clientX, e.clientY);
    const snapped = getSnappedPoint(worldPos);

    switch (activeTool) {
      case 'select': {
        // Check if clicking on an entity first
        const nearest = findNearestEntity(worldPos);
        if (nearest) {
          onSelectEntity(nearest.id, e.shiftKey);
        } else {
          if (!e.shiftKey) onDeselectAll();
          // Start window selection
          setSelBoxStart(snapped);
          setSelBoxEnd(snapped);
          setIsSelecting(true);
        }
        break;
      }

      case 'line':
      case 'rect':
      case 'circle':
        if (!drawStart) {
          setDrawStart(snapped);
        } else {
          if (activeTool === 'line') {
            if (distance2D(drawStart, snapped) > 0.5) {
              onAddLine(drawStart, snapped);
              setDrawStart(snapped);
            }
          } else if (activeTool === 'rect') {
            const w = snapped.x - drawStart.x, h = snapped.y - drawStart.y;
            if (Math.abs(w) > 0.5 && Math.abs(h) > 0.5) {
              onAddRect(
                { x: Math.min(drawStart.x, snapped.x), y: Math.min(drawStart.y, snapped.y) },
                Math.abs(w), Math.abs(h),
              );
            }
            setDrawStart(null);
          } else if (activeTool === 'circle') {
            const r = distance2D(drawStart, snapped);
            if (r > 0.5) onAddCircle(drawStart, r);
            setDrawStart(null);
          }
        }
        break;

      case 'arc':
        if (arcPhase === 'center') {
          setArcCenter(snapped);
          setArcPhase('radius');
        } else if (arcPhase === 'radius' && arcCenter) {
          const r = distance2D(arcCenter, snapped);
          if (r > 0.5) {
            setArcRadius(r);
            setArcStartAngle(Math.atan2(snapped.y - arcCenter.y, snapped.x - arcCenter.x));
            setArcPhase('end');
          }
        } else if (arcPhase === 'end' && arcCenter) {
          const endAngle = Math.atan2(snapped.y - arcCenter.y, snapped.x - arcCenter.x);
          onAddArc(arcCenter, arcRadius, arcStartAngle, endAngle);
          setArcPhase('center');
          setArcCenter(null);
        }
        break;

      case 'point':
        onAddPoint(snapped);
        break;

      case 'move':
        if (moveDragging && moveStart) {
          // Place entities at new position
          const dx = snapped.x - moveStart.x, dy = snapped.y - moveStart.y;
          for (const id of selectedIds) {
            const ent = entities.find(e => e.id === id);
            if (!ent) continue;
            if (ent.type === 'line') {
              onUpdateEntity(id, { start: { x: ent.start.x + dx, y: ent.start.y + dy }, end: { x: ent.end.x + dx, y: ent.end.y + dy } });
            } else if (ent.type === 'rect') {
              onUpdateEntity(id, { origin: { x: ent.origin.x + dx, y: ent.origin.y + dy } });
            } else if (ent.type === 'circle') {
              onUpdateEntity(id, { center: { x: ent.center.x + dx, y: ent.center.y + dy } });
            } else if (ent.type === 'arc') {
              onUpdateEntity(id, { center: { x: ent.center.x + dx, y: ent.center.y + dy } });
            } else if (ent.type === 'point') {
              onUpdateEntity(id, { position: { x: ent.position.x + dx, y: ent.position.y + dy } });
            }
          }
          setMoveStart(null);
          setMoveDragging(false);
          toast.success('Entities moved');
        } else if (selectedIds.length > 0) {
          // Already have selection, set base point
          setMoveStart(snapped);
          setMoveDragging(true);
        } else {
          // No selection: try click-pick an entity, or start window selection
          const nearest = findNearestEntity(worldPos);
          if (nearest) {
            onSelectEntity(nearest.id, false);
            setMoveStart(snapped);
            setMoveDragging(true);
          } else {
            // Start window selection for move
            setSelBoxStart(snapped);
            setSelBoxEnd(snapped);
            setIsSelecting(true);
          }
        }
        break;

      case 'trim': {
        const nearest = findNearestEntity(worldPos);
        if (!nearest || nearest.type !== 'line') {
          toast.info('Click on a line near an intersection to trim');
          break;
        }
        const result = trimLineAtIntersections(nearest, entities, worldPos);
        if (!result) {
          toast.info('No intersections found to trim at');
          break;
        }
        const allPts = [nearest.start, result.start, result.end, nearest.end];
        onRemoveEntities([nearest.id]);
        if (distance2D(allPts[0], allPts[1]) > 0.5) {
          onAddLine(allPts[0], allPts[1]);
        }
        if (distance2D(allPts[2], allPts[3]) > 0.5) {
          onAddLine(allPts[2], allPts[3]);
        }
        toast.success('Trimmed');
        break;
      }

      case 'extend': {
        const nearest = findNearestEntity(worldPos);
        if (!nearest || nearest.type !== 'line') {
          toast.info('Click near a line endpoint to extend');
          break;
        }
        const ep = closestEndpoint(nearest, worldPos);
        const newPt = extendLineToNearest(nearest, ep, entities);
        if (!newPt) {
          toast.info('No entity found to extend to');
          break;
        }
        onUpdateEntity(nearest.id, ep === 'start' ? { start: newPt } : { end: newPt });
        toast.success('Extended');
        break;
      }

      case 'offset': {
        const nearest = findNearestEntity(worldPos);
        if (!nearest) { toast.info('Click on an entity to offset'); break; }
        const dist = gridSize;
        const side = nearest.type === 'line'
          ? pointSideOfLine(worldPos, nearest.start, nearest.end)
          : (distance2D(worldPos, (nearest as any).center ?? nearest) > ((nearest as any).radius ?? 0) ? 1 : -1);
        if (nearest.type === 'line') {
          const off = offsetLine(nearest, dist, side);
          onAddLine(off.start, off.end);
        } else if (nearest.type === 'rect') {
          const off = offsetRect(nearest, dist, side);
          onAddRect(off.origin, off.width, off.height);
        } else if (nearest.type === 'circle') {
          const off = offsetCircle(nearest, dist, side);
          onAddCircle(off.center, off.radius);
        } else {
          toast.info('Offset not supported for this entity type');
          break;
        }
        toast.success(`Offset by ${dist}mm`);
        break;
      }

      case 'mirror':
        if (selectedIds.length === 0) {
          toast.info('Select entities first, then use Mirror');
          break;
        }
        if (mirrorPhase === 'axis1') {
          setMirrorAxis1(snapped);
          setMirrorPhase('axis2');
        } else if (mirrorPhase === 'axis2' && mirrorAxis1) {
          if (distance2D(mirrorAxis1, snapped) < 0.5) break;
          const mirrored = selectedIds
            .map(id => entities.find(e => e.id === id))
            .filter(Boolean)
            .map(ent => mirrorEntity(ent!, mirrorAxis1, snapped));
          onAddEntities(mirrored);
          setMirrorPhase('axis1');
          setMirrorAxis1(null);
          toast.success(`Mirrored ${mirrored.length} entities`);
        }
        break;

      case 'dimension': {
        const nearest = findNearestEntity(worldPos);
        if (!nearest) { toast.info('Click on an entity to edit its dimension'); break; }
        setEditingDimId(nearest.id);
        if (nearest.type === 'line') {
          setDimInputValue(distance2D(nearest.start, nearest.end).toFixed(1));
        } else if (nearest.type === 'rect') {
          setDimInputValue(`${nearest.width.toFixed(1)} x ${nearest.height.toFixed(1)}`);
        } else if (nearest.type === 'circle') {
          setDimInputValue(nearest.radius.toFixed(1));
        } else if (nearest.type === 'arc') {
          setDimInputValue(nearest.radius.toFixed(1));
        }
        break;
      }
    }
  }, [activeTool, drawStart, svgToWorld, getSnappedPoint, onAddLine, onAddRect, onAddCircle, onAddArc, onAddPoint,
    onUpdateEntity, onAddEntities, onDeselectAll, onRemoveEntities, viewBox, entities, selectedIds,
    arcPhase, arcCenter, arcRadius, arcStartAngle, moveStart, moveDragging, mirrorPhase, mirrorAxis1, findNearestEntity, gridSize, onSelectEntity]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const worldPos = svgToWorld(e.clientX, e.clientY);
    const snapped = getSnappedPoint(worldPos);
    setCursorPos(snapped);

    if (isPanning && panStart) {
      const dx = (e.clientX - panStart.x) * (viewBox.w / (svgRef.current?.getBoundingClientRect().width || 1));
      const dy = (e.clientY - panStart.y) * (viewBox.h / (svgRef.current?.getBoundingClientRect().height || 1));
      setViewBox(prev => ({ ...prev, x: panStart.vx - dx, y: panStart.vy - dy }));
    }

    // Update window selection box
    if (isSelecting && selBoxStart) {
      setSelBoxEnd(snapped);
    }
  }, [svgToWorld, getSnappedPoint, isPanning, panStart, viewBox.w, viewBox.h, isSelecting, selBoxStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);

    // Complete window selection
    if (isSelecting && selBoxStart && selBoxEnd) {
      const boxW = Math.abs(selBoxEnd.x - selBoxStart.x);
      const boxH = Math.abs(selBoxEnd.y - selBoxStart.y);
      if (boxW > 1 || boxH > 1) {
        completeWindowSelection(selBoxStart, selBoxEnd, activeTool === 'move');
      } else {
        setSelBoxStart(null);
        setSelBoxEnd(null);
        setIsSelecting(false);
      }
    }
  }, [isSelecting, selBoxStart, selBoxEnd, completeWindowSelection, activeTool]);

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
        w: newW, h: newH,
      };
    });
  }, [svgToWorld]);

  // Handle dimension edit submit
  const handleDimSubmit = useCallback(() => {
    if (!editingDimId) return;
    const ent = entities.find(e => e.id === editingDimId);
    if (!ent) { setEditingDimId(null); return; }

    if (ent.type === 'line') {
      const newLen = parseFloat(dimInputValue);
      if (isNaN(newLen) || newLen <= 0) { setEditingDimId(null); return; }
      const dx = ent.end.x - ent.start.x, dy = ent.end.y - ent.start.y;
      const curLen = Math.sqrt(dx * dx + dy * dy);
      if (curLen < 1e-10) { setEditingDimId(null); return; }
      const scale = newLen / curLen;
      onUpdateEntity(editingDimId, { end: { x: ent.start.x + dx * scale, y: ent.start.y + dy * scale } });
    } else if (ent.type === 'rect') {
      const parts = dimInputValue.split(/[x×,]/i).map(s => parseFloat(s.trim()));
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        onUpdateEntity(editingDimId, { width: parts[0], height: parts[1] });
      }
    } else if (ent.type === 'circle') {
      const newR = parseFloat(dimInputValue);
      if (!isNaN(newR) && newR > 0) onUpdateEntity(editingDimId, { radius: newR });
    } else if (ent.type === 'arc') {
      const newR = parseFloat(dimInputValue);
      if (!isNaN(newR) && newR > 0) onUpdateEntity(editingDimId, { radius: newR });
    }
    setEditingDimId(null);
    toast.success('Dimension updated');
  }, [editingDimId, dimInputValue, entities, onUpdateEntity]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Tab toggles precision mode for line/rect/move
      if (e.key === 'Tab' && !editingDimId) {
        const canPrecLine = activeTool === 'line' && drawStart;
        const canPrecRect = activeTool === 'rect' && drawStart;
        const canPrecMove = activeTool === 'move' && moveDragging && moveStart;
        if (canPrecLine || canPrecRect || canPrecMove) {
          e.preventDefault();
          setPrecisionMode(prev => {
            if (!prev) {
              if (activeTool === 'rect' && drawStart) {
                setPrecInput1(Math.abs(cursorPos.x - drawStart.x).toFixed(1));
                setPrecInput2(Math.abs(cursorPos.y - drawStart.y).toFixed(1));
              } else if (activeTool === 'line' && drawStart) {
                const len = distance2D(drawStart, cursorPos);
                const angle = (Math.atan2(cursorPos.y - drawStart.y, cursorPos.x - drawStart.x) * 180) / Math.PI;
                setPrecInput1(len.toFixed(1));
                setPrecInput2(angle.toFixed(1));
              } else if (activeTool === 'move' && moveStart) {
                setPrecInput1((cursorPos.x - moveStart.x).toFixed(1));
                setPrecInput2((cursorPos.y - moveStart.y).toFixed(1));
              }
              setTimeout(() => precInput1Ref.current?.focus(), 50);
            }
            return !prev;
          });
          return;
        }
      }
      if (e.key === 'Escape') {
        setDrawStart(null);
        setArcPhase('center');
        setArcCenter(null);
        setMoveStart(null);
        setMoveDragging(false);
        setMirrorPhase('axis1');
        setMirrorAxis1(null);
        setEditingDimId(null);
        setPrecisionMode(false);
        setPrecInput1('');
        setPrecInput2('');
        setSelBoxStart(null);
        setSelBoxEnd(null);
        setIsSelecting(false);
      }
      if (e.key === 'Enter' && precisionMode) {
        e.preventDefault();
        handlePrecisionSubmit();
        return;
      }
      if (e.key === 'Enter' && editingDimId) {
        e.preventDefault();
        handleDimSubmit();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0 && !precisionMode && !editingDimId) {
        e.preventDefault();
        onRemoveEntities(selectedIds);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, onRemoveEntities, editingDimId, handleDimSubmit, drawStart, activeTool, precisionMode, handlePrecisionSubmit, cursorPos, moveDragging, moveStart]);

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
      <line key={`gv${x}`} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.h}
        stroke={isMajor ? 'hsl(var(--cad-grid-major))' : 'hsl(var(--cad-grid))'}
        strokeWidth={isMajor ? 0.5 : 0.2} />
    );
  }
  for (let y = startY; y <= endY; y += gridSize) {
    const isMajor = Math.abs(y % majorGrid) < 0.01;
    gridLines.push(
      <line key={`gh${y}`} x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.w} y2={y}
        stroke={isMajor ? 'hsl(var(--cad-grid-major))' : 'hsl(var(--cad-grid))'}
        strokeWidth={isMajor ? 0.5 : 0.2} />
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
          <line x1={entity.start.x} y1={entity.start.y} x2={entity.end.x} y2={entity.end.y}
            stroke={strokeColor} strokeWidth={strokeWidth} className="cursor-pointer" />
          {editingDimId === entity.id ? (
            <foreignObject x={mid.x + offsetX - 15} y={mid.y + offsetY - 5} width={30} height={10}>
              <input
                autoFocus
                value={dimInputValue}
                onChange={e => setDimInputValue(e.target.value)}
                onBlur={handleDimSubmit}
                onKeyDown={e => { if (e.key === 'Enter') handleDimSubmit(); }}
                style={{ width: '100%', fontSize: '8px', textAlign: 'center', background: 'rgba(0,0,0,0.8)', color: '#0f0', border: 'none', outline: 'none', fontFamily: 'monospace' }}
              />
            </foreignObject>
          ) : (
            <text x={mid.x + offsetX} y={mid.y + offsetY}
              fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace"
              textAnchor="middle" dominantBaseline="middle">{dist.toFixed(1)}</text>
          )}
          <circle cx={entity.start.x} cy={entity.start.y} r={1} fill={strokeColor} />
          <circle cx={entity.end.x} cy={entity.end.y} r={1} fill={strokeColor} />
        </g>
      );
    }

    if (entity.type === 'rect') {
      return (
        <g key={entity.id} onClick={(e) => { e.stopPropagation(); onSelectEntity(entity.id, e.shiftKey); }}>
          <rect x={entity.origin.x} y={entity.origin.y} width={entity.width} height={entity.height}
            stroke={strokeColor} strokeWidth={strokeWidth} fill="none" className="cursor-pointer" />
          {editingDimId === entity.id ? (
            <foreignObject x={entity.origin.x + entity.width / 2 - 20} y={entity.origin.y - 12} width={40} height={10}>
              <input
                autoFocus
                value={dimInputValue}
                onChange={e => setDimInputValue(e.target.value)}
                onBlur={handleDimSubmit}
                onKeyDown={e => { if (e.key === 'Enter') handleDimSubmit(); }}
                style={{ width: '100%', fontSize: '8px', textAlign: 'center', background: 'rgba(0,0,0,0.8)', color: '#0f0', border: 'none', outline: 'none', fontFamily: 'monospace' }}
              />
            </foreignObject>
          ) : (
            <>
              <text x={entity.origin.x + entity.width / 2} y={entity.origin.y - 3}
                fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                {entity.width.toFixed(1)}
              </text>
              <text x={entity.origin.x + entity.width + 5} y={entity.origin.y + entity.height / 2}
                fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace" textAnchor="start" dominantBaseline="middle">
                {entity.height.toFixed(1)}
              </text>
            </>
          )}
        </g>
      );
    }

    if (entity.type === 'circle') {
      return (
        <g key={entity.id} onClick={(e) => { e.stopPropagation(); onSelectEntity(entity.id, e.shiftKey); }}>
          <circle cx={entity.center.x} cy={entity.center.y} r={entity.radius}
            stroke={strokeColor} strokeWidth={strokeWidth} fill="none" className="cursor-pointer" />
          {editingDimId === entity.id ? (
            <foreignObject x={entity.center.x + entity.radius + 2} y={entity.center.y - 5} width={25} height={10}>
              <input
                autoFocus
                value={dimInputValue}
                onChange={e => setDimInputValue(e.target.value)}
                onBlur={handleDimSubmit}
                onKeyDown={e => { if (e.key === 'Enter') handleDimSubmit(); }}
                style={{ width: '100%', fontSize: '8px', textAlign: 'center', background: 'rgba(0,0,0,0.8)', color: '#0f0', border: 'none', outline: 'none', fontFamily: 'monospace' }}
              />
            </foreignObject>
          ) : (
            <text x={entity.center.x + entity.radius + 3} y={entity.center.y}
              fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace" textAnchor="start" dominantBaseline="middle">
              R{entity.radius.toFixed(1)}
            </text>
          )}
          <circle cx={entity.center.x} cy={entity.center.y} r={0.8} fill={strokeColor} />
        </g>
      );
    }

    if (entity.type === 'arc') {
      const path = arcSvgPath(entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle);
      return (
        <g key={entity.id} onClick={(e) => { e.stopPropagation(); onSelectEntity(entity.id, e.shiftKey); }}>
          <path d={path} stroke={strokeColor} strokeWidth={strokeWidth} fill="none" className="cursor-pointer" />
          <text x={entity.center.x + entity.radius + 3} y={entity.center.y}
            fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace" textAnchor="start" dominantBaseline="middle">
            R{entity.radius.toFixed(1)}
          </text>
          <circle cx={entity.center.x} cy={entity.center.y} r={0.6} fill={strokeColor} />
        </g>
      );
    }

    if (entity.type === 'point') {
      const sz = 2;
      return (
        <g key={entity.id} onClick={(e) => { e.stopPropagation(); onSelectEntity(entity.id, e.shiftKey); }}>
          <line x1={entity.position.x - sz} y1={entity.position.y} x2={entity.position.x + sz} y2={entity.position.y}
            stroke={strokeColor} strokeWidth={strokeWidth} />
          <line x1={entity.position.x} y1={entity.position.y - sz} x2={entity.position.x} y2={entity.position.y + sz}
            stroke={strokeColor} strokeWidth={strokeWidth} />
          <circle cx={entity.position.x} cy={entity.position.y} r={0.8} fill={strokeColor} />
        </g>
      );
    }

    return null;
  };

  // Preview shape while drawing
  const renderPreview = () => {
    if (activeTool === 'line' && drawStart) {
      return (
        <line x1={drawStart.x} y1={drawStart.y} x2={cursorPos.x} y2={cursorPos.y}
          stroke="hsl(var(--cad-sketch-line))" strokeWidth={0.6} strokeDasharray="2 1" opacity={0.7} />
      );
    }

    if (activeTool === 'rect' && drawStart) {
      const x = Math.min(drawStart.x, cursorPos.x), y = Math.min(drawStart.y, cursorPos.y);
      const w = Math.abs(cursorPos.x - drawStart.x), h = Math.abs(cursorPos.y - drawStart.y);
      return (
        <rect x={x} y={y} width={w} height={h}
          stroke="hsl(var(--cad-sketch-line))" strokeWidth={0.6} strokeDasharray="2 1"
          fill="hsl(var(--cad-sketch-line) / 0.05)" opacity={0.7} />
      );
    }

    if (activeTool === 'circle' && drawStart) {
      const r = distance2D(drawStart, cursorPos);
      return (
        <g opacity={0.7}>
          <circle cx={drawStart.x} cy={drawStart.y} r={r}
            stroke="hsl(var(--cad-sketch-line))" strokeWidth={0.6} strokeDasharray="2 1" fill="none" />
          <line x1={drawStart.x} y1={drawStart.y} x2={cursorPos.x} y2={cursorPos.y}
            stroke="hsl(var(--cad-dimension))" strokeWidth={0.3} strokeDasharray="1 1" />
          <text x={(drawStart.x + cursorPos.x) / 2 + 2} y={(drawStart.y + cursorPos.y) / 2 - 2}
            fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace">
            R{r.toFixed(1)}
          </text>
        </g>
      );
    }

    if (activeTool === 'arc' && arcCenter) {
      if (arcPhase === 'radius') {
        const r = distance2D(arcCenter, cursorPos);
        return (
          <g opacity={0.5}>
            <circle cx={arcCenter.x} cy={arcCenter.y} r={r}
              stroke="hsl(var(--cad-sketch-line))" strokeWidth={0.3} strokeDasharray="2 2" fill="none" />
            <line x1={arcCenter.x} y1={arcCenter.y} x2={cursorPos.x} y2={cursorPos.y}
              stroke="hsl(var(--cad-dimension))" strokeWidth={0.3} strokeDasharray="1 1" />
          </g>
        );
      }
      if (arcPhase === 'end') {
        const endAngle = Math.atan2(cursorPos.y - arcCenter.y, cursorPos.x - arcCenter.x);
        const path = arcSvgPath(arcCenter.x, arcCenter.y, arcRadius, arcStartAngle, endAngle);
        return (
          <g opacity={0.7}>
            <path d={path} stroke="hsl(var(--cad-sketch-line))" strokeWidth={0.6} strokeDasharray="2 1" fill="none" />
            <line x1={arcCenter.x} y1={arcCenter.y}
              x2={arcCenter.x + arcRadius * Math.cos(arcStartAngle)} y2={arcCenter.y + arcRadius * Math.sin(arcStartAngle)}
              stroke="hsl(var(--cad-dimension))" strokeWidth={0.3} strokeDasharray="1 1" />
            <line x1={arcCenter.x} y1={arcCenter.y} x2={cursorPos.x} y2={cursorPos.y}
              stroke="hsl(var(--cad-dimension))" strokeWidth={0.3} strokeDasharray="1 1" />
          </g>
        );
      }
    }

    if (activeTool === 'move' && moveDragging && moveStart) {
      const dx = cursorPos.x - moveStart.x;
      const dy = cursorPos.y - moveStart.y;
      return (
        <g opacity={0.4}>
          <line x1={moveStart.x} y1={moveStart.y} x2={cursorPos.x} y2={cursorPos.y}
            stroke="hsl(var(--cad-snap))" strokeWidth={0.5} strokeDasharray="2 1" />
          {/* Ghost preview of selected entities at new position */}
          {selectedIds.map(id => {
            const ent = entities.find(e => e.id === id);
            if (!ent) return null;
            if (ent.type === 'line') {
              return <line key={`mv-${id}`}
                x1={ent.start.x + dx} y1={ent.start.y + dy}
                x2={ent.end.x + dx} y2={ent.end.y + dy}
                stroke="hsl(var(--cad-snap))" strokeWidth={0.6} strokeDasharray="2 1" />;
            }
            if (ent.type === 'rect') {
              return <rect key={`mv-${id}`}
                x={ent.origin.x + dx} y={ent.origin.y + dy}
                width={ent.width} height={ent.height}
                stroke="hsl(var(--cad-snap))" strokeWidth={0.6} strokeDasharray="2 1" fill="none" />;
            }
            if (ent.type === 'circle') {
              return <circle key={`mv-${id}`}
                cx={ent.center.x + dx} cy={ent.center.y + dy} r={ent.radius}
                stroke="hsl(var(--cad-snap))" strokeWidth={0.6} strokeDasharray="2 1" fill="none" />;
            }
            if (ent.type === 'arc') {
              const path = arcSvgPath(ent.center.x + dx, ent.center.y + dy, ent.radius, ent.startAngle, ent.endAngle);
              return <path key={`mv-${id}`} d={path}
                stroke="hsl(var(--cad-snap))" strokeWidth={0.6} strokeDasharray="2 1" fill="none" />;
            }
            if (ent.type === 'point') {
              return <circle key={`mv-${id}`}
                cx={ent.position.x + dx} cy={ent.position.y + dy} r={0.8}
                fill="hsl(var(--cad-snap))" />;
            }
            return null;
          })}
          {/* dX/dY label */}
          <text x={cursorPos.x + 3} y={cursorPos.y - 3}
            fill="hsl(var(--cad-dimension))" fontSize={3} fontFamily="JetBrains Mono, monospace">
            Δ{dx.toFixed(1)}, {dy.toFixed(1)}
          </text>
        </g>
      );
    }

    if (activeTool === 'mirror' && mirrorAxis1 && mirrorPhase === 'axis2') {
      return (
        <line x1={mirrorAxis1.x} y1={mirrorAxis1.y} x2={cursorPos.x} y2={cursorPos.y}
          stroke="hsl(var(--cad-dimension))" strokeWidth={0.5} strokeDasharray="3 2" opacity={0.8} />
      );
    }

    return null;
  };

  // Render selection box
  const renderSelectionBox = () => {
    if (!isSelecting || !selBoxStart || !selBoxEnd) return null;
    const x = Math.min(selBoxStart.x, selBoxEnd.x);
    const y = Math.min(selBoxStart.y, selBoxEnd.y);
    const w = Math.abs(selBoxEnd.x - selBoxStart.x);
    const h = Math.abs(selBoxEnd.y - selBoxStart.y);
    const isLeftToRight = selBoxEnd.x >= selBoxStart.x;
    return (
      <rect x={x} y={y} width={w} height={h}
        stroke={isLeftToRight ? 'hsl(var(--cad-selection))' : 'hsl(var(--cad-snap))'}
        strokeWidth={0.5}
        strokeDasharray={isLeftToRight ? 'none' : '3 2'}
        fill={isLeftToRight ? 'hsl(var(--cad-selection) / 0.08)' : 'hsl(var(--cad-snap) / 0.08)'}
      />
    );
  };

  // Status text
  const getStatusText = () => {
    if (precisionMode) {
      if (activeTool === 'move') return 'Move: dX & dY eingeben, Enter bestätigen';
      if (activeTool === 'rect') return 'Rechteck: Breite & Höhe eingeben, Enter bestätigen';
      return 'Linie: Länge & Winkel eingeben, Enter bestätigen';
    }
    switch (activeTool) {
      case 'select':
        return 'Auswahl: Klick auf Entity oder Fenster ziehen (L→R: eingeschlossen, R→L: kreuzend)';
      case 'line':
        if (drawStart) return 'Linie: Klicken oder Tab für Präzisionseingabe (Länge/Winkel)';
        return 'Linie: Startpunkt klicken';
      case 'rect':
        if (drawStart) return 'Rechteck: Klicken oder Tab für Präzisionseingabe (B×H)';
        return 'Rechteck: Eckpunkt klicken';
      case 'arc':
        if (arcPhase === 'center') return 'Arc: Click center point';
        if (arcPhase === 'radius') return 'Arc: Click to set radius & start angle';
        if (arcPhase === 'end') return 'Arc: Click to set end angle';
        break;
      case 'move':
        if (moveDragging && moveStart) return 'Move: Klicken zum Platzieren oder Tab für dX/dY';
        if (selectedIds.length > 0) return 'Move: Basispunkt klicken';
        return 'Move: Entity klicken oder Fenster ziehen zum Auswählen';
      case 'mirror':
        if (mirrorPhase === 'axis1') return 'Mirror: Click first axis point';
        return 'Mirror: Click second axis point';
      case 'trim': return 'Trim: Click on a line segment to trim';
      case 'extend': return 'Extend: Click near a line endpoint';
      case 'offset': return `Offset: Click an entity (distance: ${gridSize}mm)`;
      case 'dimension': return 'Dimension: Click an entity to edit';
    }
    return null;
  };

  const statusText = getStatusText();
  const showPrecision = precisionMode && (
    (activeTool === 'line' && drawStart) ||
    (activeTool === 'rect' && drawStart) ||
    (activeTool === 'move' && moveDragging && moveStart)
  );

  const precLabel1 = activeTool === 'rect' ? 'B:' : activeTool === 'move' ? 'dX:' : 'L:';
  const precLabel2 = activeTool === 'rect' ? 'H:' : activeTool === 'move' ? 'dY:' : '∠:';
  const precPlaceholder1 = activeTool === 'rect' ? 'Breite' : activeTool === 'move' ? 'dX' : 'Länge';
  const precPlaceholder2 = activeTool === 'rect' ? 'Höhe' : activeTool === 'move' ? 'dY' : 'Winkel°';

  return (
    <div className="relative flex-1 overflow-hidden bg-cad-surface">
      {/* Coordinate display */}
      <div className="absolute bottom-3 left-3 z-10 bg-card/90 backdrop-blur border rounded px-2.5 py-1 font-mono text-xs text-muted-foreground">
        X: {cursorPos.x.toFixed(1)} &nbsp; Y: {cursorPos.y.toFixed(1)} mm
      </div>

      {/* Status text */}
      {statusText && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-card/90 backdrop-blur border rounded px-3 py-1 text-xs font-medium text-muted-foreground">
          {statusText}
        </div>
      )}

      {/* Snap indicator */}
      {snapEnabled && (
        <div className="absolute bottom-3 right-3 z-10 bg-card/90 backdrop-blur border rounded px-2.5 py-1 text-xs text-cad-snap font-medium">
          SNAP: {gridSize}mm
        </div>
      )}

      {/* Precision input panel */}
      {showPrecision && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-card/95 backdrop-blur border rounded-lg px-4 py-2.5 flex items-center gap-3 shadow-lg">
          <span className="text-xs font-medium text-muted-foreground">{precLabel1}</span>
          <input
            ref={precInput1Ref}
            type="number"
            step="0.1"
            value={precInput1}
            onChange={e => setPrecInput1(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handlePrecisionSubmit(); if (e.key === 'Escape') { setPrecisionMode(false); } }}
            className="w-20 h-7 bg-background border rounded px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={precPlaceholder1}
          />
          <span className="text-xs font-medium text-muted-foreground">{precLabel2}</span>
          <input
            type="number"
            step="0.1"
            value={precInput2}
            onChange={e => setPrecInput2(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handlePrecisionSubmit(); if (e.key === 'Escape') { setPrecisionMode(false); } }}
            className="w-20 h-7 bg-background border rounded px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={precPlaceholder2}
          />
          <span className="text-[10px] text-muted-foreground">mm</span>
          <button
            onClick={handlePrecisionSubmit}
            className="h-7 px-3 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 transition-colors"
          >
            OK
          </button>
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
        {gridLines}

        {/* Origin axes */}
        <line x1={viewBox.x} y1={0} x2={viewBox.x + viewBox.w} y2={0}
          stroke="hsl(var(--cad-bend-line))" strokeWidth={0.3} opacity={0.5} />
        <line x1={0} y1={viewBox.y} x2={0} y2={viewBox.y + viewBox.h}
          stroke="hsl(var(--cad-snap))" strokeWidth={0.3} opacity={0.5} />

        {entities.map(renderEntity)}
        {renderPreview()}
        {renderSelectionBox()}

        {/* Snap cursor */}
        {activeTool !== 'select' && (
          <g>
            <line x1={cursorPos.x - 3} y1={cursorPos.y} x2={cursorPos.x + 3} y2={cursorPos.y}
              stroke="hsl(var(--cad-snap))" strokeWidth={0.3} />
            <line x1={cursorPos.x} y1={cursorPos.y - 3} x2={cursorPos.x} y2={cursorPos.y + 3}
              stroke="hsl(var(--cad-snap))" strokeWidth={0.3} />
          </g>
        )}
      </svg>
    </div>
  );
}
