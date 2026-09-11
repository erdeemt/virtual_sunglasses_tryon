# Mimari — Sistem Nasıl Çalışıyor

Kod okumadan önce buradan başla. Özellikle **§2 Koordinat Uzayları** bölümünü
atlama — projedeki hataların çoğu oradan çıkıyor.

Stratejik plan: [../ROADMAP.md](../ROADMAP.md) · Görevler: [TASKS.md](TASKS.md)

---

## 1. Problem

Tarayıcıda, kullanıcının yüzüne gerçek zamanlı 3D gözlük yerleştirmek.
Warby Parker bunu iOS uygulamasında **TrueDepth** sensörüyle yapıyor: yüze
30.000 kızılötesi nokta atıp piksel başına **metrik** derinlik alıyor.

Bizde bu yok ve olamayacak:

- `getUserMedia` derinlik akışı vermiyor. TrueDepth tarayıcıya hiçbir yoldan açılmıyor.
- iOS Safari'de `immersive-ar` yok; ARKit yüz takibine WebXR'dan da erişilemiyor.
- Kamera intrinsics'i web'de güvenilir değil.

Elimizde sadece RGB kareler var.

### Ölçek-derinlik belirsizliği

```
u = f · X / Z
```

Gerçek boyut `X` ile mesafe `Z` çarpımsal eşleşir: uzaktaki büyük yüz ile
yakındaki küçük yüz aynı pikselleri üretir. Snapchat filtresi için sorun değil;
gözlük için felaket — çerçeve ölçüleri fiziksel olarak sabit (`49□21-145`), yanlış
ölçekte her çerçeve herkese "mükemmel" oturur ve ürün alışveriş aracı olmaktan çıkar.

Çözüm §3'te.

---

## 2. Koordinat Uzayları ⚠

**En sık hata kaynağı.** Beş uzay var, hepsi farklı birim.

| Uzay | Birim | Nerede üretilir |
|---|---|---|
| **Normalize (MediaPipe)** | birimsiz, x,y ∈ [0,1] | `FaceLandmarker` |
| **FaceUnits** | birimsiz, x ∈ [0, aspect] | `toFaceUnits()` |
| **Kamera (metrik)** | **mm**, kamera orijinde, −Z'ye bakar | `unprojectToMM()` |
| **Baş** | **mm**, orijin sellion, +x takanın solu, +y yukarı, +z yüzden dışarı | `buildHeadFrame()` + `toHead()` |
| **Model (çerçeve)** | **mm**, +x takanın solu, +y yukarı, +z yüzden dışarı, saplar −Z | `buildFrame()` / `normalizeFrame()` |

### Normalize → FaceUnits

MediaPipe `x`'i genişliğe, `y`'yi yüksekliğe böler. Düzeltilmezse 16:9 videoda
yatay mesafeler ~%44 küçük ölçülür — kod çalışır, sayılar sessizce yanlış çıkar.

```ts
{ x: p.x * aspect, y: p.y, z: p.z * aspect }
```

### FaceUnits → Kamera (mm)

Görüntünün dikey açıklığı `Z` uzaklığında `2·Z·tan(fov/2)` mm'dir; FaceUnits'te bu
açıklık 1 birim, ölçek füzyonu "1 birim = k mm" diyor. Dolayısıyla:

```
Z = k / (2·tan(fov/2))
```

**Metrik ölçek doğrudan kamera mesafesini verir** (k ≈ 630, fov 60° → ~55 cm).
Her landmark kendi derinliğinde geri-projekte edilir; round-trip testi hizalamanın
<10⁻⁵ px tuttuğunu kanıtlıyor. FOV varsayımı (60°) yanlışsa hizalama yine tam
kalır, sadece perspektif kısalması hafif hatalı olur.

### Kamera → Baş

Çözücü baş uzayında çalışır. Sebep: gözlüğün başa göre nasıl oturduğu (hangi
yükseklikte, ne kadar eğik) **anatomik bir sabittir**, kafa hareketiyle değişmez.
Bu yerel poz ağır filtrelenir; her karede değişen tek şey baş pozudur.

Baş çerçevesinde yalnızca iki işaret kuralı var: z kameraya bakar, y yukarı bakar;
x sağ-el kuralından türer. 234/454'ün hangisinin hangi tarafta olduğunu bilmeye
gerek kalmaz.

