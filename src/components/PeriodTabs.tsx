import { cn } from "@/lib/utils";

export type Period = "today" | "week" | "month";

export const PERIOD_LABEL: Record<Period, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
};

/**
 * Trả [start, end] timestamp ms theo client local timezone.
 * VN convention week starts Monday.
 */
export function periodRange(period: Period): [number, number] {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") {
    // Monday này (getDay: 0=CN, 1=T2, ..., 6=T7)
    const d = start.getDay();
    const diff = d === 0 ? 6 : d - 1; // CN → lùi 6 ngày, T2 → 0
    start.setDate(start.getDate() - diff);
  } else if (period === "month") {
    start.setDate(1);
  }
  return [start.getTime(), now.getTime()];
}

interface Props {
  value: Period;
  onChange: (next: Period) => void;
  className?: string;
}

/**
 * 3 tab pill chọn khoảng thời gian. Reusable cho ReportsPage + OrdersPage.
 */
export function PeriodTabs({ value, onChange, className }: Props) {
  return (
    <div className={cn("flex gap-2", className)}>
      {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium press min-h-[36px]",
            value === p
              ? "bg-primary-700 text-white"
              : "bg-bg-card border border-line text-ink-muted hover:bg-bg-subtle",
          )}
        >
          {PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );
}
