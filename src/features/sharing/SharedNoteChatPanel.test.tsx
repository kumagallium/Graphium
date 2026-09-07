// @vitest-environment jsdom
// 共有エントリの「AI に質問」パネルのテスト。
//
// 対象の不変条件:
// - 送信されるメッセージには題名と共有本文が入る（読み手の質問だけを送らない）
// - 会話履歴と session_id が引き継がれる（2 通目以降が単発の質問にならない）
// - 横断検索は scope が内部参照以上のときだけ走り、そのエントリ自身は除く
//   （同じ文章を「背景」と「検索で見つけた断片」の二重で渡さない）
// - 応答は assistant として積まれ、session_id が保存される
// - Stop は「やめた」であってエラーではない（文言を出さない）
// - 会話は手元の appData `shared-chats:<id>` にだけ残り、再マウントで戻る
//   （共有フォルダには一切書かない）
// - ハッシュ照合が通っていない本文には注意行を出す

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// AiAssistantPanel 実体は Markdown レンダラ・sidecar 監視まで抱えるので、
// 送信・停止の口と会話の中身だけを持つ偽物に差し替える（見るのは配線）
vi.mock("../ai-assistant/panel", async () => {
  const { useAiAssistant } = await import("../ai-assistant/store");
  return {
    AiAssistantPanel: ({
      onSubmit,
      onStop,
    }: {
      onSubmit: (q: string, a?: unknown, scope?: string, rewindIndex?: number) => void;
      onStop?: () => void;
    }) => {
      const { messages, chats, loading, error, quotedMarkdown } = useAiAssistant();
      return (
        <div>
          <div data-testid="loading">{loading ? "1" : "0"}</div>
          <div data-testid="error">{error ?? ""}</div>
          <div data-testid="quoted">{quotedMarkdown}</div>
          <div data-testid="chat-count">{chats.length}</div>
          <div data-testid="chat-first">{chats[0]?.messages[0]?.content ?? ""}</div>
          {messages.map((m, i) => (
            <div key={i} data-testid={`msg-${i}`}>{`${m.role}:${m.content}`}</div>
          ))}
          <button data-testid="send" onClick={() => onSubmit("昇温速度は？", undefined, "notes")}>
            send
          </button>
          <button
            data-testid="send-internal"
            onClick={() => onSubmit("昇温速度は？", undefined, "internal")}
          >
            send internal
          </button>
          <button data-testid="stop" onClick={() => onStop?.()}>
            stop
          </button>
        </div>
      );
    },
  };
});

import { render, screen, act, cleanup } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { AiAssistantProvider } from "../ai-assistant/store";
import { setAiModelsAvailable } from "../settings/store";
import { SharedNoteChatPanel, type SharedNoteChatDeps } from "./SharedNoteChatPanel";
import { sharedChatsKey } from "./shared-chat";
import type { AgentRunRequest, AgentRunResponse } from "../ai-assistant/api";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import type { StorageProvider } from "../../lib/storage/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE: SharedEntry = {
  id: "note-1",
  type: "note",
  author: { name: "佐藤 学生", email: "sato@example.ac.jp" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  hash: "sha256:aaa",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録" },
} as SharedEntry;

