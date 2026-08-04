# Mimari — Sistem Nasıl Çalışıyor

Bu doküman sistemin nasıl çalıştığını açıklar. Kod okumadan önce buradan
başla; özellikle **§2 Koordinat Uzayları** bölümünü atlamadan oku — projedeki
hataların çoğu oradan çıkıyor.

Stratejik plan ve neden bu ürünü yaptığımız: [../ROADMAP.md](../ROADMAP.md)

---

## 1. Problem

Tarayıcıda, kullanıcının yüzüne gerçek zamanlı 3D gözlük yerleştirmek.
Warby Parker bunu iOS uygulamasında **TrueDepth** sensörüyle yapıyor: yüze
30.000 kızılötesi nokta atıp piksel başına **metrik** derinlik alıyor.

Bizde bu yok ve olamayacak:

- `getUserMedia` derinlik akışı vermiyor. TrueDepth verisi tarayıcıya
  hiçbir yoldan açılmıyor.
- iOS Safari'de `immersive-ar` WebXR oturumu desteklenmiyor, yani ARKit'in
  yüz takibine WebXR üzerinden de erişilemiyor.
- Kamera intrinsics (odak uzaklığı) web'de güvenilir değil; `MediaTrackSettings`
  çoğu cihazda boş döner.

Elimizde sadece RGB kareler var.

### Neden bu zor: ölçek-derinlik belirsizliği

Perspektif projeksiyonda gözlemlenen şey:

```
u = f · X / Z
```

Gerçek boyut `X` ile mesafe `Z` **çarpımsal** olarak eşleşir. Uzaktaki büyük
yüz ile yakındaki küçük yüz piksel piksel aynı görüntüyü üretir. Tek bir RGB
kameradan mutlak ölçek gözlemlenemez.

Snapchat filtresi için sorun değil — köpek kulağı yüzün oranında ölçeklenir.
Gözlük için felaket:

- Gerçek çerçevenin fiziksel ölçüleri sabittir (`49□21-145` — lens 49 mm,
  köprü 21 mm, sap 145 mm)
- Kullanıcının yüz genişliği 130 mm mi 148 mm mi, çerçevenin nasıl duracağını
  tamamen değiştirir
- Yanlış ölçekte render edilirse **her çerçeve herkese mükemmel oturur**, ki
  bu bir alışveriş aracı olarak ürünü değersizleştirir

**Bu projenin çekirdek fikri: ölçeği antropometrik priorlardan istatistiksel
olarak çözmek.** Detay §3'te.

---

## 2. Koordinat Uzayları ⚠

**Buradaki karışıklık en sık hata kaynağı.** Dört ayrı uzay var, dördü de
farklı birim kullanıyor.

| Uzay | Birim | Aralık | Nerede üretilir |
|---|---|---|---|
| **Normalize (MediaPipe)** | birimsiz | x,y ∈ [0,1]; z ≈ x ölçeğinde | `FaceLandmarker` çıktısı |
| **FaceUnits** | birimsiz | x ∈ [0, aspect]; y ∈ [0,1] | `toFaceUnits()` |
| **Metrik dünya** | **milimetre** | kamera orijinde, -Z'ye bakar | `unprojectToMM()` |
| **Canvas pikseli** | piksel | [0, w] × [0, h] | `overlay.ts::project()` |

### Normalize → FaceUnits

MediaPipe `x`'i görüntü **genişliğine**, `y`'yi **yüksekliğe** böler. Kare
olmayan videoda x ve y farklı ölçektedir.

```ts
// packages/core/src/perception/geometry.ts
{ x: p.x * aspect, y: p.y, z: p.z * aspect }
```

**Bu düzeltme yapılmazsa 16:9 videoda yatay mesafeler ~%44 küçük ölçülür.**
Sessiz ve ölümcül bir hata — kod çalışır, sayılar yanlış çıkar. Ölçüm yapan
her fonksiyon FaceUnits bekler, ham normalize landmark değil.

### FaceUnits → Metrik dünya

`unprojectToMM()` yapıyor. Türetimi:

