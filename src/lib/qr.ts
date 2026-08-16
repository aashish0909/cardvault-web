// QR rendering shared by pairing and nearby share. Screens scan best when
// modules are large and crisp, so render at high resolution with the lowest
// error correction level the payload allows (the data is short-lived and
// harmless if damaged - a barely readable QR is far worse).

import QRCode from 'qrcode';

/** Render a QR data URL sized for screen display (crisp, big modules). */
export async function qrDataUrl(text: string): Promise<string> {
  const opts = {
    width: 640,
    margin: 2,
    color: { dark: '#0B0F14', light: '#FFFFFF' },
  };
  try {
    return await QRCode.toDataURL(text, { ...opts, errorCorrectionLevel: 'L' });
  } catch {
    return QRCode.toDataURL(text, { ...opts, errorCorrectionLevel: 'M' });
  }
}
