// AI チャット実行のアプリレベル管理（chat run manager）
//
// 課題: チャット実行（runAgent の await と応答の store 書き込み）は従来
// NoteEditorInner のクロージャ内にあり、ノート切替（<NoteEditor key={editorKey}>
// の remount）で AiAssistantProvider ごと破棄されると応答の書き込み先が消え、
// 回答が失われていた。
//
// この manager は「実行中のチャット run」をコンポーネントのライフサイクルの外
// （モジュールレベル singleton）で保持する。役割分担:
//
// - 送信時: NoteEditorInner がプロンプトを組み立て（エディタ依存の処理は送信時に
//   完結させ）、スナップショットと実行クロージャを start() に渡す
// - 完了時: NoteApp 常駐のディスパッチャ（subscribe）が、元ノートが開いていれば
//   ライブ store へ、閉じていればファイルの doc.chats へ書き戻す
// - 復元時: 元ノートの再マウント時に getRunsForNote() で実行中 run を拾い、
//   会話とローディング表示を復元する
//
// wiki ingest（NoteApp 常駐の ingestQueueRef）と同じ「ノート切替に耐える」構造を、
// React 外 singleton + listener 通知で実現する。

import type { ChatMessage, GraphiumDocument, ScopeChat } from "../../lib/document-types";

export type ChatRunStatus = "running" | "done" | "error";

export type ChatRunSnapshot = {
  runId: string;
  /**
   * 実行元ノートのフルキー（wiki:/skill: プレフィックス込み、doc キャッシュと同形）。
   * 未採番の新規ノートは null（オートセーブで採番されたら assignNoteId で補完する）。
   */
  noteId: string | null;
  /** 送信時に確定した ScopeChat の id。応答の書き戻し先はこの id への upsert で決める */
  chatId: string;
  /** 送信時点のスコープ（sourceBlockIds のスナップショット） */
  scopeBlockIds: string[];
  /** 送信時点の引用テキスト（復元時に継続会話の context を維持するため保持） */
  quotedMarkdown: string;
  /** 送信時点の sessionId（継続会話用） */
  sessionId: string | null;
  forkedFrom: ScopeChat["forkedFrom"] | null;
  /** 送信直前までのメッセージ（rewind 適用済みスナップショット） */
  baseMessages: ChatMessage[];
  /** 送信した user メッセージ（表示用 content + attachments） */
  userMessage: ChatMessage;
};

export type ChatRunResult = {
  assistantMessage: ChatMessage;
  sessionId: string | null;
};

export type ChatRunState = ChatRunSnapshot & {
  status: ChatRunStatus;
  result?: ChatRunResult;
  /** exec 側で localizeAiError 済みの表示用文言（Error.message） */
  errorMessage?: string;
};

/**
 * NoteApp のディスパッチャが「元ノートが今開かれているか」を判定し、開かれて
 * いればライブ store へ反映するための imperative ハンドル。NoteEditorInner が
 * useEffect で登録する（composerSubmitRef と同じ流儀）。
 */
export type ChatRunApplyHandle = {
  /** このハンドルが属するノートのフルキー（未採番の新規ノートは null） */
  noteId: string | null;
  /**
   * 未採番（noteId が null 同士）の run がこのエディタインスタンス発かを判定する。
   * null === null の単純比較だと「別の未採番ノートに切り替えた」ケースで他ノートの
   * store に誤配するため、runId ベースで所有権を確認する。
   */
  ownsRun: (runId: string) => boolean;
  /** done した run をライブ store に反映して markDirty する */
  applyResult: (run: ChatRunState) => void;
  /** error した run をライブ store に反映する（保存はしない） */
  applyError: (run: ChatRunState) => void;
  /** ファイル書き戻し後の doc.chats を store のチャット一覧へ反映する */
  refreshChats: (doc: GraphiumDocument) => void;
};

/** run が完了（done / error）したときに呼ばれるリスナー */
type ChatRunListener = (run: ChatRunState) => void;

class ChatRunManager {
  private runs = new Map<string, ChatRunState>();
  private listeners = new Set<ChatRunListener>();
  private claimedIds = new Set<string>();

