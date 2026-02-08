import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFlangeMesh, computeBendLinePositions, PartEdge, Flange } from '@/lib/geometry';

function makeEdge(length = 100): PartEdge {
  return {
    id: 'edge_test',
    start: new THREE.Vector3(0, 0, 4),
    end: new THREE.Vector3(length, 0, 4),
    faceId: 'base',
    normal: new THREE.Vector3(0, -1, 0), // outward normal
  };
}

function makeFlange(overrides: Partial<Flange> = {}): Flange {
  return {
    id: 'flange_test',
    edgeId: 'edge_test',
    height: 20,
    angle: 90,
    direction: 'up',
    bendRadius: 4,
    ...overrides,
  };
}

describe('Bend radius in geometry', () => {
  it('createFlangeMesh uses the flange.bendRadius, not a hardcoded value', () => {
    const edge = makeEdge();
    const thickness = 4;

    // Create two flanges with different bend radii
    const smallR = makeFlange({ bendRadius: 2 });
    const largeR = makeFlange({ bendRadius: 10 });

    const geoSmall = createFlangeMesh(edge, smallR, thickness);
    const geoLarge = createFlangeMesh(edge, largeR, thickness);

    // They should produce different geometry (different bounding boxes)
    geoSmall.computeBoundingBox();
    geoLarge.computeBoundingBox();

    // Larger bend radius produces a wider bend zone — min.y differs
    // (normal is (0,-1,0) so flange extends in -Y direction)
    expect(geoLarge.boundingBox!.min.y).not.toEqual(geoSmall.boundingBox!.min.y);
    
    // For 90° bend with direction=up, the bend arc center is at (0, R) in u-w space
    // At t=90°, inner pos: u = R*sin(90) = R, w = R*(1-cos(90)) = R
    // So larger R should extend further in the normal direction (negative Y here since normal is -Y)
    expect(Math.abs(geoLarge.boundingBox!.min.y)).toBeGreaterThan(
      Math.abs(geoSmall.boundingBox!.min.y)
    );
  });

  it('computeBendLinePositions reflects the bend radius', () => {
    const edge = makeEdge();
    const thickness = 4;

    const smallR = makeFlange({ bendRadius: 2 });
    const largeR = makeFlange({ bendRadius: 10 });

    const linesSmall = computeBendLinePositions(edge, smallR, thickness);
    const linesLarge = computeBendLinePositions(edge, largeR, thickness);

    // Bend start lines should be at the same position (at the edge, t=0)
    // because at t=0, inner pos is always (0, epsilon) regardless of R
    expect(linesSmall.bendStart[0].x).toBeCloseTo(linesLarge.bendStart[0].x, 1);

    // Bend end lines should differ — larger R pushes the end further out
    // At t=90°: inner u = R*sin(90°) = R, so larger R → larger offset in normal direction
    // Normal is (0, -1, 0), so the Y coordinate should be more negative for larger R
    expect(linesLarge.bendEnd[0].y).toBeLessThan(linesSmall.bendEnd[0].y);
  });

  it('bend end line position matches expected arc geometry for R=4, angle=90°', () => {
    const edge = makeEdge();
    const thickness = 4;
    const flange = makeFlange({ bendRadius: 4, angle: 90 });

    const lines = computeBendLinePositions(edge, flange, thickness);

    // At 90° bend: inner surface end = (R*sin(90), R*(1-cos(90))) = (R, R) = (4, 4)
    // Normal direction is (0, -1, 0), so u offset goes in -Y direction
    // wDir is (0, 0, 1) for 'up', so w offset goes in +Z direction
    // bendEnd inner at edge.start: start(0,0,4) + uDir*(4)*(-1 in Y) + wDir*(4+epsilon)
    const bendEndStart = lines.bendEnd[0];
    
    // u = R*sin(90°) = 4, applied in normal direction (0,-1,0) → Y offset = -4
    expect(bendEndStart.y).toBeCloseTo(0 + (-1) * 4, 1); // = -4
    
    // w = R*(1-cos(90°)) = 4, applied in wDir (0,0,1) → Z offset = 4 + epsilon
    expect(bendEndStart.z).toBeCloseTo(4 + 4, 0); // ≈ 8
  });

  it('changing bend radius from 4 to 8 doubles the bend line end offset', () => {
    const edge = makeEdge();
    const thickness = 4;

    const r4 = computeBendLinePositions(edge, makeFlange({ bendRadius: 4, angle: 90 }), thickness);
    const r8 = computeBendLinePositions(edge, makeFlange({ bendRadius: 8, angle: 90 }), thickness);

    // For 90° bend, inner end u = R*sin(90) = R
    // So R=8 should have double the Y offset compared to R=4
    const yOffset4 = Math.abs(r4.bendEnd[0].y - edge.start.y);
    const yOffset8 = Math.abs(r8.bendEnd[0].y - edge.start.y);

    expect(yOffset8).toBeCloseTo(yOffset4 * 2, 1);
  });
});
