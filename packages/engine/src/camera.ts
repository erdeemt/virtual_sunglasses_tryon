/**
 * Kamera açma/kapama — demo ve embed widget'ın ortak kullandığı yol.
 *
 * İki ders buraya gömülü:
 *  - Sabit çözünürlük istemek bazı sürücülerde/sanal kameralarda
 *    NotReadableError üretiyor → kısıtlar kademeli gevşetiliyor.
 *  - Akış serbest bırakılmazsa her sayfa yenilemesi bir akış sızdırıyor ve
 *    Windows'ta kamera kilitleniyor ("Could not start video source").
 */

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Bu tarayıcıda kamera API\'si yok ya da bağlantı güvenli değil (HTTPS gerekli).'), {
      name: 'NotSupportedError',
    });
  }

  const attempts: MediaStreamConstraints[] = [
    {
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    },
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      // İzin reddi kısıt gevşetmekle çözülmez — hemen çık.
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw error;
    }
  }
  throw lastError;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const detail = error instanceof Error ? error.message : String(error);

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Kamera izni reddedildi. Adres çubuğundaki kamera simgesinden izin verip tekrar dene.';
    case 'NotReadableError':
    case 'TrackStartError':
      return (
        'Kamera başka bir uygulama tarafından kullanılıyor. Kontrol et: bu sitenin diğer sekmeleri, ' +
        'Zoom / Teams / OBS / Windows Kamera uygulaması. Hepsini kapatıp tekrar dene.'
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Kamera bulunamadı. Cihazın bağlı ve işletim sistemi gizlilik ayarlarında etkin olduğundan emin ol.';
    case 'OverconstrainedError':
      return 'Kamera istenen çözünürlüğü desteklemiyor.';
    case 'NotSupportedError':
      return detail;
    default:
      return `Kamera başlatılamadı: ${detail}`;
  }
}
