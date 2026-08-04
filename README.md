# VTO — Tarayıcıda Gözlük Deneme

Platform-aware, tarayıcıda çalışan gerçek zamanlı 3D gözlük deneme sistemi.
B2B SaaS olarak paketlenecek: markalar siteye tek `<script>` ile gömer.

**Ayırt edici iddia:** uygulama kurulumu olmadan, tek RGB kameradan
**milimetre doğruluğunda** yüz ölçümü. Warby Parker bunu iOS'ta TrueDepth
donanımıyla yapıyor; biz tarayıcıda, istatistiksel olarak çözüyoruz.

```
┌─ Kurulum ────────────────────────────────────────┐
│  npm install                                     │
│  npm run setup      # WASM + model (~3.6 MB)     │
│  npm run dev        # https://localhost:5173     │
└──────────────────────────────────────────────────┘
```

---

## Dokümanlar

| Doküman | Ne için |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **Sistem nasıl çalışıyor** — koordinat uzayları, ölçek matematiği, occlusion. Kod okumadan önce buradan başla. |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Çalışma kuralları, kod konvansiyonları, sorun giderme, sözlük |
| [docs/TASKS.md](docs/TASKS.md) | Görev listesi ve iş bölümü |
| [ROADMAP.md](ROADMAP.md) | Ürün stratejisi, rakip analizi, 28 günlük plan |

---

## Durum

| Aşama | Durum |
|---|---|
| Cihaz yetenek tespiti, kamera, HTTPS | ✅ |
| MediaPipe FaceLandmarker (478 landmark) | ✅ |
| Landmark indeks denetimi | ✅ gözle doğrulandı |
| **Metrik ölçek füzyonu (GLS)** | ✅ 15 birim testi |
| One Euro filtresi, zamansal birikim | ✅ |
| three.js sahnesi, metrik geri-projeksiyon | ✅ round-trip testi |
| **Depth-only occlusion** | ✅ kod hazır, ekranda doğrulanmadı |
| Parametrik çerçeve + semantik anchor'lar | ✅ |
| **Gerçek PD ile doğruluk kanıtı** | ❌ **açık kapı** |
| Temas-kısıtlı yerleştirme çözücüsü | ❌ (şu an naif) |
| Temas gölgesi, saç matting, SH ışık | ❌ |
| Fit skoru, optik ölçüm raporu | ❌ |
| Asset pipeline, embed widget, backend | ❌ |

Sıradaki iş: [docs/TASKS.md](docs/TASKS.md) → **T-00** (doğruluk ölçümü) ve
**T-01** (yerleştirme çözücüsü).

---

## Ne yapıyor

Kamerayı açar, MediaPipe ile 478 yüz landmark'ı çıkarır ve yüz ölçülerini
**milimetre cinsinden** tahmin eder. Sonra gözlüğü **gerçek fiziksel
ölçüleriyle** (49□21-145) yüze yerleştirir.

### Neden zor

Monoküler kamerada mutlak ölçek gözlemlenemez — `u = f·X/Z`, boyut ve mesafe
çarpımsal olarak eşleşir. Uzaktaki büyük yüz ile yakındaki küçük yüz aynı
pikselleri üretir.

Snapchat filtresi için sorun değil. Gözlük için felaket: yanlış ölçekte her
çerçeve herkese "mükemmel" oturur ve ürün alışveriş aracı olmaktan çıkar.

### Çözüm

Ölçek, antropometrik priorların korelasyon-farkında birleşiminden çözülür
(GLS füzyonu): iris çapı, PD, iç kantal mesafe, yüz genişliği.

Teorik doğruluk tabanı — birim testlerinden:

| İpucu seti | CV | 63 mm PD'de |
|---|---|---|
| Sadece PD | %5.71 | ±3.60 mm |
| Sadece iris | %4.27 | ±2.69 mm |
| İris + PD | %3.73 | ±2.35 mm |
| **Tam set (5 ipucu)** | **%3.49** | **±2.20 mm** |

