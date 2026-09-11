# VTO — Tarayıcıda Gözlük Deneme

Platform-aware, tarayıcıda çalışan gerçek zamanlı 3D gözlük deneme sistemi.
B2B SaaS olarak paketleniyor: markalar ürün sayfasına iki satırla gömer.

**Ayırt edici iddia:** uygulama kurulumu olmadan, tek RGB kameradan milimetre
ölçekli yüz ölçümü — ve gözlüğün gerçek fiziksel ölçüleriyle, **burnun şekline
göre** oturtulması. Warby Parker bunu iOS'ta TrueDepth donanımıyla yapıyor;
biz tarayıcıda istatistiksel olarak çözüyoruz.

```
┌─ Kurulum ────────────────────────────────────────────────────────┐
│  npm install                                                     │
│  npm run setup   # MediaPipe WASM + yüz/saç modelleri + demo      │
│                  # gözlük (~5 MB, repoya girmez)                  │
│  npm run dev     # https://localhost:5173                        │
└──────────────────────────────────────────────────────────────────┘
```

| Sayfa | Ne için |
|---|---|
| `/` | **Geliştirme paneli** — fit raporu, çözücü durumu, landmark denetimi, doğruluk çalışması, GLB yükleme |
| `/shop.html` | **Demo mağaza** — `<glasses-tryon>` widget'ının gerçek bir ürün sayfasındaki hali, canlı olay günlüğü |

---

## Dokümanlar

| Doküman | Ne için |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **Sistem nasıl çalışıyor** — koordinat uzayları, ölçek matematiği, yerleştirme çözücüsü, render katmanları. Kod okumadan önce buradan başla. |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Çalışma kuralları, sorun giderme, sözlük |
| [docs/TASKS.md](docs/TASKS.md) | Görev listesi, iş bölümü, açık işler |
| [ROADMAP.md](ROADMAP.md) | Ürün stratejisi, rakip analizi, plan |

---

## Durum

| Özellik | Durum | Kanıt |
|---|---|---|
| Metrik ölçek füzyonu (GLS) | ✅ | 15 birim testi · 30↔80 cm'de PD ±1.5 mm · PC/telefon arası 1 mm |
| Landmark indeksleri | ✅ | denetim modunda gözle doğrulandı |
| Metrik yüz mesh'i + occlusion | ✅ | geri-projeksiyon round-trip testi, <10⁻⁵ px |
| **Temas-kısıtlı yerleştirme çözücüsü** | ✅ kod · ⚠ görsel | 22 test: yüze girmiyor, temas ediyor, yüksek köprüde düz köprüden yukarıda oturuyor, kafa hareketinden bağımsız |
| **Fit skoru + optik ölçüm raporu** | ✅ kod · ⚠ kalibre değil | beden önerisi testleri (dar/uygun/geniş) |
| Gölgeler (shadow map + kontak AO) | ✅ kod · ⚠ görsel ayar | — |
| Saç occlusion'ı | ✅ kod · ⚠ görsel | 781 KB saç modeli; sınıf indeksi modelin kendi etiketlerinden |
| Işık tahmini (yön / renk / şiddet) | ✅ kod · ⚠ görsel | — |
| Lens kırılması | ✅ | video WebGL arka planında, transmission gerçek görüntüyü kırıyor |
| Hazır GLB modeller | ✅ | gerçek Khronos modeli uçtan uca test ediliyor |
| **Embed widget** | ✅ | yükleyici **10.9 kB (gzip 4.2 kB)** — motor ayrı parça, sayfa açılışında inmez |
| **Mutlak PD doğruluğu** | ❌ | **açık kapı — T-00** |
| Kart kalibrasyonu · Web Worker · asset pipeline · backend | ❌ | [TASKS.md](docs/TASKS.md) |

"⚠ görsel" = kod ve testler hazır, ama ekranda gözle doğrulanmadı. "⚠ kalibre değil" =
parametreler literatür başlangıç değerleri; gerçek deneklerle ayarlanmadan müşteriye
doğruluk iddiası yapılmamalı.

---

## Embed kullanımı

```html
<script type="module" src="https://cdn.ornek.io/v1/embed.js"></script>

<glasses-tryon model="/modeller/aviator.glb" label="Aviator"></glasses-tryon>
<glasses-tryon spec="49,21,145" label="Klasik 49□21"></glasses-tryon>
```

| Nitelik | Anlamı |
|---|---|
| `model` | GLB adresi |
| `spec` | `lens,köprü,sap` — parametrik çerçeve (model yoksa) |
| `label` | modal başlığı |
| `asset-base` | `mediapipe/` ve `models/` kökü (varsayılan `/`) |
| `accent` | vurgu rengi |

| Olay | `detail` |
|---|---|
| `vto:ready` | — kamera açıldı |
| `vto:fit` | `FitReport` — skor, beden önerisi, optik ölçümler |
| `vto:capture` | `{ blob }` — kullanıcının çektiği fotoğraf |
| `vto:error` | `{ message }` |
| `vto:close` | — |

Widget Shadow DOM içinde çalışır (sitenin CSS'i onu bozamaz), kamera izni
istemeden önce gizlilik notunu gösterir, kapatıldığında kamerayı hemen bırakır.

---

## Komutlar

| Komut | İş |
|---|---|
| `npm run dev` | Vite dev sunucusu (HTTPS, LAN'a açık — telefondan test için) |
| `npm run build` | Production build (panel + mağaza) |
| `npm run typecheck` | Tüm paketlerde `tsc --noEmit` |
| `npx vitest run` | 70 birim/entegrasyon testi |
| `npm run setup` | WASM + modeller + demo gözlük |

### Teşhis anahtarları

| URL | Ne yapar |
|---|---|
| `?no3d=1` | three.js sahnesini kapatır (sadece ölçüm) |
| `?cpu=1` | MediaPipe'ı CPU delegesiyle çalıştırır |
| `?nohair=1` | saç segmentasyonunu kapatır |

Bir sorun varsa bunlarla bisect et — hangisinde kaybolursa suçlu odur.

### Telefondan test

Konsolda yazan ağ adresine gir (`https://192.168.x.x:5173`) ve kendinden imzalı
sertifika uyarısını bir kez kabul et. Kamera güvenli bağlam ister.

---

## Yapı

```
packages/core     DOM'suz: algılama, metrik ölçek, yerleştirme çözücüsü, fit
packages/render   three.js: sahne, occlusion, gölge, saç, ışık, GLB yükleme
packages/engine   pipeline: kamera → takip → ölçek → çözücü → render → fit
packages/embed    <glasses-tryon> web component
apps/demo         geliştirme paneli (/) + demo mağaza (/shop.html)
scripts/          varlık kurulumu
```

---

## Gizlilik

**Kamera karesi hiçbir zaman ağa çıkmaz.** Tüm çıkarım cihazda yapılır. Widget
olayları yalnızca türetilmiş sayılar taşır (skor, mm ölçüler).

Bu bir uygulama detayı değil, ürünün B2B konumlandırmasının temeli — KVKK'da
biyometrik veri işleme yükümlülüğünü, GDPR'da DPIA yükünü, ABD'de BIPA riskini
büyük ölçüde ortadan kaldırıyor. Bozacak değişiklikler kabul edilmez.

---

## Lisanslar ve atıflar

- **Demo güneş gözlüğü:** "SunglassesKhronos" — Eric Chadwick, Darmstadt Graphics
  Group, [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Khronos ve
  3D Commerce logoları içerir — **yalnızca demo, müşteriye giden üründe kullanılmaz.**
- **MediaPipe modelleri** (yüz, saç): Apache-2.0.
