import { useEffect, useRef, useState } from 'react';
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import { Flashlight, SwitchCamera, ZoomIn } from 'lucide-react';
import { ModalSheet } from './ModalSheet';

// Configure ZXing C++ WASM to load 100% locally from /wasm/ (works offline in PWA)
prepareZXingModule({
  overrides: {
    locateFile: (path: string) => `/wasm/${path}`,
  },
});

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
}

const SUPPORTED_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'codabar',
  'qr_code',
  'data_matrix',
] as const;

function playScanBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    setTimeout(() => void ctx.close(), 150);
  } catch {
    // AudioContext blocked or unavailable
  }
}

export function BarcodeScannerModal({ open, onClose, onDetected, title = 'Scan barcode' }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIdx, setCameraIdx] = useState(0);

  const applyCameraZoom = async (targetZoom: number) => {
    const track = trackRef.current;
    if (!track || !zoomRange) return;
    const clamped = Math.max(zoomRange.min, Math.min(zoomRange.max, targetZoom));
    try {
      await track.applyConstraints({
        advanced: [{ zoom: clamped } as MediaTrackConstraintSet],
      });
      setZoomLevel(clamped);
    } catch {
      // Some lenses reject programmatic zoom
    }
  };

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Ignore if lens does not support torch
    }
  };

  useEffect(() => {
    if (!open) return;

    let active = true;
    let rafId = 0;
    let scanning = false;
    let frameCount = 0;

    setError(null);
    setTorchOn(false);

    const stopMedia = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) {
          t.stop();
        }
        streamRef.current = null;
      }
      trackRef.current = null;
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API unavailable (requires HTTPS)');
        }

        // Request Full HD 1080p rear camera so tiny 1D barcode bars stay razor-sharp
        const selectedDevice = cameras[cameraIdx]?.deviceId;
        const videoConstraints: MediaTrackConstraints = selectedDevice
          ? {
              deviceId: { exact: selectedDevice },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
            };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        if (!active) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }

        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;

        // Enumerate rear cameras for optional lens switching (macro vs main)
        if (cameras.length === 0) {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const vids = allDevices.filter((d) => d.kind === 'videoinput');
          if (active && vids.length > 1) {
            setCameras(vids);
          }
        }

        // Probe hardware capabilities: continuous autofocus, zoom (default 2x for small barcodes!), torch
        const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
        const advanced: Record<string, unknown>[] = [];

        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          advanced.push({ focusMode: 'continuous' });
        }

        if (caps.zoom && typeof caps.zoom === 'object') {
          const z = caps.zoom as { min?: number; max?: number };
          const min = z.min ?? 1;
          const max = z.max ?? 1;
          if (max > min) {
            setZoomRange({ min, max });
            // Default to ~1.8x zoom if supported — lets user hold phone at sharp focus distance while enlarging tiny barcodes
            const idealZoom = Math.min(max, Math.max(min, 1.8));
            advanced.push({ zoom: idealZoom });
            setZoomLevel(idealZoom);
          }
        } else {
          setZoomRange(null);
          setZoomLevel(1);
        }

        setTorchSupported(Boolean(caps.torch));

        if (advanced.length > 0) {
          try {
            await track.applyConstraints({ advanced: advanced as MediaTrackConstraintSet[] });
          } catch {
            // Non-fatal if browser ignores advanced constraint
          }
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new BarcodeDetector({
          formats: [...SUPPORTED_FORMATS],
        });

        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const tick = async () => {
          if (!active) return;
          if (!scanning && video.readyState >= 2 && video.videoWidth > 0 && ctx) {
            scanning = true;
            frameCount++;
            try {
              const vw = video.videoWidth;
              const vh = video.videoHeight;

              // Alternate between high-res center strip crop (ideal for tiny 1D retail barcodes)
              // and full frame (for large QR / wide codes)
              const useCenterCrop = frameCount % 3 !== 0;
              let source: HTMLCanvasElement | HTMLVideoElement = video;

              if (useCenterCrop) {
                const cropW = Math.round(vw * 0.84);
                const cropH = Math.round(vh * 0.42);
                const sx = Math.round((vw - cropW) / 2);
                const sy = Math.round((vh - cropH) / 2);
                if (canvas.width !== cropW || canvas.height !== cropH) {
                  canvas.width = cropW;
                  canvas.height = cropH;
                }
                ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
                source = canvas;
              }

              const results = await detector.detect(source);
              if (active && results.length > 0 && results[0].rawValue) {
                active = false;
                playScanBeep();
                if ('vibrate' in navigator) {
                  navigator.vibrate(25);
                }
                stopMedia();
                onDetected(results[0].rawValue.trim());
                onClose();
                return;
              }
            } catch {
              // Ignore transient frame decode error
            } finally {
              scanning = false;
            }
          }
          if (active) {
            rafId = requestAnimationFrame(() => void tick());
          }
        };

        rafId = requestAnimationFrame(() => void tick());
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Camera unavailable';
        setError(
          `${msg}. Camera scanning requires HTTPS (Cloudflare Tunnel / Tailscale Serve) or localhost. You can type or use a USB/Bluetooth scanner below.`
        );
      }
    };

    void start();

    return () => {
      active = false;
      stopMedia();
    };
  }, [open, cameraIdx, onDetected, onClose]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    onDetected(trimmed);
    setManualCode('');
    onClose();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle="HD ZXing-WASM · supports small 1D retail & QR barcodes"
      maxWidth="max-w-md"
    >
      <div className="p-4 sm:p-5">
        {/* Live HD Camera Viewfinder */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-slate-950">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
          />

          {/* Crisp targeting reticle for small horizontal 1D barcodes */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[42%] w-[84%] rounded-xl border border-white/55 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]">
              <div className="absolute left-3 right-3 top-1/2 h-[1.5px] -translate-y-1/2 bg-[var(--accent)] opacity-85" />
            </div>
          </div>

          {/* Floating Apple-glass camera controls: Zoom, Torch, Lens switch */}
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-full bg-black/55 p-1 text-[11px] font-medium text-white backdrop-blur-md">
              {zoomRange ? (
                [1, 2, 3]
                  .filter((z) => z <= zoomRange.max + 0.1)
                  .map((z) => {
                    const active = Math.abs(zoomLevel - z) < 0.35;
                    return (
                      <button
                        key={z}
                        type="button"
                        onClick={() => void applyCameraZoom(z)}
                        className={`min-h-[28px] rounded-full px-2.5 font-mono-num ${
                          active ? 'bg-white text-slate-950' : 'text-white/85'
                        }`}
                      >
                        {z}x
                      </button>
                    );
                  })
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 text-white/80">
                  <ZoomIn className="h-3 w-3" /> HD
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {torchSupported && (
                <button
                  type="button"
                  onClick={() => void toggleTorch()}
                  aria-label="Toggle flashlight"
                  className={`flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md ${
                    torchOn ? 'bg-amber-400 text-slate-950' : 'bg-black/55 text-white'
                  }`}
                >
                  <Flashlight className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
              {cameras.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCameraIdx((i) => (i + 1) % cameras.length)}
                  aria-label="Switch camera lens"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md"
                >
                  <SwitchCamera className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2.5 text-center text-[11px] text-[var(--text-muted)]">
          For small barcodes, hold 15–20cm away and tap <span className="font-mono-num font-medium">2x</span> or{' '}
          <span className="font-mono-num font-medium">3x</span> zoom.
        </p>

        {error && (
          <p className="mt-3 rounded-xl bg-[var(--warn-subtle)] px-3 py-2 text-xs text-[var(--warn)]">
            {error}
          </p>
        )}

        <form onSubmit={submitManual} className="mt-3.5 flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Or enter / USB-scan barcode"
            data-barcode-target="true"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="done"
            className="min-h-[44px] flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Use
          </button>
        </form>
      </div>
    </ModalSheet>
  );
}
