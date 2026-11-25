import { Ionicons } from "@expo/vector-icons";
import { useState, useSyncExternalStore } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Header, Screen } from "@/components/ui";
import { clearApiDebug, getApiDebugEntries, isApiDebugEnabled, setApiDebugEnabled, subscribeApiDebug, type ApiDebugEntry } from "@/llm/api-debug";
import { colors, radius, spacing, useThemeColors } from "@/theme";
import { themedStyles } from "@/themed-styles";

const PAGE_SIZE = 12_000;
function requestDetails(entry: ApiDebugEntry): { thinking: string; system: string } {
  try {
    const body = JSON.parse(entry.request);
    const thinking = {
      ...(body.thinking !== undefined ? { thinking: body.thinking } : {}),
      ...(body.reasoning_effort !== undefined ? { reasoning_effort: body.reasoning_effort } : {}),
      ...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
      ...(body.generationConfig?.thinkingConfig !== undefined ? { thinkingConfig: body.generationConfig.thinkingConfig } : {}),
      ...(body.output_config !== undefined ? { output_config: body.output_config } : {}),
    };
    const system: unknown = body.instructions ?? body.system ?? body.systemInstruction
      ?? (Array.isArray(body.messages) ? body.messages.filter((m: any) => m.role === "system").map((m: any) => m.content) : undefined);
    return {
      thinking: Object.keys(thinking).length ? JSON.stringify(thinking, null, 2) : "未显式发送思考参数（由服务端决定）",
      system: typeof system === "string" ? system : Array.isArray(system) && system.every((s) => typeof s === "string")
        ? system.join("\n\n") : system === undefined ? "没有独立系统提示字段，请查看请求体" : JSON.stringify(system, null, 2),
    };
  } catch { return { thinking: "请求体无法完整解析，请查看原始记录", system: "请求体无法完整解析，请查看请求体" }; }
}
function duration(entry: ApiDebugEntry) {
  return entry.endedAt === undefined ? "进行中" : ((entry.endedAt - entry.startedAt) / 1000).toFixed(1) + " 秒";
}
function usageText(entry: ApiDebugEntry) {
  if (!entry.usage) return "服务端未返回用量，无法确定 Token 消耗。";
  const u = entry.usage as Record<string, any>;
  const input = u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount;
  const output = u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount;
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? u.thoughtsTokenCount;
  const total = u.total_tokens ?? u.totalTokenCount;
  return `输入：${input ?? "未返回"}　输出：${output ?? "未返回"}\n推理：${reasoning ?? "未返回"}　总量：${total ?? "未返回"}\n\n${JSON.stringify(u, null, 2)}`;
}
function LogText({ value }: { value: string }) {
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(value.length / PAGE_SIZE));
  const index = Math.min(page, count - 1);
  return (
    <View style={styles.textGroup}>
      {count > 1 ? <View style={styles.row}>
        <Pressable disabled={index === 0} onPress={() => setPage(index - 1)} style={styles.action}><Text style={styles.link}>上一页</Text></Pressable>
        <Text style={styles.muted}>{index + 1} / {count}</Text>
        <Pressable disabled={index === count - 1} onPress={() => setPage(index + 1)} style={styles.action}><Text style={styles.link}>下一页</Text></Pressable>
      </View> : null}
      <Text selectable style={styles.code}>{value.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)}</Text>
    </View>
  );
}
type Section = "summary" | "system" | "request" | "response";
const tabs: { id: Section; label: string }[] = [{ id: "summary", label: "概览" }, { id: "system", label: "系统提示" }, { id: "request", label: "请求体" }, { id: "response", label: "响应体" }];
function DebugDetail({ entry }: { entry: ApiDebugEntry }) {
  const [section, setSection] = useState<Section>("summary");
  const details = requestDetails(entry);
  return <View style={styles.flex}>
    <View style={styles.tabs}>{tabs.map((tab) => (
      <Pressable key={tab.id} accessibilityRole="button" accessibilityState={{ selected: section === tab.id }} onPress={() => setSection(tab.id)} style={[styles.tab, section === tab.id && styles.activeTab]}>
        <Text style={[styles.tabText, section === tab.id && styles.link]}>{tab.label}</Text>
      </Pressable>
    ))}</View>
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {section === "summary" ? <>
        <Text style={styles.heading}>请求详情 #{entry.id}</Text>
        <Text selectable style={styles.body}>智能体：{entry.context?.agent ?? "其他模型调用"} · {entry.context?.stage ?? "请求"}{"\n"}请求模型：{entry.model}{"\n"}服务商：{entry.provider}{"\n"}响应模型：{entry.returnedModel ?? "服务端未返回"}{"\n"}接口：{entry.endpoint}{"\n"}HTTP：{entry.httpStatus ?? "未返回"} · 尝试 {entry.attempt} · {duration(entry)}</Text>
        <Text style={styles.heading}>思考参数（实际请求）</Text><LogText key="thinking" value={details.thinking} />
        <Text style={styles.heading}>服务端 Token 用量</Text><LogText key="usage" value={usageText(entry)} />
        {entry.error ? <><Text style={styles.heading}>错误详情</Text><LogText key="error" value={entry.error} /></> : null}
      </> : <LogText key={section} value={section === "system" ? details.system : section === "request" ? entry.request : entry.response ?? (entry.endedAt ? "无响应正文" : "请求仍在进行")} />}
      {section === "response" && entry.responseFormat === "SSE" ? <Text style={styles.muted}>流式原始 SSE 文本；不等同于单个 JSON 对象。</Text> : null}
    </ScrollView>
  </View>;
}
export function ApiDebugPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const entries = useSyncExternalStore(subscribeApiDebug, getApiDebugEntries, getApiDebugEntries);
  const enabled = useSyncExternalStore(subscribeApiDebug, isApiDebugEnabled, isApiDebugEnabled);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const theme = useThemeColors();
  const selected = entries.find((entry) => entry.id === selectedId);
  const close = () => { setSelectedId(null); onClose(); };
  return <Modal visible={visible} animationType="slide" onRequestClose={selected ? () => setSelectedId(null) : close}>
    {visible ? <Screen>
      <Header title={selected ? "API 请求详情" : "API 调试"} onBack={selected ? () => setSelectedId(null) : close} />
      {selected ? <DebugDetail key={selected.id} entry={selected} /> : <>
        <View style={styles.settings}>
          <View style={styles.row}>
            <View style={styles.flex}><Text style={styles.heading}>记录 API 请求</Text><Text style={styles.muted}>默认关闭，仅保存在当前应用内存。关闭开关或重启应用会清空。</Text></View>
            <Switch value={enabled} onValueChange={setApiDebugEnabled} trackColor={{ false: theme.border, true: theme.primary }} />
          </View>
          <Text style={styles.muted}>最多 20 次 HTTP 尝试，每个正文最多 160,000 字符。包含私密作品内容，注意不要公开截图。不会记录请求头；常见密钥字段、当前 API Key 和 URL 查询参数会脱敏。</Text>
          <Pressable onPress={clearApiDebug} disabled={!entries.length} style={styles.action}><Text style={styles.link}>清空日志（{entries.length}）</Text></Pressable>
        </View>
        <FlatList data={entries} keyExtractor={(entry) => String(entry.id)} style={styles.flex}
          ListEmptyComponent={<Text style={styles.empty}>{enabled ? "已开启。返回助手发送一条消息后查看记录。" : "开启调试后才会记录新的请求。"}</Text>}
          renderItem={({ item }) => <Pressable onPress={() => setSelectedId(item.id)} style={styles.entry}>
            <View style={styles.flex}>
              <Text style={styles.heading} numberOfLines={1}>{item.context?.agent ?? "模型"} · {item.context?.stage ?? "API 调用"}</Text>
              <Text style={styles.body} numberOfLines={1}>{item.model}</Text>
              <Text style={styles.muted}>{new Date(item.startedAt).toLocaleTimeString()} · HTTP {item.httpStatus ?? "—"} · {duration(item)}{item.error ? " · 失败" : ""}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>} />
      </>}
    </Screen> : null}
  </Modal>;
}
const styles = themedStyles((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  settings: { padding: spacing.lg, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  entry: { flexDirection: "row", alignItems: "center", padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm },
  heading: { color: colors.text, fontWeight: "700", fontSize: 15 },
  body: { color: colors.text, fontSize: 14, lineHeight: 22 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  link: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  action: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start" },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.xl, fontSize: 14 },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
  activeTab: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textMuted, fontSize: 13 },
  textGroup: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  code: { color: colors.text, fontSize: 13, lineHeight: 20, fontFamily: "monospace" },
}));
