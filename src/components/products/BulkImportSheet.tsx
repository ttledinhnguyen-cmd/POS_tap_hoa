import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Upload,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/integrations/supabase";
import { productsSync } from "@/integrations/sync/products-sync";
import { contributeBarcode } from "@/integrations/barcode/lookup";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const CHUNK_SIZE = 100;

type ColumnKey =
  | "name"
  | "barcode"
  | "unit"
  | "priceBuy"
  | "priceSell"
  | "stock"
  | "taxRate"
  | "category";

const COLUMN_LABEL: Record<ColumnKey, string> = {
  name: "Tên sản phẩm",
  barcode: "Mã vạch",
  unit: "Đơn vị",
  priceBuy: "Giá vốn",
  priceSell: "Giá bán",
  stock: "Tồn kho",
  taxRate: "Thuế (%)",
  category: "Danh mục",
};

/**
 * Auto-detect column index dựa vào header text. Match case-insensitive,
 * không dấu Việt Nam (NFD strip).
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  name: ["ten san pham", "ten", "san pham", "mat hang", "name", "product"],
  barcode: ["ma vach", "ma", "barcode", "ean", "upc"],
  unit: ["don vi", "dvt", "unit", "dv"],
  priceBuy: ["gia von", "gia nhap", "cost", "buy"],
  priceSell: ["gia ban", "gia", "don gia", "price", "sell"],
  stock: ["ton kho", "so luong", "sl", "stock", "ton", "quantity", "qty"],
  taxRate: ["thue", "vat", "thue gtgt", "%", "tax"],
  category: ["danh muc", "loai", "category", "nhom"],
};

function autoDetectColumns(headers: string[]): Partial<Record<ColumnKey, number>> {
  const result: Partial<Record<ColumnKey, number>> = {};
  const normalized = headers.map((h) => normalize(String(h ?? "")));
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    for (const alias of COLUMN_ALIASES[key]) {
      const idx = normalized.findIndex((h) => h === alias || h.includes(alias));
      if (idx !== -1) {
        result[key] = idx;
        break;
      }
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// Cell parse helpers
// -----------------------------------------------------------------------------

function parseString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

/**
 * Barcode: Excel hay convert long digit (EAN-13) thành scientific notation.
 * Đã dùng raw:false ở sheet_to_json để giữ formatted text. Strip non-digit.
 * Verify length đúng EAN-8/UPC-A/EAN-13/GTIN-14.
 */
function parseBarcode(cell: unknown): { value: string; valid: boolean } {
  const raw = parseString(cell);
  if (!raw) return { value: "", valid: true }; // optional
  const digits = raw.replace(/\D/g, "");
  // Reject scientific notation residue (vd. "8.93E12" → "893" → 3 digits sai)
  if (digits.length > 0 && raw.includes("E")) {
    return { value: digits, valid: false };
  }
  // Standard barcode lengths
  const validLengths = [8, 12, 13, 14];
  return {
    value: digits,
    valid: digits.length === 0 || validLengths.includes(digits.length),
  };
}

/**
 * Price/stock: handle Excel native number, hoặc string với "," (VN thousand sep).
 */
function parseNumber(cell: unknown): number | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "number") return cell;
  const s = String(cell).trim().replace(/[\s,]/g, ""); // strip space + comma
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tax rate: chấp nhận "8%", "8", "0.08", "8.0". Output PERCENT (8, không phải 0.08).
 * Validate ∈ {0, 5, 8, 10}.
 */
