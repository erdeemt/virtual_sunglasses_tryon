# Gözlük Virtual Try-On — B2B SaaS Teknik Roadmap

> **Konum:** Web-first, platform-aware embed widget. Marka sitesinde "Sanal Dene" → tarayıcıda çalışır (iOS Safari, Android Chrome, masaüstü). App kurulumu yok.
> **Model:** B2B SaaS — markalara embed edilebilir widget + asset onboarding + ölçüm API'si satıyoruz.
> **Kaynak:** 1 geliştirici, 28 gün (çekirdek ürün). Ticarileştirme katmanı → Faz 2 (90 gün).

---

## Durum — 11 Eylül 2026

Planın **teknik çekirdeği** tamamlandı. Açık kalanlar: doğruluk kanıtı,
parametre kalibrasyonu, ekranda görsel doğrulama ve ticarileştirme katmanı.

| Blok | Durum |
|---|---|
| Perception + metrik ölçek (Gün 1–7) | ✅ — kart kalibrasyonu (Gün 6) ve worker (Gün 2) hariç |
| Çözücü + occlusion + gölge + saç + fit (Gün 8–14) | ✅ kod ve testler · ⚠ görsel doğrulama ve kalibrasyon bekliyor |
| Render kalitesi (Gün 15–18) | 🟡 PBR, ortam haritası, lens transmission, ışık tahmini ✅ · reçete simülasyonu ❌ |
| Asset (Gün 19–20) | 🟡 GLB yükleyici + isimli parça sözleşmesi ✅ · Blender CLI ❌ |
| Embed + backend (Gün 22–23) | 🟡 `<glasses-tryon>` ✅ (gzip 4.2 kB, motor lazy) · backend ❌ |
| Doğruluk çalışması (Gün 25) | ❌ **T-00 hâlâ bloke ediyor** |

Ayrıntı ve sıradaki işler: [docs/TASKS.md](docs/TASKS.md).

---

## 0. Yönetici Özeti — Kapsam Dürüstlüğü

28 günde **çıkan**:

- Tarayıcıda 30–60 FPS gerçek zamanlı 3D gözlük deneme, iOS/Android/masaüstü
- Metrik ölçek çözümü (**±2–3 mm** yüz ölçüsü doğruluğu, kalibrasyonla ±1 mm)
- Temas-kısıtlı yerleştirme çözücüsü + sayısal **uyum (fit) skoru** ve beden önerisi
- Occlusion (saç dahil), temas gölgesi, PBR + reçeteli lens simülasyonu
- Tek satırlık embed: `<script>` + `<glasses-tryon sku="...">`
- 5–8 SKU'luk demo kataloğu ve otomatik asset pipeline CLI'ı
- Optik ölçüm raporu (PD, segment height, vertex distance, pantoskopik açı)
- Doğruluk doğrulama çalışması (n≥15 gerçek kişi, optometrist ölçümü ile karşılaştırma)

28 günde **çıkmayan** (Faz 2 backlog, §18):

- Self-servis tenant onboarding, faturalandırma, kullanım limitleri
- Multi-tenant admin paneli, marka bazlı tema editörü
- 100+ SKU ölçekli asset üretim operasyonu
- SOC 2 / ISO 27001, kurumsal SLA, DPA şablonları
- Shopify/Magento/WooCommerce yayınlanmış eklentileri (sadece manuel entegrasyon dokümanı çıkar)

**İlk müşteri için yeterli mi?** Evet. B2B optik satışında pilot kararı; doğruluk iddiası + görsel kalite + 1 saatlik entegrasyon ile verilir. Faturalandırma altyapısı ilk 2–3 müşteriye elle fatura kesilerek atlanabilir.

---

## 1. Rekabet Konumu — Nereden Kazanacağız

| Oyuncu | Yaklaşım | Açık nerede |
|---|---|---|
| **Warby Parker (iOS app)** | ARKit TrueDepth, metrik mesh, 1220 vertex, kendi asset ekibi | Sadece native iOS app. Web'de gerçek AR yok (2D foto kompozit). Sadece kendi kataloğu — satılan bir servis değil. Saç occlusion'ı zayıf, reçeteli lens simülasyonu yok. |
| **Fittingbox** | Pazar lideri B2B, web + native | Pahalı, ağır entegrasyon, asset onboarding yavaş ve kapalı. Ölçüm tarafı ayrı ürün olarak satılıyor. |
| **Perfect Corp (YouCam)** | Kozmetik odaklı, gözlük yan ürün | Gözlükte fiziksel doğruluk zayıf — "filtre" hissi. Metrik ölçek iddiası yok. |
| **Banuba / Jeeliz** | SDK satıyor, geliştirici odaklı | Sadece takip katmanı — yerleştirme çözücüsü, fit skoru, asset pipeline müşteride kalıyor. |
| **Ditto** | Ölçüm + try-on, web | Video tabanlı, yavaş akış (kafayı çevir, işlensin), gerçek zamanlı değil. |

### Kazanma tezi

Web'de TrueDepth'i kopyalayamayız. Bunun yerine **üç ayrı cephede** öne geçiyoruz:

1. **Ölçüm doğruluğu ürünün kendisi olur.** Sadece "eğlenceli deneme" değil — optometristin mağazada yaptığı 5 ölçümü (PD, segment height, vertex distance, pantoskopik tilt, frame wrap) tarayıcıda üretip reçeteli lens siparişine besliyoruz. Bu, gözlük satan bir markaya try-on'dan daha değerli.
2. **Fiziksel yerleştirme, yaklaşık hizalama değil.** Üç temas noktalı (burun sırtı + iki kulak üstü) kısıtlı çözücü → aynı çerçeve iki farklı yüzde farklı yükseklikte oturur. Sahtelik hissinin 1 numaralı sebebi sabit offset kullanmaktır.
3. **Kimsenin yapmadığı iki render detayı:** saç matting ile occlusion, ve reçete diyoptrisine göre lens kalınlığı + göz büyütme/küçültme simülasyonu. -6.00 D bir lensin gözü küçülttüğünü gösteren tek VTO olmak, optik zincirleri için somut bir satış argümanı.

---

## 2. Kritik Kısıt: iOS Web'de Metrik Derinlik Yok

Karara temel olduğu için net yazıyorum:

- `getUserMedia` derinlik akışı vermiyor. TrueDepth verisi tarayıcıya **hiçbir yoldan** açılmıyor.
- iOS Safari'de `immersive-ar` WebXR oturumu desteklenmiyor (Vision Pro hariç). Yani WebXR üzerinden ARKit yüz takibine erişim yolu da kapalı.
- Android'de `immersive-ar` + Depth API var ama Augmented Faces WebXR'a açılmıyor; ayrıca cihaz dağılımı parçalı.
- Kamera intrinsics (odak uzaklığı, autofocus mesafesi) web'de güvenilir değil. `MediaTrackSettings` çoğu cihazda boş döner.