---

## 3. Metrik Ölçek Füzyonu

`packages/core/src/metric/`

Her antropometrik ipucu `i` için gerçek dünya prior'ı `N(μᵢ, σᵢ²)` ve gözlenen
mesafe `oᵢ` verildiğinde `sᵢ = μᵢ / oᵢ`. Birleştirme **GLS** ile:

```
k̂ = (1ᵀΣ⁻¹1)⁻¹ · 1ᵀΣ⁻¹s        Var(k̂) = (1ᵀΣ⁻¹1)⁻¹
```

| İpucu | μ (mm) | σ (mm) | CV |
|---|---|---|---|
| İris çapı (×2) | 11.7 | 0.5 | %4.3 |
| Pupiller mesafe | 63.0 | 3.6 | %5.7 |
| İç kantal | 32.0 | 2.5 | %7.8 |
| Yüz genişliği ⚠ proxy | 134.0 | 7.0 | %5.2 |

**Neden GLS:** iki iris ölçümü aynı büyüklüğün iki gözlemidir (r≈0.95). Naif
ters-varyans onları bağımsız sayıp belirsizliği √2 kat düşük gösterirdi.
`scale.test.ts` bunu kilitliyor.

**Teorik taban:** tam sette CV %3.49 → 63 mm PD'de ±2.20 mm. Bu prior kaynaklı
sistematik tabandır; daha çok kare toplamak düşürmez, kart kalibrasyonu düşürür.

Panelde iki belirsizlik ayrı gösterilir: `systematicCV` (prior) ve `stabilityCV`
(jitter). Frontallik kapısı (≥0.9) dönük karelerin ölçümünü dışarıda tutar.

---

## 4. Veri Akışı

```
kamera
  │
  ▼  @vto/engine — TryOnEngine.tick()
FaceLandmarker ──► 478 landmark ──► toFaceUnits ──► MetricEstimator ──► k (mm/birim)
                                         │                                   │
  HairSegmenter (N karede bir) ──► maske │                                   ▼
                                         ▼                            One Euro (ölçek)
                               TryOnScene.update(units, k)
                                 ├ unprojectToMM ──► metrik landmarklar + yüz mesh'i
                                 ├ buildHeadFrame ──► baş pozu (her kare)
                                 ├ solvePlacement ──► yerel poz (frontal karelerde)
                                 │     └ One Euro (ağır) ──► filtrelenmiş yerel poz
                                 ├ composePose ──► gözlük dünya pozu
                                 ├ kontak AO noktaları · saç düzlemi
                                 └ render (video arka plan + ortam + gölge)
                                         │
  LightEstimator (4 karede bir) ─────────┘
                                         ▼
                                  computeFit (4 Hz, medyan) ──► 'fit' olayı
```

Motor UI bilmez; `frame`, `fit`, `error`, `noface` olayları yayınlar. Geliştirme
paneli ve embed widget aynı motora abone — panelde görülen davranış müşterinin
göreceğiyle aynı.

Perception, çözücü ve render şu an **ana thread'de** (T-07).

---

## 5. Yerleştirme Çözücüsü

`packages/core/src/solver/placement.ts` · 22 test

### Fizik

Gerçek gözlük iki burun pedi ve iki kulak üstünde durur. Sürtünmesiz statik
yetersiz: pedler her yükseklikte buruna değebilir, yerçekimi çerçeveyi dibe
indirir. Gerçekte çerçeveyi silikon pedlerin sürtünmesi ve burnun iki yanına
kama gibi oturmaları tutar. Model üç terimli bir enerji:

```
E(h) = h + k·z(h) + λ·(h − h₀)²
```

| Terim | Anlamı |
|---|---|
| `h` | ped orta noktasının yüksekliği (sellion = 0) |
| `z(h)` | o yükseklikte çerçevenin yüze ne kadar yaklaşabildiği — bir şeye değene kadar itilir |
| `h + k·z` | yerçekimi aşağı, sap gerginliği yüze doğru |
| `λ(h − h₀)²` | sürtünme/kamanın yerine geçen anatomik prior: pedler pupil hizasının biraz altında durur |

