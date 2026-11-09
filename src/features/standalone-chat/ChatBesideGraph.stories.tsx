// ノートに紐づかないチャットの横に全体グラフを並べ、AI が答えに使ったページを光らせる試作。
//
// - 会話一覧は左のサイドバーのチャットのタブに出し、会話とグラフの幅を空ける
// - 送信すると 1 秒ほどで見本の答えが返り、答えが引用したページが緑に灯って一度だけ火花が走る。
//   それ以外のときはグラフは動かない（会話の邪魔をしないため）
// - 探すフォルダを選んでいると、範囲の外のページが薄くなる（AI が範囲を守っているかが見える）。
//   範囲の外なのに使ったページには赤い点線の輪が付く（本来は出ない。出たら絞り込みの抜け）
//
// グラフのデータは全体グラフのストーリーと同じ見本（パン作り・連番の題名）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useMemo, useRef, useState } from "react";
import { FileSidebar } from "../../components/FileSidebar";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { ChatMessage } from "../../lib/document-types";
import { SAMPLE_DATA, SAMPLE_DATA_EN } from "../network-graph/global-graph-structure.stories";
import { seededRandom } from "../network-graph/graph-firing";
import { StandaloneChatGraph } from "./StandaloneChatGraph";
import { StandaloneChatNav } from "./StandaloneChatNav";
import { StandaloneChatWorkspace } from "./StandaloneChatWorkspace";
import type { StandaloneChat, StandaloneChatSummary } from "./types";

const NOW = new Date(2026, 10, 9, 15, 0, 0);
const noop = () => {};

function msg(role: ChatMessage["role"], content: string, searchFolder?: string | null): ChatMessage {
  return { role, content, timestamp: new Date().toISOString(), ...(searchFolder !== undefined ? { searchFolder } : {}) };
}

/** 見本のフォルダの範囲（同じフォルダには同じ Set を返す） */
const scopeCache = new Map<string, Set<string> | null>();
function scopeFor(folder: string | undefined): Set<string> | null {
  const key = folder ?? "";
  if (!scopeCache.has(key)) scopeCache.set(key, buildScope(folder));
  return scopeCache.get(key) ?? null;
}

/** 見本のフォルダの範囲: そのシリーズのノートと、そこからつながる知見（派生の近似） */
function buildScope(folder: string | undefined): Set<string> | null {
  if (!folder) return null;
  const ids = new Set(SAMPLE_DATA.nodes.filter((n) => n.noteContexts?.includes(folder)).map((n) => n.id));
  for (const e of SAMPLE_DATA.edges) {
    const s = SAMPLE_DATA.nodes.find((n) => n.id === e.source);
    const t = SAMPLE_DATA.nodes.find((n) => n.id === e.target);
    if (ids.has(e.source) && t?.isWiki) ids.add(e.target);
    if (ids.has(e.target) && s?.isWiki) ids.add(e.source);
  }
  return ids;
}

/** 見本の答え: 範囲の中のつながりのあるページから数件を引用する。leak=true なら範囲の外を 1 件混ぜる */
/** 見本で AI が読むページ（範囲の中のつながりのあるページから n 件。参照は note:<id>） */
function sampleReads(rng: () => number, inScope: Set<string> | null, n: number): string[] {
  const linked = SAMPLE_DATA.nodes.filter(
    (x) => !x.external && SAMPLE_DATA.edges.some((e) => e.source === x.id || e.target === x.id),
  );
  const pool = inScope ? linked.filter((x) => inScope.has(x.id)) : linked;
  const out = new Set<string>();
  while (out.size < Math.min(n, pool.length)) out.add(pool[Math.floor(rng() * pool.length)].id);
  return [...out].map((id) => `note:${id}`);
}

/** 読んだページのうち先頭の数件を引用する答え */
function answerFromReads(question: string, reads: string[], count: number): string {
  const titles = reads
    .slice(0, count)
    .map((r) => SAMPLE_DATA.nodes.find((x) => x.id === r.slice("note:".length))?.title)
    .filter((t): t is string => !!t);
  const body = titles
    .slice(0, 2)
    .map((t) => `「${t}」によると、条件を少しずつ振って確かめるのがよさそうです [Source: "${t}"]。`)
    .join("\n\n");
  return `「${question}」について、読んだノートから分かることをまとめます。\n\n${body}\n\n---\n**📓 ノート内の知識**\n${titles
    .map((t) => `  - [Source: "${t}"]`)
    .join("\n")}`;
}

