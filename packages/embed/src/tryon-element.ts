import type { FitReport } from '@vto/core';
import type { EngineFrame, TryOnEngine } from '@vto/engine';

/**
 * <glasses-tryon> — markaların ürün sayfasına gömülen widget (TASKS T-10).
 *
 *   <script type="module" src="https://cdn.../embed.js"></script>
 *   <glasses-tryon model="/models/aviator.glb" label="Aviator"></glasses-tryon>
 *   <glasses-tryon spec="49,21,145" label="Klasik"></glasses-tryon>
 *
 * Nitelikler:
 *   model       GLB adresi (sayfaya göre göreli olabilir)
 *   spec        "lens,köprü,sap" — parametrik çerçeve (model yoksa)
 *   label       modal başlığı
 *   asset-base  mediapipe/ ve models/ dizinlerinin kökü (varsayılan "/")
 *   accent      vurgu rengi
 *
 * Olaylar (bubbles + composed — Shadow DOM dışına çıkar):
 *   vto:ready   kamera açıldı, deneme başladı
 *   vto:fit     detail: FitReport — skor, beden önerisi, optik ölçümler
 *   vto:capture detail: { blob } — kullanıcının çektiği fotoğraf
 *   vto:error   detail: { message }
 *   vto:close
 *
 * Tasarım kararları:
 *   - Shadow DOM: markanın CSS'i widget'ı bozamaz (B2B destek biletlerinin
 *     en büyük kaynağı).
 *   - Lazy load: bu dosya motoru STATİK import etmez. three.js + MediaPipe
 *     yalnızca kullanıcı "Sanal Dene"ye basınca iner — marka sayfasının
 *     Core Web Vitals'ını bozmak ilk itiraz sebebi olur.
 *   - Önce gizlilik: kamera izni istenmeden önce görüntünün cihazdan
 *     çıkmadığı söyleniyor. İzin ekranı dönüşüm oranını belirgin etkiliyor.
 */

const STYLE = /* css */ `
  :host {
    display: inline-block;
    --vto-accent: #1a73e8;
    --vto-bg: #0b0d10;
    --vto-fg: #e6eaef;
    --vto-dim: #8b97a6;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--vto-accent);
    color: #fff;
    border: 0;
    border-radius: 999px;
    padding: 10px 18px;
    font: 600 14px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  .trigger:hover { filter: brightness(1.08); }
  .trigger:focus-visible, button:focus-visible { outline: 2px solid var(--vto-accent); outline-offset: 2px; }

  .modal {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.72);
  }
  .modal[hidden] { display: none; }
  .sheet {
    width: min(760px, 100vw);
    height: min(680px, 100dvh);
    display: grid;
    grid-template-rows: auto 1fr auto;
    background: var(--vto-bg);
    color: var(--vto-fg);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  }
  @media (max-width: 640px) {
    .sheet { width: 100vw; height: 100dvh; border-radius: 0; }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #1e252d;
  }
  .title { font-weight: 600; font-size: 15px; }
  .close {
    background: transparent;
    color: var(--vto-dim);
    border: 0;
    font-size: 20px;
    cursor: pointer;
    line-height: 1;
    padding: 4px 8px;
  }

  .stage { position: relative; background: #000; overflow: hidden; }
  /* Video çözülmeye devam etmeli ama görünmemeli — motor onu WebGL
     sahnesinin arka planı olarak çiziyor. display:none bazı tarayıcılarda
     kare akışını durdurabiliyor. */
  video { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1); /* ayna — kullanıcı kendini aynada görmeye alışkın */
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    padding: 28px;
    text-align: center;
    background: rgba(11, 13, 16, 0.9);
  }
  .overlay[hidden] { display: none; }
  .overlay p { max-width: 420px; margin: 0; color: var(--vto-dim); line-height: 1.5; font-size: 14px; }
  .overlay strong { color: var(--vto-fg); }
  .allow {
    background: var(--vto-accent);
    color: #fff;
    border: 0;
    border-radius: 999px;
    padding: 11px 22px;
    font: 600 14px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  .spinner {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 3px solid #26303a;
    border-top-color: var(--vto-accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { color: #e05c5c !important; }
  .hint {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    white-space: nowrap;
  }
  .hint[hidden] { display: none; }

  footer {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border-top: 1px solid #1e252d;
  }
  .score { font: 700 26px/1 ui-monospace, Consolas, monospace; min-width: 44px; }
  .verdict { font-size: 13px; line-height: 1.35; }
  .verdict b { display: block; font-size: 14px; }
  .ok { color: #35c98a; }
  .warn { color: #e0b341; }
  .bad { color: #e05c5c; }
  .pd { font: 12px ui-monospace, Consolas, monospace; color: var(--vto-dim); }
  .capture {
    margin-left: auto;
    background: #1e252d;
    color: var(--vto-fg);
    border: 0;
    border-radius: 999px;
    padding: 9px 16px;
    font: 600 13px/1 system-ui, sans-serif;
    cursor: pointer;
  }
`;

