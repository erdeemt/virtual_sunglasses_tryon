# Görevler ve İş Bölümü

İki kişilik ekip. Görevler **çakışmayacak şekilde** paketlere ayrıldı —
aynı dosyada iki kişi çalışmasın diye.

Strateji ve takvim: [../ROADMAP.md](../ROADMAP.md)
Sistem nasıl çalışıyor: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## İş Bölümü Önerisi

| Alan | Paketler | Kim |
|---|---|---|
| **Perception & Metrik** | `packages/core` | A (mevcut context sahibi) |
| **Render & Görsel** | `packages/render` | B (yeni) |
| **Demo/UI** | `apps/demo` | ortak — küçük dosyalar, çakışma riski düşük |
| **Asset pipeline** | `packages/asset-cli` (henüz yok) | B |
| **Backend/Embed** | `apps/api`, `packages/embed` (henüz yok) | A |

**Kural:** bir görevi almadan önce issue'yu kendine ata. `packages/core` ve
`packages/render` aynı anda iki kişi tarafından değiştirilmemeli.

---

## Öncelik Sırası

Roadmap'in kendi ifadesi: *"En çok kazanç getiren üç şey sırasıyla: occlusion,
temas gölgesi, doğru metrik ölçek."* Occlusion ✅ yapıldı, metrik ölçek ✅
yapısal olarak doğrulandı, temas gölgesi ❌ eksik.

```
ACİL       T-00  Gün 5 kapısı — gerçek PD ölçümü
           T-01  Temas-kısıtlı yerleştirme çözücüsü
           T-02  Temas gölgesi
SONRA      T-03  Fit skoru + optik ölçüm raporu
           T-04  Saç matting
           T-05  Kart kalibrasyonu
           T-06  SH ışık tahmini
ALTYAPI    T-07  Perception → Web Worker
           T-08  Asset pipeline CLI
           T-09  Gerçek SKU'lar
           T-10  Embed widget + lazy load
           T-11  Backend / multi-tenant
```

---

## T-00 · Gün 5 Kapısı: Gerçek PD Ölçümü 🔴 BLOKE EDİYOR

**Kim:** ikisi de (farklı yüz tipleri lazım)
**Kod yok** — ölçüm işi.

Ürünün "±2 mm" iddiası kanıtlanmadı. Bu kapı geçilmeden doğruluk iddiası
hiçbir yerde yazılmamalı.

**Yapılacak:**
1. En az 3 kişi, tercihen farklı yüz tiplerinden (dar/geniş, kadın/erkek)
2. Gerçek PD'yi bul:
   - Optikteki gözlük sipariş kaydında yazıyor (en kolay)
   - Cetvel + ayna yöntemi (±1–2 mm)
   - Optikte dijital pupilometre (en doğrusu, ücretsiz)
3. Demo panelinde "Doğruluk Çalışması" → denek kodu + gerçek PD → Kaydet
4. "JSON İndir" → `docs/accuracy-report.md` olarak özetle

**Kabul kriteri:** n ≥ 3, MAE ve bias raporlanmış.

**Karar:**
- MAE < %4 → devam, kart kalibrasyonu (T-05) opsiyonel kalır
- MAE > %4 → T-05 zorunlu hale gelir, ürün konumlandırması değişir
- **bias** > 2 mm → priorlar sistematik kaymış, `anthropometry.ts` düzeltilir
  (tek satır, kolay). Özellikle `bizygomatic` şüpheli — gerçek zygion değil
  yüz ovali proxy'si ölçüyor.

---

## T-01 · Temas-Kısıtlı Yerleştirme Çözücüsü 🔴

**Kim:** A · **Dosya:** `packages/core/src/solver/` (yeni) · **Tahmin:** 2 gün

Şu anki yerleştirme naif (burun kökü + sabit 13 mm offset) ve sahte görünüyor.
Gerçek gözlük **üç noktada** durur: burun sırtı + sol/sağ kulak üstü.

**Algoritma:**

```
1. SİMETRİ KISITI
   Çerçeve orta düzlemi ← yüzün sagital düzlemine hizala
   → yaw ve roll kilitlenir; 6DoF → 3DoF (pitch, y, z)

2. BURUN TEMASI
   Çerçevenin nose-pad anchor'larından yüz mesh'ine ray-cast
   ilk kesişimi bul → yüzey normali boyunca temasa kadar ilerlet
   → y ve z belirlenir

3. KULAK TEMASI → pitch
   Çerçeveyi burun temas noktası etrafında döndür,
   sap uçları kulak üstü noktasına değene kadar
   → pantoskopik açı doğal olarak ortaya çıkar

4. PENETRASYON KONTROLÜ
   Saplar yanak/şakak mesh'ini kesiyor mu?
   Kesiyorsa çerçeve dar → sapları esnet (±3°) VE fit skorunu düşür
```

**Girdi:** metrik yüz mesh'i (`unprojectToMM` çıktısı) + `FrameAnchors`
**Çıktı:** `{ position, quaternion, contactPoints, penetrationDepth }`

