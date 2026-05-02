import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShopWithStats, SubscriptionStatus } from "@/types";

const GOONG_KEY = import.meta.env.VITE_GOONG_API_KEY ?? "";
const MAP_STYLE = "https://tiles.goong.io/assets/goong_map_web.json";

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

interface Props {
  shops: ShopWithStats[];
  /** Tap "Xem chi tiết" trong popup → callback navigate */
  onShopClick?: (orgId: string) => void;
  /** Override height; default mobile 300px, desktop 500px */
  className?: string;
}

/**
 * Bản đồ shops với marker theo status. Lazy import @goongmaps/goong-js (~150KB).
 * Map.remove() trên unmount để tránh leak.
 */
export function ShopsMap({ shops, onShopClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const goongRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<SubscriptionStatus>>(
    () => new Set(FILTERABLE_STATUSES),
  );

  const shopsWithCoords = shops.filter(
    (s) =>
      s.latitude !== null &&
      s.longitude !== null &&
      !Number.isNaN(Number(s.latitude)) &&
      !Number.isNaN(Number(s.longitude)),
  );

  // Init map (1 lần khi mount)
  useEffect(() => {
    if (!GOONG_KEY) {
      setLoading(false);
      setError("Goong API key chưa cấu hình");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Load JS + CSS song song (CSS cần cho popup + nav controls render đúng)
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
          center: [107.5, 15.5], // VN center [lng, lat]
          zoom: 5,
        });
        mapRef.current = map;
        goongRef.current = goong;
        map.on("load", () => {
          if (!cancelled) setLoading(false);
        });
      } catch (e) {
        if (cancelled) return;
        console.error("[ShopsMap] init failed:", e);
        setError(
          e instanceof Error ? e.message : "Không thể tải bản đồ",
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      // Cleanup markers + map
      markersRef.current.forEach((m) => m.remove?.());
      markersRef.current = [];
      mapRef.current?.remove?.();
      mapRef.current = null;
      goongRef.current = null;
    };
  }, []);

  // Render markers + auto-fit bounds khi shops/filters đổi
  useEffect(() => {
    const map = mapRef.current;
    const goong = goongRef.current;
    if (!map || !goong || loading) return;

    // Clear markers cũ
    markersRef.current.forEach((m) => m.remove?.());
    markersRef.current = [];

    const filtered = shopsWithCoords.filter((s) => activeFilters.has(s.status));
    if (filtered.length === 0) return;

    const bounds = new goong.LngLatBounds();
    for (const s of filtered) {
      const lng = Number(s.longitude);
      const lat = Number(s.latitude);
      const color = MARKER_COLORS[s.status];

      // Custom marker DOM (tròn + viền trắng + shadow)
      const el = document.createElement("div");
      el.className =
        "rounded-full border-2 border-white shadow-md cursor-pointer";
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.backgroundColor = color;
      el.setAttribute("aria-label", s.org_name);

      // Popup HTML — escape user-controlled fields qua textContent
      const popupContainer = document.createElement("div");
      popupContainer.className = "p-1 max-w-[220px]";
      const title = document.createElement("p");
      title.className = "text-sm font-semibold mb-1";
      title.textContent = s.org_name;
      popupContainer.appendChild(title);

      const badge = document.createElement("span");
      badge.className =
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-medium";
      badge.style.backgroundColor = color + "1a"; // 10% opacity
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
    // Khi filtered rỗng nhưng đã có shops → giữ nguyên view trước
  }, [shopsWithCoords, activeFilters, loading, onShopClick]);

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

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden border border-line bg-bg-subtle",
        "h-[300px] md:h-[500px]",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-subtle">
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Đang tải bản đồ...</p>
          </div>
        </div>
      )}

      {/* Error / no key */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="bg-bg-card rounded-lg p-4 max-w-sm text-center">
            <MapPin className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
            <p className="text-sm font-medium">{error}</p>
            <p className="text-xs text-ink-muted mt-1">
              Cấu hình VITE_GOONG_API_KEY trong .env.local
            </p>
          </div>
        </div>
      )}

      {/* Empty state khi không có shop nào với coords */}
      {!loading && !error && totalWithCoords === 0 && (
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

      {/* Counter overlay top-left */}
      {!loading && !error && totalWithCoords > 0 && (
        <div className="absolute top-3 left-3 bg-bg-card/95 backdrop-blur rounded-lg px-3 py-1.5 shadow-soft text-xs font-medium">
          Hiển thị{" "}
          <span className="font-semibold text-primary-700">{visibleCount}</span>
          /{totalWithCoords} shops
        </div>
      )}

      {/* Filter overlay top-right */}
      {!loading && !error && totalWithCoords > 0 && (
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