**Sonuç:** Ölçek, görüntüden istatistiksel olarak çözülecek. Bu roadmap'in en riskli ve en değerli parçası — bu yüzden 1. haftaya alındı. Çözülmezse ürün yok.

`roadmap.txt`'teki "hasWebXR && isIOS → arkit" mantığı bu yüzden hatalı; `navigator.xr` varlığı iOS'ta AR oturumu alınabileceği anlamına gelmiyor. Yetenek tespiti `navigator.xr.isSessionSupported('immersive-ar')` ile **async** yapılmalı.

---

## 3. Mimari

```
┌─────────────────────────────────────────────────────────────┐
│  EMBED KATMANI  <glasses-tryon>  (Web Component, Shadow DOM)│
│  tenant teması · SKU seçici · izin onboarding · analytics    │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  ÇEKİRDEK (framework-agnostic TS, worker'da çalışır)         │
│                                                              │
│  ① CAPABILITY   cihaz/tarayıcı yetenek profili, kalite kademesi│
│  ② PERCEPTION   FaceLandmarker(478+blendshape+4x4 matrix)     │
│                 HairSegmenter · IrisRefine                    │
│  ③ METRIC       çok-ipuçlu Bayesian ölçek füzyonu             │
│                 + opsiyonel kart kalibrasyonu → mm'lik mesh   │
│  ④ SOLVER       temas-kısıtlı 3DoF yerleştirme + fit skoru    │
│  ⑤ FILTER       One Euro (öteleme) + SLERP (rotasyon)         │
│  ⑥ MEASURE      PD, seg height, vertex dist, pantoskopik açı  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  RENDER (three.js / WebGL2, opsiyonel WebGPU)                │
│  depth-only occlusion pass · saç alpha maskesi                │
│  PBR (asetat transmission / titanyum metal)                   │
│  SH ışık tahmini · temas gölgesi · lens refraction + reçete   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  BACKEND (Cloudflare Workers + R2 + D1)                      │
│  tenant config · imzalı asset URL · usage metering · events   │
│  ⚠ Kamera görüntüsü ASLA sunucuya gitmez — tüm çıkarım cihazda│
└──────────────────────────────────────────────────────────────┘
```

**Kamera karesi hiç ağa çıkmaz.** Bu mimari kararı KVKK/GDPR'da biyometrik veri işleme yükümlülüğünü büyük ölçüde ortadan kaldırıyor ve B2B satışta en güçlü kozumuz (§14).

---

## 4. Teknoloji Stack

| Katman | Seçim | Neden / Alternatif |
|---|---|---|
| Yüz takibi | **`@mediapipe/tasks-vision` → FaceLandmarker** | 478 landmark + 52 blendshape + `facialTransformationMatrixes` (4×4). Eski `@mediapipe/face_mesh` paketi kullanılmayacak — transform matrisi ve blendshape vermiyor, bakımı durdu. |
| Saç segmentasyonu | **MediaPipe ImageSegmenter**, `selfie_multiclass_256x256` | Hazır `hair` sınıfı var — kendi U-Net'ini eğitmeye gerek yok. Alt.: RVM (Robust Video Matting) ONNX. |
| İris | FaceLandmarker `outputFaceBlendshapes` + iris landmark 468–477 | Ölçek füzyonunun en düşük varyanslı girdisi. |
| 3D render | **three.js + WebGL2**, `MeshPhysicalMaterial` | `transmission`/`thickness`/`ior`/`iridescence`/`clearcoat` zaten var → asetat ve lens için yeterli. WebGPURenderer feature-detect ile opsiyonel hızlandırma. Alt.: Babylon.js 8. |
| Inference backend | WASM+SIMD (varsayılan), GPU delegate (destekliyorsa) | Küçük modellerde WebGL transfer overhead'i WASM'ı geçebiliyor — ölç, varsayma. |
| Filtre | One Euro filter (kendi implementasyonu, ~40 satır) | Kalman'a göre ayarı kolay, latency/jitter dengesi insan algısına uygun. |
| Asset pipeline | Blender headless (`bpy`) + **glTF-Transform CLI** | Draco/meshopt sıkıştırma, KTX2/Basis texture, LOD üretimi, otomatik. |
| Embed | Custom Element + Shadow DOM, tek `<script>` | Marka CSS'i ile çakışmaz. Alt.: iframe (izolasyon iyi, kamera izni ve UX kötü). |
| Backend | Cloudflare Workers + R2 + D1 | R2 çıkış bandwidth'i ücretsiz — asset ağırlıklı ürün için kritik maliyet kalemi. Edge'de düşük gecikme. |
| Monorepo | ~~pnpm~~ **npm workspaces** + Vite + TypeScript strict | Geliştirme makinesinde pnpm yoktu; global kurulum yapmamak için npm workspaces kullanıldı. Geçiş tek adım. |
| Test | Vitest (birim) + Playwright (E2E, fake camera stream) | `--use-file-for-fake-video-capture` ile deterministik regresyon. |

---

## 5. Platform-Aware Yetenek Kademeleri

```ts
// packages/core/src/capability.ts
export type Tier = 'high' | 'mid' | 'low' | 'photo';

export async function detectCapability() {
  const gl = document.createElement('canvas').getContext('webgl2');
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? 4;          // Chrome-only
  const webgpu = !!(navigator as any).gpu;
  const arSupported = await navigator.xr
    ?.isSessionSupported('immersive-ar').catch(() => false) ?? false;

  // GPU rengi: renderer string'i ile kaba sınıflandırma
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string : '';

  let tier: Tier = 'mid';
  if (!gl) tier = 'photo';                                    // WebGL2 yok
  else if (cores >= 8 && mem >= 6) tier = 'high';
  else if (cores <= 4 || /Mali-4|Adreno 3|PowerVR/.test(gpu)) tier = 'low';

  return { tier, webgpu, arSupported, gpu, cores };
}
```

| Kademe | Cihaz örneği | Perception Hz | Render | Saç matting | Lens refraction | Gölge |
|---|---|---|---|---|---|---|
| **high** | iPhone 15+/17, S24+, masaüstü dGPU | 60 | 60 FPS, 2× DPR | ✅ her frame | ✅ screen-space | ✅ soft shadow map |
| **mid** | Orta Android, MacBook Air, iPad | 30 | 60 FPS (interpolasyonlu), 1.5× DPR | ✅ 3 frame'de 1 + reprojection | ✅ basitleştirilmiş | ✅ contact shadow |
| **low** | Eski Android, düşük RAM | 20 | 30 FPS, 1× DPR | ❌ | ❌ (Fresnel + tint) | contact shadow (baked) |
| **photo** | WebGL2 yok / kamera izni yok | — | Tek kare | ❌ | ❌ | baked |

