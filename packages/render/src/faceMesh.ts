import * as THREE from 'three';
import type { FaceUnits } from '@vto/core';
import { unprojectToMM } from './camera.js';

/**
 * Occluder yüz mesh'i — roadmap §8.1, "tek en kritik numara".
 *
 * Yüz, renk yazmadan ama derinlik yazarak render edilir. Z-buffer böylece
 * gözlük saplarını kafanın arkasında keser. Bu yapılmadığında gözlük yüzün
 * "üstünde yüzer" ve hiçbir PBR kalitesi bunu kurtarmaz.
 */

/** MediaPipe bağlantı listesi: ardışık her 3 kenar kapalı bir üçgen oluşturur. */
export interface Connection {
  start: number;
  end: number;
}

export function trianglesFromTesselation(connections: readonly Connection[]): Uint16Array {
  const count = Math.floor(connections.length / 3);
  const indices = new Uint16Array(count * 3);
  for (let t = 0; t < count; t++) {
    const a = connections[t * 3]!;
    const b = connections[t * 3 + 1]!;
    const c = connections[t * 3 + 2]!;
    // Kapalılık doğrulaması: a.end===b.start && b.end===c.start && c.end===a.start
    // (tasks-vision 1.0.0'da 852 üçgenin tamamı kapalı — çalışma anında
    // tekrar kontrol etmeye değmez, ama sürüm yükseltmesinde bak.)
    indices[t * 3] = a.start;
    indices[t * 3 + 1] = b.start;
    indices[t * 3 + 2] = c.start;
  }
  return indices;
}

export class FaceOccluder {
  readonly mesh: THREE.Mesh;
  /** Gölge alıcı ve kontak AO aynı geometriyi paylaşıyor — tek güncelleme. */
  readonly geometry: THREE.BufferGeometry;
  /** Kamera uzayında mm; yerleştirme çözücüsü doğrudan bunu kullanıyor. */
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  private scratch: Float32Array;

  /** Tesselation yalnızca 468 yüz noktasını kapsar; iris (468-477) hariç. */
  private readonly vertexCount = 468;

  constructor(tesselation: readonly Connection[]) {
    this.positions = new Float32Array(this.vertexCount * 3);
    this.scratch = new Float32Array(478 * 3);
    this.indices = trianglesFromTesselation(tesselation);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    const material = new THREE.MeshBasicMaterial({
      colorWrite: false, // renk yazma — yalnızca derinlik
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.renderOrder = -1; // gözlükten önce çiz ki z-buffer hazır olsun
    this.mesh.frustumCulled = false;
    this.mesh.name = 'face-occluder';
  }

  /** Hata ayıklama: occluder'ı görünür kıl (wireframe / yarı saydam). */
  setDebug(mode: 'off' | 'wireframe' | 'solid'): void {
    const m = this.mesh.material as THREE.MeshBasicMaterial;
    m.colorWrite = mode !== 'off';
    m.wireframe = mode === 'wireframe';
    m.transparent = mode === 'solid';
    m.opacity = mode === 'solid' ? 0.55 : 1;
    m.color.set(mode === 'wireframe' ? 0x4a9eff : 0x35c98a);
    m.needsUpdate = true;
  }

  update(lm: FaceUnits, scaleMMPerUnit: number, aspect: number, fovYDeg: number): void {
    if (this.scratch.length !== lm.length * 3) this.scratch = new Float32Array(lm.length * 3);
    unprojectToMM(lm, scaleMMPerUnit, aspect, fovYDeg, this.scratch);
    this.positions.set(this.scratch.subarray(0, this.vertexCount * 3));

    const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
