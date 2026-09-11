import '@vto/embed';
import type { FitReport } from '@vto/core';

/**
 * Demo mağaza: widget'ın gerçek bir ürün sayfasında nasıl duracağını ve
 * markanın hangi olayları dinleyebileceğini gösteren pitch sayfası.
 *
 * Bu dosya motoru import ETMİYOR — sadece widget'ı. Motor, kullanıcı "Sanal
 * Dene"ye basınca widget tarafından dinamik olarak yükleniyor. Ağ sekmesinde
 * kontrol edilebilir: sayfa açılışında three.js ve MediaPipe inmez.
 */

const log = document.getElementById('event-log')!;
let first = true;

function write(type: string, source: string, payload: unknown): void {
  if (first) {
    log.textContent = '';
    first = false;
  }
  const time = new Date().toLocaleTimeString('tr-TR');
  const line = `${time}  ${type.padEnd(12)} ${source}\n${payload ? `${JSON.stringify(payload, null, 2)}\n` : ''}\n`;
  log.textContent = line + log.textContent;
}

function label(target: EventTarget | null): string {
  return (target as HTMLElement | null)?.getAttribute?.('label') ?? '';
}

document.addEventListener('vto:ready', (e) => write('vto:ready', label(e.target), null));
document.addEventListener('vto:close', (e) => write('vto:close', label(e.target), null));
document.addEventListener('vto:error', (e) => write('vto:error', label(e.target), (e as CustomEvent).detail));
document.addEventListener('vto:capture', (e) =>
  write('vto:capture', label(e.target), { bytes: ((e as CustomEvent).detail as { blob: Blob }).blob.size }),
);
document.addEventListener('vto:fit', (e) => {
  const fit = (e as CustomEvent<FitReport>).detail;
  // Marka tarafında tipik kullanım: beden önerisini sepete, optik ölçümleri
  // reçete formuna aktarmak. Kamera verisi yok — sadece türetilmiş sayılar.
  write('vto:fit', label(e.target), {
    score: fit.score,
    verdict: fit.verdict,
    sizeSuggestion: fit.sizeSuggestion,
    optical: {
      segmentHeightOD: round(fit.optical.segmentHeightOD),
      segmentHeightOS: round(fit.optical.segmentHeightOS),
      pantoscopicTilt: round(fit.optical.pantoscopicTilt),
    },
  });
});

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
