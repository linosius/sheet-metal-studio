import { Point2D } from '@/lib/sheetmetal';
import { bendAllowance } from '@/lib/sheetmetal';
import { Flange, Fold, getFoldNormal, clipPolygonByLine } from '@/lib/geometry';

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
  overallWidth: number;
  overallHeight: number;
}

interface FlatEdge {
  start: Point2D;
  end: Point2D;
  outward: Point2D;
}

/**
 * Compute the 2D flat pattern (unfolded) for a sheet metal part.
 * Uses the ORIGINAL profile as the base (not the fixed/clipped profile),
 * matching Inventor behavior where folds don't change the base face size.
 * Fold regions are mirrored across the fold line to unfold outward.
 */
export function computeFlatPattern(
  profile: Point2D[],
  thickness: number,
  flanges: Flange[],
  kFactor: number,
  folds: Fold[] = [],
): FlatPattern {
  const regions: FlatRegion[] = [];
  const bendLines: BendLine[] = [];

  // ---- Base face region: use the ORIGINAL profile (not clipped by folds) ----
  regions.push({ id: 'base', type: 'base', polygon: [...profile] });

  // ---- Profile bounds ----
  const pxs = profile.map(p => p.x);
  const pys = profile.map(p => p.y);
  const profMinX = Math.min(...pxs);
  const profMinY = Math.min(...pys);
  const faceWidth = Math.max(...pxs) - profMinX;
  const faceHeight = Math.max(...pys) - profMinY;

  // ---- Build flat edge map from original profile for flanges ----
  const flatEdges = new Map<string, FlatEdge>();

  for (let i = 0; i < profile.length; i++) {
    const curr = profile[i];
    const next = profile[(i + 1) % profile.length];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;

    const nx = dy / len;
    const ny = -dx / len;

    flatEdges.set(`edge_top_${i}`, { start: curr, end: next, outward: { x: nx, y: ny } });
    flatEdges.set(`edge_bot_${i}`, { start: curr, end: next, outward: { x: nx, y: ny } });
  }

  let bendIndex = 1;

  // ---- Process folds: mirror moving polygon across fold line ----
  for (const fold of folds) {
    const foldStart = { x: profMinX + fold.lineStart.x, y: profMinY + fold.lineStart.y };
    const foldEnd = { x: profMinX + fold.lineEnd.x, y: profMinY + fold.lineEnd.y };

    const normal = getFoldNormal(fold, faceWidth, faceHeight);

    // Get moving polygon (side where dot >= 0, i.e. the normal/moving side)
    const negNormal = { x: -normal.x, y: -normal.y };
    const movingPoly = clipPolygonByLine([...profile], foldStart, negNormal);

    if (movingPoly.length < 3) continue;

    const BA = bendAllowance(fold.bendRadius, kFactor, thickness, fold.angle);

    // Mirror each vertex across the fold line to the opposite side, offset by BA.
    // For vertex v at signed distance d from fold line (d >= 0 on moving side):
    //   new_v = v - normal * (2*d + BA)
    // This places the moving polygon on the fixed side, extending outward.
    const unfoldedPoly = movingPoly.map(v => {
      const vx = v.x - foldStart.x;
      const vy = v.y - foldStart.y;
      const d = vx * normal.x + vy * normal.y; // signed distance (>= 0 for moving side)
      const offset = 2 * d + BA;
      return {
        x: v.x - normal.x * offset,
        y: v.y - normal.y * offset,
      };
    });

    regions.push({ id: `fold_${fold.id}`, type: 'flange', polygon: unfoldedPoly });

    // Bend lines at the fold line position
    bendLines.push({
      start: { ...foldStart }, end: { ...foldEnd },
      angle: fold.angle, radius: fold.bendRadius, label: `F${bendIndex}`,
    });
    // Second bend line offset by BA in -normal direction (toward the unfolded side)
    bendLines.push({
      start: { x: foldStart.x - normal.x * BA, y: foldStart.y - normal.y * BA },
      end: { x: foldEnd.x - normal.x * BA, y: foldEnd.y - normal.y * BA },
      angle: fold.angle, radius: fold.bendRadius, label: `F${bendIndex}`,
    });
    bendIndex++;
  }

  // ---- Process flanges (topological iteration for nested flanges) ----
  const processed = new Set<string>();
  let remaining = [...flanges];
  let maxIter = flanges.length + 1;

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

      const p0 = start;
      const p1 = end;
      const p2: Point2D = { x: end.x + outward.x * totalExtension, y: end.y + outward.y * totalExtension };
      const p3: Point2D = { x: start.x + outward.x * totalExtension, y: start.y + outward.y * totalExtension };

      regions.push({ id: flange.id, type: 'flange', polygon: [p0, p1, p2, p3] });

      bendLines.push({
        start: { ...start }, end: { ...end },
        angle: flange.angle, radius: flange.bendRadius, label: `B${bendIndex}`,
      });
      bendLines.push({
        start: { x: start.x + outward.x * BA, y: start.y + outward.y * BA },
        end: { x: end.x + outward.x * BA, y: end.y + outward.y * BA },
        angle: flange.angle, radius: flange.bendRadius, label: `B${bendIndex}`,
      });
      bendIndex++;

      // Register tip edges for nested flanges
      flatEdges.set(`flange_tip_outer_${flange.id}`, { start: p3, end: p2, outward });
      flatEdges.set(`flange_tip_inner_${flange.id}`, {
        start: p3, end: p2, outward: { x: -outward.x, y: -outward.y },
      });
      const sideVec = { x: end.x - start.x, y: end.y - start.y };
      const sideLen = Math.hypot(sideVec.x, sideVec.y);
      const sideNorm = { x: sideVec.x / sideLen, y: sideVec.y / sideLen };
      flatEdges.set(`flange_side_s_${flange.id}`, {
        start: p0, end: p3, outward: { x: -sideNorm.x, y: -sideNorm.y },
      });
      flatEdges.set(`flange_side_e_${flange.id}`, { start: p1, end: p2, outward: sideNorm });

      processed.add(flange.id);
    }
    remaining = nextBatch;
  }

  // ---- Bounding box ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
