// chat-run-manager の不変条件テスト
//
// 対象の不変条件:
// - run は start で running になり、exec の解決/拒否で done/error に settle して
//   リスナーへ通知される
// - claim は最初の呼び出しだけ true（ディスパッチャの二重処理防止）
// - assignNoteId は noteId が null の run にだけ効く（採番済みを上書きしない）
// - buildRunScopeChat は id を run.chatId で安定させ（新 UUID を発番しない =
//   チャット増殖防止）、既存エントリのフィールドを脱落させない
//   （store.tsx buildCurrentChat と同じ通線ルール）

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRunScopeChat,
  chatRunManager,
  type ChatRunResult,
  type ChatRunSnapshot,
  type ChatRunState,
} from "./chat-run-manager";
import type { ChatMessage, ScopeChat } from "../../lib/document-types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: "2026-01-01T00:00:00.000Z" };
}

function snapshot(overrides: Partial<ChatRunSnapshot> = {}): ChatRunSnapshot {
  return {
    runId: "run-1",
    noteId: "note-1",
    chatId: "chat-1",
    scopeBlockIds: [],
    quotedMarkdown: "",
    sessionId: null,
    forkedFrom: null,
    baseMessages: [msg("user", "Q1"), msg("assistant", "A1")],
    userMessage: msg("user", "Q2"),
    ...overrides,
  };
}

const RESULT: ChatRunResult = {
  assistantMessage: msg("assistant", "A2"),
  sessionId: "session-new",
};

// exec の then 連鎖を確実にフラッシュする
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  chatRunManager.reset();
});

describe("chatRunManager: run のライフサイクル", () => {
  it("start 直後は running としてノート宛 run に載る", () => {
    let resolveExec!: (r: ChatRunResult) => void;
    chatRunManager.start(
      snapshot(),
      () => new Promise<ChatRunResult>((resolve) => { resolveExec = resolve; }),
    );
    const runs = chatRunManager.getRunsForNote("note-1");
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
    expect(chatRunManager.getSettledRuns()).toHaveLength(0);
    resolveExec(RESULT);
  });

  it("exec が解決したら done になり、result 付きでリスナーに通知される", async () => {
    const seen: ChatRunState[] = [];
    chatRunManager.subscribe((run) => seen.push(run));
    chatRunManager.start(snapshot(), async () => RESULT);
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe("done");
    expect(seen[0].result?.assistantMessage.content).toBe("A2");
    expect(seen[0].result?.sessionId).toBe("session-new");
    expect(chatRunManager.getSettledRuns()).toHaveLength(1);
  });

  it("exec が拒否したら error になり、Error.message が errorMessage に載る", async () => {
    const seen: ChatRunState[] = [];
    chatRunManager.subscribe((run) => seen.push(run));
    chatRunManager.start(snapshot(), async () => {
      throw new Error("AI が応答しませんでした");
    });
    await flush();
    expect(seen[0].status).toBe("error");
    expect(seen[0].errorMessage).toBe("AI が応答しませんでした");
  });

  it("リスナーが例外を投げても settle 自体は成立する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    chatRunManager.subscribe(() => {
      throw new Error("listener boom");
    });
    chatRunManager.start(snapshot(), async () => RESULT);
    await flush();
    expect(chatRunManager.getSettledRuns()).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it("claim は最初の 1 回だけ true（二重処理の排他）", async () => {
    chatRunManager.start(snapshot(), async () => RESULT);
    await flush();
    expect(chatRunManager.claim("run-1")).toBe(true);
    expect(chatRunManager.claim("run-1")).toBe(false);
    // claim 済みは取りこぼし回収の対象から外れる
    expect(chatRunManager.getSettledRuns()).toHaveLength(0);
  });

  it("consume した run は一覧から消え、claim も false になる", async () => {
    chatRunManager.start(snapshot(), async () => RESULT);
    await flush();
    chatRunManager.consume("run-1");
    expect(chatRunManager.getRunsForNote("note-1")).toHaveLength(0);
    expect(chatRunManager.claim("run-1")).toBe(false);
  });

  it("unclaim で処理権を返上すると再 claim でき、getSettledRuns にも再び載る", async () => {
    chatRunManager.start(snapshot(), async () => RESULT);
    await flush();
    expect(chatRunManager.claim("run-1")).toBe(true);
    // 書き戻しの一時失敗を想定: 返上 → 回収対象に戻る → 再 claim できる
    chatRunManager.unclaim("run-1");
    expect(chatRunManager.getSettledRuns()).toHaveLength(1);
    expect(chatRunManager.claim("run-1")).toBe(true);
  });

  it("assignNoteId は noteId が null の run にだけ効く", () => {
    let resolve1!: (r: ChatRunResult) => void;
    let resolve2!: (r: ChatRunResult) => void;
    chatRunManager.start(
      snapshot({ runId: "run-null", noteId: null }),
      () => new Promise<ChatRunResult>((r) => { resolve1 = r; }),
    );
    chatRunManager.start(
      snapshot({ runId: "run-fixed", noteId: "note-9" }),
      () => new Promise<ChatRunResult>((r) => { resolve2 = r; }),
    );
    chatRunManager.assignNoteId("run-null", "note-assigned");
    chatRunManager.assignNoteId("run-fixed", "note-assigned");
    expect(chatRunManager.getRunsForNote("note-assigned")).toHaveLength(1);
    expect(chatRunManager.getRunsForNote("note-9")).toHaveLength(1);
    resolve1(RESULT);
    resolve2(RESULT);
  });

  it("unsubscribe 後は通知されない", async () => {
    const seen: ChatRunState[] = [];
    const unsubscribe = chatRunManager.subscribe((run) => seen.push(run));
    unsubscribe();
    chatRunManager.start(snapshot(), async () => RESULT);
    await flush();
    expect(seen).toHaveLength(0);
  });
});

