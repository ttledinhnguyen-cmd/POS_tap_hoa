import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Camera, CheckCircle2, ShoppingBag, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatVND } from "@/lib/format";
import { beep, vibrate } from "@/lib/utils";

// Per-session unique-scan: trong 1 lần mở scanner, mỗi EAN chỉ fire onScan 1 lần.
// Cashier muốn 2 chai cùng loại → đóng scanner + mở lại + scan lại, hoặc tăng
// qty trong cart sheet. Pattern này phù hợp tạp hoá (đa số mua 1 món/loại) +
// loại bỏ 100% spam khi giữ camera lâu trên frame.

/**
 * Format whitelist cho tạp hóa VN:
 * - EAN-13: chuẩn quốc tế nhất, hàng nhập + nội địa lớn
 * - EAN-8: bao bì nhỏ
 * - UPC-A/UPC-E: hàng Bắc Mỹ
 * - CODE-128: nội bộ shop tự in tem (vd. Sapo/KiotViet xuất)
 *
 * KHÔNG include QR / DataMatrix / Aztec / PDF417 vì:
 * - Tạp hóa không dùng QR product
 * - ZXing tốc độ scale nghịch số format → ít hơn = nhanh hơn
 * - TRY_HARDER bù lại cho EAN bị mờ/cong
 */
const SUPPORTED_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
];

const SCANNER_HINTS: Map<DecodeHintType, unknown> = (() => {
  const h = new Map<DecodeHintType, unknown>();
  h.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
  h.set(DecodeHintType.TRY_HARDER, true);
  return h;
})();

/**
 * Camera constraints — facingMode environment (back camera) + 1280x720.
 * focusMode 'continuous' best-effort (chỉ Chrome Android + 1 vài browser),
 * fallback graceful nếu unsupported.
 */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  // @ts-expect-error focusMode không có trong DOM types nhưng được hỗ trợ runtime
  advanced: [{ focusMode: "continuous" }],
};

/**
 * Toast feedback hiển thị giữa scanner sau mỗi scan (parent set qua prop).
 * Bump `timestamp` để re-trigger animation cho cùng barcode scan lại.
 */
export interface ScanFeedback {
  type: "success" | "error";
  message: string;
  sublabel?: string;
  timestamp: number; // Date.now() khi parent set, dùng để watch + auto-fade
}

interface Props {
  onScan: (barcode: string) => void;
  onClose: () => void;
  /**
   * Optional toast feedback từ parent — hiển thị 1.5s rồi fade out.
   * Parent set null/undefined để clear sớm.
   */
  feedback?: ScanFeedback | null;
  /**
   * Optional top overlay summary — count + total tiền đã quét.
   * Parent truyền cart state để user thấy progress trong continuous scan mode.
   */
  summary?: {
    count: number;
    total: number;
  };
  /**
   * Hint text cuối màn hình. Default "Đưa mã vạch vào khung — máy sẽ tự đọc".
   */
  bottomHint?: string;
  /**
   * Tap "Giỏ hàng" trong top bar → callback. Parent thường đóng scanner +
   * mở cart sheet. Nếu undefined → button không render.
   */
  onOpenCart?: () => void;
}