**Dikkat:** kulak üstü noktası MediaPipe mesh'inde **yok** (ARKit'te de yok).
Landmark 234/454 tragion *proxy*'sidir, superior helix değil. Şimdilik
antropometrik offset kullan, `docs/` içine varsayımı yaz.

**Kabul kriteri:**
- Aynı çerçeve iki farklı yüzde **farklı yükseklikte** oturuyor (asıl amaç bu)
- Birim test: bilinen geometride bilinen temas noktaları çıkıyor
- Sabit offset kodu tamamen kalkmış

---

## T-02 · Temas Gölgesi ⭐ 🔴

**Kim:** B · **Dosya:** `packages/render/src/shadow.ts` (yeni) · **Tahmin:** 1 gün

Burun köprüsündeki o küçük koyu şerit. Roadmap: *"olmadığında gözlük yapışkan
sticker gibi durur"* — en büyük tek gerçekçilik ipucu.

**Yaklaşım (ucuzdan pahalıya, ucuzla başla):**
1. Köprü çevresine baked contact-AO decal — neredeyse bedava, etkisi büyük
2. Tahmini ana ışık yönünden shadow map → yüz mesh'ine projekte, çarpımsal kompozit

Kademe bütçesine uy: `low` kademede sadece (1), `high`'da (2).

**Kabul kriteri:** yan yana ekran görüntüsü (gölgeli/gölgesiz), fark gözle net.

---

## T-03 · Fit Skoru + Optik Ölçüm Raporu 🟡

**Kim:** A · **Dosya:** `packages/core/src/fit/` (yeni) · **Bağımlı:** T-01

B2B satışının **asıl argümanı.** Try-on eğlence, ölçüm para kazandırır.

```ts
type FitReport = {
  score: number;                  // 0..100
  verdict: 'too-narrow' | 'good' | 'too-wide';
  sizeSuggestion: -1 | 0 | 1;
  breakdown: {
    frameWidthVsFace, bridgeVsNose, templeLengthVsEar,
    lensHeightVsPupil, penetration, pantoscopicTilt, vertexDistance
  };
};
```

Ayrıca reçeteli lens siparişi için gereken 5 parametre — mağazada
optometristin yaptığı iş:

| Parametre | Hedef doğruluk |
|---|---|
| Monoküler PD (OD/OS ayrı) | ±1 mm |
| Segment height | ±1.5 mm |
| Vertex distance | ±1.5 mm |
| Pantoskopik açı | ±2° |
| Frame wrap | ±2° |

**Dikkat:** fit skoru **yumuşatılmalı/kilitlenmeli.** 78↔81 arası oynayan bir
skor güveni yok eder.

**Ağırlıklar tahminle bırakılmaz** — T-00'ın verisiyle kalibre edilir.

---

## T-04 · Saç Matting (Occlusion Tamamlama) 🟡

**Kim:** B · **Dosya:** `packages/core/src/perception/hair.ts` + render tarafı

Yüz mesh'i saçı içermez → uzun saçlı kullanıcıda sap saçın önünden geçer.
WP'de bile zayıf olan bir yer — gerçek fark yaratma fırsatı.

