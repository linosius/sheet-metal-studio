import { Point2D } from '@/lib/sheetmetal';
import { bendAllowance } from '@/lib/sheetmetal';
import { Flange, Fold, getFoldNormal, clipPolygonByLine, foldLineToInnerEdgeOffset, getFixedProfile } from '@/lib/geometry';

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

  // ---- Build flat edge map from FIXED (clipped) profile for flanges ----
  // This ensures flanges only extend along the portion of the edge that
  // remains after folds have been applied.
  const fixedProfile = getFixedProfile(profile, folds, thickness);
  const flatEdges = new Map<string, FlatEdge>();

  for (let i = 0; i < fixedProfile.length; i++) {
    const curr = fixedProfile[i];
    const next = fixedProfile[(i + 1) % fixedProfile.length];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;

    const nx = dy / len;
    const ny = -dx / len;

    // Map to original edge indices by finding which original edge this segment lies on
    for (let j = 0; j < profile.length; j++) {
      const origCurr = profile[j];
      const origNext = profile[(j + 1) % profile.length];
      const origDx = origNext.x - origCurr.x;
      const origDy = origNext.y - origCurr.y;
      const origLen = Math.hypot(origDx, origDy);
      if (origLen < 0.01) continue;

      // Check if fixed edge segment lies on this original edge
      const crossCurr = Math.abs((curr.x - origCurr.x) * origDy - (curr.y - origCurr.y) * origDx) / origLen;
      const crossNext = Math.abs((next.x - origCurr.x) * origDy - (next.y - origCurr.y) * origDx) / origLen;
      
      if (crossCurr < 0.5 && crossNext < 0.5) {
        // This fixed edge segment is on original edge j
        flatEdges.set(`edge_top_${j}`, { start: curr, end: next, outward: { x: nx, y: ny } });
        flatEdges.set(`edge_bot_${j}`, { start: curr, end: next, outward: { x: nx, y: ny } });
        break;
      }
    }
  }

  let bendIndex = 1;

  // ---- Process folds: add bend lines only (no displaced regions) ----
  // Folds bend existing material, so the flat pattern keeps the original
  // base face dimensions. We only draw bend line annotations at the
  // ORIGINAL drawn fold line position (not shifted by foldLocation offset).
  for (const fold of folds) {
    const normal = getFoldNormal(fold, faceWidth, faceHeight);
    const BA = bendAllowance(fold.bendRadius, kFactor, thickness, fold.angle);

    // Use the original drawn fold line position (no foldLocation offset)
    const foldStart = { x: profMinX + fold.lineStart.x, y: profMinY + fold.lineStart.y };
    const foldEnd = { x: profMinX + fold.lineEnd.x, y: profMinY + fold.lineEnd.y };

    // First bend line at the fold line position
    bendLines.push({
      start: { ...foldStart }, end: { ...foldEnd },
      angle: fold.angle, radius: fold.bendRadius, label: `F${bendIndex}`,
    });
    // Second bend line offset by BA in +normal direction (marks bend zone width)
    bendLines.push({
      start: { x: foldStart.x + normal.x * BA, y: foldStart.y + normal.y * BA },
      end: { x: foldEnd.x + normal.x * BA, y: foldEnd.y + normal.y * BA },
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