const DOC = {
  version: 6,
  title: "焼結の記録",
  pages: [{ id: "p1", title: "焼結の記録", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
} as unknown as GraphiumDocument;

const BODY = JSON.stringify(DOC);
/** deps.toMarkdown が返す本文（実物は graphiumDocToMarkdown） */
const BODY_MARKDOWN = "1050 ℃ で 2 時間保持した";

/** readAppData / writeAppData だけを in-memory で実装した最小プロバイダ */
function makeProvider(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    store,
    provider: {
      readAppData: async (k: string) => (store.has(k) ? store.get(k) : null),
      writeAppData: async (k: string, v: unknown) => {
        store.set(k, v);
      },
    } as unknown as StorageProvider,
  };
}

function okResponse(overrides: Partial<AgentRunResponse> = {}): AgentRunResponse {
  return {
    session_id: "sess-1",
    message: "5 ℃/min と書かれています。",
    tool_calls: [],
    provenance_id: null,
    token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: "test-model",
    ...overrides,
  };
}

type Harness = {
  calls: { req: AgentRunRequest; signal?: AbortSignal }[];
  retrievals: { query: string; excludeIds?: Set<string> }[];
  deps: SharedNoteChatDeps;
};

function makeDeps(
  provider: StorageProvider,
  run?: (req: AgentRunRequest, signal?: AbortSignal) => Promise<AgentRunResponse>,
): Harness {
  const calls: Harness["calls"] = [];
  const retrievals: Harness["retrievals"] = [];
  return {
    calls,
    retrievals,
    deps: {
      provider,
      now: () => new Date("2026-09-07T00:00:00.000Z"),
      toMarkdown: async () => BODY_MARKDOWN,
      retrieveWikiContext: async (query, excludeIds) => {
        retrievals.push({ query, excludeIds });
        return "【共有ナレッジ】焼結の一般論";
      },
      runAgent: async (req, signal) => {
        calls.push({ req, signal });
        return run ? await run(req, signal) : okResponse();
      },
    },
  };
}

function renderPanel(
  deps: SharedNoteChatDeps,
  overrides: Partial<React.ComponentProps<typeof SharedNoteChatPanel>> = {},
) {
  return render(
    <LocaleProvider>
      <AiAssistantProvider aiAvailable>
        <SharedNoteChatPanel entry={NOTE} body={BODY} verified deps={deps} {...overrides} />
      </AiAssistantProvider>
    </LocaleProvider>,
  );
}

/** debounce（600ms）と、その中で走る保存 Promise を消化する */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** クリック → 送信の Promise チェーンを流し切る */
async function click(testId: string) {
  await act(async () => {
    screen.getByTestId(testId).click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setAiModelsAvailable(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setAiModelsAvailable(false);
});

describe("共有エントリのチャット送信", () => {
  it("題名と共有本文を同梱したメッセージを送る", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps);
    await click("send");

    expect(h.calls).toHaveLength(1);
    const sent = h.calls[0].req.message;
    expect(sent).toContain("焼結の記録");
    expect(sent).toContain("佐藤 学生");
    expect(sent).toContain(BODY_MARKDOWN);
    expect(sent).toContain("昇温速度は？");
    // 最新の user メッセージは messages の末尾にも同じものが入る
    const messages = h.calls[0].req.messages ?? [];
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: sent });
  });

  it("2 通目は履歴と session_id を引き継ぐ", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps);
    await click("send");
    await click("send");

    expect(h.calls).toHaveLength(2);
    // 1 通目は session_id を持たない（サーバーが発行する）
    expect(h.calls[0].req.session_id).toBeUndefined();
    expect(h.calls[1].req.session_id).toBe("sess-1");
    // 履歴は「1 通目の質問 + その回答」+ 今回の user
    const history = h.calls[1].req.messages ?? [];
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ role: "user", content: "昇温速度は？" });
    expect(history[1].role).toBe("assistant");
    // 履歴には本文を積まない（毎ターン user メッセージ側に載せる）
    expect(history[0].content).not.toContain(BODY_MARKDOWN);
  });

  it("ノート内参照（notes）では横断検索を行わない", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps);
    await click("send");

    expect(h.retrievals).toHaveLength(0);
    expect(h.calls[0].req.wiki_context).toBeUndefined();
    expect(h.calls[0].req.grounding_scope).toBe("notes");
  });

  it("内部参照（internal）では横断検索し、そのエントリ自身は除く", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps);
    await click("send-internal");

    expect(h.retrievals).toHaveLength(1);
    expect([...(h.retrievals[0].excludeIds ?? [])]).toEqual(["note-1"]);
    // 検索クエリに本文全文を混ぜない（embedding が希釈される）
    expect(h.retrievals[0].query).toContain("昇温速度は？");
    expect(h.calls[0].req.wiki_context).toBe("【共有ナレッジ】焼結の一般論");
  });

  it("応答は assistant として積まれる", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps);
    await click("send");

    expect(screen.getByTestId("msg-0").textContent).toBe("user:昇温速度は？");
    expect(screen.getByTestId("msg-1").textContent).toContain("assistant:5 ℃/min");
    expect(screen.getByTestId("loading").textContent).toBe("0");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("主題の Markdown 変換を待つ間も実行中にする（二重送信の窓を作らない）", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    // 変換の完了をテスト側から押さえる（長い本文で変換に時間がかかる状態）
    let finishMarkdown!: (markdown: string) => void;
    const pending = new Promise<string>((resolve) => {
      finishMarkdown = resolve;
    });
    h.deps.toMarkdown = () => pending;
    renderPanel(h.deps);
    await click("send");

    // 変換はまだ終わっていないが、この間も loading は立っている
    //（パネル側は loading で送信を弾くので、ここで 0 だと 2 本目が走れてしまう）
    expect(screen.getByTestId("loading").textContent).toBe("1");
    expect(h.calls).toHaveLength(0);

    await act(async () => {
      finishMarkdown(BODY_MARKDOWN);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].req.message).toContain(BODY_MARKDOWN);
    expect(screen.getByTestId("loading").textContent).toBe("0");
  });
});

