import { useState, useCallback } from 'react';
import {
  SketchEntity,
  SketchLine,
  SketchRect,
  Point2D,
  SheetMetalDefaults,
  DEFAULT_SHEET_METAL,
  generateId,
} from '@/lib/sheetmetal';

export type SketchTool = 'select' | 'line' | 'rect';

export interface SketchState {
  entities: SketchEntity[];
  selectedIds: string[];
  activeTool: SketchTool;
  gridSize: number;
  snapEnabled: boolean;
  sheetMetalDefaults: SheetMetalDefaults;
}

export function useSketchStore() {
  const [entities, setEntities] = useState<SketchEntity[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<SketchTool>('line');
  const [gridSize, setGridSize] = useState(10); // mm
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [sheetMetalDefaults, setSheetMetalDefaults] = useState<SheetMetalDefaults>(DEFAULT_SHEET_METAL);

  const addLine = useCallback((start: Point2D, end: Point2D) => {
    const line: SketchLine = {
      id: generateId(),
      type: 'line',
      start,
      end,
    };
    setEntities(prev => [...prev, line]);
    return line;
  }, []);

  const addRect = useCallback((origin: Point2D, width: number, height: number) => {
    const rect: SketchRect = {
      id: generateId(),
      type: 'rect',
      origin,
      width,
      height,
    };
    setEntities(prev => [...prev, rect]);
    return rect;
  }, []);

  const removeEntity = useCallback((id: string) => {
    setEntities(prev => prev.filter(e => e.id !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
  }, []);

  const clearAll = useCallback(() => {
    setEntities([]);
    setSelectedIds([]);
  }, []);

  const selectEntity = useCallback((id: string, multi = false) => {
    setSelectedIds(prev => multi ? [...prev, id] : [id]);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  return {
    entities,
    selectedIds,
    activeTool,
    gridSize,
    snapEnabled,
    sheetMetalDefaults,
    setActiveTool,
    setGridSize,
    setSnapEnabled,
    setSheetMetalDefaults,
    addLine,
    addRect,
    removeEntity,
    clearAll,
    selectEntity,
    deselectAll,
  };
}