Burun şekli çerçeveyi h₀'dan uzaklaştırır: burun hızla öne çıkıyorsa (yüksek
köprü) çerçeve yukarıda kalır; düz köprüde aşağı kayar ve kirpiğe ya da yanağa
değer — optisyenlerin bildiği "alçak köprü" problemi. **Sabit offset kullanan naif
yerleştirme bu farkı tamamen kaybeder** ve sahteliğin 1 numaralı sebebi budur.

İlk sürümde prior yoktu; testler yüksek köprüde bile çerçevenin arama aralığının
dibine kaydığını gösterdi — gerçek burunlar pedlerin olduğu yerde 45°'den dik
değil. Prior bu yüzden var.

### Sondalar

z(h), çerçevedeki sonda noktalarının her birinin ürettiği alt sınırların
maksimumu. Her sonda "önündeki yüzey + boşluk" kadar derinlik ister:

| Sonda | Kısıt | Destek sağlar mı |
|---|---|---|
| burun pedleri (2) | yüzeye temas | ✅ |
| köprü | burun sırtının 1.5 mm üstünde | ✅ |
| alt lens kenarı (6) | yanağın 2 mm önünde | ✅ |
| üst lens kenarı (4) | kaşın 2 mm önünde | ❌ |
| lens merkezi (2) | korneanın 10 mm önünde (vertex) | ❌ |

Kirpik ve kaş destek sağlamaz, sadece girişi engeller: kirpik kısıtı z'yi sabit
tutarken enerjinin h terimi çerçeveyi aşağı iter — pedler buruna değene kadar
kayar. Fiziksel olarak doğru.

Yüzey sorgusu (`HeadSurface.zAt`) −z yönünde ışın atıp en öndeki kesişimi bulur;
852 üçgen 4 mm'lik bir ızgaraya dağıtılır, sorgu başına ~10 üçgen. Çözüm ~1-3 ms.

### Serbestlik dereceleri

Simetri kısıtı yaw/roll'u başa kilitler, x ötelemesini sıfırlar. Kalan üç:
h ve z enerji minimumundan, pantoskopik açı θ sap uçlarını kulak üstü
yüksekliğine getirecek şekilde analitik olarak. İkisi bağlı; 2-4 iterasyonda
yakınsıyor.

Kulak üstü noktası MediaPipe mesh'inde **yok** (ARKit'te de yok) — 234/454'ten
antropometrik offset'le tahmin ediliyor.

### Dinlenme durumu

| Durum | Anlamı | Kullanıcıya |
|---|---|---|
| `nose` | pedler/köprü taşıyor | — |
| `rides-high` | köprü dar, çerçeve yukarıda | "sıkabilir" |
| `slides-low` | köprü geniş / alçak burun kökü | "ayarlanabilir ped" |
| `on-cheeks` | alt çerçeve yanakta | "alçak köprü uyumlu model" |
| `on-lashes` | lens kirpiğe yakın | — |

### Kalibrasyon

`k`, `λ`, `h₀` ve kulak offset'leri ampirik. Gerçek gözlük takan kişilerin
fotoğraflarıyla kalibre edilmeli (T-12). Testler **göreli** davranışları kanıtlıyor
(yüksek köprü > düz köprü, yüze girmiyor, kafa hareketinden bağımsız); mutlak
yüksekliği değil.

---

## 6. Render Katmanı

`packages/render/src/`

### Video WebGL arka planında

Video, sahnenin `background`'u olarak çiziliyor. Sebep: three.js lens
transmission'ı sahnenin **opak render'ını** örnekliyor — HTML video katmanını
göremez. Video sahneye girince lensler arkalarındaki gerçek görüntüyü kırıyor;
roadmap'teki screen-space refraction böylece bedavaya geldi.

### Ortam haritası

`RoomEnvironment` + PMREM. Olmadan metalik yüzeyler siyah görünür. Şiddeti ışık
tahmini ayarlıyor.

### Occlusion — "tek en kritik numara"

Yüz mesh'i renk yazmadan, derinlik yazarak çiziliyor (`renderOrder -3`).
Z-buffer sapları kafanın arkasında keser. Üçgenleme
`FACE_LANDMARKS_TESSELATION`'dan: 2556 bağlantı → 852 üçgen.

### Gölgeler

İki katman, ikisi de yüz geometrisini paylaşıyor:

