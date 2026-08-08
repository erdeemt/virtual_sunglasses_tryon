import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  EXPECTED_LANDMARK_COUNT,
  detectCapability,
  MetricEstimator,
  OneEuroFilter,
  PRIORS,
  toFaceUnits,
  type Capability,
  type EstimatorFrame,
} from '@vto/core';
import { specLabel, TryOnScene, type OccluderDebug } from '@vto/render';
import { drawOverlay, type OverlayFlags } from './overlay.js';
import { Study } from './study.js';
import { Audit } from './audit.js';
import { setupGlbLoader } from './glbLoader.js';

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
let scene: TryOnScene | null = null;

/**
 * Teşhis anahtarları.
 *
 * Çökme sebebini tahminle aramak yerine bisect etmek için: 3D sahne ve
 * MediaPipe GPU delegesi bağımsız olarak kapatılabiliyor. Hangi kombinasyonda
 * çökme duruyorsa suçlu odur.
 */
const params = new URLSearchParams(location.search);
const USE_3D = !params.has('no3d');
const FORCE_CPU = params.has('cpu');

const study = new Study();
const audit = new Audit();
let auditActive = false;
let capability: Capability;
let loopStopped = false;
let landmarker: FaceLandmarker | null = null;
let estimator = new MetricEstimator();
let lastState: EstimatorFrame['state'] = null;

/** Görüntülenen sayıları yumuşat — okunamayan titrek rakamlar güven kaybettirir. */
const displayFilters = {
  pd: new OneEuroFilter({ minCutoff: 0.6, beta: 0.01 }),
  fps: new OneEuroFilter({ minCutoff: 1.5, beta: 0.01 }),
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
 * Çökmeyi teşhis edilebilir kıl.
 *
 * Eski hali: loop() içindeki bir istisna her karede tekrar atılıyordu
 * (requestAnimationFrame en başta çağrıldığı için döngü durmuyordu) —
 * saniyede 60 hata, konsol dolup sekme kilitleniyor. Kullanıcıya bu
 * "çökme" olarak görünüyor. Artık ilk hatada duruyor ve gösteriliyor.
 */
function showFatal(context: string, error: unknown): void {
  if (fatalShown) return;
  fatalShown = true;
  loopStopped = true;

  const err = error instanceof Error ? error : new Error(String(error));
  const lines = [
    `bağlam:  ${context}`,
    `hata:    ${err.name}: ${err.message}`,
    '',
    `3D:      ${USE_3D ? 'açık' : 'kapalı (?no3d=1)'}`,
    `delege:  ${FORCE_CPU ? 'CPU (?cpu=1)' : capability?.tier === 'low' ? 'CPU (düşük kademe)' : 'GPU'}`,
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

// ---------------------------------------------------------------- kamera

let activeStream: MediaStream | null = null;

/**
 * Kamerayı kademeli olarak açar.
 *
 * Sabit bir çözünürlük istemek çoğu cihazda çalışır ama bazılarında —
 * özellikle sanal kameralar, bazı dizüstü sürücüleri ve kamera başka bir
 * uygulama tarafından tutulduğunda — NotReadableError üretir. Kısıtları
 * gevşeterek yeniden denemek bu vakaların çoğunu kurtarıyor.
 */
async function openCamera(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false },
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      // İzin reddi kısıt gevşetmekle çözülmez — hemen çık.
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw error;
    }
  }
  throw lastError;
}

/** Akışı serbest bırak — bırakılmazsa sonraki sekme/yenileme kamerayı açamaz. */
function releaseCamera(): void {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
}

// Sayfa kapanırken/yenilenirken kamerayı bırak. Bu yapılmazsa her yenileme
// bir akış sızdırıyor ve Windows'ta ikinci açılış "Could not start video
// source" ile düşüyor.
window.addEventListener('pagehide', releaseCamera);
window.addEventListener('beforeunload', releaseCamera);

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const detail = error instanceof Error ? error.message : String(error);

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Kamera izni reddedildi. Adres çubuğundaki kamera simgesinden izin verip tekrar dene.';
    case 'NotReadableError':
    case 'TrackStartError':
      return (
        'Kamera başka bir uygulama tarafından kullanılıyor. Kontrol et: ' +
        'bu sitenin diğer sekmeleri, Zoom / Teams / OBS / Windows Kamera uygulaması. ' +
        'Hepsini kapatıp tekrar dene.'
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Kamera bulunamadı. Cihazın bağlı ve Windows gizlilik ayarlarında etkin olduğundan emin ol.';
    case 'OverconstrainedError':
      return 'Kamera istenen çözünürlüğü desteklemiyor. (Gevşetilmiş ayarlar da başarısız oldu.)';
    default:
      return `Başlatılamadı: ${detail}`;
  }
}