function sampleAnswer(question: string, rng: () => number, inScope: Set<string> | null, leak = false): string {
  const linked = SAMPLE_DATA.nodes.filter(
    (n) => !n.external && SAMPLE_DATA.edges.some((e) => e.source === n.id || e.target === n.id),
  );
  const pool = inScope ? linked.filter((n) => inScope.has(n.id)) : linked;
  const picked = new Set<string>();
  const count = Math.min(pool.length, 2 + Math.floor(rng() * 4));
  while (picked.size < count) picked.add(pool[Math.floor(rng() * pool.length)].title);
  if (leak && inScope) {
    const outside = linked.filter((n) => !inScope.has(n.id));
    picked.add(outside[Math.floor(rng() * outside.length)].title);
  }
  const titles = [...picked];
  const body = titles
    .slice(0, 2)
    .map((t) => `「${t}」によると、条件を少しずつ振って確かめるのがよさそうです [Source: "${t}"]。`)
    .join("\n\n");
  return `「${question}」について、ノートから分かることをまとめます。\n\n${body}\n\n---\n**📓 ノート内の知識**\n${titles
    .map((t) => `  - [Source: "${t}"]`)
    .join("\n")}`;
}

type DemoProps = {
  initial: ChatMessage[];
  folder?: string;
  scope?: "internal" | "external";
  /** 次の答えに範囲の外のページを混ぜる（絞り込みに抜けがあったときの見え方） */
  leak?: boolean;
  /** @ で渡したページ（見本のノード ID） */
  attachedIds?: string[];
};

