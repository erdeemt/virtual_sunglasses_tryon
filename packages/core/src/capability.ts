/**
 * Cihaz yetenek tespiti ve kalite kademesi.
 *
 * DİKKAT (roadmap §2): `navigator.xr` varlığı iOS'ta AR oturumu alınabildiği
 * ANLAMINA GELMEZ. iOS Safari'de immersive-ar desteklenmiyor ve TrueDepth
 * tarayıcıya hiçbir yoldan açılmıyor. Bu yüzden tespit async ve
 * isSessionSupported() tabanlı.
 */

export type Tier = 'high' | 'mid' | 'low' | 'photo';

export interface Capability {
  tier: Tier;
  hasWebGL2: boolean;
  hasWebGPU: boolean;
  /** Gerçekten immersive-ar oturumu açılabilir mi (iOS'ta beklenen: false). */
  hasImmersiveAR: boolean;
  hasCamera: boolean;
  gpuRenderer: string;
  cores: number;
  deviceMemoryGB: number | null;
  isIOS: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  /** Kademeye bağlı çalışma ayarları. */
  budget: TierBudget;
}

export interface TierBudget {
  /** Perception hedef frekansı (Hz). Render'dan bağımsız — ara kareler filtre ile doldurulur. */
  perceptionHz: number;
  /** Render hedef FPS. */
  renderFps: number;
  /** devicePixelRatio üst sınırı. */
  maxPixelRatio: number;
  /** Saç matting kaç karede bir çalışsın (0 = kapalı). */
  hairSegmentEvery: number;
  lensRefraction: boolean;
  softShadows: boolean;
}

const BUDGETS: Record<Tier, TierBudget> = {
  high: { perceptionHz: 60, renderFps: 60, maxPixelRatio: 2, hairSegmentEvery: 1, lensRefraction: true, softShadows: true },
  mid: { perceptionHz: 30, renderFps: 60, maxPixelRatio: 1.5, hairSegmentEvery: 3, lensRefraction: true, softShadows: false },
  low: { perceptionHz: 20, renderFps: 30, maxPixelRatio: 1, hairSegmentEvery: 0, lensRefraction: false, softShadows: false },
  photo: { perceptionHz: 0, renderFps: 0, maxPixelRatio: 1, hairSegmentEvery: 0, lensRefraction: false, softShadows: false },
};

/** Düşük performanslı mobil GPU imzaları — kaba ama pratikte iş görüyor. */
const WEAK_GPU = /Mali-4|Mali-T[0-7]|Adreno \(TM\) [123]\d{2}|PowerVR (SGX|GE8[01])|Videocore|SwiftShader|llvmpipe/i;

function readGpuRenderer(): { renderer: string; hasWebGL2: boolean } {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { renderer: '', hasWebGL2: false };

  // WEBGL_debug_renderer_info bazı tarayıcılarda (Safari, sıkı gizlilik modları)
  // yok. Yokluğu hata değil — sadece daha az bilgiyle kademe seçeriz.
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg
    ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));

  // Bağlamı serbest bırak — Safari'de canlı WebGL bağlamı sayısı sınırlı.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { renderer, hasWebGL2: true };
}

export async function detectCapability(): Promise<Capability> {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ kendini macOS olarak tanıtıyor; dokunma desteği ile ayırt edilir.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid;

  const { renderer, hasWebGL2 } = readGpuRenderer();
  const cores = navigator.hardwareConcurrency ?? 4;
  const deviceMemoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const hasWebGPU = 'gpu' in navigator;

  // WebXR tiplerini bağımlılık olarak eklemek yerine yerel daraltma —
  // tek ihtiyacımız isSessionSupported ve o da her yerde yok.
  const xr = (navigator as Navigator & {
    xr?: { isSessionSupported(mode: string): Promise<boolean> };
  }).xr;

  let hasImmersiveAR = false;
  try {
    hasImmersiveAR = (await xr?.isSessionSupported('immersive-ar')) ?? false;
  } catch {
    hasImmersiveAR = false;
  }

  const hasCamera =
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    (window.isSecureContext ?? false);

  let tier: Tier;
  if (!hasWebGL2 || !hasCamera) {
    tier = 'photo';
  } else if (WEAK_GPU.test(renderer) || cores <= 4 || (deviceMemoryGB !== null && deviceMemoryGB <= 2)) {
    tier = 'low';
  } else if (cores >= 8 && (deviceMemoryGB === null || deviceMemoryGB >= 6)) {
    tier = 'high';
  } else {
    tier = 'mid';
  }

  return {
    tier,
    hasWebGL2,
    hasWebGPU,
    hasImmersiveAR,
    hasCamera,
    gpuRenderer: renderer,
    cores,
    deviceMemoryGB,
    isIOS,
    isAndroid,
    isMobile,
    budget: BUDGETS[tier],
  };
}

/** Çalışma anında FPS düşerse kademeyi indir (roadmap §14). */
export function degradeTier(current: Tier): Tier {
  const order: Tier[] = ['high', 'mid', 'low', 'photo'];
  const i = order.indexOf(current);
  return order[Math.min(i + 1, order.length - 1)] ?? 'low';
}
