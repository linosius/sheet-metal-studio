import { Point2D } from '@/lib/sheetmetal';
import { bendAllowance } from '@/lib/sheetmetal';
import { Flange } from '@/lib/geometry';

// ========== Flat Pattern Types ==========

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
  /** Overall flat dimensions */
  overallWidth: number;
  overallHeight: number;
}

interface FlatEdge {
  start: Point2D;
  end: Point2D;
  outward: Point2D; // unit outward normal
}

/**
 * Compute the 2D flat pattern (unfolded) for a sheet metal part.
 *
 * The base profile stays in its original position. Each flange is "unfolded"
 * outward from its parent edge, with the bend arc replaced by the
 * computed bend allowance length.
 *
 * Supports nested flanges (flange-on-flange) via topological iteration.
 */
export function computeFlatPattern(
  profile: Point2D[],
  thickness: number,
  flanges: Flange[],
  kFactor: number,
): FlatPattern {
  const regions: FlatRegion[] = [];
  const bendLines: BendLine[] = [];

  // ---- Base face region ----
  regions.push({ id: 'base', type: 'base', polygon: [...profile] });

  // ---- Build flat edge map for base profile edges ----
  const flatEdges = new Map<string, FlatEdge>();

  for (let i = 0; i < profile.length; i++) {
    const curr = profile[i];
    const next = profile[(i + 1) % profile.length];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;

    // Outward normal (for CCW-wound polygon: (dy, -dx) / len)
    const nx = dy / len;
    const ny = -dx / len;

    // Both top and bottom base edges share the same flat position
    flatEdges.set(`edge_top_${i}`, { start: curr, end: next, outward: { x: nx, y: ny } });
    flatEdges.set(`edge_bot_${i}`, { start: curr, end: next, outward: { x: nx, y: ny } });
  }

  // ---- Process flanges (iterative topological sort) ----
  const processed = new Set<string>();
  let remaining = [...flanges];
  let maxIter = flanges.length + 1;
  let bendIndex = 1;

  while (remaining.length > 0 && maxIter > 0) {
    maxIter--;
    const nextBatch: Flange[] = [];

    for (const flange of remaining) {
      const parentFlatEdge = flatEdges.get(flange.edgeId);
      if (!parentFlatEdge) {
        nextBatch.push(flange);
        continue;
      }

      const BA = bendAllowance(flange.bendRadius, kFactor, thickness, flange.angle);
      const totalExtension = BA + flange.height;

      const { start, end, outward } = parentFlatEdge;

      // Four corners of the unfolded flange strip
      const p0 = start;
      const p1 = end;
      const p2: Point2D = {
        x: end.x + outward.x * totalExtension,
        y: end.y + outward.y * totalExtension,
      };
      const p3: Point2D = {
        x: start.x + outward.x * totalExtension,
        y: start.y + outward.y * totalExtension,
      };

      regions.push({
        id: flange.id,
        type: 'flange',
        polygon: [p0, p1, p2, p3],
      });

      // Bend line at start of bend zone (at the parent edge)
      bendLines.push({
        start: { ...start },
        end: { ...end },
        angle: flange.angle,
        radius: flange.bendRadius,
        label: `B${bendIndex}`,
      });

      // Bend line at end of bend zone (BA distance from edge)
      const bendEndStart: Point2D = {
        x: start.x + outward.x * BA,
        y: start.y + outward.y * BA,
      };
      const bendEndEnd: Point2D = {
        x: end.x + outward.x * BA,
        y: end.y + outward.y * BA,
      };
      bendLines.push({
        start: bendEndStart,
        end: bendEndEnd,
        angle: flange.angle,
        radius: flange.bendRadius,
        label: `B${bendIndex}`,
      });

      bendIndex++;

      // ---- Register tip edges for nested flanges ----

      // Outer tip edge (continues outward)
      flatEdges.set(`flange_tip_outer_${flange.id}`, {
        start: p3,
        end: p2,
        outward,
      });

      // Inner tip edge (folds back inward)
      flatEdges.set(`flange_tip_inner_${flange.id}`, {
        start: p3,
        end: p2,
        outward: { x: -outward.x, y: -outward.y },
      });

      // Side edges
      const sideVec = { x: end.x - start.x, y: end.y - start.y };
      const sideLen = Math.hypot(sideVec.x, sideVec.y);
      const sideNorm = { x: sideVec.x / sideLen, y: sideVec.y / sideLen };

      flatEdges.set(`flange_side_s_${flange.id}`, {
        start: p0,
        end: p3,
        outward: { x: -sideNorm.x, y: -sideNorm.y },
      });

      flatEdges.set(`flange_side_e_${flange.id}`, {
        start: p1,
        end: p2,
        outward: sideNorm,
      });

      processed.add(flange.id);
    }

    remaining = nextBatch;
  }

  // ---- Bounding box ----
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    for (const p of region.polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return {
    regions,
    bendLines,
    boundingBox: { minX, minY, maxX, maxY },
    overallWidth: maxX - minX,
    overallHeight: maxY - minY,
  };
}
