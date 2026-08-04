import {
  IRIS_A_RING,
  IRIS_B_RING,
  MIDLINE,
  NAMED_LANDMARKS,
  type FaceUnits,
  type FrameGeometry,
  type Vec3,
} from '@vto/core';

export type LandmarkGroup = 'iris' | 'eye' | 'oval' | 'midline' | 'nose';

export interface OverlayFlags {
  showAll: boolean;
  showNamed: boolean;
  showPlane: boolean;
  /**
   * Denetim modu: yalnızca bu grup çizilir, büyütülmüş ve etiketleri
   * çakışmadan. Hepsini aynı anda göstermek doğrulamayı imkânsız kılıyordu.
   */
  focusGroup: LandmarkGroup | null;
}

const COLORS = {
  iris: '#4a9eff',
  eye: '#35c98a',
  oval: '#e0b341',
  midline: '#c86ae0',
  nose: '#e05c5c',
  dust: 'rgba(120, 180, 255, 0.35)',
} as const;

/**
 * FaceUnits → canvas pikseli.
 *
 * FaceUnits'te x, aspect ile çarpılmıştı (bkz. toFaceUnits); ekrana dönerken
 * o çarpanı geri almak gerekiyor, aksi halde çizim yatayda kayar.
 */
function project(v: Vec3, w: number, h: number, aspect: number): [number, number] {
  return [(v.x / aspect) * w, v.y * h];
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  lm: FaceUnits,
  geo: FrameGeometry | null,
  aspect: number,
  flags: OverlayFlags,
): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const px = (v: Vec3) => project(v, w, h, aspect);

  // Denetim modu her şeyi bastırır — tek grup, temiz görüntü.
  if (flags.focusGroup) {
    ctx.fillStyle = 'rgba(11, 13, 16, 0.45)';
    ctx.fillRect(0, 0, w, h);
    if (flags.focusGroup === 'iris' && geo) drawIris(ctx, lm, geo, px, true);
    if (flags.focusGroup === 'midline') drawMidline(ctx, lm, px);
    drawNamed(ctx, lm, px, flags.focusGroup);
    return;
  }

  if (flags.showAll) {
    ctx.fillStyle = COLORS.dust;
    for (const p of lm) {
      const [x, y] = px(p);
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
  }

  if (flags.showPlane && geo) {
    drawMidline(ctx, lm, px);
    drawBasis(ctx, geo, px, w, h, aspect);
  }

  if (geo) {
    drawIris(ctx, lm, geo, px);
  }

  if (flags.showNamed) {
    drawNamed(ctx, lm, px, null);
  }
}

function drawMidline(
  ctx: CanvasRenderingContext2D,
  lm: FaceUnits,
  px: (v: Vec3) => [number, number],
): void {
  ctx.strokeStyle = COLORS.midline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (const i of MIDLINE) {
    const p = lm[i];
    if (!p) continue;
    const [x, y] = px(p);
    if (started) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      started = true;
    }
  }
  ctx.stroke();
}

function drawBasis(
  ctx: CanvasRenderingContext2D,
  geo: FrameGeometry,
  px: (v: Vec3) => [number, number],
  w: number,
  h: number,
  aspect: number,
): void {
  const L = 0.12; // FaceUnits cinsinden eksen uzunluğu
  const o = geo.basis.origin;
  const axes: Array<[Vec3, string, string]> = [
    [geo.basis.x, '#ff6b6b', 'x'],
    [geo.basis.y, '#6bff9e', 'y'],
    [geo.basis.z, '#6bb6ff', 'z'],
  ];
  ctx.lineWidth = 2;
  for (const [axis, color, label] of axes) {
    const tip: Vec3 = { x: o.x + axis.x * L, y: o.y + axis.y * L, z: o.z + axis.z * L };
    const [x0, y0] = px(o);
    const [x1, y1] = px(tip);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    label_(ctx, label, x1, y1, color);
  }
  void w;
  void h;
  void aspect;
}

function drawIris(
  ctx: CanvasRenderingContext2D,
  lm: FaceUnits,
  geo: FrameGeometry,
  px: (v: Vec3) => [number, number],
  large = false,
): void {
  const rings: Array<[readonly number[], Vec3, number]> = [
    [IRIS_A_RING, geo.irisOD, geo.irisDiameterOD],
    [IRIS_B_RING, geo.irisOS, geo.irisDiameterOS],
  ];
  ctx.strokeStyle = COLORS.iris;
  ctx.lineWidth = 1.5;
  for (const [ring] of rings) {
    ctx.beginPath();
    ring.forEach((i, n) => {
      const p = lm[i];
      if (!p) return;
      const [x, y] = px(p);
      if (n === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // OD/OS etiketi — taraf ataması görüntü x'inden türetiliyor, doğruluğu
  // burada gözle teyit edilir (kullanıcı sağ elini kaldırıp kontrol edebilir).
  const [odx, ody] = px(geo.irisOD);
  const [osx, osy] = px(geo.irisOS);
  label_(ctx, 'OD (sağ göz)', odx, ody - 26, COLORS.iris, large);
  label_(ctx, 'OS (sol göz)', osx, osy - 26, COLORS.iris, large);
}

function drawNamed(
  ctx: CanvasRenderingContext2D,
  lm: FaceUnits,
  px: (v: Vec3) => [number, number],
  focus: LandmarkGroup | null,
): void {
  const focused = focus !== null;
  const radius = focused ? 6 : 3;

  for (const named of NAMED_LANDMARKS) {
    if (focus && named.group !== focus) continue;
    const p = lm[named.index];
    if (!p) continue;
    const [x, y] = px(p);
    const color = COLORS[named.group];

    if (focused) {
      // Halka: göze çarpsın, ama altındaki anatomiyi kapatmasın.
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Halka noktalarını etiketleme — okunmaz hale geliyor.
    if (!named.label.includes('halka')) {
      label_(ctx, `${named.index} ${named.label}`, x + radius + 8, y, color, focused);
    }
  }
}

/**
 * Metin çizimi.
 *
 * Sahne CSS'te scaleX(-1) ile aynalandığı için metin de ters görünürdü;
 * yerel olarak bir kez daha çevirerek düz okunmasını sağlıyoruz.
 */
function label_(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  large = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = `${large ? '600 17px' : '500 12px'} ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