describe("共有エントリのチャットの中断", () => {
  it("Stop で中断しても文言を出さない", async () => {
    const p = makeProvider();
    let aborted = false;
    const h = makeDeps(p.provider, (_req, signal) =>
      new Promise<AgentRunResponse>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    renderPanel(h.deps);
    await click("send");
    expect(screen.getByTestId("loading").textContent).toBe("1");

    await click("stop");
    await advance(0);

    expect(aborted).toBe(true);
    expect(screen.getByTestId("loading").textContent).toBe("0");
    expect(screen.getByTestId("error").textContent).toBe("");
  });
});

describe("共有エントリのチャットの保存先", () => {
  it("手元の appData（shared-chats:<id>）にだけ残す", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps);
    await click("send");
    await advance(600);

    const saved = p.store.get(sharedChatsKey("note-1")) as { messages: unknown[] }[];
    expect(Array.isArray(saved)).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].messages).toHaveLength(2);
    // 共有フォルダ側のキーは一切増えない
    expect([...p.store.keys()]).toEqual(["shared-chats:note-1"]);
  });

  it("保存済みの会話は開き直したときに戻る", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    const first = renderPanel(h.deps);
    await click("send");
    await advance(600);
    first.unmount();

    // 別インスタンス（＝画面を開き直した状態）で同じ appData を読む
    // 復元された会話は履歴一覧（chats）として戻る。表示中の会話は空のまま
    renderPanel(makeDeps(p.provider).deps);
    await advance(0);
    expect(screen.getByTestId("chat-count").textContent).toBe("1");
    expect(screen.getByTestId("chat-first").textContent).toBe("昇温速度は？");
  });
});

describe("共有エントリのチャットの断り書き", () => {
  it("ハッシュ照合が通っていない本文には注意行を出す", async () => {
    const p = makeProvider();
    renderPanel(makeDeps(p.provider).deps, { verified: false });
    expect(screen.getByTestId("shared-note-chat-unverified").textContent).toContain(
      t("sharedNote.chat.unverified"),
    );
  });

  it("照合が通っていれば注意行は出さない", async () => {
    const p = makeProvider();
    renderPanel(makeDeps(p.provider).deps);
    expect(screen.queryByTestId("shared-note-chat-unverified")).toBeNull();
  });

  it("本文がまだ届いていないときは待つよう伝える", async () => {
    const p = makeProvider();
    const h = makeDeps(p.provider);
    renderPanel(h.deps, { body: null });
    await click("send");

    expect(h.calls).toHaveLength(0);
    expect(screen.getByTestId("error").textContent).toBe(t("sharedNote.chat.bodyNotReady"));
  });
});
