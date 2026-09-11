# Görevler ve İş Bölümü

İki kişilik ekip. Görevler **çakışmayacak şekilde** paketlere ayrıldı.

Strateji: [../ROADMAP.md](../ROADMAP.md) · Sistem: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## İş Bölümü

| Alan | Paketler | Kim |
|---|---|---|
| **Algılama, ölçek, çözücü, motor** | `packages/core`, `packages/engine` | A |
| **Render, görsel ayar, asset** | `packages/render`, `packages/asset-cli` (yok) | B |
| **Widget & backend** | `packages/embed`, `apps/api` (yok) | A |
| **Demo** | `apps/demo` | ortak |

**Kural:** görev almadan önce issue'yu kendine ata. `core` ve `render` aynı anda iki
kişi tarafından değiştirilmemeli.

---

## Durum Özeti

| # | Görev | Durum |
|---|---|---|
| T-00 | Gerçek PD ile doğruluk ölçümü | 🔴 **açık — bloke ediyor** |
| T-01 | Temas-kısıtlı yerleştirme çözücüsü | ✅ kod · ⚠ görsel doğrulama (T-13) · kalibrasyon (T-12) |
| T-02 | Temas gölgesi | ✅ kod · ⚠ görsel ayar |
| T-03 | Fit skoru + optik ölçüm raporu | ✅ kod · ⚠ kalibrasyon |
| T-04 | Saç occlusion'ı | ✅ kod · ⚠ görsel |
| T-05 | Kart kalibrasyonu | ⏳ |
| T-06 | Işık tahmini | 🟡 yön/renk/şiddet ✅ · tam SH ⏳ |
| T-07 | Perception → Web Worker | ⏳ (artık daha önemli: saç + çözücü de ana thread'de) |
| T-08 | Asset pipeline CLI | ⏳ · isimli parça sözleşmesi ara çözüm olarak ✅ |
| T-09 | Gerçek SKU kataloğu | ⏳ · yalnızca demo modeli var |
| T-10 | Embed widget | ✅ · CDN kütüphane build'i ⏳ |
| T-11 | Backend / multi-tenant | ⏳ |
| T-12 | Çözücü parametre kalibrasyonu | ⏳ **yeni** |
| T-13 | Görsel doğrulama turu | ⏳ **yeni — sıradaki iş** |
| T-14 | Reçete lens simülasyonu | ⏳ |
| T-15 | Playwright uçtan uca testler | ⏳ |

---

## T-13 · Görsel Doğrulama Turu 🔴 SIRADAKİ

**Kim:** ikisi de, farklı cihazlarda · **Kod yok**, gözlem

Bugün yazılanların hepsi testlerle doğrulandı ama **hiçbiri ekranda görülmedi.**
Paneli aç, her madde için ekran görüntüsü al, issue'ya ekle:

| # | Kontrol | Nasıl | Beklenen |
|---|---|---|---|
| 1 | Çözücü aktif | Panel → "Yerleşim" | "temas çözücüsü" (yedek değil) |
| 2 | Oturma yüksekliği | gerçek gözlüğünle karşılaştır | pupil lensin üst yarısında, lens gözün üstünde değil |
| 3 | Burun şekline tepki | iki farklı burunlu kişi | ped yüksekliği farklı olmalı |
| 4 | Occlusion | başı 45° çevir | sap kulağın arkasına geçer |
| 5 | Saç | uzun saçlı denek | sap saçın arkasında |
| 6 | Kontak gölgesi | "Gölgeler" aç/kapat | ped altında koyu leke, gözlük "yapışkan" durmaz |
| 7 | Işık | yandan lamba | çerçeve gölgesi ışığın karşısına düşer |
| 8 | Lens kırılması | Khronos modeli | lens arkasındaki yüz koyu tonlu görünür, siyah değil |
| 9 | Kararlılık | kafayı yavaş salla | gözlük kaymaz, nefes almaz |
| 10 | Fit skoru | 30 sn bekle | ±2'den fazla oynamaz |
| 11 | FPS | panel üstü | high kademe ≥ 30, mid ≥ 24 |
| 12 | Mağaza | `/shop.html` | 4 ürün, "Sanal Dene" açılır, olay günlüğü dolar |
| 13 | Lazy load | Ağ sekmesi, mağaza açılışı | three.js/MediaPipe inmez; "Sanal Dene"de iner |

Başarısız olan her madde bir bug issue'su olur.

---

## T-00 · Gerçek PD Ölçümü 🔴 BLOKE EDİYOR

**Kim:** ikisi de · **Kod yok**

"±2 mm" iddiası kanıtlanmadı. Bu kapı geçilmeden doğruluk iddiası hiçbir yerde
(pitch deck, müşteri görüşmesi, README) yazılmamalı.

1. En az 3 kişi, farklı yüz tipleri (dar/geniş, kadın/erkek, gözlüklü/gözlüksüz)
2. Gerçek PD: optik sipariş kaydı · cetvel+ayna (±1–2 mm) · dijital pupilometre
3. Panel → "Doğruluk Çalışması" → denek kodu + gerçek PD → Kaydet → JSON İndir
4. `docs/accuracy-report.md` olarak özetle

**Karar:** MAE < %4 → devam · MAE > %4 → T-05 zorunlu · **bias** > 2 mm →
`anthropometry.ts` prior'ları kaydır (özellikle `bizygomatic`, proxy ölçüyor).

---

## T-12 · Çözücü Parametre Kalibrasyonu 🟡

**Kim:** A · **Dosya:** `packages/core/src/solver/placement.ts` · **Bağımlı:** T-13

Çözücünün ampirik parametreleri:

| Parametre | Varsayılan | Anlamı |
|---|---|---|
| `templePull` (k) | 1.0 | sap gerginliği / yerçekimi |
| `restPrior` (λ) | 0.06 | burun şekli ne kadar etkili (küçük = daha etkili) |
| `padRestBelowPupil` (h₀) | 2 mm | pedlerin pupil hattına göre yeri |
| `earAboveOval` / `earBehindOval` | 10 / 30 mm | kulak üstü temas tahmini |

**Yöntem:** 10+ kişinin **gerçek gözlükle** önden fotoğrafı. Her fotoğrafta pupil
ile lens alt kenarı arası piksel → ölçekle mm. Aynı kişi aynı çerçeve ölçüsüyle
panelde → çözücünün segment yüksekliği. Farkın ortalamasını h₀ ile, burun
tiplerine göre dağılımını λ ile kapat.

**Kabul:** 10 kişide segment yüksekliği MAE < 3 mm.

---

## T-03 devamı · Fit Kalibrasyonu 🟡

**Kim:** A · **Bağımlı:** T-00, T-12

`fit.ts` içindeki ideal aralıklar ve ağırlıklar literatür başlangıcı. T-00 ve
T-12 verisiyle: optisyenin "uygun / dar / geniş" dediği çerçevelerle skorun
uyuşmasını ölç. Uyuşma < %80 ise aralıkları ayarla.

---

## T-05 · Kart Kalibrasyonu 🟡

**Kim:** A · **Dosya:** `packages/core/src/metric/calibration.ts`

Sistematik hatayı %3.5'ten ~%1'e düşürür. ISO/IEC 7810 ID-1 kart (85.60 × 53.98 mm)
alına tutulur, sonuç profile yazılır. Köşeleri otomatik bulmak yerine
**sürüklenebilir 4 tutamaç** — daha güvenilir, 10× az kod.

**Kabul:** kalibrasyonlu MAE < %1.5.

---

## T-07 · Web Worker 🟡

**Kim:** A · **Tahmin:** 1–2 gün

Şu an ana thread'de: FaceLandmarker (3–8 ms) + saç (4–8 ms, N karede bir) +
çözücü (1–3 ms) + render. `core` DOM'suz yazıldı, taşıma hazır. `OffscreenCanvas`
+ `ImageBitmap` transfer. Saç ve landmarker aynı worker'da.

---

## T-08 · Asset Pipeline CLI 🟢

**Kim:** B · **Dosya:** `packages/asset-cli/`

SaaS'ta **marjı belirleyen kalem** — SKU başına iş 20 dakikanın altına inmeli.

Ara çözüm var: **isimli parça sözleşmesi** (ARCHITECTURE §8). Tedarikçiden gelen
GLB'de düğüm adları `nosepad` / `temple` / `earhook` / `lens` / `frame` içeriyorsa
anchor'lar gerçek geometriden çıkıyor — Khronos modelinde 9/9 anchor'un çoğu böyle.

CLI'ın işi: bu sözleşmeyi doğrulamak + LOD + KTX2 + ölçü tutarlılığı kontrolü
(`49□21-145` ↔ mesh ±1 mm) + manifest.

---

## T-10 devamı · CDN Kütüphane Build'i 🟢

**Kim:** A

`<glasses-tryon>` çalışıyor ama şu an demo uygulamasının parçası olarak derleniyor.
Gerekli: `vite build --lib` ile bağımsız `embed.js` + motor parçası, sürümlü CDN
yolu (`/v1/`), `asset-base`'in CDN'e varsayılanı, tenant anahtarı niteliği.

---

## T-11 · Backend 🟢

**Kim:** A · Cloudflare Workers + R2 + D1

```
GET  /v1/tenant/:pk/config    tema, aktif SKU listesi
GET  /v1/sku/:tenant/:sku     imzalı R2 URL (kısa TTL)
POST /v1/events               batch analitik — kamera verisi YOK
```

Origin allowlist per `pk_live_*`. Usage metering ilk günden.

---

## T-14 · Reçete Lens Simülasyonu 🟢

**Kim:** B · **Dosya:** `packages/render/src/lens.ts`

Rakiplerde olmayan fark: diyoptri girilince spectacle magnification
(`SM ≈ 1/(1 − d·F)`) ile göz küçülür/büyür, minus lenste kenar kalınlaşır, 1.50 vs
1.74 indeks yan yana → doğrudan upsell aracı. Transmission altyapısı artık hazır
(video WebGL'de).

---

## T-15 · Playwright Uçtan Uca 🟢

**Kim:** B

`--use-file-for-fake-video-capture` ile sabit video → regresyon: FPS, çözücü
durumu, fit skoru kararlılığı, mağaza lazy load'u (ağ isteklerinde three.js yok).

---

## Küçük İşler

| # | İş | Dosya |
|---|---|---|
| D-1 | Kademe bütçelerini gerçek FPS ölçümüyle ayarla | `capability.ts` |
| D-2 | `placeNaive` ve anchor dönüşümlerinde kare başına `Vector3` tahsisi | `scene.ts` |
| D-5 | Kamera cihaz seçici | `engine/camera.ts` |
| D-7 | Occluder'da göz/ağız delikleri — göz kapağı lensi kesebilir | `faceMesh.ts` |
| D-8 | Parametrik çerçeveye görünür burun pedi geometrisi | `frameModel.ts` |
| D-9 | Saç maskesini karelar arasında poz deltasıyla reproject et | `hairOccluder.ts` |
| D-10 | Gölge bias/opaklık değerlerini görsel olarak ayarla | `scene.ts`, `contactShadow.ts` |

---

## Görev Alma Akışı

1. Issue aç ya da kendine ata
2. Branch: `t12-solver-calibration` gibi
3. `npm run typecheck && npx vitest run` yeşil olmadan PR açma
4. PR'da kabul kriterinin nasıl doğrulandığı — **görsel işlerde ekran görüntüsü şart**