function Demo({ initial, folder, scope = "internal", leak = false, attachedIds = [] }: DemoProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [loading, setLoading] = useState(false);
  const rng = useRef(seededRandom(11));
  const inScope = useMemo(() => scopeFor(folder), [folder]);
  const chat: StandaloneChat = {
    id: "demo",
    title: "発酵の温度について",
    scope,
    folder,
    attachedNoteIds: attachedIds,
    messages,
    createdAt: NOW.toISOString(),
    modifiedAt: NOW.toISOString(),
  };
  const summaries: StandaloneChatSummary[] = [
    { id: "demo", title: chat.title, firstQuestion: "発酵の温度は？", messageCount: messages.length, modifiedAt: NOW.toISOString() },
    { id: "b", title: "焼き色を濃くするには", firstQuestion: "焼き色", messageCount: 4, modifiedAt: new Date(2026, 10, 8, 10).toISOString() },
    { id: "c", title: "加水率の決め方", firstQuestion: "加水率", messageCount: 2, modifiedAt: new Date(2026, 10, 3, 9).toISOString() },
  ];

  // 答えを待っているあいだに読んでいるページ（2 件ずつ増える）
  const [reading, setReading] = useState<string[]>([]);
  const onSend = useCallback(
    (text: string) => {
      setMessages((m) => [...m, msg("user", text)]);
      setLoading(true);
      // 渡した文脈で 4 件、じっくり調べて 2 件ずつ足す見本。最後に 3 件を使って答える
      const reads = sampleReads(rng.current, inScope, 10);
      if (leak && inScope) {
        const outside = SAMPLE_DATA.nodes.find((x) => !x.external && !inScope.has(x.id));
        if (outside) reads.push(`note:${outside.id}`);
      }
      let shown = 4;
      setReading(reads.slice(0, shown));
      const timer = setInterval(() => {
        shown += 2;
        setReading(reads.slice(0, shown));
        if (shown >= reads.length) {
          clearInterval(timer);
          setTimeout(() => {
            const answer = msg("assistant", answerFromReads(text, leak ? [reads[reads.length - 1], ...reads] : reads, 3), folder ?? null);
            setMessages((m) => [...m, { ...answer, readRefs: reads }]);
            setReading([]);
            setLoading(false);
          }, 500);
        }
      }, 700);
    },
    [inScope, leak, folder],
  );

  const attachedNotes = attachedIds.map((id) => ({ id, title: SAMPLE_DATA.nodes.find((n) => n.id === id)?.title ?? id }));

  return (
    <>
      <FileSidebar
        activeFileId={null}
        onSelect={noop}
        onNewNote={noop}
        onRefresh={noop}
        onShowReleaseNotes={noop}
        onShowSettings={noop}
        agentConfigured
        recentNotes={[]}
        onShowNoteList={noop}
        mediaIndex={null}
        onShowAssetGallery={noop}
        noteIndex={null}
        onShowLabelGallery={noop}
        activeAssetType={null}
        activeLabel={null}
        onOpenSearch={noop}
        onShowChatList={noop}
        chatActive
        chatCount={summaries.length}
        chatNav={
          <StandaloneChatNav chats={summaries} activeChatId="demo" onSelect={noop} onNew={noop} onDelete={noop} now={NOW} />
        }
      />
      <StandaloneChatWorkspace
        chats={summaries}
        activeChatId="demo"
        activeChat={chat}
        loading={loading}
        onSelectChat={noop}
        onNewChat={noop}
        onSend={(text) => onSend(text)}
        onScopeChange={noop}
        attachedNotes={attachedNotes}
        now={NOW}
        navInSidebar
        renderGraph={(close, ctx) => (
          <StandaloneChatGraph
            data={SAMPLE_DATA}
            messages={messages}
            scope={ctx.scope}
            folder={ctx.folder}
            scopeIdsFor={scopeFor}
            attachedIds={attachedIds}
            readingRefs={reading}
            onClose={close}
            onSelectNote={noop}
          />
        )}
      />
    </>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Organisms/StandaloneChat/ChatBesideGraph",
  component: Demo,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "チャットを全画面で開いているとき（画面幅 1280px 以上）、右に全体グラフを並べる。会話一覧は左のサイドバーに出す。答えが返ると、その答えが引用したページが濃い緑に灯って一度だけ火花が走る。探すフォルダを選ぶと範囲の外が薄くなり、AI が範囲を守っているかが見える。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ width: "100vw", height: "100vh", display: "flex", background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;
type Story = StoryObj<typeof Demo>;

const FOLDER = "春の試作";

export const NewConversation: Story = {
  name: "1. 送ると、使ったページが光る",
  args: { initial: [] },
};

export const Continued: Story = {
  name: "2. 続きの会話（前の答えのページは薄く残る）",
  args: {
    initial: (() => {
      const r = seededRandom(3);
      return [
        msg("user", "発酵の温度はどう決めればいい？"),
        msg("assistant", sampleAnswer("発酵の温度はどう決めればいい？", r, null)),
        msg("user", "加水率との関係は？"),
        msg("assistant", sampleAnswer("加水率との関係は？", r, null)),
      ];
    })(),
  },
};

export const FolderScope: Story = {
  name: "3. フォルダを選ぶと、範囲の外が薄くなる",
  args: {
    folder: FOLDER,
    initial: (() => {
      const r = seededRandom(5);
      return [msg("user", "春の試作で発酵はどうだった？"), msg("assistant", sampleAnswer("春の試作で発酵はどうだった？", r, scopeFor(FOLDER)), FOLDER)];
    })(),
  },
};

export const AttachedAndBreach: Story = {
  name: "4. @ で渡したページの輪と、範囲の外で使ったときの赤い輪",
  args: {
    folder: FOLDER,
    attachedIds: SAMPLE_DATA.nodes.filter((n) => n.noteContexts?.includes(FOLDER)).slice(0, 1).map((n) => n.id),
    initial: (() => {
      const r = seededRandom(9);
      return [msg("user", "塩はいつ入れる？"), msg("assistant", sampleAnswer("塩はいつ入れる？", r, scopeFor(FOLDER), true), FOLDER)];
    })(),
  },
};

export const ExternalScope: Story = {
  name: "5. 外部参照（Web の出典の数も出る）",
  args: {
    scope: "external",
    initial: (() => {
      const r = seededRandom(13);
      return [
        msg("user", "ほかの人は発酵温度をどうしている？"),
        msg(
          "assistant",
          `${sampleAnswer("ほかの人は発酵温度をどうしている？", r, null)}\n\n---\n**🌐 Web の出典**\n  - [発酵の基礎](https://example.com/a)\n  - [温度管理のコツ](https://example.com/b)`,
        ),
      ];
    })(),
  },
};

// ── マニュアル用（英語・パン作り）。送信はせず、答えが 1 つ返った状態を撮る ──

/** 英語の見本で、題名からノード ID を引く */
function enId(title: string): string | undefined {
  return SAMPLE_DATA_EN.nodes.find((n) => n.title === title)?.id;
}

function ManualEnglish() {
  const folder = "Spring batch";
  const inScope = useMemo(() => {
    const ids = new Set(SAMPLE_DATA_EN.nodes.filter((n) => n.noteContexts?.includes(folder)).map((n) => n.id));
    for (const e of SAMPLE_DATA_EN.edges) {
      const s = SAMPLE_DATA_EN.nodes.find((n) => n.id === e.source);
      const t = SAMPLE_DATA_EN.nodes.find((n) => n.id === e.target);
      if (ids.has(e.source) && t?.isWiki) ids.add(e.target);
      if (ids.has(e.target) && s?.isWiki) ids.add(e.source);
    }
    return ids;
  }, []);
  // 実際の答えと同じく「ある記録と、そこから作られた知見」をまとめて読んだ形にする:
  // 範囲の中で隣り合うページの多い 1 本を中心に、その隣を読み、中心と隣 2 件を引用する
  const { reads, used } = useMemo(() => {
    const neighbors = (id: string) =>
      SAMPLE_DATA_EN.edges
        .filter((e) => e.source === id || e.target === id)
        .map((e) => (e.source === id ? e.target : e.source))
        .filter((n) => inScope.has(n) && !SAMPLE_DATA_EN.nodes.find((x) => x.id === n)?.external);
    const center = SAMPLE_DATA_EN.nodes
      .filter((x) => !x.external && inScope.has(x.id))
      .sort((a, b) => neighbors(b.id).length - neighbors(a.id).length || a.id.localeCompare(b.id))[0];
    const around = [...new Set(neighbors(center.id))].slice(0, 6);
    const titleOf = (id: string) => SAMPLE_DATA_EN.nodes.find((x) => x.id === id)?.title ?? id;
    const titles = [center.id, ...around].map(titleOf);
    return { reads: titles, used: titles.slice(0, 3) };
  }, [inScope]);
  const question = "What proofing temperature worked best in the spring batch?";
  const answer = `From your spring batch notes:\n\n${used
    .slice(0, 2)
    .map((t) => `- "${t}" points to keeping the dough a little warmer and checking it more often [Source: "${t}"].`)
    .join("\n")}\n\n---\n**📓 From your notes**\n${used.map((t) => `  - [Source: "${t}"]`).join("\n")}`;
  const messages: ChatMessage[] = [
    msg("user", question),
    {
      ...msg("assistant", answer, folder),
      readRefs: reads.map((t) => enId(t)).filter((x): x is string => !!x).map((id) => `note:${id}`),
    },
  ];
  const chat: StandaloneChat = {
    id: "m1",
    title: "Proofing temperature in spring",
    scope: "internal",
    folder,
    messages,
    createdAt: NOW.toISOString(),
    modifiedAt: NOW.toISOString(),
  };
  const summaries: StandaloneChatSummary[] = [
    { id: "m1", title: chat.title, firstQuestion: question, messageCount: 2, modifiedAt: NOW.toISOString() },
    { id: "m2", title: "Why the crumb came out dense", firstQuestion: "", messageCount: 2, modifiedAt: new Date(2026, 10, 9, 11).toISOString() },
    { id: "m3", title: "Darker crust on baguettes", firstQuestion: "", messageCount: 6, modifiedAt: new Date(2026, 10, 8, 10).toISOString() },
    { id: "m4", title: "Choosing a hydration for ciabatta", firstQuestion: "", messageCount: 3, modifiedAt: new Date(2026, 10, 5, 9).toISOString() },
  ];
  const scopeIdsFor = useCallback((f: string | undefined) => (f === folder ? inScope : null), [inScope]);
  return (
    <>
      <FileSidebar
        activeFileId={null}
        onSelect={noop}
        onNewNote={noop}
        onRefresh={noop}
        onShowReleaseNotes={noop}
        onShowSettings={noop}
        agentConfigured
        aiAvailable
        recentNotes={[]}
        onShowNoteList={noop}
        mediaIndex={null}
        onShowAssetGallery={noop}
        noteIndex={null}
        onShowLabelGallery={noop}
        onShowWikiList={noop}
        activeAssetType={null}
        activeLabel={null}
        onOpenSearch={noop}
        onOpenIntake={noop}
        onShowChatList={noop}
        chatActive
        chatNav={<StandaloneChatNav chats={summaries} activeChatId="m1" onSelect={noop} onNew={noop} onDelete={noop} now={NOW} />}
      />
      <StandaloneChatWorkspace
        chats={summaries}
        activeChatId="m1"
        activeChat={chat}
        loading={false}
        onSelectChat={noop}
        onNewChat={noop}
        onSend={noop}
        onScopeChange={noop}
        now={NOW}
        navInSidebar
        // 引用をアプリと同じリンク表示にする（題名 → ページ）
        sourceLinks={{
          titleToRef: new Map(reads.map((t) => [t, enId(t) ?? t] as [string, string])),
          onOpenWiki: noop,
        }}
        renderGraph={(close, ctx) => (
          <StandaloneChatGraph
            data={SAMPLE_DATA_EN}
            messages={messages}
            scope={ctx.scope}
            folder={ctx.folder}
            scopeIdsFor={scopeIdsFor}
            attachedIds={[]}
            onClose={close}
            onSelectNote={noop}
          />
        )}
      />
    </>
  );
}

export const ManualEnglishBread: StoryObj<typeof ManualEnglish> = {
  name: "Manual (English, bread world)",
  render: () => <ManualEnglish />,
  decorators: [
    (Story) => {
      syncLocale("en");
      return <Story />;
    },
  ],
};

// ── じっくり調べたとき: 来歴の道具（trace_lineage）でたどった線が濃く太く残る ──

/** 隣り合うページの多い 1 本を中心に、そこから来歴を 2 段たどった見本の答え */
function walkedSample(): ChatMessage[] {
  const neighbors = (id: string) =>
    SAMPLE_DATA.edges
      .filter((e) => e.source === id || e.target === id)
      .map((e) => (e.source === id ? e.target : e.source))
      .filter((n) => !SAMPLE_DATA.nodes.find((x) => x.id === n)?.external);
  const center = SAMPLE_DATA.nodes
    .filter((x) => !x.external)
    .sort((a, b) => neighbors(b.id).length - neighbors(a.id).length || a.id.localeCompare(b.id))[0];
  const first = [...new Set(neighbors(center.id))].slice(0, 3);
  // 2 段目: 1 段目の先から、まだ出ていない隣を 1 つずつ
  const seen = new Set([center.id, ...first]);
  const second: { from: string; to: string }[] = [];
  for (const f of first) {
    const n = neighbors(f).find((x) => !seen.has(x));
    if (n) {
      seen.add(n);
      second.push({ from: f, to: n });
    }
  }
  const walkedEdges = [...first.map((to) => ({ from: center.id, to })), ...second];
  const titleOf = (id: string) => SAMPLE_DATA.nodes.find((x) => x.id === id)?.title ?? id;
  const used = [center.id, first[0]].map(titleOf);
  const answer = `来歴をたどって確かめました。\n\n${used
    .map((t) => `- 「${t}」によると、条件を少しずつ振って確かめるのがよさそうです [Source: "${t}"]。`)
    .join("\n")}\n\n---\n**📓 ノート内の知識**\n${used.map((t) => `  - [Source: "${t}"]`).join("\n")}`;
  return [
    msg("user", "この試作の元になった記録まで遡って、何が効いたか教えて"),
    { ...msg("assistant", answer, null), readRefs: [...seen].map((id) => `note:${id}`), walkedEdges },
  ];
}

export const WalkedEdges: Story = {
  name: "6. じっくり調べたとき（来歴の道具でたどった線）",
  args: { initial: walkedSample() },
};
