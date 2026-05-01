import { db } from "@/lib/db";
import type { OutboxJob } from "@/integrations/shared/queue";
import { supabase } from "@/integrations/supabase";

/**
 * Backoff schedule cho retry sau lỗi (mạng / 5xx).
 * 1s → 5s → 30s → 5m → 30m. Sau lần thứ 5 fail → permanent failed (UI manual retry).
 */
const BACKOFF_MS = [1_000, 5_000, 30_000, 300_000, 1_800_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1; // 6 tổng (1 fresh + 5 retries)

const DRAIN_INTERVAL_MS = 30_000; // safety net poll
const BATCH_SIZE = 5;
const DONE_KEEP_MS = 7 * 24 * 3600 * 1000; // xóa job done > 7 ngày (audit trail)

/**
 * Outbox Worker — Phase 4 (Browser only).
 *
 * Drain triggers:
 *   - window.online event (mạng vừa lên)
 *   - document.visibilitychange → visible (user quay lại tab)
 *   - setInterval 30s (safety net)
 *   - Manual: outboxWorker.drainNow() khi UI vừa enqueue job
 *
 * Multi-tab: chấp nhận race condition. Supabase upsert idempotent (cùng id →
 * UPDATE no-op). Phase 4 không claim/lock — cải thiện khi cần.
 */
class OutboxWorker {
  private started = false;
  private draining = false;
  private intervalId: number | null = null;
  private onlineListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;

    this.onlineListener = () => this.drain().catch(logErr);
    this.visibilityListener = () => {
      if (document.visibilityState === "visible") this.drain().catch(logErr);
    };

    window.addEventListener("online", this.onlineListener);
    document.addEventListener("visibilitychange", this.visibilityListener);
    this.intervalId = window.setInterval(
      () => this.drain().catch(logErr),
      DRAIN_INTERVAL_MS,
    );

    // Drain ngay khi start (catch up jobs từ session trước)
    this.drain().catch(logErr);
  }

  stop(): void {
    if (!this.started) return;
    if (this.onlineListener) {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    if (this.visibilityListener) {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.started = false;
  }

  /**
   * Trigger drain ngay (vd. ngay sau khi UI enqueue job để không phải đợi 30s).
   *
   * Returns Promise — caller có thể `await` nếu cần đảm bảo server đã có data
   * trước khi tiếp tục (vd. DEV seed phải drain trước khi user tạo order, tránh
   * FK violation order_items.product_id).
   */
  async drainNow(): Promise<void> {
    try {
      await this.drain();
    } catch (err) {
      logErr(err);
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    if (!navigator.onLine) return;
    this.draining = true;

    try {
      // Query pending jobs đáo hạn
      const now = Date.now();
      const jobs = await db.outbox
        .where("nextRunAt")
        .belowOrEqual(now)
        .filter((j) => j.status !== "done" && j.status !== "failed")
        .limit(BATCH_SIZE)
        .toArray();

      if (jobs.length > 0) {
        for (const job of jobs) {
          await this.processOne(job);
        }
      }

      // Cleanup: xóa job 'done' cũ hơn 7 ngày (giữ audit trail tươi)
      // Chạy ở cuối drain để không chặn đường xử lý job pending.
      const cutoff = now - DONE_KEEP_MS;
      try {
        const cleared = await db.outbox
          .where("status")
          .equals("done")
          .filter((j) => j.createdAt < cutoff)
          .delete();
        if (import.meta.env.DEV && cleared > 0) {
          console.log(`[outbox] cleanup ${cleared} done jobs >7 ngày`);
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[outbox] cleanup failed:", err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async processOne(job: OutboxJob): Promise<void> {
    try {
      await this.runHandler(job);
      // Success: mark done. Có thể delete row sau N ngày để gọn DB; Phase 4 keep
      // để có audit trail dev (chưa cleanup).
      await db.outbox.update(job.id, { status: "done" });
    } catch (err) {
      const attempts = job.attempts + 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempts >= MAX_ATTEMPTS) {
        await db.outbox.update(job.id, {
          status: "failed",
          attempts,
          lastError: errMsg,
        });
        if (import.meta.env.DEV) {
          console.error(`[outbox] permanent fail: ${job.type}`, errMsg);
        }
        return;
      }
      const delayMs = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      await db.outbox.update(job.id, {
        attempts,
        nextRunAt: Date.now() + delayMs,
        lastError: errMsg,
      });
      if (import.meta.env.DEV) {
        console.warn(
          `[outbox] retry ${attempts}/${MAX_ATTEMPTS} (${job.type}) in ${delayMs}ms: ${errMsg}`,
        );
      }
    }
  }

  /**
   * Job handlers. Throw để trigger retry; chỉ throw lỗi tạm thời (mạng/5xx).
   * Lỗi vĩnh viễn (4xx validation, RLS deny) sẽ retry hết quota rồi mark failed.
   */
  private async runHandler(job: OutboxJob): Promise<void> {
    switch (job.type) {
      case "product.upsert": {
        const { error } = await supabase
          .from("products")
          .upsert(job.payload as object, { onConflict: "id" });
        if (error) throw new Error(error.message);
        return;
      }
      case "product.archive": {
        const p = job.payload as { id: string };
        const { error } = await supabase
          .from("products")
          .update({ is_active: false })
          .eq("id", p.id);
        if (error) throw new Error(error.message);
        return;
      }
      case "order.create": {
        // Phase 5: gọi RPC create_order_with_items (idempotent qua order.id).
        // Retry an toàn — RPC sẽ skip insert items + decrement stock nếu đã tồn tại.
        const p = job.payload as { order: object; items: object[] };
        const { error } = await supabase.rpc("create_order_with_items", {
          p_order: p.order,
          p_items: p.items,
        });
        if (error) throw new Error(error.message);
        return;
      }
      default:
        // Sprint 4+ thêm: invoice.issue, zns.send, ...
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }
}

function logErr(err: unknown) {
  if (import.meta.env.DEV) {
    console.error("[outbox] drain error:", err);
  }
}

export const outboxWorker = new OutboxWorker();
