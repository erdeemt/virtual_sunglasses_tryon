/**
 * MediaPipe WASM, ML modelleri ve demo gözlük modelini demo'nun public/
 * dizinine koyar.
 *
 * Neden CDN kullanmıyoruz:
 *  - Çalışma anında üçüncü taraf bağımlılığı = tek hata noktası + gizlilik
 *    sorusu (B2B müşterisinin güvenlik formunda ilk sorulan şey).
 *  - Sürüm kayması: CDN'deki model sessizce değişirse doğruluk iddiamız bozulur.
 *  - Kurumsal ağlarda cdn.jsdelivr.net sıklıkla bloklu.
 *
 * Kullanım: npm run setup
 */
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'apps/demo/public');

const ASSETS = [
  {
    path: 'models/face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    note: '478 landmark yüz takibi',
  },
  {
    // Genel çok-sınıflı segmenter 16 MB; bu özel saç modeli 781 KB.
    // Embed widget için 20 kat fark. Etiketler: 0=background, 1=hair.
    path: 'models/hair_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite',
    note: 'saç segmentasyonu',
  },
  {
    // Khronos glTF örnek seti — e-ticaret için tasarlanmış, gerçek boyutlu,
    // parçaları isimli (Nosepads, Earhook*, Temple*, Lenses*). CC-BY-4.0:
    // atıf ZORUNLU (bkz. ATTRIBUTION.md, arayüzde de gösteriliyor).
    path: 'models/glasses/khronos-sunglasses.glb',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SunglassesKhronos/glTF-Binary/SunglassesKhronos.glb',
    note: 'demo güneş gözlüğü (CC-BY-4.0)',
  },
];

const ATTRIBUTION = `# Üçüncü Taraf Varlıklar

Bu dizindeki dosyalar \`npm run setup\` ile indirilir ve repoya girmez.

## models/glasses/khronos-sunglasses.glb

- **Kaynak:** Khronos glTF-Sample-Assets — SunglassesKhronos
  https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SunglassesKhronos
- **Sanatçı:** Eric Chadwick
- **Sahibi:** Darmstadt Graphics Group GmbH (2024)
- **Lisans:** CC-BY-4.0 — https://creativecommons.org/licenses/by/4.0/
- Modelde Khronos ve 3D Commerce logoları var (Khronos ticari markaları).
  **Müşteriye giden üründe kullanılmamalı** — yalnızca demo ve test amaçlı.

## models/face_landmarker.task, models/hair_segmenter.tflite

- **Kaynak:** Google MediaPipe — https://ai.google.dev/edge/mediapipe
- **Lisans:** Apache-2.0
`;

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  const src = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  const dest = resolve(publicDir, 'mediapipe/wasm');
  if (!(await exists(src))) {
    throw new Error(`WASM kaynağı yok: ${src} — önce npm install çalıştır.`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log('✓ WASM kopyalandı → apps/demo/public/mediapipe/wasm');
}

async function download() {
  for (const asset of ASSETS) {
    const dest = resolve(publicDir, asset.path);
    await mkdir(dirname(dest), { recursive: true });
    if (await exists(dest)) {
      console.log(`· ${asset.path} zaten var, atlandı`);
      continue;
    }
    process.stdout.write(`↓ ${asset.path} (${asset.note}) indiriliyor... `);
    const res = await fetch(asset.url);
    if (!res.ok || !res.body) throw new Error(`İndirme başarısız (${res.status}): ${asset.url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    const { size } = await stat(dest);
    console.log(`tamam (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }
}

await mkdir(publicDir, { recursive: true });
await copyWasm();
await download();
await writeFile(resolve(publicDir, 'models/ATTRIBUTION.md'), ATTRIBUTION);
await writeFile(
  resolve(publicDir, '.gitignore'),
  '# npm run setup ile üretilir — repoya girmez\nmediapipe/\nmodels/\n',
);
console.log('\nHazır. `npm run dev` ile başlat.');
