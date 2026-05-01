import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { beep, vibrate } from "@/lib/utils";

interface Props {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    const start = async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (devices.length === 0) {
          setError("Không tìm thấy camera trên thiết bị này");
          return;
        }

        // Ưu tiên camera sau (back) trên điện thoại
        const back = devices.find((d) =>
          /back|rear|environment/i.test(d.label),
        );
        const deviceId = back?.deviceId ?? devices[0].deviceId;

        if (cancelled || !videoRef.current) return;

        setScanning(true);
        await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result, err) => {
            if (cancelled) return;
            if (result) {
              const text = result.getText();
              beep(880, 80);
              vibrate(40);
              onScan(text);
            }
            // err xuất hiện liên tục khi không thấy mã — bỏ qua
            void err;
          },
        );
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : "Không thể truy cập camera. Vui lòng cấp quyền và thử lại.";
        setError(msg);
        setScanning(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      // Tắt stream camera
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-4 safe-top bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-2 text-white">
          <Camera className="w-5 h-5" />
          <span className="text-sm font-medium">
            {scanning ? "Đang quét…" : "Chuẩn bị camera"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-black/50 text-white press"
          aria-label="Đóng"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
        />

        {/* Khung ngắm */}
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-72 h-44 max-w-[80vw]">
              <div className="absolute inset-0 border-2 border-white/40 rounded-xl" />
              {/* 4 góc highlight */}
              <Corner className="top-0 left-0" />
              <Corner className="top-0 right-0 rotate-90" />
              <Corner className="bottom-0 right-0 rotate-180" />
              <Corner className="bottom-0 left-0 -rotate-90" />
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-bg-card rounded-xl p-5 max-w-sm">
              <p className="text-ink mb-4">{error}</p>
              <Button onClick={onClose} variant="outline" className="w-full">
                Đóng
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-0 inset-x-0 p-6 safe-bottom bg-gradient-to-t from-black/60 to-transparent">
        <p className="text-center text-white/80 text-sm">
          Đưa mã vạch vào khung — máy sẽ tự đọc
        </p>
      </div>
    </div>
  );
}

function Corner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute w-6 h-6 border-t-[3px] border-l-[3px] border-accent rounded-tl-md ${className}`}
    />
  );
}