**Kritik teknik:** perception ve render frekansını ayır. `low`/`mid`'de yüz takibi 20–30 Hz çalışsa bile One Euro filtresi ara kareleri tahmin ederek render'ı 60 FPS tutar. Kullanıcı 30 Hz takibi hissetmez, ama 30 FPS render'ı hisseder.

---

## 6. Metrik Ölçek — Çekirdek Problem (En Riskli İş)

### Problem

Perspektif projeksiyonda `u = f·X/Z`. Gerçek boyut `X` ve mesafe `Z` çarpımsal olarak eşleşiyor — uzaktaki büyük yüz ile yakındaki küçük yüz aynı pikselleri üretir. Klasik scale-depth ambiguity.

Snapchat için sorun değil. Gözlük için felaket: çerçeve ölçüleri fiziksel olarak sabit (49□21-145), yüz genişliği 130 mm mi 148 mm mi bilinmezse her çerçeve herkese "mükemmel" oturur ve ürün bir alışveriş aracı olarak değersizleşir.

### Çözüm: Çok-İpuçlu Bayesian Ölçek Füzyonu

FaceLandmarker kanonik (sabit boyutlu) bir yüz modelini kameraya oturtuyor — **oranlar** doğru, **mutlak boyut** varsayım. Bize gereken tek skaler: `s = gerçek_yüz / kanonik_yüz`.

Her antropometrik ölçüt `i` için: kanonik mesh'ten ölçülen `c_i` (kanonik birim), gerçek dünya priori `N(μ_i, σ_i²)` (mm).

```
s_i = μ_i / c_i          σ_{s_i} = σ_i / c_i
```

Ölçütler **korele** (PD ve bizygomatic genişlik birlikte büyür), bu yüzden naif çarpım değil GLS füzyonu:

```
ŝ = (1ᵀ Σ⁻¹ 1)⁻¹ · 1ᵀ Σ⁻¹ s        Var(ŝ) = (1ᵀ Σ⁻¹ 1)⁻¹
```

`Σ` = ölçüt bazlı ölçek tahminlerinin kovaryansı (köşegen: `σ_{s_i}²`; köşegen dışı: antropometrik korelasyondan, ~0.5–0.7).

### Prior tablosu

| Ölçüt | Landmark | μ (mm) | σ (mm) | CV | Not |
|---|---|---|---|---|---|
| **İris yatay çapı** | 468–472 / 473–477 | 11.7 | 0.5 | 4.3% | En stabil. Yaş/etnisiteden neredeyse bağımsız. Birincil ipucu. |
| Pupiller mesafe (PD) | iris merkezleri 468, 473 | 63.0 | 3.6 | 5.7% | Cinsiyet beyan edilirse: E 64.0±3.4 / K 61.7±3.6 |
| İç kantal mesafe | 133 ↔ 362 | 32.0 | 2.5 | 7.8% | Zayıf ama bağımsız-ish |
| Bizygomatik genişlik | 234 ↔ 454 | 134 | 7 | 5.2% | Cinsiyet ayrımıyla belirgin iyileşir |
| Burun genişliği | 49 ↔ 279 | 34 | 3 | 8.8% | Sadece regularizasyon amaçlı |

> ⚠ **Landmark indekslerini kodda sabitlemeden önce kanonik mesh üzerine çizip görsel olarak doğrula.** MediaPipe indeksleri sezgisel değil ve internetteki çoğu liste hatalı. `refineLandmarks: true` (yani `outputFaceLandmarks` + iris) olmadan 468–477 gelmez.

İki-üç bağımsız-ish ipucunun füzyonu ile beklenen hata **~3%** → 63 mm PD'de ~2 mm. Çerçeve beden adımları 2 mm olduğu için bu, "bir beden" çözünürlüğüne denk. Kabul edilebilir taban.

### Opsiyonel kalibrasyon → ~1%

ISO/IEC 7810 ID-1 kart (85.60 × 53.98 mm — her banka/kimlik kartı) alına tutulur, aynı karede yüz ölçütleri gerçek mm'ye kalibre edilir, sonuç kullanıcı profiline yazılır (bir kez, `localStorage` + hesap).

Uygulama: kartın 4 köşesini bul (contour + `approxPolyDP`, veya kullanıcıya sürüklenebilir 4 tutamaç göster — daha güvenilir ve 10× daha az kod), homografi çöz, kartın alın düzlemindeki derinliğini yüz mesh'i ile eşle.

```ts
// packages/core/src/metric/scale.ts
type Cue = { name: string; observed: number; muMM: number; sigmaMM: number };

export function fuseScale(cues: Cue[], corr = 0.6) {
  const s = cues.map(c => c.muMM / c.observed);
  const sd = cues.map(c => c.sigmaMM / c.observed);
  const n = cues.length;

  // Kovaryans: köşegen varyans, köşegen dışı korelasyonlu
  const S = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? sd[i] ** 2 : corr * sd[i] * sd[j]));

  const Si = invert(S);                       // n ≤ 5, basit Gauss-Jordan yeter
  const w  = Si.map(row => row.reduce((a, b) => a + b, 0));
  const wsum = w.reduce((a, b) => a + b, 0);

  return {
    scale: s.reduce((acc, si, i) => acc + si * w[i], 0) / wsum,
    sigma: Math.sqrt(1 / wsum),               // güven aralığı → UI'da göster
  };
}
```

### Ölçek kalitesi UI'da görünür olmalı

Kullanıcıya "±2 mm" güvenini göstermek, sessizce yanlış olmaktan iyidir. Ayrıca kalibrasyona teşvik eder: *"Ölçüm hassasiyeti: ±2.4 mm — bir kart ile ±1 mm'ye düşür."*

### Etik/hukuki not

Cinsiyet/etnisite priorları doğruluğu artırır ama otomatik demografi çıkarımı KVKK'da **özel nitelikli kişisel veri** işlemeye girer ve bias riski taşır. **Karar: otomatik çıkarım yapılmayacak.** Kullanıcı isteğe bağlı beyan ederse prior daraltılır, aksi halde cinsiyet-agnostik prior kullanılır.

---

## 7. Yerleştirme Çözücüsü — "Fiziği Taklit Et"

Naif yaklaşım (gözlüğü göz landmarklarının ortasına koy + kafa pozunu uygula) sahte görünür. Gerçek gözlük **üç noktada** durur:

1. Burun sırtı (nazal dorsum) — köprü/burun pedleri
2. Sol kulak üstü (superior helix birleşimi)
3. Sağ kulak üstü

Üç temas noktası rijit cismin pozunu belirler.

### Algoritma

