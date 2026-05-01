export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retry?: number;
  backoffMs?: number;
}

/**
 * Fetch wrapper với timeout, retry exponential backoff cho lỗi 5xx.
 * Mặc định: timeout 10s, không retry. Set retry > 0 cho integrations
 * có thể fail tạm thời (eSMS, MISA, FPT.AI).
 */
export async function http(url: string, opts: FetchOpts = {}): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retry = 0,
    backoffMs = 500,
    ...init
  } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok && res.status >= 500 && attempt < retry) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt < retry) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