Görüntünün dikey açıklığı `Z` uzaklığında `2·Z·tan(fov/2)` mm'dir. FaceUnits
tanımı gereği bu açıklık tam olarak **1 birimdir** ve ölçek füzyonu
"1 birim = k mm" demiştir. Dolayısıyla:

```
k = 2·Z·tan(fov/2)   →   Z = k / (2·tan(fov/2))
```

Yani **metrik ölçek doğrudan kamera mesafesini verir.** Tipik değerlerle
(k ≈ 630 mm/birim, fov 60°) Z ≈ 545 mm çıkıyor — bir webcam mesafesi olarak
makul. Bu, ölçek füzyonunun fiziksel tutarlılığının bedava bir kontrolü ve
demo panelinde gösteriliyor.

Her landmark **kendi derinliğinde** geri-projekte edilir:

```ts
depth = Z + (p.z - zMean) * k
ratio = depth / Z
X = (p.x - aspect/2) * k * ratio
Y = -(p.y - 0.5)     * k * ratio
Z_world = -depth
```

`ratio` çarpanı olmasaydı tek düzlem varsayılırdı ve burun ucunda ~%5 hata
kalırdı.

**Bu dönüşümün garantisi:** metrik noktalar kameradan tekrar projekte
edildiğinde orijinal piksel konumlarını verir. `camera.test.ts` içindeki
"round-trip" testi bunu kanıtlıyor (hata < 10⁻⁵ piksel, kalanı float32
hassasiyeti). Bu garanti olmadan occlusion kayardı.

### FOV varsayımı yanlışsa ne olur?

Kamera FOV'unu bilmiyoruz, 60° varsayıyoruz. Varsayım yanlışsa:

- ✅ Yüz mesh'i görüntüye **hâlâ tam oturur** — geri-projeksiyon gözlenen
  piksel konumunu korur
- ❌ Sahnenin derinlik ölçeği yanlış olur, yani gözlüğün perspektif kısalması
  hafif hatalı görünür

Yani hizalama hatası değil, görsel hata. Kabul edilebilir.

---

## 3. Metrik Ölçek Füzyonu

Ürünün çekirdeği. `packages/core/src/metric/`

### Fikir

`FaceLandmarker` kanonik (sabit boyutlu) bir yüz modeli kullanır — **oranlar**
doğrudur, **mutlak boyut** varsayımdır. Bize gereken tek skaler:

```
k = gerçek yüz boyutu / gözlenen boyut   [mm / FaceUnit]
```

Her antropometrik ipucu `i` için, gerçek dünya prior'ı `N(μᵢ, σᵢ²)` ve
gözlenen mesafe `oᵢ` verildiğinde:

```
sᵢ = μᵢ / oᵢ            σ_{sᵢ} = σᵢ / oᵢ
```

### Priorlar

| İpucu | μ (mm) | σ (mm) | CV | Not |
|---|---|---|---|---|
| İris çapı (×2) | 11.7 | 0.5 | %4.3 | En stabil. Yaş/etnisiteden neredeyse bağımsız |
| Pupiller mesafe | 63.0 | 3.6 | %5.7 | Cinsiyet beyan edilirse daralır |
| İç kantal mesafe | 32.0 | 2.5 | %7.8 | Zayıf ama görece bağımsız |
| Yüz genişliği | 134.0 | 7.0 | %5.2 | ⚠ Gerçek zygion değil, yüz ovali proxy'si |

### Neden GLS, neden basit ağırlıklı ortalama değil

İpuçları **korelelidir**. İki iris ölçümü aynı büyüklüğün iki gözlemidir
(r ≈ 0.95). Naif ters-varyans ağırlıklandırma bunları bağımsız sayar ve
belirsizliği √2 kat düşük gösterir — yani "±2 mm" iddiamız yalan olur.

Genelleştirilmiş en küçük kareler kovaryansı hesaba katar:

```
k̂ = (1ᵀΣ⁻¹1)⁻¹ · 1ᵀΣ⁻¹s        Var(k̂) = (1ᵀΣ⁻¹1)⁻¹
```

