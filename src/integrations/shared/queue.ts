/**
 * Outbox queue — offline-first sync (Phase 4 implements worker).
 *
 * Mọi thao tác cần đẩy lên server (sync order, phát hành HĐĐT, gửi ZNS) ghi
 * vào bảng Dexie `outbox`. Khi navigator.onLine → drain từng job.
 */

export type OutboxJobType =
  | "product.upsert"
  | "product.archive"
  | "order.create" // Phase 5
  | "invoice.issue" // Phase 6
  | "zns.send" // Phase 7
  | "sms.otp"
  | "product.sync";

export type OutboxJobStatus = "pending" | "processing" | "done" | "failed";

export interface OutboxJob {
  id: string;
  type: OutboxJobType | string;
  payload: unknown;
  attempts: number;
  nextRunAt: number;
  createdAt: number;
  /**
   * Trạng thái Dexie. Phase 1 default 'pending' (không set field này);
   * worker Phase 4 sẽ track 'done' / 'failed-permanent'.
   */
  status?: OutboxJobStatus;
  lastError?: string;
}