function parseTaxRate(cell: unknown): { value: number; valid: boolean } {
  if (cell === null || cell === undefined || cell === "") {
    return { value: 8, valid: true }; // default 8%
  }
  const raw = String(cell).trim().replace(/%/g, "").replace(",", ".");
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return { value: 8, valid: false };
  // Nếu < 1 → fraction (0.08 → 8)
  const percent = n < 1 ? Math.round(n * 100) : Math.round(n);
  return {
    value: percent,
    valid: [0, 5, 8, 10].includes(percent),
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

interface ParsedRow {
  excelRow: number; // 1-based row number trong Excel (header = 1)
  name: string;
  barcode: string;
  unit: string;
  priceBuy: number;
  priceSell: number;
  stock: number;
  taxRatePercent: number; // server format
  category: string | null;
  status: "valid" | "warning" | "error";
  errors: string[];
  warnings: string[];
}

function validateRow(
  raw: unknown[],
  excelRow: number,
  mapping: Partial<Record<ColumnKey, number>>,
): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const get = (key: ColumnKey): unknown => {
    const idx = mapping[key];
    return idx !== undefined ? raw[idx] : undefined;
  };

  const name = parseString(get("name"));
  if (!name) errors.push("Tên sản phẩm trống");

  const bc = parseBarcode(get("barcode"));
  if (!bc.valid) errors.push(`Mã vạch không hợp lệ ("${parseString(get("barcode"))}")`);

  const unit = parseString(get("unit")) || "cái";

  const priceSellN = parseNumber(get("priceSell"));
  if (priceSellN === null || priceSellN < 0) {
    errors.push(`Giá bán không hợp lệ ("${parseString(get("priceSell"))}")`);
  }

  const priceBuyN = parseNumber(get("priceBuy"));
  const priceBuy = priceBuyN === null ? 0 : Math.max(0, priceBuyN);
  if (priceBuyN !== null && priceBuyN < 0) {
    warnings.push("Giá vốn âm, dùng 0");
  }

  const stockN = parseNumber(get("stock"));
  const stock = stockN === null ? 0 : stockN;
  if (stockN !== null && stockN < 0) warnings.push("Tồn kho âm");

  const tax = parseTaxRate(get("taxRate"));
  if (!tax.valid) {
    warnings.push(`Thuế ${parseString(get("taxRate"))} không thuộc {0,5,8,10}, dùng 8%`);
  }

  const category = parseString(get("category")) || null;

  const status: ParsedRow["status"] =
    errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";

  return {
    excelRow,
    name,
    barcode: bc.value,
    unit,
    priceBuy: Math.round(priceBuy),
    priceSell: priceSellN !== null && priceSellN >= 0 ? Math.round(priceSellN) : 0,
    stock,
    taxRatePercent: tax.valid ? tax.value : 8,
    category,
    status,
    errors,
    warnings,
  };
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

type Step = "upload" | "preview" | "import" | "result";
type Strategy = "skip" | "overwrite";

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  failedRows: { excelRow: number; reason: string }[];
}

export function BulkImportSheet({ open, onClose }: Props) {
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [step, setStep] = useState<Step>("upload");
  const [parseError, setParseError] = useState<string>();
  const [parsing, setParsing] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ColumnKey, number>>>({});
  const [strategy, setStrategy] = useState<Strategy>("skip");
  const [duplicatesInDb, setDuplicatesInDb] = useState<Set<string>>(new Set());

  // Import progress
  const [completedChunks, setCompletedChunks] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importPaused, setImportPaused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Reset state khi sheet mở/đóng
  useEffect(() => {
    if (!open) return;
    setStep("upload");
    setParseError(undefined);
    setParsing(false);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setStrategy("skip");
    setDuplicatesInDb(new Set());
    setCompletedChunks(0);
    setTotalChunks(0);
    setImporting(false);
    setImportPaused(false);
    setResult(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  // Compute parsed rows từ rawRows + mapping
  const parsedRows = useMemo<ParsedRow[]>(() => {
    if (rawRows.length === 0) return [];
    return rawRows.map((row, i) => validateRow(row, i + 2, mapping));
  }, [rawRows, mapping]);

  // Check trùng barcode trong cùng file (1 lần)
  const fileDuplicates = useMemo<Set<string>>(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const r of parsedRows) {
      if (!r.barcode) continue;
      if (seen.has(r.barcode)) dupes.add(r.barcode);
      seen.add(r.barcode);
    }
    return dupes;
  }, [parsedRows]);

  // Apply file-duplicate warning vào status (không tạo mảng mới, chỉ flag)
  const finalRows = useMemo<ParsedRow[]>(() => {
    return parsedRows.map((r) => {
      if (r.barcode && fileDuplicates.has(r.barcode) && r.status !== "error") {
        return {
          ...r,
          status: "error" as const,
          errors: [...r.errors, "Mã vạch trùng trong file"],
        };
      }
      return r;
    });
  }, [parsedRows, fileDuplicates]);

  const stats = useMemo(() => {
    let valid = 0;
    let warning = 0;
    let error = 0;
    let dbConflict = 0;
    for (const r of finalRows) {
      if (r.status === "error") error++;
      else if (r.status === "warning") warning++;
      else valid++;
      if (r.barcode && duplicatesInDb.has(r.barcode)) dbConflict++;
    }
    return { valid, warning, error, dbConflict, total: finalRows.length };
  }, [finalRows, duplicatesInDb]);

  // -----------------------------------------------------------------
  // Step handlers
  // -----------------------------------------------------------------

  const handleFile = async (file: File) => {
    setParseError(undefined);
    if (file.size > MAX_FILE_BYTES) {
      setParseError("File vượt giới hạn 10MB. Chia nhỏ file rồi thử lại.");
      return;
    }
    setParsing(true);
    try {
      // Lazy load SheetJS — chỉ tải ~100KB khi user thật sự upload
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setParseError("File không có sheet nào.");
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      // raw:false → giữ formatted text (tránh barcode → scientific notation)
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      if (rows.length === 0) {
        setParseError("File rỗng.");
        return;
      }
      const [headerRow, ...dataRows] = rows;
      const cleanHeaders = (headerRow as unknown[]).map((c) => parseString(c));
      if (dataRows.length > MAX_ROWS) {
        setParseError(
          `File quá lớn (${dataRows.length} dòng). Chia nhỏ tối đa ${MAX_ROWS} dòng/lần.`,
        );
        return;
      }
      setHeaders(cleanHeaders);
      setRawRows(dataRows);
      setMapping(autoDetectColumns(cleanHeaders));
      setStep("preview");
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Không đọc được file: ${err.message}`
          : "Không đọc được file (corrupt hoặc sai format).",
      );
    } finally {
      setParsing(false);
    }
  };

  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const data = [
      [
        "Tên sản phẩm",
        "Mã vạch",
        "Đơn vị",
        "Giá vốn",
        "Giá bán",
        "Tồn kho",
        "Thuế (%)",
        "Danh mục",
      ],
      [
        "Mì Hảo Hảo tôm chua cay",
        "8934563138165",
        "gói",
        4200,
        5000,
        100,
        8,
        "Mì gói",
      ],
      [
        "Coca-Cola lon 320ml",
        "8934588063053",
        "lon",
        9500,
        12000,
        48,
        8,
        "Nước ngọt",
      ],
      [
        "Sữa Vinamilk 100% có đường 180ml",
        "8934673001113",
        "hộp",
        8200,
        9500,
        60,
        8,
        "Sữa",
      ],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Sản phẩm");
    XLSX.writeFile(wb, "mau-nhap-san-pham.xlsx");
  };

  const goToImport = async () => {
    if (!orgId) return;
    // Check duplicates in DB chỉ với valid + warning rows có barcode
    const candidateBarcodes = finalRows
      .filter((r) => r.status !== "error" && r.barcode)
      .map((r) => r.barcode);
    if (candidateBarcodes.length > 0) {
      const { data, error } = await supabase
        .from("products")
        .select("barcode")
        .eq("org_id", orgId)
        .in("barcode", candidateBarcodes);
      if (error) {
        setParseError(`Lỗi check trùng: ${error.message}`);
        return;
      }
      setDuplicatesInDb(new Set((data ?? []).map((d) => d.barcode as string)));
    } else {
      setDuplicatesInDb(new Set());
    }
    setStep("import");
  };

  const startImport = async () => {
    if (!orgId) return;
    setImporting(true);
    setImportPaused(false);

    // Phân loại rows:
    // - error → bỏ qua (failed)
    // - barcode trùng DB + strategy 'skip' → bỏ qua (skipped)
    // - còn lại → upsert
    const toImport = finalRows.filter((r) => r.status !== "error");
    const skippedDb = strategy === "skip"
      ? toImport.filter((r) => r.barcode && duplicatesInDb.has(r.barcode))
      : [];
    const skippedSet = new Set(skippedDb.map((r) => r.excelRow));
    const upsertCandidates = toImport.filter((r) => !skippedSet.has(r.excelRow));

    // Build payload — defense-in-depth: org_id từ store, không trust input
    const payload = upsertCandidates.map((r) => ({
      id: crypto.randomUUID(),
      org_id: orgId,
      barcode: r.barcode || null,
      name: r.name,
      unit: r.unit,
      price_buy: r.priceBuy,
      price_sell: r.priceSell,
      stock: r.stock,
      tax_rate: r.taxRatePercent,
      category: r.category,
      is_active: true,
    }));

    const chunks: typeof payload[] = [];
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      chunks.push(payload.slice(i, i + CHUNK_SIZE));
    }
    setTotalChunks(chunks.length);

    const startFromChunk = completedChunks; // resume support
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let inserted = 0;
    let updated = 0;
    const failed: { excelRow: number; reason: string }[] = [];

    try {
      for (let i = startFromChunk; i < chunks.length; i++) {
        if (ctrl.signal.aborted) break;
        const chunk = chunks[i];
        const onConflict = strategy === "overwrite" ? "org_id,barcode" : "id";
        const { error } = await supabase
          .from("products")
          .upsert(chunk, { onConflict })
          .abortSignal(ctrl.signal);
        if (error) {
          // Mặc định coi như cả chunk fail. User retry sẽ resume từ đây.
          throw new Error(error.message);
        }
        if (strategy === "overwrite") {
          // Phân biệt insert vs update khó (Supabase không trả). Đếm chung là updated nếu trùng.
          const dbDupesInChunk = chunk.filter(
            (p) => p.barcode && duplicatesInDb.has(p.barcode),
          ).length;
          updated += dbDupesInChunk;
          inserted += chunk.length - dbDupesInChunk;
        } else {
          inserted += chunk.length;
        }
        // Contribute mỗi product có barcode hợp lệ vào kho cộng đồng
        // (fire-and-forget per row, không block import progress).
        for (const p of chunk) {
          if (p.barcode && /^\d{8,14}$/.test(p.barcode)) {
            contributeBarcode({
              barcode: p.barcode,
              name: p.name,
              brand: p.category ?? undefined,
              defaultUnit: p.unit ?? "cái",
            }).catch(() => undefined);
          }
        }
        setCompletedChunks(i + 1);
      }

      if (ctrl.signal.aborted) {
        setImportPaused(true);
        return;
      }

      // Force pull để Dexie refresh ngay (realtime subscribe sẽ sync nhưng pull
      // là safety net cho events bị miss)
      try {
        await productsSync.pullProducts(orgId);
      } catch {
        // ignore — không critical
      }

      // Failed rows = error rows (đã filter đầu) + nothing else
      const errorRows = finalRows.filter((r) => r.status === "error");
      for (const r of errorRows) {
        failed.push({
          excelRow: r.excelRow,
          reason: r.errors.join("; ") || "Không rõ",
        });
      }

      setResult({
        inserted,
        updated,
        skipped: skippedDb.length,
        failed: failed.length,
        failedRows: failed,
      });
      setStep("result");
      vibrate(15);
    } catch (err) {
      if (ctrl.signal.aborted) {
        setImportPaused(true);
      } else {
        setImportPaused(true);
        setParseError(
          err instanceof Error ? err.message : "Lỗi không xác định",
        );
      }
    } finally {
      setImporting(false);
    }
  };

  const cancelImport = () => {
    abortRef.current?.abort();
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        step === "upload"
          ? "Nhập sản phẩm từ Excel"
          : step === "preview"
            ? "Kiểm tra dữ liệu"
            : step === "import"
              ? "Xác nhận nhập"
              : "Kết quả nhập"
      }
    >
      <div className="px-5 pb-5 flex flex-col gap-4">
        {step === "upload" && (
          <UploadStep
            parsing={parsing}
            error={parseError}
            onFile={handleFile}
            onDownloadTemplate={handleDownloadTemplate}
          />
        )}
        {step === "preview" && (
          <PreviewStep
            headers={headers}
            mapping={mapping}
            onMappingChange={setMapping}
            rows={finalRows}
            stats={stats}
            strategy={strategy}
            onStrategyChange={setStrategy}
            onBack={() => setStep("upload")}
            onContinue={goToImport}
          />
        )}
        {step === "import" && (
          <ImportStep
            stats={stats}
            strategy={strategy}
            importing={importing}
            paused={importPaused}
            completed={completedChunks}
            total={totalChunks}
            error={parseError}
            onStart={startImport}
            onCancel={cancelImport}
            onResume={startImport}
            onBack={() => setStep("preview")}
          />
        )}
        {step === "result" && result && (
          <ResultStep result={result} onClose={onClose} />
        )}
      </div>
    </Sheet>
  );
}

// -----------------------------------------------------------------------------
// Step components
// -----------------------------------------------------------------------------

function UploadStep({
  parsing,
  error,
  onFile,
  onDownloadTemplate,
}: {
  parsing: boolean;
  error?: string;
  onFile: (f: File) => void;
  onDownloadTemplate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <p className="text-sm text-ink-muted">
        Hỗ trợ file Excel (.xlsx, .xls) hoặc CSV. Tối đa 5000 dòng / 10MB.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={parsing}
        className={cn(
          "w-full p-6 rounded-lg border-2 border-dashed border-line bg-bg-subtle/30",
          "hover:border-primary-500 hover:bg-primary-50/30 press transition-colors",
          "flex flex-col items-center gap-2 text-sm text-ink-muted",
          parsing && "opacity-50 pointer-events-none",
        )}
      >
        {parsing ? (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary-700" />
            <span>Đang đọc file...</span>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 text-primary-700" />
            <span className="font-medium text-ink">Chọn file Excel/CSV</span>
            <span className="text-xs">Click để mở dialog</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ""; // reset cho lần upload kế
        }}
      />

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="border-t border-line pt-4">
        <p className="text-sm font-medium mb-2">Chưa có file?</p>
        <Button
          type="button"
          variant="outline"
          onClick={onDownloadTemplate}
          className="w-full"
        >
          <Download className="w-4 h-4" />
          Tải file mẫu (.xlsx)
        </Button>
      </div>
    </>
  );
}

interface PreviewStepProps {
  headers: string[];
  mapping: Partial<Record<ColumnKey, number>>;
  onMappingChange: (m: Partial<Record<ColumnKey, number>>) => void;
  rows: ParsedRow[];
  stats: { valid: number; warning: number; error: number; total: number };
  strategy: Strategy;
  onStrategyChange: (s: Strategy) => void;
  onBack: () => void;
  onContinue: () => void;
}

function PreviewStep({
  headers,
  mapping,
  onMappingChange,
  rows,
  stats,
  strategy,
  onStrategyChange,
  onBack,
  onContinue,
}: PreviewStepProps) {
  const previewRows = rows.slice(0, 10);
  const requiredKeys: ColumnKey[] = ["name", "priceSell"];
  const missingRequired = requiredKeys.filter((k) => mapping[k] === undefined);

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-2">
          <p className="text-lg font-mono tabular-nums font-semibold text-primary-700">
            {stats.valid}
          </p>
          <p className="text-[11px] text-ink-muted">Hợp lệ</p>
        </div>
        <div className="bg-accent/10 border border-accent/20 rounded-lg p-2">
          <p className="text-lg font-mono tabular-nums font-semibold text-accent">
            {stats.warning}
          </p>
          <p className="text-[11px] text-ink-muted">Cảnh báo</p>
        </div>
        <div className="bg-danger-bg border border-danger/20 rounded-lg p-2">
          <p className="text-lg font-mono tabular-nums font-semibold text-danger">
            {stats.error}
          </p>
          <p className="text-[11px] text-ink-muted">Lỗi</p>
        </div>
      </div>

      {/* Column mapping */}
      <section>
        <p className="text-sm font-semibold mb-2">Ánh xạ cột</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(COLUMN_LABEL) as ColumnKey[]).map((key) => {
            const required = requiredKeys.includes(key);
            return (
              <label key={key} className="text-xs">
                <span className="block text-ink-muted mb-0.5">
                  {COLUMN_LABEL[key]}
                  {required && <span className="text-danger"> *</span>}
                </span>
                <select
                  value={mapping[key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onMappingChange({
                      ...mapping,
                      [key]: v === "" ? undefined : Number(v),
                    });
                  }}
                  className={cn(
                    "w-full text-sm px-2 py-1.5 rounded border bg-bg-card",
                    "focus:outline-none focus:ring-2 focus:ring-primary-500",
                    required && mapping[key] === undefined
                      ? "border-danger"
                      : "border-line",
                  )}
                >
                  <option value="">— Bỏ qua —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      Cột {i + 1}: {h || "(rỗng)"}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        {missingRequired.length > 0 && (
          <p className="text-xs text-danger mt-2">
            Thiếu cột bắt buộc: {missingRequired.map((k) => COLUMN_LABEL[k]).join(", ")}
          </p>
        )}
      </section>

      {/* Preview table */}
      <section>
        <p className="text-sm font-semibold mb-2">Xem trước (10 dòng đầu)</p>
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-bg-subtle border-b border-line">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Dòng</th>
                <th className="px-2 py-1.5 text-left font-medium">TT</th>
                <th className="px-2 py-1.5 text-left font-medium">Tên</th>
                <th className="px-2 py-1.5 text-left font-medium">Mã vạch</th>
                <th className="px-2 py-1.5 text-right font-medium">Giá bán</th>
                <th className="px-2 py-1.5 text-right font-medium">Tồn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {previewRows.map((r) => (
                <tr key={r.excelRow}>
                  <td className="px-2 py-1.5 font-mono tabular-nums text-ink-subtle">
                    {r.excelRow}
                  </td>
                  <td className="px-2 py-1.5">
                    <RowStatusBadge row={r} />
                  </td>
                  <td className="px-2 py-1.5 truncate max-w-[120px]">{r.name || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.barcode || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {r.priceSell.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {r.stock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 10 && (
          <p className="text-xs text-ink-subtle mt-1">
            …và {rows.length - 10} dòng khác
          </p>
        )}
      </section>

      {/* Strategy */}
      <section>
        <p className="text-sm font-semibold mb-2">Khi mã vạch trùng tiệm hiện có</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              checked={strategy === "skip"}
              onChange={() => onStrategyChange("skip")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Bỏ qua dòng trùng</span>
              <span className="block text-xs text-ink-muted">
                An toàn, không động vào sản phẩm cũ
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              checked={strategy === "overwrite"}
              onChange={() => onStrategyChange("overwrite")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Ghi đè sản phẩm cũ</span>
              <span className="block text-xs text-ink-muted">
                Cập nhật giá / tồn / tên / đơn vị từ file mới
              </span>
            </span>
          </label>
        </div>
      </section>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} className="flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Quay lại
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onContinue}
          disabled={missingRequired.length > 0 || stats.valid + stats.warning === 0}
          className="flex-1"
        >
          Tiếp tục ({stats.valid + stats.warning} dòng)
        </Button>
      </div>
    </>
  );
}

function RowStatusBadge({ row }: { row: ParsedRow }) {
  if (row.status === "error") {
    return (
      <span
        title={row.errors.join("; ")}
        className="inline-flex items-center text-danger"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (row.status === "warning") {
    return (
      <span
        title={row.warnings.join("; ")}
        className="inline-flex items-center text-accent"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-primary-700">
      <Check className="w-3.5 h-3.5" />
    </span>
  );
}

interface ImportStepProps {
  stats: { valid: number; warning: number; error: number; dbConflict: number; total: number };
  strategy: Strategy;
  importing: boolean;
  paused: boolean;
  completed: number;
  total: number;
  error?: string;
  onStart: () => void;
  onCancel: () => void;
  onResume: () => void;
  onBack: () => void;
}

function ImportStep({
  stats,
  strategy,
  importing,
  paused,
  completed,
  total,
  error,
  onStart,
  onCancel,
  onResume,
  onBack,
}: ImportStepProps) {
  const willImport =
    stats.valid +
    stats.warning -
    (strategy === "skip" ? stats.dbConflict : 0);

  if (!importing && !paused && total === 0) {
    // Confirm screen trước khi start
    return (
      <>
        <div className="bg-bg-subtle/50 rounded-lg p-3 text-sm space-y-1">
          <p className="font-medium">Tóm tắt</p>
          <p className="text-ink-muted">
            • <span className="font-mono">{stats.valid + stats.warning}</span> dòng hợp lệ + cảnh báo
          </p>
          <p className="text-ink-muted">
            • <span className="font-mono">{stats.error}</span> dòng lỗi sẽ bỏ qua
          </p>
          {stats.dbConflict > 0 && (
            <p className="text-ink-muted">
              • <span className="font-mono">{stats.dbConflict}</span> dòng trùng mã vạch trong tiệm —
              {strategy === "skip" ? " sẽ BỎ QUA" : " sẽ GHI ĐÈ sản phẩm cũ"}
            </p>
          )}
          <p className="font-medium pt-1.5">
            Sẽ nhập <span className="text-primary-700">{willImport}</span> sản phẩm
          </p>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
            Quay lại
          </Button>
          <Button type="button" variant="primary" onClick={onStart} className="flex-1">
            Bắt đầu nhập
          </Button>
        </div>
      </>
    );
  }

  // Progress screen
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <>
      <div className="bg-bg-subtle/50 rounded-lg p-3">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium">
            {paused ? "Đã tạm dừng" : importing ? "Đang nhập..." : "Hoàn tất"}
          </span>
          <span className="font-mono tabular-nums text-ink-muted">
            {completed}/{total} chunk · {pct}%
          </span>
        </div>
        <div className="h-2 bg-bg-card rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-700 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-ink-muted mt-2">
          Đã nhập ~{completed * CHUNK_SIZE} dòng
        </p>
      </div>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {paused && (
        <p className="text-sm text-ink-muted">
          Mất kết nối hoặc bị hủy. Có thể nối tiếp từ chunk {completed + 1}/
          {total}.
        </p>
      )}

      <div className="flex gap-2 pt-2">
        {importing ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex-1"
          >
            Hủy
          </Button>
        ) : paused ? (
          <Button
            type="button"
            variant="primary"
            onClick={onResume}
            className="flex-1"
          >
            Thử lại từ chunk {completed + 1}
          </Button>
        ) : null}
      </div>
    </>
  );
}

function ResultStep({
  result,
  onClose,
}: {
  result: ImportResult;
  onClose: () => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <ResultCard label="Mới" value={result.inserted} variant="primary" />
        <ResultCard label="Cập nhật" value={result.updated} variant="primary" />
        <ResultCard label="Bỏ qua" value={result.skipped} variant="muted" />
        <ResultCard label="Lỗi" value={result.failed} variant="danger" />
      </div>

      {result.failedRows.length > 0 && (
        <section>
          <p className="text-sm font-semibold mb-2 text-danger">
            Chi tiết dòng lỗi (10 đầu tiên)
          </p>
          <ul className="bg-danger-bg/30 border border-danger/20 rounded-lg divide-y divide-danger/10">
            {result.failedRows.slice(0, 10).map((f, i) => (
              <li key={i} className="px-3 py-2 text-xs">
                <span className="font-mono text-danger">Dòng {f.excelRow}:</span>{" "}
                <span className="text-ink-muted">{f.reason}</span>
              </li>
            ))}
            {result.failedRows.length > 10 && (
              <li className="px-3 py-2 text-xs text-ink-subtle italic">
                …và {result.failedRows.length - 10} dòng lỗi khác
              </li>
            )}
          </ul>
        </section>
      )}

      <Button type="button" variant="primary" onClick={onClose} className="w-full">
        Đóng
      </Button>
    </>
  );
}

function ResultCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "primary" | "muted" | "danger";
}) {
  const cls =
    variant === "primary"
      ? "bg-primary-50 border-primary-100 text-primary-700"
      : variant === "danger"
        ? "bg-danger-bg border-danger/20 text-danger"
        : "bg-bg-subtle border-line text-ink-muted";
  return (
    <div className={cn("rounded-lg p-3 border text-center", cls)}>
      <p className="text-2xl font-mono tabular-nums font-semibold">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}