`scale.test.ts` bunu kilitliyor: iki iris eklemek CV'yi %4.27'den yalnızca
%4.22'ye düşürüyor. Bağımsız olsalardı %3.02'ye düşerdi.

Bazı ağırlıklar **negatif** çıkabilir (iç kantal mesafe ≈ -%1.4). Bu GLS'de
normaldir — o ipucu bağımsız bilgi katmıyor, diğerlerinin ortak hatasını
düzelten bir terime dönüşüyor.

### Ölçülen doğruluk tabanı

Birim testlerinden (teorik, prior kaynaklı):

| İpucu seti | CV | 63 mm PD'de |
|---|---|---|
| Sadece PD | %5.71 | ±3.60 mm |
| Sadece iris | %4.27 | ±2.69 mm |
| İris + PD | %3.73 | ±2.35 mm |
| **Tam set (5 ipucu)** | **%3.49** | **±2.20 mm** |

### İki farklı belirsizlik — karıştırma

Panelde ayrı gösteriliyor çünkü farklı şeyler ve farklı çözümleri var:

- **`systematicCV`** — priorlardan gelir. **Daha çok kare toplamak bunu
  düşürmez.** Yalnızca kart kalibrasyonu (henüz yapılmadı) düşürür.
- **`stabilityCV`** — kare-kare oynaklık. Örnek biriktirmek düşürür.

İkisini tek sayıya karıştırmak kalibrasyonun neden gerektiğini gizler.

### Frontallik kapısı

Yüz döndüğünde antropometrik mesafeler perspektif nedeniyle kısalır ve ölçek
bozulur. `MetricEstimator` yalnızca `frontality ≥ 0.9` olan kareleri kabul
eder (kabaca ±18° yaw/pitch). Kabul edilenler bir halka tamponda birikir,
sonuç **medyan** ile raporlanır (aykırı karelere dayanıklı).

---

## 4. Veri Akışı

```
kamera karesi (video element)
        │
        ▼
FaceLandmarker.detectForVideo()        ~3-8 ms
        │  478 normalize landmark
        ▼
toFaceUnits(raw, aspect)               en-boy düzeltmesi
        │  FaceUnits
        ├─────────────────────────────────────────┐
        ▼                                         ▼
MetricEstimator.update()               TryOnScene.update()
  ├ extractFrameGeometry()               ├ unprojectToMM()  → mm dünya
  │   ├ faceBasis()                      ├ FaceOccluder.update()
  │   ├ headPose() → frontallik          │    (depth-only pass)
  │   ├ symmetryPlane()                  └ placeFrame()
  │   └ 5 ölçek ipucu                          (naif — Gün 10-11'de değişecek)
  ├ fuseScale()  → k (mm/birim)                │
  └ zamansal birikim → mm ölçümler             ▼
        │                                 WebGLRenderer.render()
        ▼
    panel / overlay
```

Perception ve render **aynı** karede çalışıyor (ana thread). Roadmap worker'a
taşımayı öngörüyor; `packages/core` DOM'suz yazıldığı için hazır ama
yapılmadı — bkz. [TASKS.md](TASKS.md).

---

## 5. Occlusion — "tek en kritik numara"

Yüz mesh'i **renk yazmadan, derinlik yazarak** render edilir:

```ts
new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })
mesh.renderOrder = -1   // gözlükten önce çiz
```

Z-buffer böylece gözlük saplarını kafanın arkasında keser. Bu yapılmadığında
gözlük yüzün "üstünde yüzer" ve hiçbir PBR kalitesi bunu kurtarmaz.

Üçgenleme `FaceLandmarker.FACE_LANDMARKS_TESSELATION` sabitinden türetiliyor:
2556 bağlantı, ardışık her 3'ü kapalı bir üçgen → **852 üçgen**. Repoya dev
bir indeks dizisi gömmeye gerek yok.

Mesh yalnızca ilk **468** noktayı kapsar; iris (468-477) tesselation'da yok.

**Eksik:** saç. Yüz mesh'i saçı içermez, dolayısıyla uzun saçlı kullanıcıda sap
saçın önünden geçer. Çözüm `ImageSegmenter` hair maskesi — henüz yapılmadı.

---

