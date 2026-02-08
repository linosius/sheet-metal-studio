import { useMemo } from 'react';
import * as THREE from 'three';

// Three.js BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
const FACE_LABELS = ['RIGHT', 'LEFT', 'BACK', 'FRONT', 'TOP', 'BOTTOM'];

function createFaceTexture(label: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Soft light background
  ctx.fillStyle = '#e8ecf0';
  ctx.fillRect(0, 0, size, size);

  // Subtle inset border
  ctx.strokeStyle = '#b0bec5';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  // Face label
  ctx.fillStyle = '#455a64';
  const fontSize = label.length > 5 ? 13 : 16;
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function ViewCube() {
  const materials = useMemo(() => {
    return FACE_LABELS.map((label) => {
      const texture = createFaceTexture(label);
      return new THREE.MeshBasicMaterial({ map: texture });
    });
  }, []);

  const edgesGeo = useMemo(() => {
    const box = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    return new THREE.EdgesGeometry(box);
  }, []);

  return (
    <group>
      <mesh>
        <boxGeometry args={[1.8, 1.8, 1.8]} />
        {materials.map((mat, i) => (
          <primitive key={i} object={mat} attach={`material-${i}`} />
        ))}
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color="#90a4ae" />
      </lineSegments>
    </group>
  );
}