1. **Shadow map alıcı** (`ShadowMaterial`): tahmini ana ışıktan çerçeve ve sap
   gölgesi. Işık yönü görüntüden tahmin edildiği için gerçek ışıkla tutarlı düşer.
2. **Kontak AO**: ped ve köprü temas noktalarında Gauss lekeleri. Shadow map
   çözünürlüğü bu kadar ince teması yakalamaz; "sticker" hissini asıl yok eden katman.

Yüzün kendi kendine gölgesi **kapalı** — video gerçek gölgeleri zaten içeriyor,
yoksa burnun altı çift kararır. Şeffaf lensler gölge düşürmez; güneş gözlüğü
lensleri düşürür (gerçekte de öyle).

### Saç occlusion'ı

Menteşe hattında, yüze paralel görünmez bir düzlem: saç maskesinin açık olduğu
piksellerde derinlik yazar, kapalı olduklarında atılır. Düzlemin gerisindeki
(saplar) saçın olduğu yerde gizlenir; önündeki ön çerçeve etkilenmez. Hiçbir
malzemeye dokunmadığı için her GLB ile çalışır.

Ekran koordinatı `gl_FragCoord`'dan değil projeksiyondan hesaplanıyor —
transmission pass'i farklı çözünürlükte bir hedefe çiziyor, `gl_FragCoord` orada
yanlış uv verirdi.

Model: `hair_segmenter.tflite` (781 KB; genel çok-sınıflı model 16 MB). Sınıf
indeksi modelin kendi etiketlerinden okunuyor.

**Sınır:** kulak arkasına toplanmış saç da maskede "saç" görünür ve sapı gizler.
Derinlik olmadan ayırt edilemiyor.

### Işık tahmini

Sağ/sol yanak ve alın/çene parlaklık farkı → ana ışık yönü; ortalama renk ÷ tipik
cilt albedosu → ışık rengi; ortalama parlaklık → şiddet. 64×36'lık küçültülmüş
karede, 4 karede bir, ~0.2 ms. Yanak noktaları doğrulanmış landmarklardan
geometrik olarak türetiliyor. Tam küresel harmonik çözümü (9 katsayı) sonraki adım.

### Kalite kademeleri

| Kademe | Gölge | Saç | Lens |
|---|---|---|---|
| high | 1024² shadow map | her kare | transmission |
| mid | 512² | 3 karede bir | transmission |
| low | kapalı | kapalı | basit şeffaf |

---

## 7. Fit ve Optik Ölçüm

`packages/core/src/solver/fit.ts`

Aynı çözücü temas noktalarını hesaplarken "bu çerçeve bu yüze oturuyor mu"
sorusunu da cevaplıyor:

| Bileşen | İdeal | Ağırlık |
|---|---|---|
| Çerçeve – yüz genişliği | −4…+8 mm | 0.30 |
| Pupilin lens içindeki yeri | %50…68 | 0.25 |
| Sap baskısı | ≤ 3 mm | 0.15 |
| Sap uzunluğu farkı ⚠ tahmini | −3…+8 mm | 0.12 |
| Pantoskopik açı ⚠ tahmini | 6…12° | 0.10 |
| Vertex mesafesi ⚠ tahmini | 11…15 mm | 0.08 |

Optik rapor: segment yüksekliği (OD/OS), vertex mesafesi, pantoskopik açı, yüz
formu açısı (GLB lenslerinden ölçülüyor). Monoküler PD ölçek tahmin edicisinden.

Skor 4 Hz'de, **filtrelenmiş** yerel poz üzerinden hesaplanıp son 12 ölçümün
medyanıyla raporlanıyor — 78↔81 arası oynayan bir skor güveni yok eder.

⚠ İdeal aralıklar ve ağırlıklar literatür başlangıç değerleri. T-00 verisiyle
kalibre edilmeden müşteriye "doğru fit" iddiası yapılmamalı.

---

## 8. GLB Yükleme

`packages/render/src/gltf.ts` · gerçek modelle uçtan uca test

İndirilen bir modelde ölçek, yönelim, orijin ve anchor'lar garanti değil.

- **Ölçek:** glTF spesifikasyonu metre der. `auto` modu buna güvenir; sonuç gözlük
  için makul değilse (100–200 mm dışı) kullanıcının girdiği ön genişliğe oturtur.
