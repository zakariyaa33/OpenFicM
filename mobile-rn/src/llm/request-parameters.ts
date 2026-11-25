/** Provider-specific generation options. Never replace the agent's message/tool protocol. */
const blocked = new Set([
  "model", "messages", "input", "instructions", "system", "systemInstruction",
  "contents", "tools", "tool_choice", "toolConfig", "stream", "stream_options",
  "max_tokens", "max_completion_tokens", "max_output_tokens", "previous_response_id",
  "conversation", "background", "store", "__proto__", "constructor", "prototype",
]);
export function parseRequestParameters(raw?: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw?.trim() || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("高级请求参数必须是 JSON 对象");
  for (const key of Object.keys(value)) {
    if (blocked.has(key)) throw new Error("不允许覆盖协议字段：" + key);
  }
  return Object.fromEntries(Object.entries(value));
}
export function mergeRequestParameters(base: Record<string, unknown>, raw?: string): Record<string, unknown> {
  const extra = parseRequestParameters(raw);
  if (Object.prototype.hasOwnProperty.call(extra, "generationConfig")) {
    const config = extra.generationConfig;
    if (!base.generationConfig || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("generationConfig 仅用于 Gemini，且必须是 JSON 对象");
    if ("maxOutputTokens" in config) throw new Error("请在模型设置中调整最大输出 Token 数");
    extra.generationConfig = { ...(base.generationConfig as Record<string, unknown>), ...config };
  }
  return { ...base, ...extra };
}