```
1. SİMETRİ KISITI
   Çerçeve orta düzlemi ← yüz sagital düzlemine hizala
   (sagital düzlem: landmark 168/6/1/152 en küçük kareler uydurması)
   → yaw ve roll kilitlenir; 6DoF → 3DoF (pitch, y, z)

2. BURUN TEMASI
   Çerçevenin nose-pad anchor düzlemlerinden yüz mesh'ine ray-cast
   ilk kesişimi bul → yüzey normali boyunca temasa kadar ilerlet
   → y ve z belirlenir (verilen pitch için)

3. KULAK TEMASI  → pitch
   Çerçeveyi burun temas noktası etrafında döndür,
   sap uçları kulak üstü noktasına değene kadar
   → pantoskopik açı doğal olarak ortaya çıkar (uydurma sabit değil)

4. PENETRASYON KONTROLÜ
   Saplar yanak/şakak mesh'ini kesiyor mu? (SDF veya kaba ray testi)
   Kesiyorsa → çerçeve dar. Sapları esnet (menteşe eksenlerinde ±3°)
   VE fit skorunu düşür.

5. 2–3 ICP iterasyonu ile rafine et (veya 1'den 4'e analitik tek geçiş)
```

**İncelik:** Burun köprüsü açısı (kimilerinde dik, kimilerinde yayvan) gözlüğün ne kadar aşağı ineceğini belirler. Aynı çerçeve iki yüzde farklı yükseklikte oturur. Sabit offset kullanırsan bu tamamen kaybolur — sahte görünmenin bir numaralı sebebi budur.

### Kulak problemi — kimse çözmüş değil

MediaPipe face mesh **kulakları içermiyor**. ARKit'in 1220-vertex mesh'i de içermiyor. Yani WP dahil herkes kulak temasını tahmin ediyor. Landmark 234/454 tragion *proxy*'sidir, superior helix değil.

**Fark yaratma fırsatı — opsiyonel profil kalibrasyonu:** Kullanıcıya bir kez "başını 90° çevir" adımı sunulur, profil karesinden kulak üstü noktası ve gerçek `tragion→sellion` mesafesi ölçülür. Bu, sap uzunluğu (temple length, 140/145/150) uyumunu gerçek veriyle eşleştirir. WP'de yok. Kısıtlı süre nedeniyle **Gün 24'e opsiyonel** olarak koyuldu — kesilirse antropometrik offset ile devam edilir.

### Fit skoru — ürünün ticari kalbi

```ts
type FitReport = {
  score: number;                    // 0..100
  verdict: 'too-narrow' | 'good' | 'too-wide';
  sizeSuggestion: -1 | 0 | 1;       // bir beden küçük / uygun / büyük
  breakdown: {
    frameWidthVsFace: number;       // temple-to-temple
    bridgeVsNose: number;           // köprü vs iç kantal + burun kökü genişliği
    templeLengthVsEar: number;      // sap vs tragion-sellion
    lensHeightVsPupil: number;      // segment height — progresif lens için kritik
    penetration: number;            // şakak baskısı
    pantoscopicTilt: number;        // derece, ideal 8–12°
    vertexDistance: number;         // mm, ideal 12–14 mm (kirpik teması riski)
  };
};
```

`frameWidthVsFace` ve `penetration` ağır ağırlıklı; diğerleri ince ayar. Ağırlıkları §16'daki doğrulama çalışmasından kalibre et — tahminle bırakma.

### Optik ölçüm raporu — asıl satış argümanı

Aynı çözücüden bedava çıkan, reçeteli lens siparişi için gereken 5 parametre:

| Parametre | Ne için | Hedef doğruluk |
|---|---|---|
| Monoküler PD (sağ/sol ayrı) | Lens optik merkez konumu | ±1 mm |
| Segment height | Progresif/bifokal lens yüksekliği | ±1.5 mm |
| Vertex distance | Yüksek diyoptride efektif güç düzeltmesi | ±1.5 mm |
| Pantoskopik açı | Lens eğim tazminatı | ±2° |
| Frame wrap (face form) | Wrap tazminatı | ±2° |

Mağazada optometristin yaptığı iş. Bir online optik zinciri için try-on'dan daha kıymetli — ve rakiplerin çoğunda ayrı ücretli modül.

---

## 8. Render Pipeline

Fotogerçekçilik burada kazanılıyor. **Etki sırasına göre** — süre kısılırsa alttan kes:

### 8.1 Occlusion — tek en kritik numara ⭐

Yüz mesh'i renk yazma **kapalı**, derinlik yazma **açık** render edilir (depth-only pass). Z-buffer sapları doğru yerde keser.

```ts
const occluder = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({
  colorWrite: false,      // renk yazmaz
  depthWrite: true,       // derinlik yazar
}));
occluder.renderOrder = -1;   // gözlükten ÖNCE çiz
scene.add(occluder);
```

Bunu yapmayan implementasyonlarda gözlük yüzün "üstünde yüzer".

### 8.2 Saç matting — WP'de bile zayıf ⭐

Yüz mesh'i saçı içermez → uzun saçlı kullanıcıda sap saçın önünden geçer. `ImageSegmenter` hair maskesi ile sapları maskele.

Maliyet: 4–8 ms. `mid` kademede 3 frame'de bir çalıştır, aradaki karelerde maskeyi kafa pozu delta'sı ile reproject et (ekran uzayında affine warp yeterli). Maske kenarını 2–3 px feather'la, aksi halde aliasing "makas" gibi görünür.

### 8.3 Temas gölgesi ⭐

Burun köprüsündeki o küçük koyu şerit. Olmadığında gözlük yapışkan sticker gibi durur — en büyük tek gerçekçilik ipucu.

Tahmini ana ışık yönünden shadow map, yüz mesh'ine projekte, çarpımsal kompozit. Düşük kademelerde: köprü çevresine baked contact-AO decal (neredeyse bedava, etkisi büyük).

### 8.4 SH ışık tahmini

Sanal nesnenin ışığı sahne ile uyuşmazsa beyin anında yakalar. Yüz, albedosu kabaca bilinen bir Lambert yüzeyi → ters render ile 2. derece küresel harmonik (RGB başına 9 katsayı) görüntüden çıkarılabilir. Alın/yanak örneklerinden en küçük kareler; zamansal olarak yavaş yumuşat (ışık ani değişmez).

Bunu web'de yapan neredeyse yok. Orta maliyet, yüksek getiri.

### 8.5 PBR materyaller

| Malzeme | Ayar |
|---|---|
| Titanyum / metal | `metalness: 1`, `roughness: 0.22–0.30`, anisotropy (fırçalanmış yüzey) |
| Asetat | `metalness: 0`, `transmission: 0.15–0.35`, `thickness: 2–4 mm`, `attenuationColor` → ışığın içinden süzülmesi. WP'nin özellikle övündüğü detay. |
| AR kaplama | `iridescence: 0.3`, `iridescenceIOR: 1.3` → hafif yeşilimsi/morumsu yansıma |
| Lens | `transmission: 1`, `ior` (aşağıda) |