  /**
   * チャット実行を開始する。exec の解決/拒否で run が done/error になり、
   * リスナーに通知される。exec 側はエラーを表示用文言（localizeAiError 済み）の
   * Error に変換して throw する契約。
   */
  start(snapshot: ChatRunSnapshot, exec: () => Promise<ChatRunResult>): void {
    const run: ChatRunState = { ...snapshot, status: "running" };
    this.runs.set(snapshot.runId, run);
    void exec().then(
      (result) => this.settle(snapshot.runId, { status: "done", result }),
      (err: unknown) =>
        this.settle(snapshot.runId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
    );
  }

  /** 未採番だった run に、オートセーブで確定したノートのフルキーを紐づける */
  assignNoteId(runId: string, noteId: string): void {
    const run = this.runs.get(runId);
    if (run && run.noteId === null) {
      this.runs.set(runId, { ...run, noteId });
    }
  }

  /** 指定ノート宛の未消費 run（実行中含む）を開始順で返す */
  getRunsForNote(noteId: string): ChatRunState[] {
    return [...this.runs.values()].filter((r) => r.noteId === noteId);
  }

  /** 完了済み（done / error）かつ未 claim の run を返す（ディスパッチ取りこぼし回収用） */
  getSettledRuns(): ChatRunState[] {
    return [...this.runs.values()].filter(
      (r) => r.status !== "running" && !this.claimedIds.has(r.runId),
    );
  }

  /**
   * run の最終処理権を取得する。最初の呼び出しだけ true を返し、以降は false。
   * ディスパッチャの subscribe と取りこぼし回収が同じ run を二重処理しないための排他。
   */
  claim(runId: string): boolean {
    if (!this.runs.has(runId) || this.claimedIds.has(runId)) return false;
    this.claimedIds.add(runId);
    return true;
  }

  /**
   * claim を返上する（書き戻しの一時失敗時のリトライ用）。run は getSettledRuns に
   * 再び載り、次のディスパッチ機会（新たな settle / effect 再購読）で再処理される。
   */
  unclaim(runId: string): void {
    this.claimedIds.delete(runId);
  }

  /** 処理が終わった run を破棄する */
  consume(runId: string): void {
    this.runs.delete(runId);
    this.claimedIds.delete(runId);
  }

  /** 完了通知を購読する。返り値で解除 */
  subscribe(listener: ChatRunListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** テスト用: 全状態を破棄する */
  reset(): void {
    this.runs.clear();
    this.listeners.clear();
    this.claimedIds.clear();
  }

  private settle(
    runId: string,
    outcome: { status: "done"; result: ChatRunResult } | { status: "error"; errorMessage: string },
  ): void {
    const run = this.runs.get(runId);
    if (!run) return; // consume 済み（リロード間際など）
    const settled: ChatRunState = { ...run, ...outcome };
    this.runs.set(runId, settled);
    for (const listener of this.listeners) {
      try {
        listener(settled);
      } catch (err) {
        console.error("[chat-run] リスナーが例外を投げました:", err);
      }
    }
  }
}

export const chatRunManager = new ChatRunManager();

/**
 * run から書き戻し用の ScopeChat を組み立てる。
 * store.tsx の buildCurrentChat と同じ不変条件を守る:
 * - id は run.chatId（send 時確定）で安定。新 UUID を発番しない（チャット増殖防止）
 * - 既存エントリ（existing）の createdAt / generatedBy / forkedFrom / scope を継承し、
 *   ここに無いフィールドを脱落させない
 * - messages は「baseMessages + user (+ assistant)」の確定形。応答待ち中の store は
 *   loading ガードで編集不可なので、確定上書きしても履歴を壊さない（冪等に再適用できる）
 */
export function buildRunScopeChat(run: ChatRunState, existing?: ScopeChat | null): ScopeChat {
  const now = new Date().toISOString();
  const messages: ChatMessage[] =
    run.status === "done" && run.result
      ? [...run.baseMessages, run.userMessage, run.result.assistantMessage]
      : [...run.baseMessages, run.userMessage];
  const sessionId =
    (run.status === "done" ? run.result?.sessionId : null) ??
    run.sessionId ??
    existing?.generatedBy?.sessionId ??
    "";
  const forkedFrom = run.forkedFrom ?? existing?.forkedFrom;
  return {
    id: run.chatId,
    scopeBlockId: existing?.scopeBlockId ?? run.scopeBlockIds[0] ?? "",
    scopeType: existing?.scopeType ?? (run.scopeBlockIds.length > 0 ? "heading" : "page"),
    messages,
    generatedBy: {
      agent: existing?.generatedBy?.agent ?? "ai",
      sessionId,
      ...(existing?.generatedBy?.model ? { model: existing.generatedBy.model } : {}),
      ...(existing?.generatedBy?.tokenUsage
        ? { tokenUsage: existing.generatedBy.tokenUsage }
        : {}),
    },
    ...(forkedFrom ? { forkedFrom } : {}),
    createdAt: existing?.createdAt ?? run.userMessage.timestamp ?? now,
    modifiedAt: now,
  };
}
