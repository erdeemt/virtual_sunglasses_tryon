import {
  OneEuroFilter,
  PRIORS,
  detectCapability,
  type Capability,
  type ConstraintKey,
  type EstimatorFrame,
  type RestStatus,
} from '@vto/core';
import { TryOnEngine, type EngineFrame } from '@vto/engine';
import { specLabel, type OccluderDebug } from '@vto/render';
import { drawOverlay, type OverlayFlags } from './overlay.js';
import { Study } from './study.js';
import { Audit } from './audit.js';
import { setupGlbLoader } from './glbLoader.js';
import { renderFit } from './fitPanel.js';

/**
 * Geliştirme paneli.
 *
 * Pipeline'ın kendisi @vto/engine içinde — bu dosya yalnızca motorun
 * yayınladığı olaylara abone olup teşhis araçlarını çiziyor (landmark
 * overlay'i, denetim modu, doğruluk çalışması, çözücü durumu). Embed widget
 * aynı motoru kullanıyor; burada görülen davranış müşterinin göreceği
 * davranışla aynı.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} yok`);
  return node as T;
};

const video = el<HTMLVideoElement>('video');
const canvas = el<HTMLCanvasElement>('overlay');
const threeCanvas = el<HTMLCanvasElement>('three');
const ctx = canvas.getContext('2d')!;
const panel = el('panel');

/**
 * Teşhis anahtarları — bir sorunu tahminle aramak yerine bisect etmek için.
 *   ?no3d=1   three.js sahnesi kapalı
 *   ?cpu=1    MediaPipe CPU delegesi
 *   ?nohair=1 saç segmentasyonu kapalı
 */
const params = new URLSearchParams(location.search);
const USE_3D = !params.has('no3d');
const FORCE_CPU = params.has('cpu');
const NO_HAIR = params.has('nohair');

const DEMO_MODEL_URL = '/models/glasses/khronos-sunglasses.glb';

const study = new Study();
const audit = new Audit();
let auditActive = false;
let capability: Capability;
let engine: TryOnEngine | null = null;
let lastState: EstimatorFrame['state'] = null;
let modelChoice: 'parametric' | 'khronos' | 'custom' = 'parametric';

/** Görüntülenen sayıları yumuşat — okunamayan titrek rakamlar güven kaybettirir. */
const displayFilters = {
  pd: new OneEuroFilter({ minCutoff: 0.6, beta: 0.01 }),
  fps: new OneEuroFilter({ minCutoff: 1.5, beta: 0.01 }),
};

const STATUS_LABEL: Record<RestStatus, string> = {
  nose: '<span class="q-ok">burunda</span>',
  'rides-high': '<span class="q-warn">yukarıda — köprü dar</span>',
  'slides-low': '<span class="q-warn">aşağı kayıyor — köprü geniş</span>',
  'on-cheeks': '<span class="q-warn">yanaklara değiyor</span>',
  'on-lashes': '<span class="q-warn">kirpiğe yakın</span>',
};

const CONSTRAINT_LABEL: Record<ConstraintKey, string> = {
  pads: 'burun pedleri',
  bridge: 'köprü',
  cheeks: 'yanak',
  brow: 'kaş',
  lashes: 'kirpik',
};

// ---------------------------------------------------------------- yetenek

async function showCapability(): Promise<void> {
  capability = await detectCapability();
  const c = capability;
  el('capability').textContent = [
    `kademe        ${c.tier}`,
    `WebGL2        ${c.hasWebGL2 ? 'var' : 'YOK'}`,
    `WebGPU        ${c.hasWebGPU ? 'var' : 'yok'}`,
    `immersive-ar  ${c.hasImmersiveAR ? 'var' : 'yok'}${c.isIOS ? '  (iOS: beklenen)' : ''}`,
    `kamera        ${c.hasCamera ? 'kullanılabilir' : 'YOK / güvensiz bağlam'}`,
    `çekirdek      ${c.cores}${c.deviceMemoryGB ? ` · ${c.deviceMemoryGB} GB` : ''}`,
    `GPU           ${c.gpuRenderer || '(bilgi verilmiyor)'}`,
    `perception    ${c.budget.perceptionHz} Hz · render ${c.budget.renderFps} FPS`,
    `saç maskesi   ${c.budget.hairSegmentEvery > 0 ? `${c.budget.hairSegmentEvery} karede bir` : 'kapalı (kademe)'}`,
  ].join('\n');

  el<HTMLSpanElement>('tier').textContent = `${c.tier} · ${c.budget.perceptionHz}Hz`;

  if (!c.hasCamera) {
    fail(
      window.isSecureContext
        ? 'Bu tarayıcıda kamera API\'si yok.'
        : 'Kamera için HTTPS gerekiyor. localhost dışında güvenli bağlantı kullan.',
    );
  }
}

