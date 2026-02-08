// ========== Sheet Metal Engineering Calculations ==========

export interface SheetMetalDefaults {
  material: string;
  thickness: number;       // mm
  bendRadius: number;      // inner bend radius in mm
  kFactor: number;         // 0.0 to 0.5 (typically 0.3-0.5)
}

export const DEFAULT_SHEET_METAL: SheetMetalDefaults = {
  material: 'Steel',
  thickness: 1.0,
  bendRadius: 1.0,
  kFactor: 0.44,
};

export const MATERIALS = [
  { name: 'Steel', defaultK: 0.44 },
  { name: 'Aluminum', defaultK: 0.33 },
  { name: 'Stainless Steel', defaultK: 0.45 },
  { name: 'Copper', defaultK: 0.35 },
  { name: 'Custom', defaultK: 0.44 },
];

/**
 * Calculate bend allowance using K-Factor method.
 * BA = π × (R + K × T) × (A / 180)
 * 
 * @param radius Inner bend radius (mm)
 * @param kFactor K-Factor (dimensionless, 0-0.5)
 * @param thickness Material thickness (mm)
 * @param angleDeg Bend angle in degrees
 * @returns Bend allowance in mm
 */
export function bendAllowance(
  radius: number,
  kFactor: number,
  thickness: number,
  angleDeg: number
): number {
  return Math.PI * (radius + kFactor * thickness) * (angleDeg / 180);
}

/**
 * Calculate bend deduction (setback minus bend allowance).
 * BD = 2 × (R + T) × tan(A/2) - BA
 */
export function bendDeduction(
  radius: number,
  kFactor: number,
  thickness: number,
  angleDeg: number
): number {
  const ba = bendAllowance(radius, kFactor, thickness, angleDeg);
  const angleRad = (angleDeg * Math.PI) / 180;
  const ossb = (radius + thickness) * Math.tan(angleRad / 2); // outside setback
  return 2 * ossb - ba;
}

/**
 * Calculate the flat length of a bend segment.
 */
export function flatLength(
  flangeLength: number,
  radius: number,
  kFactor: number,
  thickness: number,
  angleDeg: number
): number {
  const ba = bendAllowance(radius, kFactor, thickness, angleDeg);
  return flangeLength - (radius + thickness) * Math.tan((angleDeg * Math.PI / 180) / 2) + ba;
}

// ========== 2D Sketch Types ==========

export interface Point2D {
  x: number;
  y: number;
}

export interface SketchLine {
  id: string;
  type: 'line';
  start: Point2D;
  end: Point2D;
}

export interface SketchRect {
  id: string;
  type: 'rect';
  origin: Point2D;
  width: number;
  height: number;
}

export type SketchEntity = SketchLine | SketchRect;

/**
 * Snap a point to the nearest grid intersection.
 */
export function snapToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Calculate distance between two 2D points.
 */
export function distance2D(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Calculate midpoint between two 2D points.
 */
export function midpoint2D(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Generate a unique ID for sketch entities.
 */
export function generateId(): string {
  return `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}