- **Yönelim:** en küçük açıklık = yukarı; aynalama simetrisi olmayan = ileri; sapların
  yönü uçlardaki kesit genişliğinden. Eksen eşleme matrisinin determinantı −1
  çıkarsa ileri ekseni ters çevrilir — yoksa model **aynalanırdı**.
- **Anchor'lar:** iki yol, her anchor bağımsız düşer:
  1. **İsimli parçalar** — e-ticaret modelleri parçaları adlandırır. Pedler gerçek
     ped geometrisinden, sap teması kıvrım başlangıcından, lens merkezi/ölçüleri ve
     yüz formu lens mesh'lerinden.
  2. **Heuristik** — isim yoksa gözlüğün kısıtlı şeklinden.

### İsimli parça sözleşmesi

Asset tedarikçilerine verilecek kural (düğüm ya da mesh adında geçmesi yeterli):

| Parça | Ad içinde |
|---|---|
| Burun pedleri | `nosepad`, `nose_pad`, `pad` |
| Saplar | `temple`, `earhook`, `arm` |
| Lensler | `lens`, `glass` |
| Ön çerçeve | `frame`, `rim`, `front`, `bridge` |

Sap teması "en geri nokta" değil **kıvrımın başladığı yer**: en geri nokta kulağın
arkasında aşağı sarkan kancanın ucu. İlk heuristik ön çerçevenin tepesini sap
tepesi sanıyordu — testler yakaladı.

---

## 9. Zamansal Filtreleme

One Euro filtresi (Casiez ve ark., 2012) — kesme frekansı hıza göre uyarlanıyor.

| Büyüklük | minCutoff | Neden |
|---|---|---|
| Ölçek k | 0.25 Hz | fiziksel sabit; oynarsa gözlük "nefes alır" |
| Yerel poz (h, z, θ) | 0.35 Hz | anatomik sabit |
| Görüntülenen PD | 0.6 Hz | okunabilirlik |
| Fit skoru | medyan (12) | güven |

Baş pozu filtrelenmiyor — MediaPipe'ın kendi takibi yeterince düzgün ve gecikme
kafa hareketinde hemen hissediliyor.

---

## 10. Motor ve Embed

**`@vto/engine`** tüm pipeline'ı tek sınıfta topluyor: `TryOnEngine.create()` →
`start()` → olaylar. Kamera açma mantığı (kademeli kısıt gevşetme, akış bırakma)
burada. Saç segmenter'ı opsiyonel — yüklenemezse ürün çalışmaya devam eder.

**`@vto/embed`** — `<glasses-tryon>`:

- **Shadow DOM:** markanın CSS'i widget'ı bozamaz.
- **Lazy load:** motoru statik import etmiyor. Build'de yükleyici 10.9 kB
  (gzip 4.2 kB); motor ayrı parça ve mağaza sayfasının statik bağımlılıklarında
  yok — ancak "Sanal Dene"ye basınca iniyor (build çıktısıyla doğrulandı).
- **Önce gizlilik:** kamera izni istenmeden önce görüntünün cihazdan çıkmadığı
  söyleniyor.
- **Kamera hemen bırakılır:** modal kapanınca. Açık kalan kamera ışığı güveni yok eder.
- **Fotoğraf:** WebGL tamponu kompozisyondan sonra silindiği için çizimle aynı
  görev içinde okunuyor ve kullanıcının gördüğü gibi aynalanıyor.

---

## 11. Paket Sorumlulukları

```
packages/core/           DOM'suz. capability.ts hariç window/document yok.
  perception/            landmark indeksleri, geometri, poz, simetri düzlemi
  metric/                antropometrik priorlar, GLS füzyonu, zamansal birikim
  solver/                baş çerçevesi, yüzey sorgusu, yerleştirme, fit
  filter/                One Euro

packages/render/         three.js
  camera.ts              geri-projeksiyon
  faceMesh.ts            depth-only occluder
  frameModel.ts          parametrik çerçeve + anchor'lar
  gltf.ts                GLB normalizasyonu + anchor türetimi
  glassesGeometry.ts     render çerçevesi → çözücü geometrisi
  contactShadow.ts       shadow map alıcı + kontak AO
  hairOccluder.ts        saç maskeli derinlik düzlemi
  lighting.ts            ışık tahmini
  scene.ts               sahne, yerleştirme uygulama, kalite kademeleri

packages/engine/         pipeline + kamera + saç segmenter'ı
packages/embed/          <glasses-tryon>
apps/demo/               panel (main.ts) + mağaza (shop.ts)
```

