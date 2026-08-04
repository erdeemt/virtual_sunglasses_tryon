import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

export default defineConfig({
  // Kamera erişimi güvenli bağlam ister. localhost muaf, ama gerçek cihazda
  // (roadmap Gün 2: "simülatörde değil gerçek iPhone'da test") LAN IP'sinden
  // bağlanacağız — orada HTTPS zorunlu. Sertifika kendinden imzalı, tarayıcı
  // uyarısını bir kez geçmek gerekir.
  plugins: [basicSsl()],
  resolve: {
    alias: {
      '@vto/core': resolve(import.meta.dirname, '../../packages/core/src'),
      '@vto/render': resolve(import.meta.dirname, '../../packages/render/src'),
    },
  },
  server: {
    host: true, // LAN'a aç — telefondan test için şart
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