**Yaklaşım:** MediaPipe `ImageSegmenter`, `selfie_multiclass_256x256` modeli
(hazır `hair` sınıfı var, kendi U-Net'ini eğitme).

**Performans:** 4–8 ms — her karede sığmaz. `mid` kademede 3 karede bir
çalıştır, aradaki karelerde maskeyi kafa pozu delta'sıyla reproject et
(ekran uzayında affine warp yeterli). Maske kenarını 2–3 px feather'la,
aksi halde "makas" gibi görünür.

**Kabul kriteri:** uzun saçlı bir denekte sap saçın arkasında; FPS düşüşü
kademe bütçesi içinde.

---

## T-05 · Kart Kalibrasyonu 🟡

**Kim:** A · **Dosya:** `packages/core/src/metric/calibration.ts` · **Bağımlı:** T-00

Sistematik hatayı %3.5'ten ~%1'e düşürür.

ISO/IEC 7810 ID-1 kart (85.60 × 53.98 mm — her banka/kimlik kartı) alına
tutulur, aynı karede yüz ölçütleri gerçek mm'ye kalibre edilir, sonuç
kullanıcı profiline yazılır (bir kez, `localStorage`).

**Uygulama notu:** kartın 4 köşesini otomatik bulmak (contour + `approxPolyDP`)
yerine **kullanıcıya sürüklenebilir 4 tutamaç göster** — daha güvenilir ve
10× daha az kod.

**Kabul kriteri:** kalibrasyonlu ölçümde MAE < %1.5.

---

## T-06 · SH Işık Tahmini 🟢

**Kim:** B · **Dosya:** `packages/render/src/lighting.ts`

Sanal nesnenin ışığı sahneyle uyuşmazsa beyin anında yakalar. Yüz, albedosu
kabaca bilinen bir Lambert yüzeyi → ters render ile 2. derece küresel harmonik
(RGB başına 9 katsayı) görüntüden çıkarılabilir. Alın/yanak örneklerinden en
küçük kareler, zamansal olarak yavaş yumuşat (ışık ani değişmez).

Web'de yapan neredeyse yok. Orta maliyet, yüksek getiri.

---

## T-07 · Perception → Web Worker 🟢

**Kim:** A · **Tahmin:** 1 gün

`packages/core` bu amaçla DOM'suz yazıldı, taşıma hazır. Perception ana
thread'i bloklamamalı — render ile aynı karede yarışıyorlar.

`OffscreenCanvas` + `ImageBitmap` transfer. Kademe bütçesindeki
`perceptionHz` ayrımı ancak bundan sonra anlamlı olur.

---

## T-08 · Asset Pipeline CLI 🟢

**Kim:** B · **Dosya:** `packages/asset-cli/`

SaaS'ta **marjı belirleyen kalem.** SKU başına elle iş 20 dakikanın altına
inmezse 200 SKU'lu bir müşteri kârsızlaşır.

```
npx vto-asset build ./raw/sku-1234
```

Blender headless (`bpy`) + glTF-Transform: LOD (3 kademe), KTX2/Basis texture,
Draco/meshopt sıkıştırma.

**Doğrulama kapıları (hepsi CLI'da fail eder):**
- Anchor eksik/NaN mı?
- Üçgen sayısı ve texture boyutu bütçe içinde mi?
- Fiziksel ölçüler mesh geometrisiyle tutarlı mı (±1 mm)? ← *en sık hata*
- Menteşe eksenleri simetrik mi?
- Ölçek birimi metre mi? (Blender'dan cm/inç gelmesi klasik)

**Renk varyantları ayrı GLB değil** — tek mesh + malzeme override. 1 SKU × 6
renk = 1 indirme.

---

## T-09 · Gerçek SKU Kataloğu 🟢

**Kim:** B · **Bağımlı:** T-08

5–8 gerçek çerçeve. Parametrik model yerini alır ama arayüz
(`geometry + anchors`) aynı kalır.

---

## T-10 · Embed Widget + Lazy Load 🟢

**Kim:** A · **Dosya:** `packages/embed/`

```html
<script src="https://cdn.vto.io/v1/embed.js" data-tenant="pk_live_..." defer></script>
<glasses-tryon sku="RB2140-901" mode="modal" theme="dark"></glasses-tryon>
```

**Kritik kısıtlar:**
- **Shadow DOM zorunlu** — marka CSS'i widget'ı bozmasın (B2B destek
  biletlerinin en büyük kaynağı)
- **`embed.js` < 15 kB.** Şu an bundle 738 kB (three.js). Ağır motor yalnızca
  kullanıcı "Dene"ye bastığında yüklenmeli — marka sayfasının Core Web
  Vitals'ını bozmak ilk itiraz sebebi olur.
- Event API: `vto:ready`, `vto:fit`, `vto:measure`, `vto:capture`, `vto:error`

---

## T-11 · Backend / Multi-Tenant 🟢

**Kim:** A · **Dosya:** `apps/api/`

Cloudflare Workers + R2 + D1.

```
GET  /v1/tenant/:pk/config    → tema, aktif SKU listesi
GET  /v1/sku/:tenant/:sku     → imzalı R2 URL (kısa TTL)
POST /v1/events               → batch analytics (kamera verisi YOK)
```

Origin allowlist per `pk_live_*`. **Usage metering ilk günden yazılmalı** —
sonradan eklemek acı verir.

---

## Küçük İşler / Teknik Borç

| # | İş | Dosya |
|---|---|---|
| D-1 | FPS'i gerçek cihazlarda ölç, kademe bütçelerini gerçek sayılara göre ayarla | `capability.ts` |
| D-2 | `placeFrame()` kare başına ~10 `Vector3` tahsis ediyor — havuzla | `scene.ts` |
| D-3 | Playwright + fake camera stream ile regresyon testi | `test/e2e/` |
| D-4 | `?no3d=1` / `?cpu=1` teşhis anahtarlarını README'ye ekle | ✅ yapıldı |
| D-5 | Kamera cihaz seçici (birden fazla kamera olan makineler) | `main.ts` |
| D-6 | `bizygomatic` prior'ını T-00 verisiyle kalibre et | `anthropometry.ts` |
| D-7 | Occluder mesh'e göz/ağız delikleri — şu an göz kapağı gözlüğü kesebilir | `faceMesh.ts` |

---

## Görev Alma Akışı

1. GitHub'da issue aç (veya var olanı kendine ata)
2. Branch: `t01-contact-solver` gibi görev kodundan
3. `npm run typecheck && npx vitest run` yeşil olmadan PR açma
4. PR açıklamasına **kabul kriterinin nasıl doğrulandığını** yaz
   — görsel işlerde ekran görüntüsü/video şart, ben ekranı göremiyorum