const TEMPLATE = /* html */ `
  <button class="trigger" part="button" type="button"><slot>Sanal Dene</slot></button>
  <div class="modal" hidden role="dialog" aria-modal="true" aria-label="Sanal deneme">
    <div class="sheet">
      <header>
        <span class="title"></span>
        <button class="close" type="button" aria-label="Kapat">✕</button>
      </header>
      <div class="stage">
        <video playsinline muted></video>
        <canvas></canvas>
        <div class="overlay consent">
          <p><strong>Kamera görüntün cihazından çıkmaz.</strong><br />
          Tüm işlem tarayıcında yapılır; hiçbir kare sunucuya gönderilmez, kaydedilmez.</p>
          <button class="allow" type="button">Kamerayı Aç</button>
        </div>
        <div class="overlay loading" hidden>
          <div class="spinner"></div>
          <p class="msg">Hazırlanıyor…</p>
        </div>
        <div class="hint" hidden>Kameraya düz bak</div>
      </div>
      <footer>
        <span class="score">—</span>
        <span class="verdict"><b>Ölçülüyor…</b>Kameraya düz bak</span>
        <span class="pd"></span>
        <button class="capture" type="button">Fotoğraf</button>
      </footer>
    </div>
  </div>
`;

const VERDICT: Record<FitReport['verdict'], string> = {
  good: 'Uygun',
  'too-narrow': 'Dar',
  'too-wide': 'Geniş',
};

export class GlassesTryOn extends HTMLElement {
  static observedAttributes = ['model', 'spec', 'label', 'accent'];

  private readonly root: ShadowRoot;
  private enginePromise: Promise<TryOnEngine> | null = null;
  private engine: TryOnEngine | null = null;
  private glassesKey = '';
  private previousOverflow = '';
  private readonly q = <T extends Element>(selector: string): T => this.root.querySelector(selector) as T;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;

    this.q('.trigger').addEventListener('click', () => this.open());
    this.q('.close').addEventListener('click', () => this.close());
    this.q('.allow').addEventListener('click', () => void this.start());
    this.q('.capture').addEventListener('click', () => this.capture());
    this.q('.modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
  }

  connectedCallback(): void {
    this.applyAccent();
  }

  disconnectedCallback(): void {
    this.close();
    this.engine?.dispose();
    this.engine = null;
    this.enginePromise = null;
  }

  attributeChangedCallback(name: string): void {
    if (name === 'accent') this.applyAccent();
    if ((name === 'model' || name === 'spec') && this.engine?.isRunning) void this.applyGlasses(this.engine);
  }

  /** Modalı aç. Kamera, kullanıcı gizlilik notunu görüp onaylayınca açılır. */
  open(): void {
    const modal = this.q<HTMLElement>('.modal');
    if (!modal.hidden) return;
    this.q('.title').textContent = this.getAttribute('label') ?? 'Sanal Deneme';
    modal.hidden = false;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.q<HTMLButtonElement>('.close').focus();

    const running = this.engine?.isRunning ?? false;
    this.q<HTMLElement>('.consent').hidden = running;
    if (!running && this.engine) {
      // Motor daha önce yüklendiyse izin ekranını tekrar göstermeye gerek yok.
      this.q<HTMLElement>('.consent').hidden = true;
      void this.start();
    }
  }

  close(): void {
    const modal = this.q<HTMLElement>('.modal');
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = this.previousOverflow;
    // Kamerayı hemen bırak — açık kalan kamera ışığı güveni yok eder.
    this.engine?.stop();
    this.emit('vto:close');
  }

