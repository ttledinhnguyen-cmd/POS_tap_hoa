import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const GOONG_KEY = import.meta.env.VITE_GOONG_API_KEY ?? "";
const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 3;

interface Suggestion {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

export interface AddressDetail {
  address_full: string;
  latitude: number | null;
  longitude: number | null;
  ward?: string;
  district?: string;
  province?: string;
}

interface Props {
  /** Text hiện tại trong input (controlled). Parent giữ state. */
  value: string;
  /** Khi user gõ tay → fire với address text only, lat/lng undefined.
   *  Khi user chọn suggestion → fire với full detail (lat/lng + ward/district/province). */
  onChange: (next: string, detail?: AddressDetail) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Optional: textarea variant (height auto) thay vì single-line input */
  textarea?: boolean;
}

/**
 * AddressAutocomplete — input + dropdown gợi ý địa chỉ từ Goong /Place/AutoComplete.
 * Tap suggestion → call /Place/Detail get lat/lng → onChange với detail.
 *
 * Graceful degradation:
 *   - Goong key thiếu → render input thường (không call API), warn DEV
 *   - Network/API fail → fallback cho user gõ manual, không block submit
 */
export function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  disabled,
  textarea,
}: Props) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Track last query đã call, tránh duplicate request khi user tap suggestion
  // (set value qua onChange → useEffect re-fire query với cùng text)
  const lastQueriedRef = useRef<string>("");

  const hasKey = !!GOONG_KEY;

  // Đóng dropdown khi pointer xuống ngoài (mobile-friendly)
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  // Debounced fetch suggestions
  useEffect(() => {
    if (!hasKey) return;
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      return;
    }
    if (trimmed === lastQueriedRef.current) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      lastQueriedRef.current = trimmed;
      setLoading(true);
      try {
        const url = `https://rsapi.goong.io/Place/AutoComplete?api_key=${encodeURIComponent(
          GOONG_KEY,
        )}&input=${encodeURIComponent(trimmed)}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { predictions?: Suggestion[] };
        if (cancelled) return;
        setSuggestions(j.predictions ?? []);
      } catch (e) {
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.warn("[AddressAutocomplete] Goong autocomplete failed:", e);
        }
        setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, hasKey]);

  async function pickSuggestion(s: Suggestion) {
    setOpen(false);
    setResolving(true);
    try {
      const url = `https://rsapi.goong.io/Place/Detail?api_key=${encodeURIComponent(
        GOONG_KEY,
      )}&place_id=${encodeURIComponent(s.place_id)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        result?: {
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
          compound?: {
            commune?: string;
            district?: string;
            province?: string;
          };
        };
      };
      const result = j.result;
      const address_full = result?.formatted_address ?? s.description;
      const lat = result?.geometry?.location?.lat ?? null;
      const lng = result?.geometry?.location?.lng ?? null;
      const detail: AddressDetail = {
        address_full,
        latitude: lat,
        longitude: lng,
        ward: result?.compound?.commune,
        district: result?.compound?.district,
        province: result?.compound?.province,
      };
      // Bump lastQueried để useEffect không re-fetch suggestions sau khi
      // value đổi thành address_full (tránh dropdown nhấp nháy)
      lastQueriedRef.current = address_full;
      onChange(address_full, detail);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn("[AddressAutocomplete] Goong detail failed:", e);
      }
      // Fallback: dùng description, không có lat/lng
      lastQueriedRef.current = s.description;
      onChange(s.description, {
        address_full: s.description,
        latitude: null,
        longitude: null,
      });
    } finally {
      setResolving(false);
    }
  }

  const inputClass =
    "w-full pr-10 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        {textarea ? (
          <textarea
            rows={2}
            value={value}
            disabled={disabled || resolving}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder ?? "Số nhà, đường, phường, quận, tỉnh..."}
            className={cn(
              "h-auto py-2 px-3 rounded-lg border border-line bg-bg-card resize-none",
              inputClass,
            )}
          />
        ) : (
          <input
            type="text"
            value={value}
            disabled={disabled || resolving}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder ?? "Số nhà, đường, phường, quận, tỉnh..."}
            className={cn(
              "h-touch px-3 rounded-lg border border-line bg-bg-card",
              inputClass,
            )}
          />
        )}
        {(loading || resolving) && (
          <Loader2 className="absolute right-3 top-3 w-4 h-4 animate-spin text-ink-subtle" />
        )}
      </div>

      {!hasKey && (
        <p className="text-[11px] text-ink-subtle mt-1">
          Goong API key chưa cấu hình — gõ địa chỉ thủ công
        </p>
      )}

      {open && hasKey && value.trim().length >= MIN_QUERY_LEN && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto bg-bg-card border border-line rounded-lg shadow-soft py-1">
          {loading && suggestions.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-muted flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Đang tìm địa chỉ...
            </div>
          )}
          {!loading && suggestions.length === 0 && (
            <p className="px-3 py-2 text-sm text-ink-muted">
              Không tìm thấy địa chỉ
            </p>
          )}
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => pickSuggestion(s)}
              className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-bg-subtle press"
            >
              <MapPin className="w-4 h-4 text-ink-muted flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {s.structured_formatting?.main_text ?? s.description}
                </p>
                {s.structured_formatting?.secondary_text && (
                  <p className="text-xs text-ink-muted truncate">
                    {s.structured_formatting.secondary_text}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
