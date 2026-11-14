// メインのウィンドウ側の橋。別ウィンドウで編集しているノートを、メインの既存の経路につなぐ。
//
// 役割は 3 つ（決まりごとは lib/viewer-window.ts の「編集の受け渡し」）:
//
//   1. メインが開いているノートの一覧を別ウィンドウへ知らせる（holds）。
//      別ウィンドウは、メインが開いているノートを表示のみにする。メインがノートを閉じたときは、
//      そのノートへの書き込み（閉じるときの書き出し・書き込み中だった自動保存）が終わってから
//      知らせる（別ウィンドウが古い本文から編集を始めないように）
//
//   2. 別ウィンドウで編集しているノートの「代理」を、保存の列（lib/peek-save-queue.ts）に登録する。
//      メインがそのノートを開く前の「未保存を書き出させて待つ」（flushPeekSaves）、改名の反映、
//      本文の幅の一括変更、保守の取り消しが、同じウィンドウのサイドピークと同じ口で別ウィンドウへ届く。
//      別ウィンドウの保存は、サイドピークの保存と同じ後処理（索引と doc キャッシュの更新）に流す
//
// 3. 別ウィンドウのグラフとメモのパネルからの依頼（graph-request / memo-create / memo-delete）。
//    実処理は deps が持つ。ここは返事を必ず返すことだけを担う（決まりごとは lib/viewer-window.ts）
//
// 書き出しを頼んだとき（flush）の待ち方:
//   - 別ウィンドウはまず「受け取った」と返す（flush-ack）。これが届かなければ、別ウィンドウは
//     もう無いものとして代理を外し、最後に知っている形で進める
//   - 受け取ったと返ってきたら、書き終わりの返事（flushed）を長めに待つ（遅い保存先でも追い越さない）
//   - 書けなかったと返ってきたら、失敗として扱う。書けなかった編集は、同じウィンドウのピークの
//     失敗と同じく、メインが開くときに引き取る（peek-save-queue の unsavedPeekDoc）

import type { GraphiumDocument } from "../../lib/document-types";
import {
  localLivePeekIds,
  onLocalLivePeeksChange,
  PeekSaveFailed,
  pendingLocalSaves,
  queuePeekSave,
  registerLivePeek,
} from "../../lib/peek-save-queue";
import {
  onMessageFromViewer,
  sendToViewer,
  type MainToViewerMessage,
  type ViewerMemoCreateRequest,
  type ViewerNoteGraph,
  type ViewerToMainMessage,
} from "../../lib/viewer-window";

/** 別ウィンドウが flush を「受け取った」と返すまでの上限。返らなければ、閉じたものとして扱う */
export const VIEWER_FLUSH_ACK_TIMEOUT_MS = 2000;
/** 受け取ったと返ってきた後、書き終わりを待つ上限 */
export const VIEWER_FLUSH_DONE_TIMEOUT_MS = 30000;
/** 開いているノートの一覧を送り直す間隔（別ウィンドウは、これが途絶えたメインをいないものとして扱う） */
export const HOLDS_HEARTBEAT_MS = 4000;

export type ViewerMainBridgeDeps = {
  /** 別ウィンドウがノートを保存した。サイドピークの onSaved と同じ後処理を行う */
  onSaved: (noteId: string, savedDoc: GraphiumDocument) => void;
  /** 別ウィンドウのグラフのパネル用に、このノートのグラフを作る（作れなければ null） */
  getNoteGraph?: (noteId: string) => Promise<ViewerNoteGraph | null>;
  /** 別ウィンドウのメモのパネルから頼まれたメモを作る（成否を返す） */
  createMemo?: (req: ViewerMemoCreateRequest) => Promise<boolean>;
  /** 別ウィンドウのメモのパネルから頼まれたメモを消す */
  deleteMemo?: (memoId: string) => Promise<void> | void;
  /** テスト用の差し替え口 */
  send?: (msg: MainToViewerMessage) => void;
  subscribe?: (fn: (msg: ViewerToMainMessage) => void) => () => void;
  flushAckTimeoutMs?: number;
  flushDoneTimeoutMs?: number;
};

type RemoteEdit = {
  id: string;
  /** 別ウィンドウが最後に知らせた、保存先にある形 */
  lastDoc: GraphiumDocument;
  unsaved: boolean;
  unregister: () => void;
};