---

## 12. Tasarım İlkeleri

Keyfi tercih değil, her biri bir hatadan öğrenildi:

1. **İndeks konvansiyonuna değil geometriye güven.** Taraf ataması görüntü
   geometrisinden; baş çerçevesi işaret kurallarıyla; saç sınıfı modelin kendi
   etiketlerinden.
2. **`core` DOM'suz kalmalı** — worker'a taşınabilsin.
3. **Kanıtlanmamış sayı raporlanmaz.** Kalibre olmayan parametre UI'da
   "tahmini" etiketiyle görünür.
4. **Ölçek görünür olmalı.** Gözlük gerçek mm ölçüleriyle yerleştiriliyor.
5. **Render döngüsünde `throw` yok** — tek istisna saniyede 60 kez tekrarlanıp
   sekmeyi kilitliyordu.
6. **Kamera akışı serbest bırakılır** — yoksa Windows'ta kamera kilitleniyor.
7. **Anatomik sabitler baş pozundan ayrı tutulur.** Yerel poz ağır filtrelenir,
   baş pozu filtrelenmez; titremeyen fit skorunun sebebi bu.
8. **Aynalama yok.** Eksen dönüşümlerinin determinantı kontrol edilir; testler
   bunu işaretli hacimle kilitliyor ("sol solda kalsın" test edilemez — gözlük simetrik).

---

## 13. Gizlilik Mimarisi

**Kamera karesi hiçbir zaman ağa çıkmaz.** Tüm çıkarım cihazda. Widget olayları
yalnızca türetilmiş sayılar taşır.

- **KVKK:** biyometrik veri işleme büyük ölçüde kapsam dışı.
- **GDPR:** DPIA yükü hafifler.
- **BIPA:** "no biometric template stored or transmitted" ifadesi ABD'li müşterinin
  hukuk ekibinin ilk sorusunu cevaplar.

Demografi otomatik çıkarılmaz; kullanıcı beyan ederse prior daraltılır.

---

## 14. Bilinen Sınırlar

| Sınır | Etki | Plan |
|---|---|---|
| Çözücü parametreleri (k, λ, h₀) kalibre değil | mutlak oturma yüksekliği ±birkaç mm | T-12 |
| Fit aralıkları/ağırlıkları kalibre değil | skor göreli olarak anlamlı, mutlak değil | T-00 + T-12 |
| Kulak MediaPipe mesh'inde yok | pantoskopik açı ve sap uzunluğu tahmini | profil kalibrasyonu |
| MediaPipe z'si kalibre değil | vertex mesafesi tahmini | kabul |
| Kulak arkası saç | sap yanlışlıkla gizlenebilir | derinlik yok |
| Perception + çözücü + render ana thread'de | düşük cihazlarda FPS | T-07 |
| Işık tahmini tek yönlü | çok kaynaklı ışıkta basit | tam SH |
| Reçete lens simülasyonu yok | — | T-14 |

---

## 15. Doğrulama Durumu

| Ne | Durum | Kanıt |
|---|---|---|
| Ölçek füzyonu matematiği | ✅ | 15 test |
| Geri-projeksiyon hizalaması | ✅ | round-trip <10⁻⁵ px |
| Landmark indeksleri | ✅ | gözle denetim |
| Mesafe değişmezliği · cihazlar arası tutarlılık | ✅ | ölçüldü |
| Çözücü: temas, girmeme, burun şekline tepki, poz bağımsızlığı | ✅ | 22 test |
| Gerçek GLB × çözücü | ✅ | Khronos modeliyle entegrasyon testi |
| Embed lazy load | ✅ | build çıktısı |
| **Mutlak PD doğruluğu** | ❌ | **T-00** |
| Occlusion, gölge, saç, ışık, çözücü — **ekranda** | ❌ | T-13 görsel doğrulama turu |
| FPS bütçesi gerçek cihazda | ❌ | ölçülmedi |
