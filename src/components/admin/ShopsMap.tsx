import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShopWithStats, SubscriptionStatus } from "@/types";

const GOONG_KEY = import.meta.env.VITE_GOONG_API_KEY ?? "";
const MAP_STYLE = "https://tiles.goong.io/assets/goong_map_web.json";

/** Timeout dynamic map init (ms). Sau ngưỡng → fallback static. */
const DYNAMIC_INIT_TIMEOUT_MS = 10_000;

// Color theo status — match design tokens
const MARKER_COLORS: Record<SubscriptionStatus, string> = {
  active: "#0F766E",
  trial: "#E76F51",
  expired: "#DC2626",
  suspended: "#6B6B68",
  cancelled: "#9CA3AF",
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trial: "Trial",
  expired: "Hết hạn",
  suspended: "Tạm khóa",
  cancelled: "Hủy",
};

const FILTERABLE_STATUSES: SubscriptionStatus[] = [
  "active",
  "trial",
  "expired",
  "suspended",
];

/**
 * Detect WebGL support trước khi load goong-js (~195KB chunk).
 * Zalo in-app browser, iOS Safari old, Chrome Lite mode có thể disable WebGL.
 * Catch try/catch để bắt cả case context creation throw exception.
 */
function hasWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const ctx =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return !!ctx;
  } catch {
    return false;
  }
}

interface Props {
  shops: ShopWithStats[];
  /** Tap "Xem chi tiết" trong popup → callback navigate */
  onShopClick?: (orgId: string) => void;
  /** Override height; default mobile 300px, desktop 500px */
  className?: string;
}

/**
 * Bản đồ shops với 2-tier strategy:
 *
 *   1. Dynamic interactive map (goong-js, WebGL) — desktop + mobile modern
 *   2. Static map fallback (Goong Static Map API + img tag) — cho:
 *      - WebGL không support (Zalo browser, iOS old, Chrome Lite)
 *      - Dynamic init timeout > 10s (3G/4G chậm)
 *      - User skip loading thủ công
 *
 * Static fallback render thumbnail map qua /staticmap endpoint + list shops
 * dưới với link tới Goong web map full-screen (mở tab mới).
 */