function fail(message: string): void {
  const node = el<HTMLParagraphElement>('gate-error');
  node.textContent = message;
  node.hidden = false;
}

// ---------------------------------------------------------------- hata görünürlüğü

let fatalShown = false;

/**
 * Çökmeyi teşhis edilebilir kıl: ilk hatada dur ve mesaj + stack + cihaz
 * bilgisiyle göster. (Eskiden render döngüsünde atılan tek bir istisna
 * saniyede 60 kez tekrarlanıp sekmeyi kilitliyordu.)
 */
function showFatal(context: string, error: unknown): void {
  if (fatalShown) return;
  fatalShown = true;
  engine?.stop();

  const err = error instanceof Error ? error : new Error(String(error));
  const lines = [
    `bağlam:  ${context}`,
    `hata:    ${err.name}: ${err.message}`,
    '',
    `3D:      ${USE_3D ? 'açık' : 'kapalı (?no3d=1)'}`,
    `delege:  ${FORCE_CPU ? 'CPU (?cpu=1)' : capability?.tier === 'low' ? 'CPU (düşük kademe)' : 'GPU'}`,
    `saç:     ${NO_HAIR ? 'kapalı (?nohair=1)' : engine?.hairAvailable ? 'açık' : 'yok'}`,
    `kademe:  ${capability?.tier ?? '?'}`,
    `GPU:     ${capability?.gpuRenderer || '(bilgi yok)'}`,
    `tarayıcı:${navigator.userAgent}`,
    '',
    err.stack ?? '(stack yok)',
  ];

  el('fatal-message').textContent = lines.join('\n');
  el('fatal').hidden = false;
}

