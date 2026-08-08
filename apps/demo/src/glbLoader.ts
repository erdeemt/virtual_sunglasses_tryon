import { loadFrameFromGLB, type LoadedFrame, type TryOnScene } from '@vto/render';

/**
 * Demo'nun GLB yükleme arayüzü.
 *
 * Amaç: internetten indirilen herhangi bir gözlük modelini repoya
 * commit'lemeden anında test edebilmek. Dosya tarayıcıda kalır, hiçbir yere
 * yüklenmez.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} yok`);
  return node as T;
};

export interface GlbLoaderHooks {
  getScene(): TryOnScene | null;
  onLoaded(): void;
}

export function setupGlbLoader(hooks: GlbLoaderHooks): void {
  const dropZone = el('drop-zone');
  const input = el<HTMLInputElement>('glb-input');
  const controls = el('glb-controls');
  const info = el('glb-info');

  let lastFile: File | null = null;
  let current: LoadedFrame | null = null;

  async function load(file: File): Promise<void> {
    const scene = hooks.getScene();
    if (!scene) {
      info.innerHTML = '<span class="q-bad">Önce kamerayı başlat.</span>';
      return;
    }

    lastFile = file;
    info.textContent = `${file.name} yükleniyor…`;

    const upValue = el<HTMLSelectElement>('glb-up').value;
    const frontWidth = Number(el<HTMLInputElement>('front-width').value) || 138;

    try {
      const frame = await loadFrameFromGLB(file, {
        frontWidthMM: frontWidth,
        upAxis: upValue === 'auto' ? undefined : (upValue as 'x' | 'y' | 'z'),
        flipForward: el<HTMLInputElement>('glb-flip').checked ? true : undefined,
        spec: scene.spec,
      });

      current = frame;
      scene.setFrame(frame);
      controls.hidden = false;
      hooks.onLoaded();

      const i = frame.info;
      const lines = [
        `dosya      ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
        `mesh       ${i.meshCount} · ${i.triangleCount.toLocaleString('tr')} üçgen`,
        `ham ölçü   ${fmtVec(i.rawSize)}`,
        `ölçek      ×${i.scaleFactor.toPrecision(3)} → ${frontWidth} mm genişlik`,
        `eksenler   yukarı=${i.detectedUp} · ileri=${i.detectedForward}`,
        `malzeme    ${i.materialNames.slice(0, 3).join(', ') || '(yok)'}`,
      ];
      info.textContent = lines.join('\n');

      for (const warning of i.warnings) {
        const node = document.createElement('span');
        node.className = 'q-warn';
        node.textContent = `⚠ ${warning}`;
        info.appendChild(node);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      info.innerHTML = `<span class="q-bad">Yüklenemedi: ${message}</span>`;
    }
  }

  dropZone.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void load(file);
  });

  for (const type of ['dragenter', 'dragover'] as const) {
    dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  }

  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) void load(file);
  });

  el('glb-reload').addEventListener('click', () => {
    if (lastFile) void load(lastFile);
  });

  el('glb-clear').addEventListener('click', () => {
    const scene = hooks.getScene();
    if (!scene) return;
    // Parametrik modele dönmek için mevcut spec ile yeniden kur.
    scene.setFrameSpec(scene.spec);
    current = null;
    controls.hidden = true;
    info.textContent = '';
    hooks.onLoaded();
  });

  // Yönelim değişince otomatik yeniden yükle — deneme yanılma hızlansın.
  for (const id of ['glb-up', 'glb-flip', 'front-width']) {
    el(id).addEventListener('change', () => {
      if (lastFile) void load(lastFile);
    });
  }

  void current;
}

function fmtVec(v: { x: number; y: number; z: number }): string {
  return `${v.x.toPrecision(3)} × ${v.y.toPrecision(3)} × ${v.z.toPrecision(3)}`;
}