## 6. Yerleştirme (şu an naif)

`TryOnScene.placeFrame()`:

1. Yüz bazını **metrik uzayda** yeniden hesapla (FaceUnits bazı geri-projeksiyon
   sonrası geçerli değil)
2. Çerçeveyi burun kökü landmark'ına oturt
3. Sabit 13 mm vertex mesafesi kadar öne al

**Bu sahte görünür ve bilinçli bir geçici çözümdür.** Gerçek gözlük üç noktada
durur: burun sırtı + iki kulak üstü. Burun köprüsü açısı kişiden kişiye
değiştiği için **aynı çerçeve farklı yüzlerde farklı yükseklikte oturmalı.**
Sabit offset bunu tamamen kaybeder — sahtelik hissinin 1 numaralı sebebi budur.

Temas-kısıtlı çözücü [TASKS.md](TASKS.md) → T-01.

---

## 7. Zamansal Filtreleme

Landmark tahmini kare başına gürültülüdür; ham poz kullanılırsa gözlük titrer.

**One Euro filter** (Casiez ve ark., 2012) — kesme frekansını hıza göre uyarlar:

```
f_c = f_c_min + β·|ẋ̂|
```

Yavaş harekette çok yumuşatır (titreme gider), hızlı harekette az yumuşatır
(gecikme olmaz). Kalman'a üstünlüğü ayarının kolay olması.

Ölçek **çok daha agresif** filtrelenir (`minCutoff: 0.25`) çünkü fiziksel
olarak sabit bir büyüklüktür — kişinin yüzü değişmiyor. Ölçek kare kare
oynarsa gözlük "nefes alıyormuş" gibi büyüyüp küçülür ki bu poz titremesinden
çok daha rahatsız edicidir.

---

## 8. Paket Sorumlulukları

```
packages/core/           DOM'suz. capability.ts hariç hiçbir yerde window/document yok.
  perception/            landmark indeksleri, geometri, poz, simetri düzlemi
  metric/                antropometrik priorlar, GLS füzyonu, zamansal birikim
  filter/                One Euro
  capability.ts          cihaz yetenek tespiti (tek DOM'lu dosya)

packages/render/         three.js. Sahne, occluder, parametrik çerçeve, kamera modeli.
  camera.ts              geri-projeksiyon matematiği
  faceMesh.ts            depth-only occluder
  frameModel.ts          parametrik gözlük + semantik anchor'lar
  scene.ts               sahne kurulumu ve yerleştirme

apps/demo/               doğrulama arayüzü (ürün değil, geliştirme aracı)
  main.ts                döngü, hata yönetimi, kamera
  overlay.ts             2D landmark çizimi
  audit.ts               landmark denetim modu
  study.ts               doğruluk çalışması kaydı

scripts/setup-assets.mjs WASM + model indirme
```

### Çerçeve neden parametrik, indirilen GLB değil

Temas-kısıtlı çözücü **semantik anchor** noktalarına ihtiyaç duyuyor: burun
pedi temas düzlemi, menteşe ekseni, sap ucu eğrisi, lens düzlemi. İndirilen
bir modelde bunlar yoktur ve elle işaretlemek gerekir.

Parametrik model bunları **tanım gereği** verir, üstelik ölçüleri tam bilinir
— çözücüyü bilinen bir gerçeğe karşı test edebiliyoruz. Gerçek SKU'lar asset
pipeline ile gelecek; arayüz (`geometry + anchors`) aynı kalacak.

---

## 9. Tasarım İlkeleri

Bunlar keyfi tercih değil, her biri bir hatadan öğrenildi:

**1. İndeks konvansiyonuna değil geometriye güven.**
MediaPipe'ın sol/sağ adlandırması kaynaklarda tutarsız belgeleniyor. Bunun
yerine: kameraya bakan kişinin sağ tarafı aynalanmamış görüntüde solda görünür
→ OD/OS bundan türetiliyor. Aynı ilke yüz bazının işaretinde de uygulanıyor
(`scene.ts` içinde `z.z < 0` ve `x.x < 0` kontrolleri).

