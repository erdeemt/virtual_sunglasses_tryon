/**
 * MediaPipe WASM ve model dosyalarını demo'nun public/ dizinine kopyalar.
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

const MODELS = [
  {
    name: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
];

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
  console.log(`✓ WASM kopyalandı → apps/demo/public/mediapipe/wasm`);
}

async function downloadModels() {
  const dir = resolve(publicDir, 'models');
  await mkdir(dir, { recursive: true });

  for (const model of MODELS) {
    const dest = resolve(dir, model.name);
    if (await exists(dest)) {
      console.log(`· ${model.name} zaten var, atlandı`);
      continue;
    }
    process.stdout.write(`↓ ${model.name} indiriliyor... `);
    const res = await fetch(model.url);
    if (!res.ok || !res.body) {
      throw new Error(`İndirme başarısız (${res.status}): ${model.url}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    const { size } = await stat(dest);
    console.log(`tamam (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

await mkdir(publicDir, { recursive: true });
await copyWasm();
await downloadModels();
await writeFile(
  resolve(publicDir, '.gitignore'),
  '# npm run setup ile üretilir — repoya girmez\nmediapipe/\nmodels/\n',
);
console.log('\nHazır. `npm run dev` ile başlat.');
