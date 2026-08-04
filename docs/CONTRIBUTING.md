# Çalışma Kuralları

Yeni katılan biri için: önce [ARCHITECTURE.md](ARCHITECTURE.md), sonra bu
doküman, sonra [TASKS.md](TASKS.md).

---

## İlk Gün

```bash
git clone <repo>
cd gozluk
npm install
npm run setup        # MediaPipe WASM + model (~3.6 MB indirir)
npm run dev          # https://localhost:5173
```

Sertifika kendinden imzalı, tarayıcı uyarısını bir kez geç.

Sonra sırayla:

1. **Demo'yu aç, kamerayı başlat.** Yüzünde landmarklar ve gözlük görmelisin.
2. **"Denetimi Başlat"a bas**, 5 adımı gez. Bu, hangi landmark'ın ne olduğunu
   öğrenmenin en hızlı yolu.
3. **Occluder'ı `wireframe` yap.** Yüz mesh'inin nasıl bir şey olduğunu gör.
4. **Çerçeve ölçüsünü değiştir** (45 ↔ 54). Metrik ölçeğin ne işe yaradığını
   burada anlarsın.
5. `packages/core/src/metric/scale.ts` oku — projenin fikri orada.

---

## Komutlar

| Komut | İş |
|---|---|
| `npm run dev` | Vite dev sunucusu (HTTPS, LAN'a açık) |
| `npm run build` | Production build |
| `npm run typecheck` | Tüm paketlerde `tsc --noEmit` |
| `npx vitest run` | Birim testleri |
| `npx vitest` | Watch modunda test |
| `npm run setup` | WASM + model indirme (bir kez yeter) |

**PR açmadan önce:** `npm run typecheck && npx vitest run` ikisi de yeşil.

---

## Teşhis Anahtarları

Bir şey çalışmıyorsa önce bunlarla bisect et:

| URL | Ne yapar |
|---|---|
| `?no3d=1` | three.js sahnesini tamamen kapatır |
| `?cpu=1` | MediaPipe'ı GPU yerine CPU delegesiyle çalıştırır |
| `?no3d=1&cpu=1` | ikisi birden |

Hangisinde sorun kayboluyorsa suçlu odur. Hata olursa ekranda mesaj + stack +
cihaz bilgisi gösteren bir kart çıkar; "Hatayı Kopyala" ile paylaş.

---

## Kod Konvansiyonları

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`. Dizi erişimi `T | undefined`
  döner — `!` kullanmadan önce gerçekten garanti olduğundan emin ol.
- Import'larda `.js` uzantısı (ESM), dosya `.ts` olsa bile.
- `verbatimModuleSyntax` açık → tip import'ları `import type`.

### Yorumlar

Kod ne yaptığını zaten söylüyor. Yorumlar **neden** öyle yapıldığını
anlatmalı — özellikle sezgiye aykırı olan kararları:

```ts
// ✅ iyi
// Naif ters-varyans ağırlıklandırma iki iris ölçümünü bağımsız sayar ve
// belirsizliği √2 kat düşük gösterir — yani "±2 mm" iddiamız yalan olur.

// ❌ gereksiz
// ölçekleri topla
```

Yorumlar Türkçe. Tanımlayıcılar (değişken/fonksiyon adları) İngilizce.

### Sihirli sayı yok

Her fiziksel sabit kaynağıyla birlikte yazılır:

```ts
muMM: 11.7,
sigmaMM: 0.5,
source: 'Kornea/iris yatay çap normları — CV %4.3, en stabil ipucu',
```

---

## Sert Kurallar

Bunlar tartışmaya kapalı, her biri bir hatadan öğrenildi:

**1. `packages/core` DOM'a dokunmaz.**
`window`, `document`, `navigator` yok. Tek istisna `capability.ts`. Sebep:
core'un Web Worker'a taşınabilmesi gerekiyor (T-07).

**2. Render döngüsünde `throw` yok.**
`requestAnimationFrame` en başta çağrıldığı için istisna döngüyü durdurmaz —
saniyede 60 hata sekmeyi kilitler ve kullanıcıya "çökme" olarak görünür.
Hatalar `showFatal()` ile bir kez gösterilir.

**3. Kamera görüntüsü ağa çıkmaz.**
Tüm çıkarım cihazda. Bu, KVKK/GDPR/BIPA konumumuzun ve B2B satış argümanımızın
temeli. Bozacak hiçbir değişiklik kabul edilmez.

**4. Demografi otomatik çıkarılmaz.**
Cinsiyet/etnisite tahmini doğruluğu artırır ama KVKK'da özel nitelikli veri
ve bias riski taşır. Kullanıcı **beyan ederse** prior daraltılır.

**5. Kanıtlanmamış sayı raporlanmaz.**
Yeni landmark indeksi `verified: false` ile başlar, denetim modunda gözle
teyit edilmeden `true` olmaz. Doğruluk iddiası ölçülmeden yazılmaz.

**6. İndeks konvansiyonuna değil geometriye güven.**
MediaPipe'ın sol/sağ adlandırması kaynaklarda tutarsız. Taraf ataması
görüntü geometrisinden türetilir (`irisA.x < irisB.x` → OD).

**7. Kamera akışı serbest bırakılır.**
`pagehide`/`beforeunload` üzerinde `track.stop()`. Yapılmazsa her yenileme
bir akış sızdırır, Windows'ta kamera kilitlenir ve
`NotReadableError: Could not start video source` alırsın.

---

## Test Yaklaşımı

Ekranı göremeyen biri (CI, ya da uzaktan çalışan biri) için **matematik
testlerle kilitlenir**:

- `scale.test.ts` — füzyonun korelasyonu doğru işlediğini kanıtlar. Bu test
  düşerse "±2 mm" iddiası çöker.
- `camera.test.ts` — geri-projeksiyon round-trip'i. Bu test düşerse occlusion
  kayar.

**Görsel işlerde test yerine kanıt:** PR'a ekran görüntüsü/video ekle. Yan
yana karşılaştırma (öncesi/sonrası) en iyisi.

---

## Git Akışı

```bash
git checkout -b t01-contact-solver     # görev kodundan branch
# ... çalış ...
npm run typecheck && npx vitest run    # ikisi de yeşil olmalı
git commit -m "solver: temas-kısıtlı yerleştirme"
git push -u origin t01-contact-solver
```

PR açıklamasında:
- Hangi göreve karşılık geldiği (T-01 gibi)
- **Kabul kriterinin nasıl doğrulandığı** — görsel işlerde ekran görüntüsü şart

### Çakışma önleme

`packages/core` ve `packages/render` aynı anda iki kişi tarafından
değiştirilmemeli. Görev almadan önce issue'yu kendine ata.

---

## Sık Karşılaşılan Sorunlar

**`Could not start video source`**
Kamera başka bir şey tarafından tutuluyor. Sırayla: bu sitenin diğer
sekmelerini kapat → Zoom/Teams/OBS/Windows Kamera kapat → tarayıcıyı tamamen
kapat aç. Kod artık akışı serbest bırakıyor ama açık kalan eski sekmeler
sorun çıkarabilir.

**Kamera hiç açılmıyor, izin sorulmuyor**
HTTPS gerekiyor. `localhost` muaf ama LAN IP'sinden bağlanıyorsan
`https://` şart ve sertifika uyarısını kabul etmen gerekir.

**`npm run setup` başarısız**
Model `storage.googleapis.com`'dan iniyor. Kurumsal ağ blokluyorsa VPN'den
dene ya da dosyayı elle indirip `apps/demo/public/models/` içine koy.

**Landmarklar yüzden kayık**
Aspect düzeltmesi atlanmış olabilir. Ölçüm yapan her fonksiyon **FaceUnits**
bekler, ham normalize landmark değil. Bkz. ARCHITECTURE.md §2.

**Sayılar mantıksız (PD 200 mm gibi)**
Ölçek füzyonu bozulmuş. Panelde "Ölçek Füzyonu" bölümüne bak — hangi ipucunun
saçma katkı verdiği orada görünür.

**FPS düşük**
`?no3d=1` ile render'ı kapat, perception tek başına kaç FPS veriyor bak.
Sorun render'daysa kademe bütçesi (`capability.ts`) ayarlanır.

---

## Sözlük

| Terim | Anlamı |
|---|---|
| **PD** | Pupiller mesafe — iki göz bebeği arası (mm) |
| **Monoküler PD** | Her gözün burun orta hattına uzaklığı ayrı ayrı |
| **OD / OS** | Oculus dexter / sinister — sağ göz / sol göz |
| **Kantus** | Göz köşesi. İç = burun tarafı, dış = şakak tarafı |
| **Bizygomatik** | Elmacık kemikleri arası yüz genişliği |
| **Sellion** | Burun kökü, iki göz arasındaki çukur |
| **Tragion** | Kulak önündeki çıkıntı |
| **Vertex distance** | Lens arka yüzü ile kornea arası mesafe (12–14 mm ideal) |
| **Pantoskopik açı** | Lens düzleminin dikeyle yaptığı açı (8–12° ideal) |
| **Segment height** | Lens altından pupil merkezine yükseklik — progresif lens için |
| **49□21-145** | Çerçeve ölçüsü: lens genişliği □ köprü - sap uzunluğu |
| **Occluder** | Renk yazmayan, sadece derinlik yazan mesh |
| **FaceUnits** | En-boy düzeltilmiş normalize landmark uzayı (bkz. §2) |
| **GLS** | Generalized Least Squares — korelasyonlu füzyon |
| **CV** | Coefficient of Variation — σ/μ, bağıl belirsizlik |