describe("buildRunScopeChat: ScopeChat の組み立て", () => {
  function doneRun(overrides: Partial<ChatRunSnapshot> = {}): ChatRunState {
    return { ...snapshot(overrides), status: "done", result: RESULT };
  }

  it("done なら baseMessages + user + assistant の確定形になる", () => {
    const chat = buildRunScopeChat(doneRun());
    expect(chat.messages.map((m) => m.content)).toEqual(["Q1", "A1", "Q2", "A2"]);
    expect(chat.id).toBe("chat-1");
    expect(chat.generatedBy?.sessionId).toBe("session-new");
  });

  it("running なら baseMessages + user まで（assistant は含まない）", () => {
    const run: ChatRunState = { ...snapshot(), status: "running" };
    const chat = buildRunScopeChat(run);
    expect(chat.messages.map((m) => m.content)).toEqual(["Q1", "A1", "Q2"]);
    // sessionId は送信時点の値へフォールバック（null なら空文字）
    expect(chat.generatedBy?.sessionId).toBe("");
  });

  it("スコープは scopeBlockIds から解決する（空 = page / あり = heading）", () => {
    expect(buildRunScopeChat(doneRun()).scopeType).toBe("page");
    const heading = buildRunScopeChat(doneRun({ scopeBlockIds: ["block-1"] }));
    expect(heading.scopeType).toBe("heading");
    expect(heading.scopeBlockId).toBe("block-1");
  });

  it("既存エントリの createdAt / generatedBy / forkedFrom / scope を脱落させない", () => {
    const existing: ScopeChat = {
      id: "chat-1",
      scopeBlockId: "block-x",
      scopeType: "block",
      messages: [msg("user", "old")],
      generatedBy: {
        agent: "crucible-agent",
        sessionId: "session-old",
        model: "gpt-oss-120b",
        tokenUsage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
      forkedFrom: { chatId: "parent-1", messageIndex: 3 },
      createdAt: "2025-12-31T00:00:00.000Z",
      modifiedAt: "2025-12-31T00:00:00.000Z",
    };
    const chat = buildRunScopeChat(doneRun(), existing);
    expect(chat.createdAt).toBe("2025-12-31T00:00:00.000Z");
    expect(chat.scopeBlockId).toBe("block-x");
    expect(chat.scopeType).toBe("block");
    expect(chat.generatedBy?.agent).toBe("crucible-agent");
    expect(chat.generatedBy?.model).toBe("gpt-oss-120b");
    expect(chat.generatedBy?.tokenUsage?.total_tokens).toBe(3);
    expect(chat.forkedFrom).toEqual({ chatId: "parent-1", messageIndex: 3 });
    // sessionId は run の結果が優先（継続会話が新しいセッションに切り替わる）
    expect(chat.generatedBy?.sessionId).toBe("session-new");
  });

  it("run の forkedFrom は既存より優先される", () => {
    const existing: ScopeChat = {
      id: "chat-1",
      scopeBlockId: "",
      scopeType: "page",
      messages: [],
      createdAt: "2025-12-31T00:00:00.000Z",
      modifiedAt: "2025-12-31T00:00:00.000Z",
    };
    const run = doneRun({ forkedFrom: { chatId: "parent-2", messageIndex: 1 } });
    expect(buildRunScopeChat(run, existing).forkedFrom).toEqual({
      chatId: "parent-2",
      messageIndex: 1,
    });
  });

  it("attachments 付き user メッセージを保持する", () => {
    const userWithAttachment: ChatMessage = {
      ...msg("user", "Q2 📎 資料"),
      attachments: [{ id: "note-a", title: "資料", isWiki: true }],
    };
    const chat = buildRunScopeChat(doneRun({ userMessage: userWithAttachment }));
    expect(chat.messages[2].attachments).toEqual([
      { id: "note-a", title: "資料", isWiki: true },
    ]);
  });
});
