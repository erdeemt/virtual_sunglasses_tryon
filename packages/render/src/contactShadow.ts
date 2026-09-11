import * as THREE from 'three';

/**
 * Gölgeler (TASKS T-02) — roadmap: "en büyük tek gerçekçilik ipucu".
 *
 * İki katman, ikisi de yüz mesh'inin geometrisini paylaşıyor:
 *
 * 1. Gölge alıcı: tahmini ana ışıktan gelen shadow map'i yüze projekte eder
 *    (ShadowMaterial — sadece gölgeyi çizer, geri kalanı şeffaf). Çerçevenin
 *    ve sapların yüze düşen gölgesi buradan gelir. Işık yönü görüntüden
 *    tahmin edildiği için gölge gerçek ışıkla tutarlı düşer.
 *
 * 2. Kontak AO: burun pedleri ve köprünün yüze değdiği yerde küçük, koyu
 *    Gauss lekeleri. Shadow map çözünürlüğü bu kadar ince teması yakalamaz;
 *    "yapışkan sticker" hissini asıl yok eden katman bu.
 *
 * Video zaten gerçek gölgeleri içerdiği için yüzün kendi kendine gölge
 * düşürmesi KAPALI — yoksa burnun altı çift kararır.
 */
export class ContactShadow {
  readonly receiver: THREE.Mesh;
  readonly ao: THREE.Mesh;
  private readonly shadowMaterial: THREE.ShadowMaterial;
  private readonly aoMaterial: THREE.ShaderMaterial;

  constructor(faceGeometry: THREE.BufferGeometry) {
    this.shadowMaterial = new THREE.ShadowMaterial({
      opacity: 0.28,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.receiver = new THREE.Mesh(faceGeometry, this.shadowMaterial);
    this.receiver.name = 'shadow-receiver';
    this.receiver.receiveShadow = true;
    this.receiver.castShadow = false;
    this.receiver.renderOrder = 1;
    this.receiver.frustumCulled = false;

    this.aoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uContacts: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
        uWeights: { value: [0, 0, 0, 0] },
        uCount: { value: 0 },
        uSigma: { value: 3.2 },
        uStrength: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uContacts[4];
        uniform float uWeights[4];
        uniform int uCount;
        uniform float uSigma;
        uniform float uStrength;
        varying vec3 vWorld;
        void main() {
          float ao = 0.0;
          for (int i = 0; i < 4; i++) {
            if (i >= uCount) break;
            float d = distance(vWorld, uContacts[i]);
            ao += uWeights[i] * exp(-(d * d) / (2.0 * uSigma * uSigma));
          }
          float alpha = uStrength * clamp(ao, 0.0, 1.0);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.ao = new THREE.Mesh(faceGeometry, this.aoMaterial);
    this.ao.name = 'contact-ao';
    this.ao.renderOrder = 2;
    this.ao.frustumCulled = false;
  }

  /** En fazla 4 temas noktası (dünya uzayı, mm) ve her birinin ağırlığı. */
  setContacts(points: Array<{ point: THREE.Vector3; weight: number }>): void {
    const contacts = this.aoMaterial.uniforms.uContacts!.value as THREE.Vector3[];
    const weights = this.aoMaterial.uniforms.uWeights!.value as number[];
    const n = Math.min(4, points.length);
    for (let i = 0; i < n; i++) {
      contacts[i]!.copy(points[i]!.point);
      weights[i] = points[i]!.weight;
    }
    this.aoMaterial.uniforms.uCount!.value = n;
  }

  setStrength(shadowOpacity: number, aoStrength: number): void {
    this.shadowMaterial.opacity = shadowOpacity;
    this.aoMaterial.uniforms.uStrength!.value = aoStrength;
  }

  setVisible(visible: boolean): void {
    this.receiver.visible = visible;
    this.ao.visible = visible;
  }

  dispose(): void {
    this.shadowMaterial.dispose();
    this.aoMaterial.dispose();
  }
}
