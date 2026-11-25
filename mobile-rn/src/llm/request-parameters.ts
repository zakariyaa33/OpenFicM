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

export const DEEPSEEK_EFFORTS = ["default", "off", "low", "high", "max"] as const;
export type DeepSeekEffort = typeof DEEPSEEK_EFFORTS[number];
export function deepSeekEffort(raw?: string): DeepSeekEffort | "custom" {
  try {
    const value = parseRequestParameters(raw);
    const thinking = value.thinking as { type?: unknown } | undefined;
    const effort = value.reasoning_effort;
    if (thinking?.type === "disabled") return "off";
    if (thinking?.type === "enabled" && (effort === "low" || effort === "high" || effort === "max")) return effort;
    if (thinking === undefined && effort === undefined) return "default";
  } catch { /* Invalid draft is not a preset. */ }
  return "custom";
}
export function withDeepSeekEffort(raw: string, effort: DeepSeekEffort): string {
  const value = parseRequestParameters(raw);
  delete value.thinking;
  delete value.reasoning_effort;
  if (effort === "off") value.thinking = { type: "disabled" };
  else if (effort !== "default") {
    value.thinking = { type: "enabled" };
    value.reasoning_effort = effort;
  }
  return JSON.stringify(value, null, 2);
}
