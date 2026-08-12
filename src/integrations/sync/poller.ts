import { api } from "@/integrations/api";

/**
 * Thay thế realtime của Supabase bằng poll theo `updated_at`.
 *
 * Vì sao poll chứ không phải websocket: server tự host chưa có tầng realtime,
 * và với tạp hóa thì độ trễ vài giây là chấp nhận được — một tiệm có 1–3 máy,
 * thay đổi từ máy khác không cần tới ngay lập tức. Đổi lại: không phải nuôi
 * kết nối websocket qua IIS, không phải xử lý reconnect, và hoạt động tốt trên
 * 3G chập chờn.
 *
 * Điểm quan trọng: chỉ kéo hàng có `updated_at` MỚI HƠN lần trước, nên mỗi
 * nhịp poll gần như không tốn gì khi không có thay đổi.
 */

const DEFAULT_INTERVAL_MS = 20_000;

export interface PollerOptions<Row> {
  /** Tên bảng ở API. */
  table: string;
  /** Áp từng hàng mới về Dexie. */
  apply: (rows: Row[]) => Promise<void>;
  /** Lấy mốc `updated_at` lớn nhất trong tập vừa nhận, để lần sau hỏi tiếp. */
  watermarkOf: (rows: Row[]) => string | null;
  intervalMs?: number;
}

// Không ràng buộc Row vào Record<string, unknown>: các interface *Row khai
// tường minh từng cột nên không có index signature, và ép chúng thêm vào chỉ
// để chiều generic sẽ làm mất kiểm tra kiểu ở chỗ khác.
export class Poller<Row> {
  private orgId: string | null = null;
  private since: string | null = null;
  private timer: number | null = null;
  private running = false;
  private onVisible: (() => void) | null = null;
  private onOnline: (() => void) | null = null;

  constructor(private readonly opts: PollerOptions<Row>) {}

  /**
   * Bắt đầu theo dõi một tiệm. Gọi lại với cùng orgId là no-op, với orgId khác
   * thì chuyển sang tiệm mới và quên mốc cũ.
   */
  start(orgId: string, since: string | null = null): void {
    if (this.orgId === orgId && this.timer !== null) return;
    this.stop();
    this.orgId = orgId;
    this.since = since;

    const interval = this.opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timer = window.setInterval(() => void this.tick(), interval);

    // Quay lại tab hoặc mạng vừa lên là lúc dữ liệu lệch nhiều nhất — kéo ngay
    // thay vì đợi hết nhịp.
    this.onVisible = () => {
      if (document.visibilityState === "visible") void this.tick();
    };
    this.onOnline = () => void this.tick();
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onOnline);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.onVisible) {
      document.removeEventListener("visibilitychange", this.onVisible);
      this.onVisible = null;
    }
    if (this.onOnline) {
      window.removeEventListener("online", this.onOnline);
      this.onOnline = null;
    }
    this.orgId = null;
    this.since = null;
  }

  /** Ép kéo ngay một nhịp (dùng sau khi ghi xong để thấy kết quả liền). */
  async tick(): Promise<void> {
    if (!this.orgId || this.running || !navigator.onLine) return;
    this.running = true;
    try {
      const rows = await api.list<Row>(this.opts.table, {
        org_id: this.orgId,
        since: this.since ?? undefined,
      });
      if (rows.length > 0) {
        await this.opts.apply(rows);
        const mark = this.opts.watermarkOf(rows);
        if (mark) this.since = mark;
      }
    } catch (err) {
      // Mất mạng là chuyện thường với app này — im lặng, nhịp sau thử lại.
      if (import.meta.env.DEV) {
        console.warn(`[poller:${this.opts.table}]`, err);
      }
    } finally {
      this.running = false;
    }
  }
}

/** Mốc watermark chung: `updated_at` lớn nhất trong tập. */
export function maxUpdatedAt(rows: Array<{ updated_at?: string }>): string | null {
  let max: string | null = null;
  for (const r of rows) {
    if (r.updated_at && (max === null || r.updated_at > max)) max = r.updated_at;
  }
  return max;
}