// ---------------------------------------------------------------- başlatma

async function start(): Promise<void> {
  const button = el<HTMLButtonElement>('start');
  button.disabled = true;
  button.textContent = 'Yükleniyor…';

  // Tekrar denemede eski akış hâlâ açıksa kamera meşgul kalır.
  releaseCamera();

  try {
    const stream = await openCamera();
    activeStream = stream;
    video.srcObject = stream;
    await video.play();
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0) return resolve();
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });

    // WASM ve model yerel olarak servis ediliyor (npm run setup) — çalışma
    // anında CDN bağımlılığı yok. Bkz. scripts/setup-assets.mjs.
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: '/models/face_landmarker.task',
        // GPU delegesi kendi WebGL bağlamını açıyor. three.js'in bağlamıyla
        // aynı karede çalışması bazı sürücülerde (özellikle Windows/ANGLE)
        // sorun çıkarabiliyor — ?cpu=1 bunu izole etmek için.
        delegate: FORCE_CPU || capability.tier === 'low' ? 'CPU' : 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (USE_3D) {
      // WebGL bağlamı kaybı sessizce siyah ekrana yol açar — yakala ve söyle.
      threeCanvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        showFatal('WebGL bağlamı kaybedildi', new Error('webglcontextlost'));
      });

      scene = new TryOnScene(threeCanvas, {
        // Tesselation modelin kendi sabitinden geliyor — 852 üçgenlik indeks
        // dizisini repoya gömmeye gerek yok.
        tesselation: FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        maxPixelRatio: capability.budget.maxPixelRatio,
      });
      scene.resize(video.videoWidth, video.videoHeight);
      applySceneControls();
    } else {
      threeCanvas.hidden = true;
    }

    video.classList.add('live');
    el('gate').hidden = true;
    panel.hidden = false;
    renderPriorTable();
    renderAudit();
    requestAnimationFrame(loop);
  } catch (error) {
    releaseCamera();
    button.disabled = false;
    button.textContent = 'Tekrar Dene';
    fail(cameraErrorMessage(error));
  }
}

// ---------------------------------------------------------------- döngü

let lastVideoTime = -1;
let frameCount = 0;
let fpsWindowStart = performance.now();
let displayFps = 0;
let inferenceMs = 0;

function loop(): void {
  if (loopStopped) return;
  requestAnimationFrame(loop);
  try {
    tick();
  } catch (error) {
    // Tek bir hatayı 60 Hz tekrarlamak yerine dur ve göster.
    showFatal('render döngüsü', error);
  }
}

function tick(): void {
  if (!landmarker || video.readyState < 2) return;

  const now = performance.now();
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const t0 = performance.now();
  const result = landmarker.detectForVideo(video, now);
  inferenceMs = performance.now() - t0;

  frameCount++;
  if (now - fpsWindowStart >= 500) {
    const raw = (frameCount * 1000) / (now - fpsWindowStart);
    displayFps = displayFilters.fps.filter(raw, now);
    frameCount = 0;
    fpsWindowStart = now;
    el('fps').textContent = `${displayFps.toFixed(0)} FPS · ${inferenceMs.toFixed(1)} ms`;
  }

  const raw = result.faceLandmarks[0];
  if (!raw || raw.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    scene?.hide();
    scene?.render();
    setGateStatus('bad', 'Yüz bulunamadı');
    return;
  }
  // İris yoksa ölçek füzyonu çalışamaz — ama bu döngüyü öldürmemeli.
  // (Eskiden burada throw vardı; her karede atılıp sekmeyi kilitliyordu.)
  if (raw.length < EXPECTED_LANDMARK_COUNT) {
    setGateStatus('bad', `İris landmarkları yok (${raw.length}/${EXPECTED_LANDMARK_COUNT}) — model paketi hatalı`);
    return;
  }

  const aspect = canvas.width / canvas.height;
  const units = toFaceUnits(raw, aspect);
  const frame = estimator.update(units);

  if (scene && frame) {
    const k = smoothScale(frame.scale.scale, now);
    // NaN/sonsuz ölçek geometriyi bozar ve three.js her karede uyarı basar.
    if (Number.isFinite(k) && k > 0) {
      scene.update(units, k, aspect);
      scene.render();
    } else {
      scene.hide();
      scene.render();
    }
  }

  drawOverlay(ctx, units, frame?.geometry ?? null, aspect, readFlags());
  if (frame) updatePanel(frame, now);
}

/**
 * Sahne ölçeğini ayrıca yumuşat.
 *
 * Ölçek kare kare oynarsa gözlük nefes alıyormuş gibi büyüyüp küçülür — bu,
 * poz titremesinden çok daha rahatsız edici. Ölçek fiziksel olarak sabit bir
 * büyüklük (kişinin yüzü değişmiyor), o yüzden agresif filtrelenebilir.
 */