type FlushWaiter = {
  acked: () => void;
  done: (saved: boolean, doc: GraphiumDocument | null) => void;
};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 橋を掛ける。戻り値で外す */
export function installViewerMainBridge(deps: ViewerMainBridgeDeps): () => void {
  const send = deps.send ?? sendToViewer;
  const subscribe = deps.subscribe ?? onMessageFromViewer;
  const ackTimeoutMs = deps.flushAckTimeoutMs ?? VIEWER_FLUSH_ACK_TIMEOUT_MS;
  const doneTimeoutMs = deps.flushDoneTimeoutMs ?? VIEWER_FLUSH_DONE_TIMEOUT_MS;
  const mainId = newId();
  let disposed = false;

  // 別ウィンドウで編集しているノートの代理（下の 2）。ふつうは 1 つ。別ウィンドウがノートを
  // 切り替えた直後は、前のノートの書き出しが終わるまで 2 つになる
  const remotes = new Map<string, RemoteEdit>();

  // ── 1. 開いているノートの一覧 ──
  let held = new Set<string>(localLivePeekIds());
  // 閉じたが、書き込みがまだ終わっていないノート（終わるまで開いている扱い）
  const releasing = new Map<string, number>();
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSent: string | null = null;

  const sendHolds = (force = false) => {
    if (disposed) return;
    const ids = [...new Set([...held, ...releasing.keys()])].sort();
    const key = ids.join("\n");
    if (!force && key === lastSent) return;
    lastSent = key;
    send({ type: "holds", mainId, ids, remotes: [...remotes.keys()] });
  };

  const evaluate = () => {
    announceTimer = null;
    if (disposed) return;
    const now = new Set(localLivePeekIds());
    for (const id of held) {
      if (now.has(id)) continue;
      const pending = pendingLocalSaves(id);
      if (!pending) continue;
      releasing.set(id, (releasing.get(id) ?? 0) + 1);
      void pending.then(() => {
        const left = (releasing.get(id) ?? 1) - 1;
        if (left > 0) releasing.set(id, left);
        else releasing.delete(id);
        sendHolds();
      });
    }
    held = now;
    sendHolds();
  };

  // 登録の増減はまとめて見る（ノートの切り替えは「外す → 付ける」が続けて起きる。
  // 閉じるときの書き出しが列に並ぶのも、登録が外れた後のことがある）
  const scheduleEvaluate = () => {
    if (announceTimer !== null) return;
    announceTimer = setTimeout(evaluate, 0);
  };
  const offLivePeeks = onLocalLivePeeksChange(scheduleEvaluate);
  const heartbeat = setInterval(() => sendHolds(true), HOLDS_HEARTBEAT_MS);

  // ── 2. 別ウィンドウで編集しているノートの代理 ──
  const flushWaiters = new Map<string, FlushWaiter>();

  const dropRemote = (id: string, only?: RemoteEdit) => {
    const edit = remotes.get(id);
    if (!edit || (only && edit !== only)) return;
    edit.unregister();
    remotes.delete(id);
  };

  const requestFlush = (edit: RemoteEdit): Promise<GraphiumDocument | void> =>
    new Promise((resolve, reject) => {
      const nonce = newId();
      const giveUp = () => {
        flushWaiters.delete(nonce);
        resolve();
      };
      let timer = setTimeout(() => {
        // 受け取ったとも返らない = 別ウィンドウはもう無い。代理を外し、最後に知っている形で進める
        dropRemote(edit.id, edit);
        giveUp();
      }, ackTimeoutMs);
      flushWaiters.set(nonce, {
        acked: () => {
          clearTimeout(timer);
          timer = setTimeout(giveUp, doneTimeoutMs);
        },
        done: (saved, doc) => {
          clearTimeout(timer);
          flushWaiters.delete(nonce);
          if (saved) {
            edit.unsaved = false;
            if (doc) edit.lastDoc = doc;
            resolve(doc ?? undefined);
          } else {
            // 書けなかった。doc は別ウィンドウが書こうとした形（無ければ最後に保存先にあった形）
            reject(new PeekSaveFailed(doc ?? edit.lastDoc));
          }
        },
      });
      send({ type: "flush", nonce, id: edit.id });
    });

  const startRemote = (id: string, doc: GraphiumDocument) => {
    dropRemote(id);
    const edit: RemoteEdit = { id, lastDoc: doc, unsaved: false, unregister: () => {} };
    edit.unregister = registerLivePeek(id, {
      remote: true,
      hasUnsaved: () => edit.unsaved,
      flush: () => {
        // 保存の列に並べる。メインの「開く前に待つ」は、この列が空になるのを待つ
        void queuePeekSave(id, edit.lastDoc, () => requestFlush(edit)).catch(() => {});
      },
      // 別ウィンドウのエディタにも反映させるが、反映できたかは待てない。false を返して
      // 呼び出し側にファイルも書き換えさせる（両方が同じ新しい名前を書くので食い違わない）
      applyMentionRename: (renamedId, oldTitle, newTitle, includeWikiLabels) => {
        send({ type: "mention-rename", id, renamedId, oldTitle, newTitle, includeWikiLabels });
        return false;
      },
      applyBodyWidth: (width, savedDoc) => {
        edit.lastDoc = savedDoc;
        send({ type: "body-width", id, width, doc: savedDoc });
      },
      // 呼び出し側は先に未保存を書き出させている（flushPeekSaves）。別ウィンドウは、差し替えを
      // 断る状態なら保存先から読み直す
      applyExternalDoc: (doc) => {
        edit.lastDoc = doc;
        send({ type: "external-doc", id, doc });
        return true;
      },
    });
    remotes.set(id, edit);
  };

  const offMessages = subscribe((msg) => {
    if (disposed) return;
    switch (msg.type) {
      case "hello":
        sendHolds(true);
        return;
      case "editing":
        startRemote(msg.id, msg.doc);
        return;
      case "editing-stopped":
        dropRemote(msg.id);
        return;
      case "dirty": {
        const edit = remotes.get(msg.id);
        if (edit) edit.unsaved = msg.unsaved;
        return;
      }
      case "saved": {
        const edit = remotes.get(msg.id);
        if (edit) edit.lastDoc = msg.doc;
        deps.onSaved(msg.id, msg.doc);
        return;
      }
      case "flush-ack":
        flushWaiters.get(msg.nonce)?.acked();
        return;
      case "flushed":
        flushWaiters.get(msg.nonce)?.done(msg.saved, msg.doc);
        return;
      // グラフとメモの依頼。依存が無い・失敗したときも必ず返事を返す（別ウィンドウは返事で待ちをやめる）
      case "graph-request": {
        const { nonce, id } = msg;
        const reply = (graph: ViewerNoteGraph | null) => {
          if (disposed) return;
          send({ type: "graph-data", nonce, id, data: graph?.data ?? null, lineageTree: graph?.lineageTree ?? null });
        };
        if (!deps.getNoteGraph) return reply(null);
        void Promise.resolve()
          .then(() => deps.getNoteGraph!(id))
          .then(reply, () => reply(null));
        return;
      }
      case "memo-create": {
        const { nonce } = msg;
        const req: ViewerMemoCreateRequest = {
          noteId: msg.noteId,
          title: msg.title,
          text: msg.text,
          block: msg.block,
          folder: msg.folder,
        };
        const reply = (ok: boolean) => {
          if (disposed) return;
          send({ type: "memo-result", nonce, ok });
        };
        if (!deps.createMemo) return reply(false);
        void Promise.resolve()
          .then(() => deps.createMemo!(req))
          .then((ok) => reply(ok === true), () => reply(false));
        return;
      }
      case "memo-delete": {
        const { nonce, memoId } = msg;
        const reply = (ok: boolean) => {
          if (disposed) return;
          send({ type: "memo-result", nonce, ok });
        };
        if (!deps.deleteMemo) return reply(false);
        void Promise.resolve()
          .then(() => deps.deleteMemo!(memoId))
          .then(() => reply(true), () => reply(false));
        return;
      }
    }
  });

  // このメインがいなくなる（タブを閉じる・リロードする）。React の後片付けは通らないので、ここでも知らせる
  const bye = () => send({ type: "bye", mainId });
  if (typeof window !== "undefined") window.addEventListener("pagehide", bye);

  // 起きたときに一度知らせる（別ウィンドウが先に開いていた場合）
  sendHolds(true);

  return () => {
    disposed = true;
    if (announceTimer !== null) clearTimeout(announceTimer);
    clearInterval(heartbeat);
    offLivePeeks();
    offMessages();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", bye);
    for (const id of [...remotes.keys()]) dropRemote(id);
    bye();
  };
}
