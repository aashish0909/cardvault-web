// Camera QR scanner shared by pairing and nearby share.
//
// Prefers the native BarcodeDetector API and falls back to jsQR over camera
// frames. The camera stream is released as soon as a payload is decoded or
// the component unmounts.

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface BarcodeDetectorLike {
  detect(image: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

const BarcodeDetectorCtor = (window as unknown as {
  BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike;
}).BarcodeDetector;

export default function Scanner({
  onPayload,
  busy,
  busyLabel = 'Working…',
}: {
  onPayload: (payload: unknown) => void;
  busy: boolean;
  busyLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const decoder = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ['qr_code'] }) : null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
      } catch {
        setCamError('Camera unavailable - use the regular Share over the internet instead.');
        return;
      }

      const tick = async () => {
        if (stopped) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            let raw: string | null = null;
            if (decoder) {
              try {
                const results = await decoder.detect(canvas);
                raw = results[0]?.rawValue ?? null;
              } catch {
                raw = null;
              }
            } else {
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const found = jsQR(image.data, image.width, image.height);
              raw = found?.data ?? null;
            }
            if (raw && raw.startsWith('{')) {
              try {
                onPayload(JSON.parse(raw));
                return;
              } catch {
                // not JSON: ignore frame
              }
            }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onPayload]);

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
      {camError && <p className="muted">{camError}</p>}
      {busy && <p className="muted">{busyLabel}</p>}
    </div>
  );
}