### 8.6 Lens kırılması + reçete simülasyonu ⭐ (differentiator)

Screen-space refraction: sahneyi texture'a render et, lens shader'ında kırılma vektörünü hesapla ve kaydırılmış UV ile örnekle.

```
t = η·i + (η(n·i) − √(1 − η²(1 − (n·i)²)))·n
```

IOR: asetat/CR-39 1.50 · polikarbonat 1.586 · yüksek indeks 1.67 / 1.74.

**Reçete katmanı — kimsede yok.** Diyoptri girildiğinde:

- **Büyütme/küçültme:** spectacle magnification `SM ≈ 1/(1 − d·F)` (`d` = vertex mesafesi metre, `F` = diyoptri). -6.00 D'de gözler belirgin küçülür, +4.00 D'de büyür. Shader'da lens bölgesine radyal ölçekleme.
- **Kenar kalınlığı:** minus lensde kenar kalınlaşır. Sagitta `≈ r²·F / (2000·(n−1))` (mm) → geometriye gerçek kalınlık uygula, "kavanoz dibi" etkisi ve iç halkalar görünür.
- **Yüksek indeks satışı:** aynı reçeteyi 1.50 ve 1.74'te yan yana göster → **doğrudan upsell aracı.** Optik zincirine bunu anlatmak kolay.

### 8.7 Fresnel + AR yansıma

Ucuz, etkisi büyük. Kesme listesinin en sonunda olsun.

---

## 9. Zamansal Filtreleme

Landmark tahmini kare başına gürültülü; ham poz kullanılırsa gözlük titrer.

**One Euro filter** (Casiez ve ark., 2012): kesme frekansını hıza göre adapte eden alçak geçiren filtre.

```
f_c = f_c_min + β·|ẋ̂|
```

Yavaş hareket → düşük kesme → çok yumuşatma → titreme yok. Hızlı hareket → yüksek kesme → az gecikme. Kalman'a üstünlüğü: ayarı kolay ve latency/jitter dengesi insan algısına uygun.

- Öteleme: kanal başına One Euro (`f_c_min ≈ 1.0 Hz`, `β ≈ 0.05` — deneyle ayarla)
- Rotasyon: quaternion'da SLERP, adaptif alpha
- Ölçek: çok daha agresif yumuşatma — ölçek kare kare değişmemeli, oturduktan sonra neredeyse kilitle
- **Fit skoru: kesinlikle yumuşat/kilitle.** Skorun 78↔81 arası oynaması güveni yok eder.

Bütçe: 60 FPS'te kare başına 16.6 ms.

---

## 10. Asset Pipeline — Kimsenin Konuşmadığı Kısım

Algoritma bir kez yazılır, asset pipeline sonsuza kadar sürer. SaaS'ta **marjı belirleyen kalem budur.** WP'nin "her çerçeve için pixel-perfect olana kadar defalarca revizyon" demesinin sebebi tam olarak bu.

### SKU başına gereken

1. CAD modeli veya fotogrametri taraması → retopoloji (temiz quad mesh, 5–15k üçgen)
2. UV unwrap + PBR texture set (albedo, roughness, metallic, normal)
3. **Semantik anchor noktaları** — kanonik koordinat çerçevesinde:
   - `bridge_center`, `nosepad_L/R` (temas düzlemleri + normalleri)
   - `hinge_axis_L/R` (sap esnetme için)
   - `temple_tip_curve_L/R` (kulak teması eğrisi)
   - `lens_plane_L/R` (refraction ve segment height için)
   - **Çözücü bunlar olmadan generic çalışamaz.** Boru hattının en kritik ve otomatikleştirilmesi en zor parçası.
4. Fiziksel ölçü kalibrasyonu (çerçeve içine yazan `49□21-145`)
5. LOD (3 kademe) + texture sıkıştırma (KTX2/Basis, mobil ASTC)

### CLI hedefi: `npx vto-asset build ./raw/sku-1234`

```
raw/sku-1234/
├── frame.blend | frame.fbx
├── anchors.json        # elle işaretlenir (Blender add-on ile yarı-otomatik)
├── spec.json           # 49-21-145, renk varyantları, malzeme tipi
└── textures/
        ↓  Blender headless + glTF-Transform
dist/sku-1234/
├── lod0.glb (15k tri, KTX2)  lod1.glb (6k)  lod2.glb (2k)
├── thumb.webp  (otomatik turntable render)
├── manifest.json  (anchor'lar + ölçüler + varyantlar)
└── validate-report.json
```