Bu **prior kaynaklı sistematik tabandır** — daha çok kare toplamak düşürmez.
Kart kalibrasyonu (T-05) düşürür.

### Doğrulanmış davranışlar

- **Mesafe değişmezliği:** 30 cm ↔ 80 cm arasında PD ±1.5 mm sabit
- **Cihazlar arası tutarlılık:** PC 61 mm / telefon 62 mm (farklı sensör, FOV, çözünürlük)
- **Fiziksel tutarlılık:** ölçekten türetilen kamera mesafesi gerçek oturma mesafesiyle uyumlu

Henüz doğrulanmayan: **mutlak doğruluk.** Pupilometre karşılaştırması yapılana
kadar "±2 mm" iddiası hiçbir yerde kullanılmamalı ([T-00](docs/TASKS.md)).

---

## Gerçek cihazda test

Dev sunucusu LAN'a açık ve kendinden imzalı HTTPS kullanır (kamera güvenli
bağlam ister). Konsolda yazan ağ adresine telefondan gir:

```
➜  Network: https://192.168.1.161:5173/
```

Sertifika uyarısını bir kez kabul et.

### Teşhis anahtarları

| URL | Ne yapar |
|---|---|
| `?no3d=1` | three.js sahnesini kapatır |
| `?cpu=1` | MediaPipe'ı CPU delegesiyle çalıştırır |

Bir sorun varsa bunlarla bisect et — hangisinde kaybolursa suçlu odur.

---

## Demo paneli

| Bölüm | Ne için |
|---|---|
| Poz & Ölçüm Kapısı | Frontallik skoru; yüz döndüğünde ölçüm sayılmaz |
| 3D Sahne | Gözlük görünürlüğü, occluder debug, çerçeve ölçüsü |
| Metrik Ölçümler | PD (bin/monoküler), iç kantal, yüz genişliği, iris çapı |
| Ölçek Füzyonu | Her ipucunun katkısı ve GLS ağırlığı |
| Landmark Denetimi | Grup grup indeks doğrulama, sonuç kalıcı |
| Doğruluk Çalışması | Gerçek PD gir → MAE/bias, JSON dışa aktarım |

---

## Yapı

```
packages/core/      DOM'suz çekirdek — perception, metrik ölçek, filtre
packages/render/    three.js — occluder, parametrik çerçeve, kamera modeli
apps/demo/          doğrulama arayüzü (ürün değil, geliştirme aracı)
scripts/            WASM + model kurulumu
docs/               mimari, çalışma kuralları, görevler
```

Detaylı sorumluluk dağılımı: [ARCHITECTURE.md §8](docs/ARCHITECTURE.md).

---

## Teknoloji

| Katman | Seçim |
|---|---|
| Yüz takibi | `@mediapipe/tasks-vision` FaceLandmarker (478 landmark) |
| 3D render | three.js + WebGL2 |
| Build | Vite + TypeScript strict |
| Test | Vitest |
| Monorepo | npm workspaces |

WASM ve model **yerel servis edilir** — çalışma anında CDN bağımlılığı yok.
Gerekçe: gizlilik, kurumsal ağ blokları, ve CDN'deki modelin sessizce değişip
doğruluk iddiamızı bozması riski.

---

## Gizlilik

**Kamera karesi hiçbir zaman ağa çıkmaz.** Tüm çıkarım cihazda yapılır.

Bu bir uygulama detayı değil, ürünün B2B konumlandırmasının temeli — KVKK'da
biyometrik veri işleme yükümlülüğünü, GDPR'da DPIA yükünü, ABD'de BIPA
riskini büyük ölçüde ortadan kaldırıyor. Bozacak değişiklikler kabul edilmez.

Ölçüm kayıtları yalnızca tarayıcıda tutulur, dışa aktarma kullanıcının açık
eylemiyle olur ve `.gitignore` ile repodan uzak tutulur.