export function ShopsMap({ shops, onShopClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const goongRef = useRef<any>(null);

  // 4 states: 'detecting' (init) → 'dynamic' | 'static' (fork)
  const [renderMode, setRenderMode] = useState<
    "detecting" | "dynamic-loading" | "dynamic-ready" | "static" | "error"
  >(() => (GOONG_KEY ? "detecting" : "error"));
  const [errorMsg] = useState<string | null>(
    GOONG_KEY ? null : "Goong API key chưa cấu hình",
  );
  const [activeFilters, setActiveFilters] = useState<Set<SubscriptionStatus>>(
    () => new Set(FILTERABLE_STATUSES),
  );
  // Countdown loading hint — second-by-second
  const [loadingSec, setLoadingSec] = useState(0);

  const shopsWithCoords = shops.filter(
    (s) =>
      s.latitude !== null &&
      s.longitude !== null &&
      !Number.isNaN(Number(s.latitude)) &&
      !Number.isNaN(Number(s.longitude)),
  );

  // Step 1: detect WebGL → fork dynamic vs static
  useEffect(() => {
    if (renderMode !== "detecting") return;
    if (!hasWebGL()) {
      console.warn("[ShopsMap] WebGL not supported → fallback static map");
      setRenderMode("static");
      return;
    }
    setRenderMode("dynamic-loading");
  }, [renderMode]);

  // Countdown timer + 10s timeout → fallback static
  useEffect(() => {
    if (renderMode !== "dynamic-loading") {
      setLoadingSec(0);
      return;
    }
    setLoadingSec(0);
    const interval = window.setInterval(() => {
      setLoadingSec((s) => s + 1);
    }, 1000);
    const timeout = window.setTimeout(() => {
      console.warn(
        "[ShopsMap] dynamic init timeout 10s → fallback static map",
      );
      setRenderMode((curr) =>
        curr === "dynamic-loading" ? "static" : curr,
      );
    }, DYNAMIC_INIT_TIMEOUT_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [renderMode]);

  // Step 2: Init dynamic map (chỉ chạy khi mode='dynamic-loading')
  useEffect(() => {
    if (renderMode !== "dynamic-loading") return;
    let cancelled = false;
    (async () => {
      try {
        const [mod] = await Promise.all([
          import("@goongmaps/goong-js"),
          import("@goongmaps/goong-js/dist/goong-js.css"),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const goong = (mod.default ?? mod) as any;
        if (cancelled || !containerRef.current) return;
        goong.accessToken = GOONG_KEY;
        const map = new goong.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: [107.5, 15.5],
          zoom: 5,
        });
        mapRef.current = map;
        goongRef.current = goong;
        map.on("load", () => {
          if (!cancelled) setRenderMode("dynamic-ready");
        });
        map.on("error", (e: unknown) => {
          if (cancelled) return;
          console.warn("[ShopsMap] map error → fallback static:", e);
          setRenderMode("static");
        });
      } catch (e) {
        if (cancelled) return;
        console.error("[ShopsMap] init failed → fallback static:", e);
        setRenderMode("static");
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove?.());
      markersRef.current = [];
      mapRef.current?.remove?.();
      mapRef.current = null;
      goongRef.current = null;
    };
  }, [renderMode]);

  // Step 3: Render markers khi dynamic-ready hoặc filter đổi
  useEffect(() => {
    const map = mapRef.current;
    const goong = goongRef.current;
    if (!map || !goong || renderMode !== "dynamic-ready") return;

    markersRef.current.forEach((m) => m.remove?.());
    markersRef.current = [];

    const filtered = shopsWithCoords.filter((s) => activeFilters.has(s.status));
    if (filtered.length === 0) return;

    const bounds = new goong.LngLatBounds();
    for (const s of filtered) {
      const lng = Number(s.longitude);
      const lat = Number(s.latitude);
      const color = MARKER_COLORS[s.status];

      const el = document.createElement("div");
      el.className =
        "rounded-full border-2 border-white shadow-md cursor-pointer";
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.backgroundColor = color;
      el.setAttribute("aria-label", s.org_name);

      const popupContainer = document.createElement("div");
      popupContainer.className = "p-1 max-w-[220px]";
      const title = document.createElement("p");
      title.className = "text-sm font-semibold mb-1";
      title.textContent = s.org_name;
      popupContainer.appendChild(title);

      const badge = document.createElement("span");
      badge.className =
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-medium";
      badge.style.backgroundColor = color + "1a";
      badge.style.color = color;
      badge.textContent = STATUS_LABEL[s.status];
      popupContainer.appendChild(badge);

      if (s.address_full) {
        const addr = document.createElement("p");
        addr.className = "text-xs text-ink-muted mt-1 truncate";
        addr.textContent = s.address_full;
        popupContainer.appendChild(addr);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "mt-2 w-full text-xs font-medium text-primary-700 hover:underline";
      button.textContent = "Xem chi tiết →";
      button.addEventListener("click", () => {
        if (onShopClick) onShopClick(s.org_id);
      });
      popupContainer.appendChild(button);

      const popup = new goong.Popup({ offset: 14, closeButton: true }).setDOMContent(
        popupContainer,
      );

      const marker = new goong.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([lng, lat]);
    }

    if (filtered.length === 1) {
      map.flyTo({ center: bounds.getCenter(), zoom: 14, essential: true });
    } else if (filtered.length > 1) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
    }
  }, [shopsWithCoords, activeFilters, renderMode, onShopClick]);

  function toggleFilter(status: SubscriptionStatus) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  const totalWithCoords = shopsWithCoords.length;
  const visibleCount = shopsWithCoords.filter((s) =>
    activeFilters.has(s.status),
  ).length;

  // -------------------------------------------------------------------------
  // STATIC FALLBACK rendering
  // -------------------------------------------------------------------------
  if (renderMode === "static") {
    return (
      <StaticMapFallback
        shops={shopsWithCoords}
        activeFilters={activeFilters}
        toggleFilter={toggleFilter}
        onShopClick={onShopClick}
        className={className}
      />
    );
  }

  // -------------------------------------------------------------------------
  // ERROR rendering (no key)
  // -------------------------------------------------------------------------
  if (renderMode === "error") {
    return (
      <div
        className={cn(
          "relative rounded-lg overflow-hidden border border-line bg-bg-subtle",
          "h-[300px] md:h-[500px]",
          className,
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="bg-bg-card rounded-lg p-4 max-w-sm text-center">
            <MapPin className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
            <p className="text-sm font-medium">{errorMsg}</p>
            <p className="text-xs text-ink-muted mt-1">
              Cấu hình VITE_GOONG_API_KEY trong .env.local
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // DYNAMIC rendering (loading + ready)
  // -------------------------------------------------------------------------
  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden border border-line bg-bg-subtle",
        "h-[300px] md:h-[500px]",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading overlay với countdown + skip button */}
      {(renderMode === "detecting" || renderMode === "dynamic-loading") && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-subtle">
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">
              Đang tải bản đồ...{" "}
              {loadingSec > 0 && (
                <span className="text-xs tabular-nums">({loadingSec}s)</span>
              )}
            </p>
            {loadingSec >= 3 && (
              <button
                type="button"
                onClick={() => setRenderMode("static")}
                className="mt-2 text-xs text-primary-700 hover:underline press"
              >
                Chuyển sang chế độ tĩnh →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {renderMode === "dynamic-ready" && totalWithCoords === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
          <div className="bg-bg-card/95 rounded-lg p-4 max-w-sm text-center pointer-events-auto">
            <MapPin className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
            <p className="text-sm font-medium">Chưa có địa chỉ</p>
            <p className="text-xs text-ink-muted mt-1">
              Tạo shop với địa chỉ chi tiết (qua autocomplete) để hiển thị
              trên bản đồ.
            </p>
          </div>
        </div>
      )}

      {/* Counter overlay */}
      {renderMode === "dynamic-ready" && totalWithCoords > 0 && (
        <div className="absolute top-3 left-3 bg-bg-card/95 backdrop-blur rounded-lg px-3 py-1.5 shadow-soft text-xs font-medium">
          Hiển thị{" "}
          <span className="font-semibold text-primary-700">{visibleCount}</span>
          /{totalWithCoords} shops
        </div>
      )}

      {/* Filter overlay */}
      {renderMode === "dynamic-ready" && totalWithCoords > 0 && (
        <div className="absolute top-3 right-3 bg-bg-card/95 backdrop-blur rounded-lg p-2 shadow-soft flex flex-col gap-1">
          {FILTERABLE_STATUSES.map((status) => {
            const checked = activeFilters.has(status);
            return (
              <label
                key={status}
                className="flex items-center gap-2 text-xs cursor-pointer press px-1"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFilter(status)}
                  className="accent-primary-700"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: MARKER_COLORS[status] }}
                />
                <span className="font-medium">{STATUS_LABEL[status]}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// StaticMapFallback — img tag với Goong Static Map API + list shops dưới
// ============================================================================

interface FallbackProps {
  shops: ShopWithStats[];
  activeFilters: Set<SubscriptionStatus>;
  toggleFilter: (s: SubscriptionStatus) => void;
  onShopClick?: (orgId: string) => void;
  className?: string;
}

/**
 * Compute bounding box → center + zoom approximation cho static map.
 * Goong static map endpoint không hỗ trợ auto-fit, phải tự tính.
 */
function computeViewport(
  shops: ShopWithStats[],
): { center: [number, number]; zoom: number } {
  if (shops.length === 0) return { center: [107.5, 15.5], zoom: 5 };
  const lngs = shops.map((s) => Number(s.longitude));
  const lats = shops.map((s) => Number(s.latitude));
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const center: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  if (shops.length === 1) return { center, zoom: 13 };
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const span = Math.max(lngSpan, latSpan);
  // Heuristic zoom: span 180° → z=1, span 0.01° → z=15
  let zoom = 11;
  if (span > 20) zoom = 4;
  else if (span > 5) zoom = 6;
  else if (span > 1) zoom = 8;
  else if (span > 0.1) zoom = 11;
  else zoom = 13;
  return { center, zoom };
}

/**
 * Build static map URL — markers encoded với color theo status.
 * Goong endpoint: /staticmap?center={lat,lng}&zoom={z}&size=WxH&markers=color:HEX|lat,lng|...&api_key=KEY
 * Note: Goong markers param expect color WITHOUT '#'.
 */
function buildStaticMapUrl(
  shops: ShopWithStats[],
  width: number,
  height: number,
): string {
  const { center, zoom } = computeViewport(shops);
  // Group markers theo color để compress URL (Goong cho phép multiple coords/group)
  const grouped = new Map<string, string[]>();
  for (const s of shops) {
    const color = MARKER_COLORS[s.status].replace("#", "");
    const coord = `${Number(s.latitude)},${Number(s.longitude)}`;
    const arr = grouped.get(color) ?? [];
    arr.push(coord);
    grouped.set(color, arr);
  }
  const markerParams: string[] = [];
  for (const [color, coords] of grouped) {
    markerParams.push(`color:${color}|${coords.join("|")}`);
  }
  const params = new URLSearchParams({
    center: `${center[1]},${center[0]}`, // lat,lng
    zoom: String(zoom),
    size: `${width}x${height}`,
    api_key: GOONG_KEY,
  });
  let url = `https://rsapi.goong.io/staticmap?${params.toString()}`;
  for (const m of markerParams) {
    url += `&markers=${encodeURIComponent(m)}`;
  }
  return url;
}

function StaticMapFallback({
  shops,
  activeFilters,
  toggleFilter,
  onShopClick,
  className,
}: FallbackProps) {
  const [imgError, setImgError] = useState(false);
  const filtered = shops.filter((s) => activeFilters.has(s.status));
  const totalWithCoords = shops.length;
  const visibleCount = filtered.length;

  // Width fixed 640 (free tier max), height tỷ lệ container responsive
  const imgUrl =
    filtered.length > 0
      ? buildStaticMapUrl(filtered, 640, 320)
      : null;

  // External link mở Goong web map full
  const { center, zoom } = computeViewport(filtered.length > 0 ? filtered : shops);
  const externalUrl = `https://map.goong.io/?center=${center[1]},${center[0]}&zoom=${zoom}`;

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden border border-line bg-bg-subtle",
        "min-h-[300px] md:min-h-[500px]",
        className,
      )}
    >
      {/* Static map image */}
      <div className="relative h-[200px] md:h-[300px] bg-bg-subtle">
        {imgUrl && !imgError ? (
          <img
            src={imgUrl}
            alt="Bản đồ shops"
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
            <div className="bg-bg-card/95 rounded-lg p-4 max-w-sm text-center pointer-events-auto">
              <MapPin className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
              <p className="text-sm font-medium">
                {totalWithCoords === 0
                  ? "Chưa có địa chỉ"
                  : visibleCount === 0
                    ? "Không có shop khớp filter"
                    : "Không tải được bản đồ tĩnh"}
              </p>
              {totalWithCoords === 0 && (
                <p className="text-xs text-ink-muted mt-1">
                  Tạo shop với địa chỉ chi tiết để hiển thị.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Banner báo chế độ static */}
        <div className="absolute top-2 left-2 bg-accent/90 text-white text-[10px] font-medium rounded px-2 py-0.5">
          Chế độ tĩnh
        </div>

        {/* Filter overlay top-right (cùng UI) */}
        {totalWithCoords > 0 && (
          <div className="absolute top-2 right-2 bg-bg-card/95 backdrop-blur rounded-lg p-1.5 shadow-soft flex flex-col gap-0.5">
            {FILTERABLE_STATUSES.map((status) => {
              const checked = activeFilters.has(status);
              return (
                <label
                  key={status}
                  className="flex items-center gap-1.5 text-[11px] cursor-pointer press px-1"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFilter(status)}
                    className="accent-primary-700 w-3 h-3"
                  />
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: MARKER_COLORS[status] }}
                  />
                  <span className="font-medium">{STATUS_LABEL[status]}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Header + external link */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-line bg-bg-card text-xs">
        <span className="text-ink-muted">
          Hiển thị{" "}
          <span className="font-semibold text-primary-700">{visibleCount}</span>
          /{totalWithCoords} shops
        </span>
        {totalWithCoords > 0 && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-primary-700 font-medium hover:underline press"
          >
            Mở Goong Map
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Shop list dưới — clickable rows replace popup */}
      {filtered.length > 0 && (
        <ul className="divide-y divide-line/60 max-h-[260px] overflow-y-auto bg-bg-card">
          {filtered.map((s) => {
            const color = MARKER_COLORS[s.status];
            return (
              <li key={s.org_id}>
                <button
                  type="button"
                  onClick={() => onShopClick?.(s.org_id)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-bg-subtle press"
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-1 border-2 border-white shadow"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.org_name}
                    </p>
                    {s.address_full && (
                      <p className="text-xs text-ink-muted truncate">
                        {s.address_full}
                      </p>
                    )}
                  </div>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      backgroundColor: color + "1a",
                      color: color,
                    }}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Avoid unused import (X reserved cho future "close fallback" button)
void X;