Otomatik doğrulama kapıları (hepsi CLI'da fail eder):
- Anchor eksik/NaN mı?
- Üçgen sayısı ve texture boyutu bütçe içinde mi?
- Fiziksel ölçüler mesh geometrisiyle tutarlı mı? (±1 mm) ← *asset hatalarının en sık kaynağı*
- Menteşe eksenleri simetrik mi?
- Ölçek birimi metre mi? (Blender'dan cm/inç gelmesi klasik hata)

**Marj matematiği:** SKU başına elle iş 2 saatten 20 dakikaya inmezse 200 SKU'lu bir katalog müşterisi kârsızlaşır. Blender anchor add-on'u (Gün 19) bu yüzden lüks değil, iş modeli gereği.

### Renk varyantları

Ayrı GLB **değil** — tek mesh + malzeme override (`albedo tint`, `roughness`, asetat için `attenuationColor`). 1 SKU × 6 renk = 1 indirme. Bandwidth ve onboarding maliyetini 6'ya böler.

---

## 11. Embed SDK — Entegrasyon Yüzeyi

Hedef: marka geliştiricisinin işi **10 dakika** olsun.

```html
<script src="https://cdn.vto.io/v1/embed.js" data-tenant="pk_live_abc123" defer></script>

<glasses-tryon
  sku="RB2140-901"
  variant="black-g15"
  mode="modal"
  theme="dark"
  accent="#1a73e8"
  prescription="-2.50"
  lang="tr">
</glasses-tryon>
```

```js
const el = document.querySelector('glasses-tryon');

el.addEventListener('vto:ready',   e => {});
el.addEventListener('vto:fit',     e => console.log(e.detail.score, e.detail.sizeSuggestion));
el.addEventListener('vto:measure', e => sendToPrescriptionForm(e.detail));  // PD, seg height...
el.addEventListener('vto:capture', e => shareToSocial(e.detail.blob));
el.addEventListener('vto:error',   e => {});   // izin reddi, desteklenmeyen cihaz

el.setSku('RB3025-L0205');      // sayfa yenilenmeden çerçeve değiştir
el.setPrescription({ od: -2.50, os: -3.00 });
```

Tasarım kararları:

- **Shadow DOM zorunlu** — marka CSS'i widget'ı bozamaz (B2B destek biletlerinin en büyük kaynağı budur).
- **Lazy load** — `embed.js` < 15 KB olsun; ağır motor (MediaPipe WASM + three.js) sadece kullanıcı "Dene"ye bastığında yüklenir. Marka sayfasının Core Web Vitals'ını bozmak = ilk itiraz sebebi.
- **`mode="modal" | "inline" | "fullscreen"`** — mobilde varsayılan fullscreen.
- **İzin onboarding'i widget içinde** — "neden kamera gerekiyor + görüntü cihazından çıkmaz" ekranı. Bu ekran dönüşüm oranını belirgin etkiler; A/B test edilebilir olarak kur.
- **HTTPS zorunlu** (localhost hariç), `Permissions-Policy: camera=(self "https://cdn.vto.io")` dokümante et.
- **Otomatik `photo` fallback** — desteklenmeyen cihazda "fotoğraf yükle" akışı. Sessizce ölmemeli.

---

## 12. Backend & Multi-Tenant (28 gün içinde minimum)

Cloudflare Workers + R2 + D1:

```
GET  /v1/tenant/:pk/config        → tema, aktif SKU listesi, feature flag'ler
GET  /v1/sku/:tenant/:sku         → imzalı R2 URL (kısa TTL), manifest
POST /v1/events                   → batch analytics (kamera verisi YOK)
GET  /v1/health
```

- **Origin allowlist** `pk_live_*` başına — anahtar çalınıp başka sitede kullanılamaz.
- **Usage metering:** session sayacı (Workers Analytics Engine veya D1 append-only). Faturalandırmanın temeli — sonradan eklemek acı verir, ilk günden yaz.
- **Asset erişimi imzalı URL** — müşterinin 3D modelleri rakibine açık olmasın (B2B'de en sık sorulan güvenlik sorusu).
- **Toplanan event'ler:** hangi SKU denendi, süre, fit skoru dağılımı, beden önerisi, sepete ekleme. Bu veri müşteriye **dashboard olarak geri satılır** (Faz 2) ve bizim fit modelimizi kalibre eder.

**28 gün içinde admin paneli yok** — tenant config'i elle JSON olarak D1'e yazılır. İlk 3 müşteri için yeterli, dürüstçe söylenir.

---

## 13. Gizlilik — En Güçlü Satış Kozu

**Kamera karesi hiçbir zaman ağa çıkmaz.** Tüm çıkarım (yüz mesh, iris, saç maskesi) cihazda. Sunucuya yalnızca anonim event'ler ve türetilmiş sayılar (fit skoru, mm ölçüleri) gider — o da tenant'ın açık onayıyla.

Bunun sonuçları:

- **KVKK:** Yüz görüntüsünden biyometrik veri işleme (Md. 6 özel nitelikli veri) büyük ölçüde kapsam dışı kalır — görüntü işlenip anında atılır, aktarılmaz, saklanmaz. Açık rıza metni yine gerekir; şablonunu biz veririz (müşteri hukukçusunun işini kolaylaştırmak satış hızlandırır).
- **GDPR:** DPIA yükü hafifler; alt-işleyen zinciri yok. AB müşterileri için belirleyici.
- **BIPA (Illinois):** ABD'de VTO davalarının kaynağı. "No biometric template stored or transmitted" ifadesi doğrudan risk azaltır — ABD'li müşterinin hukuk ekibi bunu ilk sorar.

**Yapılacak:** `docs/privacy-architecture.md` — mimari diyagram + veri akış tablosu + hangi verinin nereye gittiği. Satış materyali olarak kullanılacak, teknik doküman gibi yazılmayacak.

---

## 14. Performans Bütçesi

60 FPS → 16.6 ms/kare. `high` kademe hedefi:

| İş | Bütçe | Not |
|---|---|---|
| FaceLandmarker | 3–6 ms | GPU delegate varsa alt sınır |
| HairSegmenter | 4–8 ms | ⚠ Her karede sığmaz → 2–3 karede bir + reprojection |
| Ölçek füzyonu | <0.1 ms | Oturduktan sonra kilitlenir, her kare çalışmaz |
| Yerleştirme çözücüsü | <1 ms | Analitik, ICP iterasyonu 2–3 ile sınırlı |
| One Euro + SLERP | <0.1 ms | |
| Render (occlusion + PBR + gölge + lens) | 4–6 ms | Refraction pass en pahalı kalem |
| **Toplam** | **~14 ms** | Perception'ı worker'a al, ana thread'i render'a bırak |

Ölçüm disiplini:
- `performance.mark/measure` ile her aşama; geliştirme HUD'unda canlı göster
- Sürekli 45 FPS altına düşerse **otomatik kademe düşür** (saç matting kapat → refraction kapat → DPR düşür). Kullanıcı bunu takılma olarak değil kalite değişimi olarak hisseder.
- `OffscreenCanvas` + worker: perception ana thread'i bloklamamalı

---

## 15. Doğrulama — "±2 mm" İddiasını Nasıl Kanıtlarız

B2B satışta doğruluk iddiası kanıtlanamıyorsa hiç söylenmemeli. Gün 25–26 bu iş için ayrıldı.

**Ölçek/ölçüm doğruluğu (n ≥ 15 kişi):**
- Ground truth: dijital pupilometre veya optometrist ölçümü (yerel bir optikle 1 günlük anlaşma)
- Karşılaştır: PD (monoküler dahil), iç kantal, bizygomatic
- Raporla: **MAE, %95 CI, Bland-Altman grafiği** — "±2 mm" iddiası bu tablodan doğar
- Alt gruplar: gözlük takan/takmayan, farklı cilt tonları, farklı ışık — **bias'ı kendin bul, müşteri bulmasın**

**Yerleştirme doğruluğu:**
- Kullanıcı gerçek gözlüğünü takar, foto çekilir → aynı SKU VTO ile render edilir → maskede IoU + köprü/sap kilit noktalarının piksel sapması

**Regresyon testi:**
- 20 kişilik sabit video seti, Playwright fake camera stream
- Metrikler: ortalama FPS, jitter (poz varyansı), ölçek kararlılığı, fit skoru stabilitesi
- CI'da her PR'da çalışır → görsel kalite sessizce bozulmaz

**Cihaz matrisi (minimum):** iPhone (Safari), orta segment Android (Chrome), eski Android, MacBook (Safari + Chrome), Windows (Chrome + Edge), iPad.

---

## 16. 28 Günlük Sprint Planı

Sıralama ilkesi: **en riskli iş en başta.** Metrik ölçek çözülmezse ürün yok — Gün 5'te bunu biliyor olmalıyız, Gün 25'te değil.

### Hafta 1 — Çekirdek Risk: Perception + Metrik Ölçek

| Gün | İş | Çıktı / Kapı |
|---|---|---|
| 1 | ✅ Monorepo (npm workspaces + Vite + TS strict), capability tespiti, kamera izin akışı, HTTPS dev sunucusu | Kamera açılıyor, cihaz kademesi doğru raporlanıyor |
| 2 | ✅ FaceLandmarker (tasks-vision) entegrasyonu, 478 landmark, FPS + inference HUD · ⚠ **worker'a taşınmadı** — core DOM'suz yazıldı, taşıma Gün 8'e ertelendi | Takip çalışıyor; FPS gerçek cihazda ölçülecek |
| 3 | ✅ Landmark doğrulama arayüzü (adlandırılmış indeksler + etiket + simetri düzlemi + eksenler), iris ölçümü, antropometrik ölçüt çıkarımı · ⚠ **indekslerin gözle teyidi bekliyor** | Araç hazır; `verified` alanları hâlâ `false` |
| 4 | ✅ **Bayesian (GLS) ölçek füzyonu** + güven aralığı, zamansal birikim, One Euro filtresi, 15 birim testi | Teorik taban: **CV %3.49 → ±2.20 mm** @63 mm PD |
| 5 | ⚠ **KAPI (bekliyor):** 3 kişide pupilometre/optometrist ölçümü ile karşılaştır — arayüz hazır (MAE/bias/JSON dışa aktarım) | Hata <%4 ise devam. Değilse: kart kalibrasyonunu zorunlu yap, planı revize et. |
| 6 | Kart (ID-1) kalibrasyon akışı, profil kalıcılığı (localStorage) | Kalibrasyonlu hata <1.5% |
| 7 | One Euro + SLERP filtresi, poz kararlılığı, temiz `core` API yüzeyi | Titremesiz, kararlı metrik poz |

### Hafta 2 — En Çok Kazanç: Solver + Occlusion + Gölge

| Gün | İş | Çıktı / Kapı |
|---|---|---|
| 8 | ✅ three.js sahnesi, metrik geri-projeksiyon (FOV varsayımı), **parametrik çerçeve** (GLB yerine — çözücünün ihtiyaç duyduğu anchor'lar tanım gereği var) | Gözlük sahnede, gerçek mm ölçüleriyle. Round-trip testi: hizalama tam. |
| 9 | ✅ **Depth-only occlusion pass** ⭐ (852 üçgen, MediaPipe tesselation'dan türetildi) | Saplar kafanın arkasına geçiyor — ekranda doğrulanacak |
| 10 | Yerleştirme çözücüsü: simetri kısıtı + burun teması ray-cast | Gözlük burun sırtına gerçekten oturuyor |
| 11 | Çözücü: kulak teması → pitch + pantoskopik açı, penetrasyon kontrolü, sap esnetme | Aynı çerçeve farklı yüzlerde farklı yükseklikte — hedeflenen davranış |
| 12 | **Temas gölgesi** ⭐ (shadow map + köprü contact AO) | Sticker hissi bitti |
| 13 | **Saç matting** ⭐ (ImageSegmenter + reprojection + kenar feather) | Uzun saçta saplar saçın arkasında |
| 14 | Fit skoru + beden önerisi + optik ölçüm raporu (5 parametre) | `vto:fit` ve `vto:measure` event'leri çalışıyor |

### Hafta 3 — Görsel Kalite + Asset Pipeline

| Gün | İş | Çıktı / Kapı |
|---|---|---|
| 15 | PBR malzemeler: titanyum, asetat transmission/thickness, AR kaplama iridescence | Malzeme ayrımı gözle net |
| 16 | SH ışık tahmini (ters render, 2. derece, zamansal yumuşatma) | Farklı ışıkta gözlük sahneye ait görünüyor |
| 17 | Lens: screen-space refraction + IOR + Fresnel | Camdan bakınca arka plan kayıyor |
| 18 | **Reçete simülasyonu** ⭐ (magnification + kenar kalınlığı + indeks karşılaştırma) | -6.00 D'de göz küçülüyor; 1.50 vs 1.74 yan yana |
| 19 | Asset CLI: Blender headless + glTF-Transform + LOD + KTX2 + doğrulama kapıları + anchor add-on'u | `npx vto-asset build` tek komut |
| 20 | 5–8 SKU üretimi (Sketchfab/CAD kaynak), renk varyantları, thumbnail turntable | Çalışan katalog |
| 21 | Kalite kademeleri + otomatik düşürme, cihaz matrisi ilk turu, performans profilleme | 3 cihazda hedef FPS tutuyor |

### Hafta 4 — Ürünleştirme + Kanıt

| Gün | İş | Çıktı / Kapı |
|---|---|---|
| 22 | Web Component embed (Shadow DOM, lazy load, `<15 KB` loader), event API, tema/aksan | Tek `<script>` ile çalışıyor |
| 23 | Cloudflare Worker: tenant config, imzalı asset URL, origin allowlist, event toplama, metering | Çok tenant'lı temel akış |
| 24 | UX cilası: izin onboarding, `photo` fallback, foto yakalama/paylaşma, TR/EN i18n, a11y (klavye + ARIA), *opsiyonel: profil kalibrasyonu* | Gerçek kullanıcıya gösterilebilir |
| 25 | **Doğruluk çalışması** — n≥15, optometrist ground truth, Bland-Altman, alt grup bias analizi | `docs/accuracy-report.md` — satış materyali |
| 26 | Cihaz matrisi tam turu, Playwright regresyon (fake camera), hata düzeltme | Yeşil CI, bilinen sorunlar listesi |
| 27 | Demo mağaza (sahte e-ticaret), entegrasyon dokümanı, gizlilik mimarisi dokümanı, KVKK rıza şablonu | Satış paketi hazır |
| 28 | Vercel/CF Pages deploy, demo videosu, pitch deck, fiyatlandırma tek sayfası | Pilot görüşmesine çıkılabilir |

### Süre kısılırsa kesme sırası (sondan başa)

`profil kalibrasyonu` → `SH ışık tahmini` → `reçete simülasyonu` → `lens refraction` → `saç matting`.

**Asla kesilmeyecek üçlü:** occlusion, temas gölgesi, doğru metrik ölçek. Bu üçü olmadan ne kadar iyi PBR yaparsan yap sticker gibi durur.

---

## 17. Faz 2 — Ticarileştirme (Gün 29–120)

| Blok | İş |
|---|---|
| **Onboarding** | Self-servis tenant kaydı, API anahtarı yönetimi, asset yükleme portalı, otomatik doğrulama geri bildirimi |
| **Faturalandırma** | Stripe, kademeli MAU/session limitleri, aşım politikası, kullanım uyarıları |
| **Dashboard** | Müşteriye analytics: SKU başına deneme, fit skoru dağılımı, beden önerisi → dönüşüm korelasyonu, ısı haritaları |
| **Entegrasyonlar** | Shopify App Store, WooCommerce eklentisi, Magento, Salesforce Commerce |
| **Asset ölçeği** | Freelancer 3D sanatçı ağı, SKU başına SLA, kalite denetim akışı, dış kaynak playbook'u |
| **ML katmanı** | Toplanan veriyle fit skoru kalibrasyonu, yüz şekli sınıflandırma → öneri motoru, iade oranı korelasyonu |
| **Native SDK köprüsü** | Markanın kendi app'i varsa ARKit/ARCore ile metrik derinlik → aynı çekirdek, daha yüksek doğruluk. iOS'ta TrueDepth'e sadece bu yolla erişilir. |
| **Uyumluluk** | SOC 2 Type I hazırlığı, DPA şablonları, güvenlik soru formu yanıt kütüphanesi, penetrasyon testi |
| **Fiyatlandırma** | Pazar araştırmasıyla doğrulanacak taslak: Starter ~$299/ay (5k session) + SKU onboarding ücreti · Growth ~$999/ay (25k) · Enterprise özel. **Fittingbox/Perfect Corp fiyat kırılımını satış öncesi doğrula — bu sayılar tahmin.** |

---

## 18. Riskler

| Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|
| Ölçek füzyonu 4% altına inmiyor | Orta | **Kritik** | Gün 5 kapısı. Kart kalibrasyonunu opsiyonelden zorunluya çevir; ürünü "kalibrasyonlu hassas ölçüm" olarak konumlandır (dönüşümde sürtünme artar ama iddia korunur). |
| iOS Safari WASM/kamera tuhaflıkları | Yüksek | Orta | Gün 2'den itibaren gerçek cihazda test — simülatörde değil. iOS'ta `playsinline`, arka plan sekme davranışı, bellek limitleri klasik tuzaklar. |
| Saç matting bütçeye sığmıyor | Orta | Orta | Kademeli devre dışı bırakma zaten planda. `low`'da kapalı. |
| Kulak temas noktası tahmini zayıf | Yüksek | Orta | Antropometrik offset taban; profil kalibrasyonu iyileştirme olarak. Rakiplerde de çözülmemiş — göreli dezavantaj değil. |
| Asset üretimi SKU başına çok uzun sürüyor | Yüksek | **Kritik (marj)** | Anchor add-on'u + CLI doğrulama Gün 19'da. Hedef ≤20 dk/SKU. Aşılırsa Faz 2'de dış kaynak. |
| 4 haftada B2B SaaS beklentisi | **Kesin** | Yüksek | §0'da açıkça yazıldı. Çıktı: pilot-ready ürün, satılabilir SaaS değil. Bu ayrımı müşteri görüşmesinde de netleştir — pilot fiyatı ver, kurumsal SLA vaat etme. |
| Tek geliştirici bottleneck | Kesin | Yüksek | Asset üretimi (Gün 20) freelancer'a verilebilir tek blok — gerekirse ilk paralelleştirilecek iş bu. |

---

## 19. Repo Yapısı

```
gozluk/
├── packages/
│   ├── core/                 # framework-agnostic TS, worker-safe
│   │   ├── capability.ts
│   │   ├── perception/       # face landmarker, hair segmenter
│   │   ├── metric/           # scale fusion, card calibration
│   │   ├── solver/           # contact-constrained placement, fit score
│   │   ├── measure/          # PD, seg height, vertex, pantoscopic
│   │   └── filter/           # one euro, slerp
│   ├── render/               # three.js: occlusion, PBR, lens, shadow, SH
│   ├── embed/                # <glasses-tryon> web component (<15 KB loader)
│   └── asset-cli/            # blender + gltf-transform pipeline
├── apps/
│   ├── demo/                 # sahte e-ticaret mağaza
│   └── api/                  # cloudflare worker
├── blender-addon/            # anchor işaretleme add-on'u
├── docs/
│   ├── integration.md        # müşteri geliştiricisi için
│   ├── privacy-architecture.md
│   ├── accuracy-report.md
│   └── kvkk-consent-template.md
└── test/
    ├── fixtures/videos/      # 20 kişilik regresyon seti
    └── e2e/
```

---

## 20. Kaynaklar

**Perception**
- MediaPipe Tasks Vision — Face Landmarker (478 landmark, blendshape, transformation matrix)
- MediaPipe Image Segmenter — `selfie_multiclass_256x256` (hair sınıfı)
- MediaPipe Iris — derinlik/ölçek için iris tabanlı yaklaşımın referans makalesi

**Geometri & Poz**
- Blanz & Vetter (1999) — 3D Morphable Model, temel makale
- FLAME / Basel Face Model — kimlik + ifade bazları
- DECA, 3DDFA-V2 — CNN tabanlı 3DMM regresyonu (Faz 2 için ilgili)
- Casiez, Roussel & Vogel (2012) — **One Euro Filter** (bu roadmap'te doğrudan uygulanıyor)

**Render**
- three.js `MeshPhysicalMaterial` — transmission, thickness, ior, iridescence
- Karis, "Real Shading in Unreal Engine 4" — GGX/Smith mikrofaset BRDF
- Ramamoorthi & Hanrahan (2001) — küresel harmonik ışıklandırma
- glTF-Transform — asset optimizasyon CLI'ı

**Antropometri (ölçek priorları — sayıları kaynağından doğrula)**
- Dodgson (2004) — interpupillary distance dağılımı
- Rüfer ve ark. — white-to-white kornea/iris çapı normları
- ANSUR II — kraniyofasiyal ölçü veritabanı

**Optik**
- ISO/IEC 7810 ID-1 — kart boyutu 85.60 × 53.98 mm (kalibrasyon referansı)
- Spectacle magnification, vertex distance tazminatı, sagitta/kenar kalınlığı formülleri — standart oftalmik optik referansları

**Rakip analizi için incelenecek**
- Fittingbox, Perfect Corp, Banuba, Jeeliz, Ditto — demo akışlarını bizzat dene, dönüşüm UX'ini not al

---

## 21. Bir Sonraki Adım

Gün 1'e başlamak için karar gereken tek şey kalmadı — plan uygulanabilir. Başlangıç sırası:

1. `packages/core` iskeleti + capability tespiti + kamera akışı
2. FaceLandmarker worker'da, FPS HUD ile
3. **Gün 5 kapısına kadar koş** — ölçek doğruluğu ürünün var olup olmayacağını belirliyor

Doğrudan kod yazmaya geçilebilir.
