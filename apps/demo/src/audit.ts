import type { LandmarkGroup } from './overlay.js';

/**
 * Gün 3 kapısı — landmark indeks denetimi.
 *
 * Neden ayrı bir mod: adlandırılmış 22 noktayı aynı anda çizince etiketler
 * üst üste biniyor ve hiçbir şey doğrulanamıyor. Grup grup, büyütülmüş,
 * tek tek onaylanır.
 *
 * Sonuçlar localStorage'da tutulur ve `landmarkIndices.ts` içindeki
 * `verified` alanlarını güncellemek için dışa aktarılır. O alanlar
 * true olmadan ölçüm sayıları güvenilir sayılmaz.
 */
export interface AuditStep {
  group: LandmarkGroup;
  title: string;
  /** Ekranda ne görülmeli — kontrol kriteri. */
  check: string;
  /** Yanlışsa hangi prior/hesap bozulur. */
  impact: string;
}

export const AUDIT_STEPS: AuditStep[] = [
  {
    group: 'iris',
    title: 'İris halkaları + OD/OS',
    check:
      'Mavi halkalar irisin dış sınırına (renkli kısmın kenarı) oturmalı — göz kapağına ya da göz akına taşmamalı. ' +
      'Görüntü aynalı: "OD (sağ göz)" etiketi SENİN sağ gözünde olmalı. Emin olmak için sağ elini kaldır, ' +
      'ekranda da sağda görünmeli.',
    impact:
      'İris çapı ölçek füzyonunun en ağırlıklı ipucu (%57). Halka büyükse tüm mm ölçüleri küçülür. ' +
      'OD/OS ters ise monoküler PD raporu yanlış göze yazılır — reçeteli lens siparişinde ciddi hata.',
  },
  {
    group: 'eye',
    title: 'Göz köşeleri (kantus)',
    check:
      '133 ve 362 "iç kantus" → gözün BURUN tarafındaki köşesinde. ' +
      '33 ve 263 "dış kantus" → ŞAKAK tarafındaki köşesinde. Karışmışsa hemen belli olur.',
    impact: 'İç kantal mesafe ölçek ipuçlarından biri. Yanlışsa füzyona gürültü girer.',
  },
  {
    group: 'oval',
    title: 'Yüz yanal noktaları',
    check:
      '234 ve 454 yüzün en dış hattında, kabaca elmacık kemiği / kulak önü hizasında olmalı. ' +
      'Belirgin şekilde içeride (yanakta) kalıyorsa not et.',
    impact:
      'Yüz genişliği prior\'ı (134 ± 7 mm) gerçek zygion için tanımlı. Nokta içerideyse prior sistematik ' +
      'olarak yanlış kalibre demektir — Gün 5 ölçümünde bias olarak görünür.',
  },
  {
    group: 'nose',
    title: 'Burun kökü ve ucu',
    check:
      '168 "burun kökü" iki göz arasındaki çukurda (sellion). 1 "burun ucu" burnun en öndeki noktasında.',
    impact:
      'Şu an sadece orta hat/görselleştirme için. Gün 10\'da yerleştirme çözücüsünün burun teması ' +
      'ray-cast başlangıcı buradan çıkacak — o zaman kritik olacak.',
  },
  {
    group: 'midline',
    title: 'Orta hat uçları',
    check:
      '10 "alın" ve 152 "çene" orta hatta olmalı. Mor çizgi alın→burun→çene boyunca yüzü ortadan ' +
      'düzgün bölmeli, yana kaymamalı.',
    impact:
      'Simetri düzlemi bu zincire uydurulur. Kayıksa monoküler PD (OD/OS ayrımı) yanlış bölünür.',
  },
];

export type Verdict = 'ok' | 'suspect' | null;

const STORAGE_KEY = 'vto.audit.v1';

export class Audit {
  private verdicts: Partial<Record<LandmarkGroup, Verdict>> = {};
  private index = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.verdicts = JSON.parse(raw) as Partial<Record<LandmarkGroup, Verdict>>;
    } catch {
      this.verdicts = {};
    }
  }

  get step(): AuditStep {
    return AUDIT_STEPS[this.index]!;
  }

  get position(): { current: number; total: number } {
    return { current: this.index + 1, total: AUDIT_STEPS.length };
  }

  verdictFor(group: LandmarkGroup): Verdict {
    return this.verdicts[group] ?? null;
  }

  set(verdict: Verdict): void {
    this.verdicts[this.step.group] = verdict;
    this.persist();
  }

  next(): void {
    this.index = (this.index + 1) % AUDIT_STEPS.length;
  }

  prev(): void {
    this.index = (this.index - 1 + AUDIT_STEPS.length) % AUDIT_STEPS.length;
  }

  jumpToFirstUnjudged(): void {
    const i = AUDIT_STEPS.findIndex((s) => !this.verdicts[s.group]);
    if (i >= 0) this.index = i;
  }

  summary(): { ok: number; suspect: number; pending: number; complete: boolean } {
    let ok = 0;
    let suspect = 0;
    for (const step of AUDIT_STEPS) {
      const v = this.verdicts[step.group];
      if (v === 'ok') ok++;
      else if (v === 'suspect') suspect++;
    }
    const pending = AUDIT_STEPS.length - ok - suspect;
    return { ok, suspect, pending, complete: pending === 0 && suspect === 0 };
  }

  reset(): void {
    this.verdicts = {};
    this.index = 0;
    this.persist();
  }

  /** landmarkIndices.ts güncellemesi için okunabilir rapor. */
  report(): string {
    const lines = AUDIT_STEPS.map((s) => {
      const v = this.verdicts[s.group];
      const mark = v === 'ok' ? 'DOĞRU' : v === 'suspect' ? 'ŞÜPHELİ' : 'denetlenmedi';
      return `${s.group.padEnd(8)} ${mark}`;
    });
    const s = this.summary();
    lines.push('', `${s.ok} doğru · ${s.suspect} şüpheli · ${s.pending} bekliyor`);
    return lines.join('\n');
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.verdicts));
    } catch {
      // Gizli sekmede localStorage yazılamaz — denetim yine çalışır, kalıcı olmaz.
    }
  }
}