  private async start(): Promise<void> {
    this.q<HTMLElement>('.consent').hidden = true;
    this.setLoading('Modeller yükleniyor…');
    try {
      const engine = await this.getEngine();
      await this.applyGlasses(engine);
      this.setLoading('Kamera açılıyor…');
      await engine.start();
      this.setLoading(null);
      this.emit('vto:ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setLoading(message, true);
      this.emit('vto:error', { message });
    }
  }

  private getEngine(): Promise<TryOnEngine> {
    this.enginePromise ??= (async () => {
      // Dinamik import — ağır motor ayrı bir parça olarak iner.
      const { TryOnEngine } = await import('@vto/engine');
      const engine = await TryOnEngine.create({
        video: this.q<HTMLVideoElement>('video'),
        canvas: this.q<HTMLCanvasElement>('canvas'),
        assetBase: this.getAttribute('asset-base') ?? '/',
      });
      engine.on('fit', (fit) => {
        this.renderFit(fit);
        this.emit('vto:fit', fit);
      });
      engine.on('frame', (frame) => this.onFrame(frame));
      engine.on('error', (error) => {
        this.setLoading(error.message, true);
        this.emit('vto:error', { message: error.message });
      });
      this.engine = engine;
      return engine;
    })();
    return this.enginePromise;
  }

  private async applyGlasses(engine: TryOnEngine): Promise<void> {
    const model = this.getAttribute('model');
    const spec = this.getAttribute('spec') ?? '49,21,145';
    const key = model ? `model:${model}` : `spec:${spec}`;
    if (key === this.glassesKey) return;

    if (model) {
      await engine.loadGlasses(new URL(model, location.href).href);
    } else {
      const [w, b, t] = spec.split(',').map((v) => Number(v.trim()));
      engine.setFrameSize(w || 49, b || 21, t || 145);
    }
    this.glassesKey = key;
    this.renderFit(null);
  }

  private onFrame(frame: EngineFrame): void {
    const hint = this.q<HTMLElement>('.hint');
    if (!frame.metric) {
      hint.textContent = 'Yüzünü kadraja al';
      hint.hidden = false;
      return;
    }
    hint.textContent = 'Kameraya düz bak';
    hint.hidden = frame.metric.accepted;

    const state = frame.metric.state;
    if (state?.settled) {
      const m = state.measurements;
      const tol = m.pd * state.systematicCV;
      this.q('.pd').textContent = `PD ${m.pd.toFixed(1)} ± ${tol.toFixed(1)} mm`;
    }
  }

  private renderFit(fit: FitReport | null): void {
    const score = this.q<HTMLElement>('.score');
    const verdict = this.q<HTMLElement>('.verdict');
    if (!fit) {
      score.textContent = '—';
      score.className = 'score';
      verdict.innerHTML = '<b>Ölçülüyor…</b>Kameraya düz bak';
      return;
    }
    score.textContent = String(fit.score);
    score.className = `score ${fit.score >= 75 ? 'ok' : fit.score >= 55 ? 'warn' : 'bad'}`;
    const size =
      fit.sizeSuggestion === 1 ? 'Bir beden büyük önerilir' : fit.sizeSuggestion === -1 ? 'Bir beden küçük önerilir' : 'Beden uygun';
    verdict.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = VERDICT[fit.verdict];
    b.className = fit.verdict === 'good' ? 'ok' : 'bad';
    verdict.append(b, document.createTextNode(size));
  }

  /**
   * Kullanıcının gördüğü (aynalanmış) kareyi fotoğrafla. WebGL tamponu
   * kompozisyondan sonra silindiği için çizimle AYNI görev içinde okunuyor.
   */
  private capture(): void {
    const scene = this.engine?.scene;
    const source = this.q<HTMLCanvasElement>('canvas');
    if (!scene) return;
    scene.render();
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      this.emit('vto:capture', { blob });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sanal-deneme-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  private setLoading(message: string | null, isError = false): void {
    const overlay = this.q<HTMLElement>('.loading');
    overlay.hidden = message === null;
    const msg = this.q<HTMLElement>('.msg');
    msg.textContent = message ?? '';
    msg.classList.toggle('error', isError);
    this.q<HTMLElement>('.spinner').hidden = isError;
  }

  private applyAccent(): void {
    const accent = this.getAttribute('accent');
    if (accent) this.style.setProperty('--vto-accent', accent);
  }

  private emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

if (!customElements.get('glasses-tryon')) {
  customElements.define('glasses-tryon', GlassesTryOn);
}

declare global {
  interface HTMLElementTagNameMap {
    'glasses-tryon': GlassesTryOn;
  }
}
