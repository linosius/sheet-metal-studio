import { FlatPatternResult } from './metalHeroApi';
import { Point2D } from './sheetmetal';

// ========== Re-export types for backward compatibility ==========

export interface FlatRegion {
  id: string;
  type: 'base' | 'flange';
  polygon: Point2D[];
}

export interface BendLine {
  start: Point2D;
  end: Point2D;
  angle: number;
  radius: number;
  label: string;
}

export interface FlatPattern {
  regions: FlatRegion[];
  bendLines: BendLine[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  overallWidth: number;
  overallHeight: number;
}
