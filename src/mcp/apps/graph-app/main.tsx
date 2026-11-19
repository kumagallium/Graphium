// 会話の中に描く全体グラフ（MCP Apps の View）。本体の全体グラフ（GlobalGraphView）を、
// アプリのチャットの横と同じ小さな表示（compact）でそのまま描く。島の配置・ホバーで題名を出す動き・
// 読んだ／使ったページの印・光り方は、すべて本体の部品のもの（見た目を写さず、部品を共有する）。
//
// データの受け取り: 道具の結果には参照（道具と引数）だけが載る。画面はそれを画面専用の道具
// graph_payload に渡して、全体グラフのデータ（buildGlobalGraph）を受け取る。
// 印: 画面専用の道具 graph_activity を数秒おきに呼び、外の AI が読んだ・書いた・たどったものを受け取る。
// アプリのチャットの横は「この答えで使った（濃い緑・大）」「前の答え（中くらい）」「読んだだけ（淡い緑）」の
// 3 段で描く。MCP からは答えに使ったかは分からないので、新しさで段を当てる:
// 直近に受け取った分 = この答え、それより前 = 前の答え。
//
// ⚠️ 外のサイトから何も読まない（CSP を空のまま通すため。ライブラリ・CSS は同梱）

import "./storage-shim";

import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

import { LocaleProvider, syncLocale, useLocale } from "../../../i18n";
import { GlobalGraphView, type GraphUsageScope } from "../../../features/network-graph/global-graph-view";
import type { NoteGraphData } from "../../../features/network-graph/graph-builder";
import "../../../app.css";

/** graph_payload が返す全体グラフ（graph-views.ts の KnowledgeAppPayload と同じ形） */
type KnowledgeAppPayload = {
  mode: "knowledge-app";
  data: NoteGraphData;
  /** フォルダの範囲（ページ id）。null なら全体 */
  scopeIds: string[] | null;
  insightsEnabled: boolean;
};

type ActivityEvent = { kind: "read" | "seen" | "walk" | "wrote"; id: string; from?: string; at?: string };

/** 「この答え」とみなす新しさ。最後に受け取った出来事から、これより前のものは「前の答え」に回す */
const LATEST_WINDOW_MS = 90 * 1000;
/** 記録は別の会話の分も混ざるファイルなので、画面を開いた少し前からだけ受け取る */
const LOOKBACK_MS = 30 * 60 * 1000;
const notBefore = new Date(Date.now() - LOOKBACK_MS).toISOString();

const app = new App({ name: "Graphium knowledge graph", version: "1.0.0" });

type Status = { kind: "loading" } | { kind: "failed"; reason: string; detail?: string } | { kind: "ready"; payload: KnowledgeAppPayload };

let setStatusExternal: ((s: Status) => void) | null = null;
let pendingStatus: Status = { kind: "loading" };
function publish(s: Status): void {
  pendingStatus = s;
  setStatusExternal?.(s);
}

function resultText(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : [];
  return content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
}

function isPayload(v: unknown): v is KnowledgeAppPayload {
  const p = v as KnowledgeAppPayload | undefined;
  return !!p && p.mode === "knowledge-app" && !!p.data && Array.isArray(p.data.nodes) && Array.isArray(p.data.edges);
}

app.ontoolresult = (result) => {
  const ref = (result.structuredContent as Record<string, unknown> | undefined)?.graphiumGraph;
  if (!ref || typeof ref !== "object") {
    publish({ kind: "failed", reason: resultText(result) || "No graph to draw" });
    return;
  }
  void (async () => {
    try {
      const res = await app.callServerTool({ name: "graph_payload", arguments: ref as Record<string, unknown> });
      const payload = (res.structuredContent as { payload?: unknown } | undefined)?.payload;
      if (!res.isError && isPayload(payload)) publish({ kind: "ready", payload });
      else publish({ kind: "failed", reason: resultText(res) || "Could not get the graph data" });
    } catch (e) {
      publish({ kind: "failed", reason: "Could not get the graph data", detail: e instanceof Error ? e.message : String(e) });
    }
  })();
};

let hostCtx: McpUiHostContext | undefined;
let setHostExternal: ((c: McpUiHostContext | undefined) => void) | null = null;
function applyHost(ctx: McpUiHostContext | undefined): void {
  if (ctx) hostCtx = { ...hostCtx, ...ctx };
  if (hostCtx?.locale) syncLocale(hostCtx.locale.toLowerCase().startsWith("ja") ? "ja" : "en");
  setHostExternal?.(hostCtx);
}
app.onhostcontextchanged = (ctx) => applyHost(ctx);