export function BarcodeScanner({
  onScan,
  onClose,
  feedback,
  summary,
  bottomHint,
  onOpenCart,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // Local toast visibility — auto-fade sau 1.5s từ feedback.timestamp
  const [toastVisible, setToastVisible] = useState(false);

  // Per-session unique scan — Set reset mỗi lần component mount (scanner open).
  // Khi user tap "Xong" → component unmount → Set tự GC. Mở lại → Set rỗng,
  // scan lại EAN cũ được +1 nữa.
  const scannedBarcodesRef = useRef<Set<string>>(new Set());

  // onScan ref để callback ZXing không re-bind mỗi render (giữ stable closure)
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Auto-fade toast sau 1.5s mỗi khi feedback.timestamp đổi
  useEffect(() => {
    if (!feedback) {
      setToastVisible(false);
      return;
    }
    setToastVisible(true);
    const t = setTimeout(() => setToastVisible(false), 1500);
    return () => clearTimeout(t);
  }, [feedback]);

  useEffect(() => {
    let cancelled = false;
    // Restrict formats + TRY_HARDER → faster decode trên mobile (chỉ check 5
    // format relevant cho tạp hóa thay vì 20+ format mặc định).
    const reader = new BrowserMultiFormatReader(SCANNER_HINTS);
    readerRef.current = reader;

    const start = async () => {
      try {
        if (cancelled || !videoRef.current) return;

        setScanning(true);
        // decodeFromConstraints áp constraints lên getUserMedia trực tiếp
        // (focusMode continuous + back camera + 720p). Skip listVideoInputDevices
        // vì facingMode 'environment' đã handle deviceId selection.
        await reader.decodeFromConstraints(
          { video: VIDEO_CONSTRAINTS, audio: false },
          videoRef.current,
          (result, err) => {
            if (cancelled) return;
            if (result) {
              const text = result.getText();
              // Per-session unique: EAN đã quét trong session này → skip
              // (tránh tăng qty khi giữ frame, tránh spam khi camera detect
              // multiple frames của cùng barcode).
              if (scannedBarcodesRef.current.has(text)) {
                return;
              }
              scannedBarcodesRef.current.add(text);
              beep(880, 80);
              vibrate(40);
              onScanRef.current(text);
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
    // KHÔNG depend [onScan] — onScanRef giữ closure stable, tránh re-init reader
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar — white card style, mx-3 mt-3 dưới safe-top notch */}
      <div className="absolute top-0 inset-x-0 z-10 safe-top">
        <div className="mx-3 mt-3 flex items-center justify-between gap-2 px-5 py-4 bg-bg-card rounded-xl shadow-soft">
          <div className="flex flex-col leading-tight min-w-0 flex-1">
            {summary && summary.count > 0 ? (
              <>
                <span className="text-sm text-ink-muted">Đã quét</span>
                <span className="text-lg font-semibold tabular-nums font-mono text-ink truncate">
                  {summary.count} món ·{" "}
                  <span className="text-primary-700">
                    {formatVND(summary.total)}đ
                  </span>
                </span>
              </>
            ) : (
              <div className="flex items-center gap-2 text-ink">
                <Camera className="w-5 h-5 text-primary-700" />
                <span className="text-base font-medium">
                  {scanning ? "Đang quét…" : "Chuẩn bị camera"}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onOpenCart && (
              <button
                type="button"
                onClick={onOpenCart}
                aria-label="Mở giỏ hàng"
                className="flex items-center gap-1.5 px-4 h-11 rounded-lg bg-primary-700 text-white press text-sm font-medium"
              >
                <ShoppingBag className="w-5 h-5" />
                Giỏ hàng
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="w-11 h-11 flex items-center justify-center rounded-lg bg-danger text-white press"
            >
              <X className="w-[22px] h-[22px]" />
            </button>
          </div>
        </div>
      </div>

      {/* Toast feedback — fade-in từ trên, ở giữa */}
      {feedback && toastVisible && (
        <div
          key={feedback.timestamp}
          className="absolute top-20 inset-x-0 z-20 flex justify-center px-4 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div
            className={`flex items-start gap-2 max-w-sm px-3 py-2 rounded-lg shadow-lg ${
              feedback.type === "success"
                ? "bg-primary-700 text-white"
                : "bg-danger text-white"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-semibold truncate">
                {feedback.message}
              </span>
              {feedback.sublabel && (
                <span className="text-xs text-white/80 truncate">
                  {feedback.sublabel}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Bottom hint — white bar nhỏ, consistent với top bar */}
      <div className="absolute bottom-0 inset-x-0 px-4 py-2 safe-bottom bg-bg-card shadow-soft">
        <p className="text-center text-xs text-ink-muted">
          {bottomHint ??
            (summary
              ? "Quét xong tự thêm vào giỏ — tap X khi xong"
              : "Đưa mã vạch vào khung — máy sẽ tự đọc")}
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
