import type { TryOnEngine } from '@vto/engine';
import type { ScaleMode } from '@vto/render';

/**
 * Demo'nun GLB yükleme arayüzü.
 *
 * İnternetten indirilen herhangi bir gözlük modelini repoya commit'lemeden
 * anında test etmek için. Dosya tarayıcıda kalır, hiçbir yere yüklenmez.
 * Yükleme motor üzerinden yapılıyor ki fit geçmişi de sıfırlansın.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} yok`);
  return node as T;
};

export interface GlbLoaderHooks {
  getEngine(): TryOnEngine | null;
  onLoaded(source: 'file' | 'url'): void;
}

export interface GlbLoader {
  load(source: File | string, label: string): Promise<void>;
  clearInfo(): void;
}

const ANCHOR_COUNT = 9;

export function setupGlbLoader(hooks: GlbLoaderHooks): GlbLoader {
  const dropZone = el('drop-zone');
  const input = el<HTMLInputElement>('glb-input');
  const controls = el('glb-controls');
  const info = el('glb-info');

  let last: { source: File | string; label: string } | null = null;

  async function load(source: File | string, label: string): Promise<void> {
    const engine = hooks.getEngine();
    if (!engine?.scene) {
      info.innerHTML = '<span class="q-bad">Önce kamerayı başlat.</span>';
      return;
    }

    last = { source, label };
    info.textContent = `${label} yükleniyor…`;

    const upValue = el<HTMLSelectElement>('glb-up').value;
    try {
      const frame = await engine.loadGlasses(source, {
        frontWidthMM: Number(el<HTMLInputElement>('front-width').value) || 138,
        scaleMode: el<HTMLSelectElement>('glb-scale').value as ScaleMode,
        upAxis: upValue === 'auto' ? undefined : (upValue as 'x' | 'y' | 'z'),
        flipForward: el<HTMLInputElement>('glb-flip').checked ? true : undefined,
      });

      controls.hidden = false;
      hooks.onLoaded(typeof source === 'string' ? 'url' : 'file');

      const i = frame.info;
      const s = frame.spec;
      const size = typeof source === 'string' ? '' : ` (${(source.size / 1024 / 1024).toFixed(1)} MB)`;
      const lines = [
        `dosya      ${label}${size}`,
        `mesh       ${i.meshCount} · ${i.triangleCount.toLocaleString('tr')} üçgen`,
        `ölçek      ${i.scaleMode === 'meters' ? 'glTF metre (×1000)' : `genişliğe oturtuldu (×${i.scaleFactor.toPrecision(3)})`}`,
        `ön genişlik ${i.frontWidthMM.toFixed(1)} mm`,
        `lens       ${s.lensWidth} × ${s.lensHeight} mm · köprü ${s.bridgeWidth} mm`,
        `eksenler   yukarı=${i.detectedUp} · ileri=${i.detectedForward}`,
        `anchor     ${i.namedAnchors.length}/${ANCHOR_COUNT} isimli parçadan, gerisi heuristik`,
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
      info.innerHTML = '';
      const node = document.createElement('span');
      node.className = 'q-bad';
      node.textContent = `Yüklenemedi: ${message}`;
      info.appendChild(node);
    }
  }

  dropZone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void load(file, file.name);
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
    if (file) void load(file, file.name);
  });

  el('glb-reload').addEventListener('click', () => {
    if (last) void load(last.source, last.label);
  });

  // Ayar değişince otomatik yeniden yükle — deneme yanılma hızlansın.
  for (const id of ['glb-up', 'glb-flip', 'front-width', 'glb-scale']) {
    el(id).addEventListener('change', () => {
      if (last) void load(last.source, last.label);
    });
  }

  return {
    load,
    clearInfo() {
      last = null;
      controls.hidden = true;
      info.textContent = '';
    },
  };
}