**2. `core` DOM'suz kalmalı.**
Worker'a taşınabilmesi için. `capability.ts` tek istisna ve orada kalmalı.

**3. Kanıtlanmamış sayı raporlanmaz.**
Landmark indeksleri denetim modunda gözle doğrulanmadan `verified: true`
yapılmaz. "±2 mm" iddiası ölçülmeden yazılmaz.

**4. Ölçek görünür olmalı.**
Gözlük gerçek mm ölçüleriyle yerleştiriliyor. Ölçek yanlışsa çerçeve orantısız
durur — yani metrik doğruluk soyut bir sayı değil, gözle görülür bir şey.

**5. Render döngüsünde `throw` yok.**
`requestAnimationFrame` en başta çağrıldığı için bir istisna döngüyü
durdurmaz; saniyede 60 hata sekmeyi kilitler ve kullanıcıya "çökme" olarak
görünür. Hatalar yakalanıp `showFatal()` ile bir kez gösterilir.

**6. Kamera akışı serbest bırakılır.**
`pagehide`/`beforeunload` üzerinde track'ler durdurulur. Yapılmazsa her
yenileme bir akış sızdırır ve Windows'ta kamera kilitlenir.

---

## 10. Gizlilik Mimarisi

**Kamera karesi hiçbir zaman ağa çıkmaz.** Tüm çıkarım (yüz mesh, iris,
ileride saç maskesi) cihazda yapılır. Sunucuya yalnızca anonim event'ler ve
türetilmiş sayılar gidebilir.

Sonuçları:

- **KVKK:** Yüz görüntüsünden biyometrik veri işleme büyük ölçüde kapsam dışı
  kalır — görüntü işlenip anında atılır, aktarılmaz, saklanmaz.
- **GDPR:** DPIA yükü hafifler, alt-işleyen zinciri yok.
- **BIPA (Illinois):** "No biometric template stored or transmitted" ifadesi
  ABD'li müşterinin hukuk ekibinin ilk sorusunu doğrudan cevaplar.

Bu mimari kararı B2B satışta en güçlü kozumuz. **Bozacak hiçbir değişiklik
tartışmasız reddedilir.**

Demografi (cinsiyet/etnisite) **otomatik çıkarılmaz** — KVKK'da özel nitelikli
veri ve bias riski taşır. Kullanıcı isteğe bağlı beyan ederse prior daraltılır.

---

## 11. Bilinen Sınırlar

| Sınır | Etki | Plan |
|---|---|---|
| MediaPipe z'si mutlak kalibre değil | Derinlik profili yaklaşık; x-y hizalaması tam | Kabul ediliyor |
| Kamera FOV'u 60° varsayılıyor | Perspektif kısalması hafif hatalı | Kabul ediliyor |
| Yüz mesh'i kulakları içermiyor | Kulak teması tahmin edilecek | Profil kalibrasyonu (opsiyonel) |
| Saç occlusion'ı yok | Uzun saçta sap saçın önünden geçer | `ImageSegmenter` — T-04 |
| Perception ana thread'de | Render ile aynı karede yarışıyor | Worker'a taşı — T-07 |
| Bundle 738 kB | Embed widget için çok büyük | Lazy load — T-10 |
| `bizygomatic` prior'ı proxy ölçüyor | Sistematik bias olabilir | Gün 5 ölçümüyle kalibre |

---

## 12. Doğrulama Durumu

| Ne | Durum | Kanıt |
|---|---|---|
| Ölçek füzyonu matematiği | ✅ | 15 birim testi |
| Geri-projeksiyon hizalaması | ✅ | round-trip testi, <10⁻⁵ px |
| Landmark indeksleri | ✅ | denetim modunda gözle |
| Mesafe değişmezliği | ✅ | 30↔80 cm'de PD ±1.5 mm |
| Cihazlar arası tutarlılık | ✅ | PC 61 mm / telefon 62 mm |
| **Mutlak doğruluk (PD)** | ❌ | **Gün 5 kapısı — açık** |
| Occlusion (görsel) | ❌ | ekranda doğrulanmadı |
| FPS bütçesi | ❌ | gerçek cihazda ölçülmedi |
