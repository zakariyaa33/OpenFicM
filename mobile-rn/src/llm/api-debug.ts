/** Opt-in, in-memory diagnostics. Never persist headers, keys, or manuscript logs. */
export type DebugContext = { agent?: string; stage?: string; sessionId?: string };
export type ApiDebugEntry = {
  id: number; startedAt: number; endedAt?: number; attempt: number; model: string; provider: string;
  endpoint: string; context?: DebugContext; request: string; response?: string; responseFormat?: string;
  httpStatus?: number; error?: string; returnedModel?: string; usage?: Record<string, unknown>;
};
const MAX_ENTRIES = 20;
const MAX_TEXT = 160_000;
let enabled = false;
let nextId = 0;
let entries: ApiDebugEntry[] = [];
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) { try { listener(); } catch { /* Diagnostics must not affect requests. */ } } }
export function subscribeApiDebug(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getApiDebugEntries() { return entries; }
export function isApiDebugEnabled() { return enabled; }
export function setApiDebugEnabled(value: boolean) { enabled = value; if (!value) entries = []; emit(); }
export function clearApiDebug() { entries = []; emit(); }
export function redactDebugText(value: string, key = ""): string {
  const safe = key ? value.split(key).join("[REDACTED]") : value;
  return safe
    .replace(/\bBearer\s+[^\s"\\,]+/gi, "Bearer [REDACTED]")
    .replace(/("(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret|x-api-key|x-goog-api-key)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
}
function bounded(value: string, key = "") { const safe = redactDebugText(value, key); return safe.length > MAX_TEXT ? safe.slice(0, MAX_TEXT) + "\n[日志已截断]" : safe; }
function displayBody(value: string, key = "") {
  try { return bounded(JSON.stringify(JSON.parse(value), null, 2), key); }
  catch { return bounded(value, key); }
}
export function beginApiDebug(input: { model: string; provider: string; url: string; body: unknown; apiKey: string; attempt: number; context?: DebugContext }): number | undefined {
  if (!enabled) return undefined;
  try {
    const id = ++nextId;
    const endpoint = bounded(input.url.replace(/^(https?:\/\/)[^/@]+@/i, "$1[REDACTED]@").replace(/\?.*$/, "?[REDACTED]"), input.apiKey);
    entries = [{ id, startedAt: Date.now(), attempt: input.attempt,
      model: bounded(input.model, input.apiKey), provider: bounded(input.provider, input.apiKey),
      endpoint, context: input.context, request: displayBody(typeof input.body === "string" ? input.body : "", input.apiKey),
    }, ...entries].slice(0, MAX_ENTRIES);
    emit();
    return id;
  } catch { return undefined; }
}
export function finishApiDebug(id: number | undefined, input: { apiKey: string; status?: number; raw?: string; format?: string; data?: Record<string, any>; error?: string }) {
  if (!enabled || id === undefined || !entries.some((entry) => entry.id === id)) return;
  try {
    const data = input.data;
    const usage = data?.usage ?? data?.usageMetadata;
    const model = data?.model ?? data?.modelVersion;
    entries = entries.map((entry) => {
      if (entry.id !== id) return entry;
      return { ...entry, endedAt: Date.now(), httpStatus: input.status ?? entry.httpStatus,
        response: input.raw === undefined ? entry.response : input.format === "SSE" ? bounded(input.raw, input.apiKey) : displayBody(input.raw, input.apiKey),
        responseFormat: input.format ?? entry.responseFormat,
        error: input.error ? bounded(input.error, input.apiKey) : entry.error,
        returnedModel: typeof model === "string" ? bounded(model, input.apiKey) : entry.returnedModel,
        usage: usage && typeof usage === "object" && !Array.isArray(usage)
          ? JSON.parse(JSON.stringify(usage, (_key, v) => typeof v === "string" ? redactDebugText(v, input.apiKey) : v)) : entry.usage,
      };
    });
    emit();
  } catch { /* Debugging must never fail the actual model call. */ }
}