/** 触れたもの（graph_activity）を受け取り、アプリのチャットの横と同じ形（重み・範囲）にする */
function useActivity(nodeIds: ReadonlySet<string> | null) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    if (!nodeIds) return;
    let cursor = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await app.callServerTool({ name: "graph_activity", arguments: { since: cursor, notBefore } });
        const sc = res.structuredContent as { events?: ActivityEvent[]; cursor?: number } | undefined;
        if (typeof sc?.cursor === "number") cursor = sc.cursor;
        const fresh = (sc?.events ?? []).filter((e) => e.kind !== "seen");
        if (fresh.length > 0 && !stopped) setEvents((prev) => [...prev, ...fresh]);
      } catch {
        // 一時的に届かなくても止めない
      }
      if (!stopped) timer = setTimeout(tick, document.hidden ? 8000 : 2500);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [nodeIds]);

  return useMemo(() => {
    const touched = events.filter((e) => (e.kind === "read" || e.kind === "wrote") && nodeIds?.has(e.id));
    const newest = touched.reduce((m, e) => Math.max(m, Date.parse(e.at ?? "") || 0), 0);
    const weights = new Map<string, number>();
    const latest = new Set<string>();
    for (const e of touched) {
      const t = Date.parse(e.at ?? "") || 0;
      const isLatest = newest - t <= LATEST_WINDOW_MS;
      if (isLatest) latest.add(e.id);
      weights.set(e.id, Math.max(weights.get(e.id) ?? 0, isLatest ? 1 : 0.5));
    }
    const read = new Set(touched.map((e) => e.id));
    const walked = events
      .filter((e) => e.kind === "walk" && e.from && nodeIds?.has(e.id) && nodeIds?.has(e.from))
      .map((e) => [e.from!, e.id] as [string, string]);
    return { weights, read, latest, walked, count: events.length };
  }, [events, nodeIds]);
}

/** 帯の文言（アプリの i18n には無い、この画面だけの言葉） */
const LABELS = {
  ja: { pages: "ページ", read: "読んだ", pip: "会話の横に浮かせる", full: "全画面", back: "会話に戻す", failed: "グラフを表示できませんでした" },
  en: { pages: "pages", read: "read", pip: "Float beside the chat", full: "Full screen", back: "Back to the chat", failed: "Could not show the graph" },
} as const;

function Root() {
  const { locale } = useLocale();
  const L = locale === "ja" ? LABELS.ja : LABELS.en;
  const [status, setStatus] = useState<Status>(pendingStatus);
  const [host, setHost] = useState<McpUiHostContext | undefined>(hostCtx);
  useEffect(() => {
    setStatusExternal = setStatus;
    setHostExternal = setHost;
    setStatus(pendingStatus);
    setHost(hostCtx);
    return () => {
      setStatusExternal = null;
      setHostExternal = null;
    };
  }, []);

  const payload = status.kind === "ready" ? status.payload : null;
  const nodeIds = useMemo(() => (payload ? new Set(payload.data.nodes.map((n) => n.id)) : null), [payload]);
  const scopeIds = useMemo(() => (payload?.scopeIds ? new Set(payload.scopeIds) : null), [payload]);
  const activity = useActivity(nodeIds);
  const usageScope: GraphUsageScope = useMemo(
    () => ({ inScope: scopeIds, read: activity.read, latestRead: activity.latest, reading: activity.latest, walked: activity.walked }),
    [scopeIds, activity],
  );
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(null);

  const mode = host?.displayMode ?? "inline";
  const modes = (host?.availableDisplayModes as string[] | undefined) ?? [];
  const height = mode === "inline" ? 560 : "100vh";

  if (status.kind === "loading") return <p className="p-4 text-sm text-muted-foreground">…</p>;
  if (status.kind === "failed") {
    return (
      <div className="p-4 text-sm">
        <p className="font-semibold">{L.failed}</p>
        <p className="text-muted-foreground">{status.reason}</p>
        {status.detail && <pre className="mt-2 text-xs whitespace-pre-wrap">{status.detail}</pre>}
      </div>
    );
  }
  const titleOf = (id: string) => payload!.data.nodes.find((n) => n.id === id)?.title ?? id;
  return (
    <div style={{ height, display: "flex", flexDirection: "column" }} className="bg-background">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs">
        <span className="truncate text-muted-foreground flex-1">
          {selected
            ? `${selected.title} — ${selected.id}`
            : `${payload!.data.nodes.length.toLocaleString()} ${L.pages} · ${L.read} ${activity.read.size}`}
        </span>
        {mode !== "inline" && modes.includes("inline") ? (
          <button className="px-2 py-0.5 rounded border border-border" title={L.back} aria-label={L.back} onClick={() => void app.requestDisplayMode({ mode: "inline" })}>
            ↩
          </button>
        ) : (
          <>
            {modes.includes("pip") && (
              <button className="px-2 py-0.5 rounded border border-border" title={L.pip} aria-label={L.pip} onClick={() => void app.requestDisplayMode({ mode: "pip" })}>
                ⧉
              </button>
            )}
            {modes.includes("fullscreen") && (
              <button className="px-2 py-0.5 rounded border border-border" title={L.full} aria-label={L.full} onClick={() => void app.requestDisplayMode({ mode: "fullscreen" })}>
                ⤢
              </button>
            )}
          </>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GlobalGraphView
          compact
          data={payload!.data}
          insightsEnabled={payload!.insightsEnabled}
          onClose={() => {}}
          usageWeights={activity.weights}
          usageFiring="once"
          usageScope={usageScope}
          onSelectNote={(id) => setSelected({ id, title: titleOf(id) })}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <Root />
    </LocaleProvider>
  </StrictMode>,
);

app
  .connect()
  .then(() => applyHost(app.getHostContext()))
  .catch((e) => publish({ kind: "failed", reason: "Could not connect to the host", detail: e instanceof Error ? e.message : String(e) }));
