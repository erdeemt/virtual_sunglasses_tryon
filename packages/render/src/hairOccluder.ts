import * as THREE from 'three';

/**
 * Saç occlusion'ı (TASKS T-04).
 *
 * Yüz mesh'i saçı içermez; uzun saçlı kullanıcıda sap saçın ÖNÜNDEN geçer.
 * WP'nin native uygulamasında bile zayıf olan bir yer.
 *
 * Yöntem: menteşe hattında, yüze paralel görünmez bir düzlem. Saç maskesinin
 * açık olduğu piksellerde derinlik yazar, kapalı olduklarında atılır. Böylece
 * düzlemin GERİSİNDE kalan her şey (saplar) saçın olduğu yerde gizlenir,
 * önünde kalan ön çerçeve etkilenmez. Hiçbir malzemeye dokunmadığı için
 * herhangi bir GLB ile çalışır.
 *
 * Ekran koordinatı gl_FragCoord'dan değil projeksiyondan hesaplanıyor:
 * three.js lens transmission'ı için sahneyi farklı çözünürlükte bir hedefe
 * de çiziyor, gl_FragCoord orada yanlış uv verirdi.
 *
 * Bilinen sınır: kulak ARKASINA toplanmış saç da maskede "saç" görünür ve
 * sapı gizler (sap aslında saçın önünde olmalı). Derinlik bilgisi olmadan
 * ayırt edilemiyor; yaygın durum (saç sapların üstünden dökülüyor) doğru.
 */
export class HairOccluder {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private texture: THREE.DataTexture | null = null;
  private data: Uint8Array | null = null;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: null },
        uThreshold: { value: 0.5 },
        uHasMask: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec4 vClip;
        void main() {
          vClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vClip;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMask;
        uniform float uThreshold;
        uniform float uHasMask;
        varying vec4 vClip;
        void main() {
          if (uHasMask < 0.5) discard;
          vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;
          // Maskenin 0. satırı görüntünün ÜSTÜ; doku örneklemesinde v=0 alt.
          float hair = texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).r;
          if (hair < uThreshold) discard;
          gl_FragColor = vec4(0.0);
        }
      `,
      colorWrite: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.material);
    this.mesh.name = 'hair-occluder';
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * @param mask  saç güven maskesi (0..1 float ya da 0..255 byte), satır sırası üstten alta
   */
  updateMask(mask: Float32Array | Uint8Array, width: number, height: number): void {
    if (!this.texture || !this.data || this.texture.image.width !== width || this.texture.image.height !== height) {
      this.texture?.dispose();
      this.data = new Uint8Array(width * height);
      this.texture = new THREE.DataTexture(this.data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this.material.uniforms.uMask!.value = this.texture;
    }

    const out = this.data;
    if (mask instanceof Float32Array) {
      for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, mask[i]! * 255));
    } else {
      out.set(mask.subarray(0, out.length));
    }
    this.texture.needsUpdate = true;
    this.material.uniforms.uHasMask!.value = 1;
  }

  clearMask(): void {
    this.material.uniforms.uHasMask!.value = 0;
  }

  setEnabled(enabled: boolean): void {
    this.mesh.visible = enabled;
  }

  /** Düzlemi menteşe hattına, yüze paralel yerleştir. */
  place(center: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): void {
    this.mesh.position.copy(center);
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