window.addEventListener('error', (e) => showFatal('window.error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showFatal('promise', e.reason));

// ---------------------------------------------------------------- başlatma

async function start(): Promise<void> {
  const button = el<HTMLButtonElement>('start');
  button.disabled = true;
  button.textContent = 'Modeller yükleniyor…';

  try {
    if (!engine) {
      engine = await TryOnEngine.create({
        video,
        canvas: threeCanvas,
        capability,
        forceCPU: FORCE_CPU,
        enable3D: USE_3D,
        ...(NO_HAIR ? { enableHair: false } : {}),
      });
      engine.on('frame', onFrame);
      engine.on('fit', (fit) => renderFit(el('fit'), fit));
      engine.on('error', (error) => showFatal('motor', error));
    }

    button.textContent = 'Kamera açılıyor…';
    await engine.start();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (USE_3D) {
      // Video artık WebGL sahnesinin arka planı — HTML video gizli kalıyor.
      video.classList.remove('live');
    } else {
      threeCanvas.hidden = true;
      video.classList.add('live');
    }

    const hairToggle = el<HTMLInputElement>('show-hair');
    hairToggle.disabled = !engine.hairAvailable;
    if (!engine.hairAvailable) hairToggle.checked = false;

    applySceneControls();
    el('gate').hidden = true;
    panel.hidden = false;
    renderPriorTable();
    renderAudit();
    renderFit(el('fit'), null);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Tekrar Dene';
    fail(error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------- kare olayı

function onFrame(f: EngineFrame): void {
  const t = f.timings;
  el('fps').textContent = `${displayFilters.fps.filter(t.fps, f.timestampMs).toFixed(0)} FPS · ${t.inferenceMs.toFixed(1)} ms`;
  el('timings').textContent =
    `saç ${t.hairMs.toFixed(1)} · çöz ${t.solveMs.toFixed(1)} · çiz ${t.renderMs.toFixed(1)} ms`;

  if (!f.units || !f.metric) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setGateStatus('bad', 'Yüz bulunamadı');
    return;
  }

  drawOverlay(ctx, f.units, f.metric.geometry, f.aspect, readFlags());
  updatePanel(f.metric, f.timestampMs);
  updateSceneInfo();
}

// ---------------------------------------------------------------- panel

function readFlags(): OverlayFlags {
  return {
    showAll: el<HTMLInputElement>('show-all').checked,
    showNamed: el<HTMLInputElement>('show-named').checked,
    showPlane: el<HTMLInputElement>('show-plane').checked,
    focusGroup: auditActive ? audit.step.group : null,
  };
}

function updatePanel(frame: EstimatorFrame, now: number): void {
  const { pose } = frame.geometry;
  lastState = frame.state;

  const pct = Math.round(pose.frontality * 100);
  const bar = el('frontality-bar');
  bar.style.width = `${pct}%`;
  bar.style.background = frame.accepted ? 'var(--ok)' : pct > 75 ? 'var(--warn)' : 'var(--bad)';

  el('pose').textContent =
    `yaw   ${fmt(pose.yaw, 1).padStart(6)}°\n` +
    `pitch ${fmt(pose.pitch, 1).padStart(6)}°\n` +
    `roll  ${fmt(pose.roll, 1).padStart(6)}°\n` +
    `frontallik ${pose.frontality.toFixed(3)}`;

  if (!frame.accepted) {
    setGateStatus('warn', 'Kapı kapalı — kameraya düz bak, ölçüm sayılmıyor');
  } else if (frame.state?.settled) {
    setGateStatus('ok', `Ölçüm oturdu (${frame.state.sampleCount} örnek)`);
  } else {
    setGateStatus('warn', `Örnek toplanıyor… ${frame.state?.sampleCount ?? 0}/20`);
  }

  const state = frame.state;
  const m = state ? state.measurements : frame.instant;
  const smoothPD = displayFilters.pd.filter(m.pd, now);

  const sysPct = state ? state.systematicCV * 100 : frame.scale.cv * 100;
  const stabPct = state ? state.stabilityCV * 100 : NaN;
  const tolMM = (smoothPD * sysPct) / 100;

  el('measurements').innerHTML = rows([
    ['PD (binoküler)', `<strong>${fmt(smoothPD, 1)}</strong> ± ${fmt(tolMM, 1)} mm`],
    ['PD sağ (OD)', `${fmt(m.pdOD, 1)} mm`],
    ['PD sol (OS)', `${fmt(m.pdOS, 1)} mm`],
    ['İç kantal', `${fmt(m.innerCanthal, 1)} mm`],
    ['Yüz genişliği', `${fmt(m.bizygomatic, 1)} mm`],
    ['İris çapı', `${fmt(m.irisDiameter, 2)} mm`],
    ['Sistematik belirsizlik', `<span class="${quality(sysPct)}">%${fmt(sysPct, 2)}</span>`],
    ['Kararlılık (jitter)', Number.isNaN(stabPct) ? '—' : `<span class="${quality(stabPct)}">%${fmt(stabPct, 2)}</span>`],
  ]);

  el('cues').innerHTML = rows(
    frame.scale.contributions.map((c) => [
      PRIORS[c.key].label,
      `${fmt(c.scale * c.observed, 1)} mm · ağırlık ${(c.weight * 100).toFixed(0)}%`,
    ]),
  );

  el('fusion-note').innerHTML =
    frame.scale.method === 'gls'
      ? 'GLS füzyonu — ipuçları arası korelasyon hesaba katıldı. İki iris ölçümü ' +
        'aynı büyüklüğün iki gözlemi olduğu için güven yapay olarak şişmiyor.'
      : '<span class="q-warn">Fallback: ters-varyans + tasarım etkisi cezası.</span> ' +
        'GLS güvenlik kapısına takıldı — kovaryans matrisi kötü koşullanmış olabilir.';
}

function updateSceneInfo(): void {
  const scene = engine?.scene;
  if (!scene) return;
  const p = scene.lastPlacement;
  const solve = scene.lastSolve;
  const local = scene.local;

  el('scene-info').innerHTML = rows([
    ['Çerçeve', specLabel(scene.spec)],
    ['Kamera mesafesi', `${fmt(p.distanceMM / 10, 1)} cm`],
    [
      'Yerleşim',
      p.mode === 'solver' ? 'temas çözücüsü' : p.mode === 'naive' ? '<span class="q-warn">yedek (naif)</span>' : '—',
    ],
    ['Dinlenme', solve ? STATUS_LABEL[solve.status] : '—'],
    ['Belirleyen temas', solve ? CONSTRAINT_LABEL[solve.governing] : '—'],
    ['Ped yüksekliği', local ? `${fmt(local.pivotY, 1)} mm <small>(sellion'a göre)</small>` : '—'],
    ['Pantoskopik', local ? `${fmt(local.pitchDeg, 1)}°` : '—'],
  ]);
}

function setGateStatus(kind: 'ok' | 'warn' | 'bad', text: string): void {
  const node = el('gate-status');
  node.className = `status ${kind}`;
  node.textContent = text;
}

function quality(cvPct: number): string {
  if (cvPct <= 2) return 'q-ok';
  if (cvPct <= 4) return 'q-warn';
  return 'q-bad';
}

function rows(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

function fmt(v: number, digits: number): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function renderPriorTable(): void {
  // Prior'lar görünür olsun — bunlar T-00'da kalibre edilecek TAHMİNLER.
  el('fusion-note').title = Object.values(PRIORS)
    .map((p) => `${p.label}: ${p.muMM} ± ${p.sigmaMM} mm — ${p.source}`)
    .join('\n');
}

// ---------------------------------------------------------------- sahne kontrolleri

function applySceneControls(rebuildParametric = true): void {
  const scene = engine?.scene;
  if (!engine || !scene) return;

  if (rebuildParametric && modelChoice === 'parametric') {
    const [w, b, t] = el<HTMLSelectElement>('frame-size').value.split(',').map(Number);
    engine.setFrameSize(w!, b!, t!);
  }

  scene.setGlassesVisible(el<HTMLInputElement>('show-glasses').checked);
  scene.setOccluderDebug(el<HTMLSelectElement>('occluder-debug').value as OccluderDebug);
  scene.setAnchorsVisible(el<HTMLInputElement>('show-anchors').checked);
  scene.setShadowsVisible(el<HTMLInputElement>('show-shadows').checked);
  engine.setHairEnabled(el<HTMLInputElement>('show-hair').checked);
}

const glb = setupGlbLoader({
  getEngine: () => engine,
  onLoaded: (source) => {
    if (source === 'file') {
      modelChoice = 'custom';
      const option = el<HTMLOptionElement>('model-custom');
      option.hidden = false;
      el<HTMLSelectElement>('glasses-model').value = 'custom';
      el('attribution').hidden = true;
    }
    el<HTMLSelectElement>('frame-size').disabled = modelChoice !== 'parametric';
    applySceneControls(false);
  },
});

async function chooseModel(choice: string): Promise<void> {
  if (!engine) return;
  if (choice === 'khronos') {
    modelChoice = 'khronos';
    el('attribution').hidden = false;
    await glb.load(DEMO_MODEL_URL, 'khronos-sunglasses.glb');
  } else if (choice === 'parametric') {
    modelChoice = 'parametric';
    el('attribution').hidden = true;
    glb.clearInfo();
    applySceneControls(true);
  }
  el<HTMLSelectElement>('frame-size').disabled = modelChoice !== 'parametric';
}

// ---------------------------------------------------------------- çalışma kaydı

function record(): void {
  if (!lastState) {
    alert('Henüz oturmuş bir ölçüm yok. Kameraya düz bakıp bekle.');
    return;
  }
  const subject = el<HTMLInputElement>('subject').value.trim();
  const truthRaw = el<HTMLInputElement>('truth-pd').value.trim();
  const truth = truthRaw === '' ? null : Number(truthRaw);

  const r = study.add(subject, truth, lastState, capability);
  const summary = study.summary();

  const line = document.createElement('div');
  line.textContent =
    `${r.subject}  ölçülen ${r.measuredPD} mm` +
    (r.truthPD !== null ? `  gerçek ${r.truthPD}  hata ${r.errorMM! > 0 ? '+' : ''}${r.errorMM} mm` : '');
  el('records').prepend(line);

  if (summary) {
    const head = document.createElement('div');
    head.innerHTML = `<strong>n=${summary.n} · MAE ${summary.mae} mm · bias ${summary.bias > 0 ? '+' : ''}${summary.bias} mm · max ${summary.maxAbs} mm</strong>`;
    el('records').prepend(head);
  }
}

// ---------------------------------------------------------------- denetim

function renderAudit(): void {
  const { current, total } = audit.position;
  const step = audit.step;
  const verdict = audit.verdictFor(step.group);

  el('audit-progress').textContent = auditActive
    ? `${current}/${total} · ${verdict === 'ok' ? '✓' : verdict === 'suspect' ? '✗' : '—'}`
    : `${audit.summary().ok}/${total} doğrulandı`;

  el('audit-title').textContent = `${current}. ${step.title}`;
  el('audit-check').textContent = step.check;
  el('audit-impact').textContent = step.impact;

  const s = audit.summary();
  el('audit-summary').innerHTML =
    s.pending === total
      ? 'Henüz denetim yapılmadı.'
      : s.complete
        ? '<span class="q-ok">Tüm gruplar doğrulandı.</span>'
        : `<span class="${s.suspect > 0 ? 'q-bad' : 'q-warn'}">${s.ok} doğru · ${s.suspect} şüpheli · ${s.pending} bekliyor</span>`;
}

function setAuditActive(active: boolean): void {
  auditActive = active;
  el('audit-body').hidden = !active;
  el<HTMLButtonElement>('audit-toggle').textContent = active ? 'Denetimi Bitir' : 'Denetimi Başlat';
  if (active) audit.jumpToFirstUnjudged();
  renderAudit();
}

// ---------------------------------------------------------------- bağlama

el('start').addEventListener('click', () => void start());
el('record').addEventListener('click', record);
el('export').addEventListener('click', () => study.export());
el('toggle-panel').addEventListener('click', () => panel.classList.toggle('collapsed'));

el('audit-toggle').addEventListener('click', () => setAuditActive(!auditActive));
el('audit-prev').addEventListener('click', () => {
  audit.prev();
  renderAudit();
});
el('audit-next').addEventListener('click', () => {
  audit.next();
  renderAudit();
});
el('audit-ok').addEventListener('click', () => {
  audit.set('ok');
  audit.next();
  renderAudit();
});
el('audit-suspect').addEventListener('click', () => {
  audit.set('suspect');
  audit.next();
  renderAudit();
});
el('audit-report').addEventListener('click', () => alert(audit.report()));
el('audit-reset').addEventListener('click', () => {
  audit.reset();
  renderAudit();
});

for (const id of ['show-glasses', 'occluder-debug', 'frame-size', 'show-anchors', 'show-shadows', 'show-hair']) {
  el(id).addEventListener('change', () => applySceneControls(id === 'frame-size'));
}
el('glasses-model').addEventListener('change', () => {
  void chooseModel(el<HTMLSelectElement>('glasses-model').value);
});

el('fatal-copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(el('fatal-message').textContent ?? '');
});
el('fatal-reload').addEventListener('click', () => location.reload());

// Yeni denek: ölçüm, ölçek ve fit geçmişi sıfırlanmalı.
el('subject').addEventListener('change', () => {
  engine?.resetMeasurements();
  displayFilters.pd.reset();
  lastState = null;
  renderFit(el('fit'), null);
});

void showCapability();
