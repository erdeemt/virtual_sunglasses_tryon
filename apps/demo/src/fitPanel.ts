import type { FitComponent, FitReport, Verdict } from '@vto/core';

/**
 * Fit skoru ve optik ölçüm raporu paneli.
 *
 * Tüm metinler koddaki sabitlerden geliyor (kullanıcı girdisi yok), o yüzden
 * innerHTML güvenli.
 */

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  good: { label: 'Uygun', cls: 'q-ok' },
  'too-narrow': { label: 'Dar', cls: 'q-bad' },
  'too-wide': { label: 'Geniş', cls: 'q-bad' },
};

export function renderFit(root: HTMLElement, fit: FitReport | null): void {
  if (!fit) {
    root.innerHTML = '<p class="note">Kameraya düz bak — çerçeve oturunca fit skoru hesaplanır.</p>';
    return;
  }

  const scoreCls = fit.score >= 75 ? 'q-ok' : fit.score >= 55 ? 'q-warn' : 'q-bad';
  const size =
    fit.sizeSuggestion === 1
      ? 'Bir beden <strong>büyük</strong> önerilir'
      : fit.sizeSuggestion === -1
        ? 'Bir beden <strong>küçük</strong> önerilir'
        : 'Beden uygun';
  const o = fit.optical;

  root.innerHTML = `
    <div class="fit-head">
      <div class="fit-score ${scoreCls}">${fit.score}</div>
      <div>
        <div class="fit-verdict ${VERDICT[fit.verdict].cls}">${VERDICT[fit.verdict].label}</div>
        <div class="note">${size}</div>
      </div>
    </div>
    <table class="fit-table">${fit.components.map(componentRow).join('')}</table>
    <h3>Optik ölçümler <small>(reçeteli lens siparişi)</small></h3>
    <table>
      <tr><td>Segment yüksekliği OD / OS</td><td>${fmt(o.segmentHeightOD)} / ${fmt(o.segmentHeightOS)} mm</td></tr>
      <tr><td>Vertex mesafesi <span class="badge">tahmini</span></td><td>${fmt(o.vertexDistance)} mm</td></tr>
      <tr><td>Pantoskopik açı</td><td>${fmt(o.pantoscopicTilt)}°</td></tr>
      <tr><td>Yüz formu (wrap)</td><td>${o.frameWrap === null ? '—' : `${fmt(o.frameWrap)}°`}</td></tr>
    </table>
    ${fit.notes.length ? `<ul class="fit-notes">${fit.notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <p class="note">
      İdeal aralıklar optik literatüründen başlangıç değerleri. Gerçek deneklerle kalibre
      edilmeden (T-00) müşteriye "doğru fit" iddiası yapılmamalı.
    </p>`;
}

function componentRow(c: FitComponent): string {
  const pct = Math.round(c.score * 100);
  const cls = c.score >= 0.8 ? 'ok' : c.score >= 0.5 ? 'warn' : 'bad';
  return `
    <tr>
      <td>
        ${c.label}${c.estimated ? ' <span class="badge">tahmini</span>' : ''}
        <div class="fit-bar"><i class="${cls}" style="width:${pct}%"></i></div>
      </td>
      <td>${fmt(c.value)} ${c.unit}<div class="note">ideal ${c.ideal[0]}…${c.ideal[1]}</div></td>
    </tr>`;
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}