const scaleFilter = new OneEuroFilter({ minCutoff: 0.25, beta: 0.002 });
function smoothScale(value: number, now: number): number {
  return scaleFilter.filter(value, now);
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

  updateSceneInfo();

  el('fusion-note').innerHTML =
    frame.scale.method === 'gls'
      ? 'GLS füzyonu — ipuçları arası korelasyon hesaba katıldı. İki iris ölçümü ' +
        'aynı büyüklüğün iki gözlemi olduğu için güven yapay olarak şişmiyor.'
      : '<span class="q-warn">Fallback: ters-varyans + tasarım etkisi cezası.</span> ' +
        'GLS güvenlik kapısına takıldı — kovaryans matrisi kötü koşullanmış olabilir.';
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
  // Prior'ların ne olduğu görünür olsun — bunlar Gün 5'te kalibre edilecek
  // TAHMİNLER, ve hangi sayının nereden geldiği unutulmamalı.
  const note = el('fusion-note');
  note.title = Object.values(PRIORS)
    .map((p) => `${p.label}: ${p.muMM} ± ${p.sigmaMM} mm — ${p.source}`)
    .join('\n');
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

// ---------------------------------------------------------------- sahne kontrolleri

/** GLB yüklüyken ölçü seçici parametrik modeli geri getirmemeli. */
let usingLoadedFrame = false;

function applySceneControls(rebuildParametric = true): void {
  if (!scene) return;

  if (rebuildParametric && !usingLoadedFrame) {
    const [w, b, t] = el<HTMLSelectElement>('frame-size').value.split(',').map(Number);
    scene.setFrameSpec({ ...scene.spec, lensWidth: w!, bridgeWidth: b!, templeLength: t! });
  }

  scene.setGlassesVisible(el<HTMLInputElement>('show-glasses').checked);
  scene.setOccluderDebug(el<HTMLSelectElement>('occluder-debug').value as OccluderDebug);
  scene.setAnchorsVisible(el<HTMLInputElement>('show-anchors').checked);
}

function updateSceneInfo(): void {
  if (!scene) return;
  const p = scene.lastPlacement;
  el('scene-info').innerHTML = rows([
    ['Çerçeve', specLabel(scene.spec)],
    ['Kamera mesafesi', `${fmt(p.distanceMM / 10, 1)} cm`],
    ['Toplam genişlik', `${scene.spec.lensWidth * 2 + scene.spec.bridgeWidth} mm`],
  ]);
}

// ---------------------------------------------------------------- denetim

function renderAudit(): void {
  const { current, total } = audit.position;
  const step = audit.step;
  const verdict = audit.verdictFor(step.group);

  el('audit-progress').textContent = auditActive
    ? `${current}/${total} · ${verdict === 'ok' ? '✓' : verdict === 'suspect' ? '✗' : '—'}`
    : summaryLabel();

  el('audit-title').textContent = `${current}. ${step.title}`;
  el('audit-check').textContent = step.check;
  el('audit-impact').textContent = step.impact;

  const s = audit.summary();
  const node = el('audit-summary');
  node.innerHTML = s.pending === total
    ? 'Henüz denetim yapılmadı. Ölçüm sayıları bu adım tamamlanmadan güvenilir sayılmamalı.'
    : s.complete
      ? '<span class="q-ok">Tüm gruplar doğrulandı.</span> landmarkIndices.ts içindeki <code>verified</code> alanları true yapılabilir.'
      : `<span class="${s.suspect > 0 ? 'q-bad' : 'q-warn'}">${s.ok} doğru · ${s.suspect} şüpheli · ${s.pending} bekliyor</span>`;
}

function summaryLabel(): string {
  const s = audit.summary();
  return `${s.ok}/${AUDIT_TOTAL} doğrulandı`;
}

const AUDIT_TOTAL = audit.position.total;

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
for (const id of ['show-glasses', 'occluder-debug', 'frame-size', 'show-anchors']) {
  el(id).addEventListener('change', () => applySceneControls());
}

setupGlbLoader({
  getScene: () => scene,
  onLoaded: () => {
    usingLoadedFrame = !el('glb-controls').hidden;
    applySceneControls(false);
  },
});

el('fatal-copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(el('fatal-message').textContent ?? '');
});
el('fatal-reload').addEventListener('click', () => location.reload());

el('audit-report').addEventListener('click', () => alert(audit.report()));
el('audit-reset').addEventListener('click', () => {
  audit.reset();
  renderAudit();
});

// Ölçek kilitli kaldığında yeni denek için sıfırlama gerekir.
el('subject').addEventListener('change', () => {
  estimator = new MetricEstimator();
  displayFilters.pd.reset();
  lastState = null;
});

void showCapability();
