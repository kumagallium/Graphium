// ノートに紐づかないチャットの横に全体グラフを並べ、AI が答えに使ったページを光らせる試作。
// 送信すると 1 秒ほどで見本の答えが返り、答えが引用したページが緑に灯って一度だけ火花が走る。
// それ以外のときはグラフは動かない（会話の邪魔をしないため）。
// グラフのデータは全体グラフのストーリーと同じ見本（パン作り・連番の題名）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useMemo, useRef, useState } from "react";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { ChatMessage } from "../../lib/document-types";
import { GlobalGraphView } from "../network-graph/global-graph-view";
import { SAMPLE_DATA } from "../network-graph/global-graph-structure.stories";
import { seededRandom } from "../network-graph/graph-firing";
import { ChatGraphPane } from "./ChatGraphPane";
import { StandaloneChatWorkspace } from "./StandaloneChatWorkspace";
import type { StandaloneChat, StandaloneChatSummary } from "./types";
import { chatUsedPageWeights, EARLIER_WEIGHT, usedPagesSignature } from "./used-pages";

const NOW = new Date(2026, 10, 9, 15, 0, 0);
const noop = () => {};

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: new Date().toISOString() };
}

/** 見本の答え: つながりのあるページ（知見・ノート）から数件を引用する */
function sampleAnswer(question: string, rng: () => number): string {
  const pool = SAMPLE_DATA.nodes.filter((n) => !n.external && SAMPLE_DATA.edges.some((e) => e.source === n.id || e.target === n.id));
  const picked = new Set<string>();
  const count = 2 + Math.floor(rng() * 4);
  while (picked.size < count) picked.add(pool[Math.floor(rng() * pool.length)].title);
  const titles = [...picked];
  const body = titles
    .slice(0, 2)
    .map((t) => `「${t}」によると、条件を少しずつ振って確かめるのがよさそうです [Source: "${t}"]。`)
    .join("\n\n");
  return `「${question}」について、ノートから分かることをまとめます。\n\n${body}\n\n---\n**📓 ノートから**\n${titles
    .map((t) => `  - [Source: "${t}"]`)
    .join("\n")}`;
}

function Demo({ initial }: { initial: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [loading, setLoading] = useState(false);
  const rng = useRef(seededRandom(11));
  const chat: StandaloneChat = {
    id: "demo",
    title: "発酵の温度について",
    scope: "internal",
    messages,
    createdAt: NOW.toISOString(),
    modifiedAt: NOW.toISOString(),
  };
  const summaries: StandaloneChatSummary[] = [
    { id: "demo", title: chat.title, firstQuestion: "発酵の温度は？", messageCount: messages.length, modifiedAt: NOW.toISOString() },
  ];

  // 重みは中身が変わったときだけ作り直す（同じ Map を渡し続ければ火花は走り直さない）
  const raw = chatUsedPageWeights(messages, SAMPLE_DATA.nodes);
  const sig = usedPagesSignature(raw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weights = useMemo(() => raw, [sig]);
  let latest = 0;
  let earlier = 0;
  for (const w of weights.values()) if (w === 1) latest++; else if (w === EARLIER_WEIGHT) earlier++;

  const onSend = useCallback((text: string) => {
    setMessages((m) => [...m, msg("user", text)]);
    setLoading(true);
    setTimeout(() => {
      setMessages((m) => [...m, msg("assistant", sampleAnswer(text, rng.current))]);
      setLoading(false);
    }, 1100);
  }, []);

  return (
    <StandaloneChatWorkspace
      chats={summaries}
      activeChatId="demo"
      activeChat={chat}
      loading={loading}
      onSelectChat={noop}
      onNewChat={noop}
      onSend={(text) => onSend(text)}
      onScopeChange={noop}
      now={NOW}
      renderGraph={(close) => (
        <ChatGraphPane latestCount={latest} earlierCount={earlier} onClose={close}>
          <GlobalGraphView compact data={SAMPLE_DATA} onClose={close} onSelectNote={noop} usageWeights={weights} usageFiring="once" />
        </ChatGraphPane>
      )}
    />
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
          "チャットを全画面で開いているとき（画面幅 1280px 以上）、右に全体グラフを並べる。答えが返ると、その答えが引用したページが濃い緑に灯って一度だけ火花が走る。前の答えのページは薄い緑で残る。それ以外のときはグラフは動かない。",
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
        msg("assistant", sampleAnswer("発酵の温度はどう決めればいい？", r)),
        msg("user", "加水率との関係は？"),
        msg("assistant", sampleAnswer("加水率との関係は？", r)),
      ];
    })(),
  },
};
