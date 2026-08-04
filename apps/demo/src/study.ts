import type { Capability, MetricState } from '@vto/core';

/**
 * Gün 5 kapısı için veri toplama.
 *
 * Amaç: "±2 mm doğruluk" iddiasını kanıtlamak ya da çürütmek. B2B satışta
 * kanıtlanamayan doğruluk iddiası hiç yapılmamalıdır — bu yüzden ölçüm
 * altyapısı, ölçümü yapan koddan önce hazır.
 *
 * ⚠ Kayıtlar kişisel ölçü içerir. Sadece cihazda tutulur, dışa aktarma
 * kullanıcının açık eylemiyle olur, repoya girmez (.gitignore).
 */
export interface StudyRecord {
  subject: string;
  timestamp: string;
  truthPD: number | null;
  measuredPD: number;
  measuredPDOD: number;
  measuredPDOS: number;
  innerCanthal: number;
  bizygomatic: number;
  irisDiameter: number;
  systematicCV: number;
  stabilityCV: number;
  sampleCount: number;
  errorMM: number | null;
  errorPct: number | null;
  device: string;
  tier: string;
}

export class Study {
  private readonly records: StudyRecord[] = [];

  add(subject: string, truthPD: number | null, state: MetricState, cap: Capability): StudyRecord {
    const m = state.measurements;
    const errorMM = truthPD !== null ? m.pd - truthPD : null;
    const record: StudyRecord = {
      subject: subject || 'anonim',
      timestamp: new Date().toISOString(),
      truthPD,
      measuredPD: round(m.pd),
      measuredPDOD: round(m.pdOD),
      measuredPDOS: round(m.pdOS),
      innerCanthal: round(m.innerCanthal),
      bizygomatic: round(m.bizygomatic),
      irisDiameter: round(m.irisDiameter),
      systematicCV: round(state.systematicCV * 100, 2),
      stabilityCV: round(state.stabilityCV * 100, 2),
      sampleCount: state.sampleCount,
      errorMM: errorMM === null ? null : round(errorMM),
      errorPct: errorMM === null || !truthPD ? null : round((errorMM / truthPD) * 100, 2),
      device: `${cap.isIOS ? 'iOS' : cap.isAndroid ? 'Android' : 'desktop'} · ${cap.gpuRenderer || 'bilinmiyor'}`,
      tier: cap.tier,
    };
    this.records.push(record);
    return record;
  }

  all(): readonly StudyRecord[] {
    return this.records;
  }

  /** Gerçek PD girilmiş kayıtlar üzerinden özet — Gün 5 kapısının kararı budur. */
  summary(): { n: number; mae: number; bias: number; maxAbs: number } | null {
    const withTruth = this.records.filter((r) => r.errorMM !== null);
    if (withTruth.length === 0) return null;
    const errors = withTruth.map((r) => r.errorMM!);
    const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
    const bias = errors.reduce((a, e) => a + e, 0) / errors.length;
    const maxAbs = Math.max(...errors.map(Math.abs));
    return { n: errors.length, mae: round(mae), bias: round(bias), maxAbs: round(maxAbs) };
  }

  export(): void {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: 'VTO ölçek doğrulama çalışması — kişisel ölçü içerir, paylaşmadan önce anonimleştir.',
      summary: this.summary(),
      records: this.records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vto-scale-study-${Date.now()}.session.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Number.isFinite(v) ? Math.round(v * f) / f : NaN;
}
