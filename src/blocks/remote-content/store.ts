// ノート本文の外部メディアを「読み込んでよいか」の判定と、ノートごとの同意の保持。
//
// BlockNote のブロック render は React ツリー外でも呼ばれるので、Context は使えない。
// mobile-capture/inbox/experimental.ts と同じ「モジュール変数 + window CustomEvent +
// 購読フック」の形にして、ブロック render と React 側の両方から同じ状態を読む。
//
// ── 同意はセッション限りにする（永続化しない） ──
// 1. ノートファイルに書くと、共有・fork したときに同意が一緒に運ばれる。次に開いた
//    人の同意を送り主が決めることになり、この機能の意味が反転する。
// 2. localStorage にノート ID で持つと「一度見た」が恒久的な許可になる。URL の
//    指す先は相手が後から差し替えられる（今日は画像、明日はリダイレクト）ので、
//    一度の同意を将来の取得にまで広げるのは根拠が無い。
// 3. セッション限りなら移行も掃除も要らない。毎回押すのが煩わしい人のために
//    設定（allowRemoteContent）を用意してある。

import { useCallback, useEffect, useState } from "react";
import { isRemoteContentAlwaysAllowed } from "../../features/settings/store";

/** 同意状態・ブロック件数が変わったときの同一タブ内通知。 */
export const REMOTE_CONTENT_CHANGED_EVENT = "graphium-remote-content-changed";

/** 「読み込む」を押した scope（= 開いているエディタ 1 つ分。createRemoteContentScope）。 */
const allowedScopes = new Set<string>();

/**
 * ブロックしたメディアブロックの件数を scope ごとに数える。
 *
 * 値は「同じ block id に対して今いくつの nodeView が生きているか」。ProseMirror は
 * 再描画のたびに nodeView を作り直し、生成と破棄の順序は場面によって前後するので、
 * 単純な集合ではなく参照カウントで持つ（0 になったらキーごと消す）。
 */
const blockedByScope = new Map<string, Map<string, number>>();

/**
 * いまローカルへの取り込みを試している最中のブロック（scope → block id）。
 *
 * 貼った直後の画像は「外部 URL のブロック」として一瞬ゲートに数えられる。数えたまま
 * バーを出すと、自分で貼った画像のせいで「読み込んでいない外部メディアがあります」が
 * 点滅し、それを消したいユーザーが「外部画像を読み込む」を押す —— そのノートの
 * **他の**外部メディアまで許可させてしまうので、取り込み中は件数から外す。
 * 取り込みが失敗して外部 URL のまま残ったものは、外した後にまた数えられる。
 */
const importingByScope = new Map<string, Set<string>>();

let notifyScheduled = false;

/**
 * 変更通知。ProseMirror の描画中に同期で React の setState を走らせないよう、
 * microtask にまとめて 1 回だけ飛ばす。
 */
function notifyRemoteContentChanged(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    try {
      window.dispatchEvent(new CustomEvent(REMOTE_CONTENT_CHANGED_EVENT));
    } catch {
      // window 不在（テスト等）は無視
    }
  });
}

/** 設定（allowRemoteContent）を切り替えた側から呼ぶ。開いているノートに即反映する。 */
export function refreshRemoteContentGate(): void {
  if (isRemoteContentAlwaysAllowed()) blockedByScope.clear();
  notifyRemoteContentChanged();
}

/** この scope の外部メディアを読み込んでよいか。設定 ON なら scope を問わず true。 */
export function isRemoteContentAllowed(scope: string): boolean {
  if (isRemoteContentAlwaysAllowed()) return true;
  return scope !== "" && allowedScopes.has(scope);
}

/**
 * このノートの外部メディアを読み込む（ユーザーの明示操作からのみ呼ぶ）。
 * 以後この scope のブロックは元の描画に切り替わるので、数えていた件数は捨てる。
 */
export function allowRemoteContentFor(scope: string): void {
  if (!scope) return;
  allowedScopes.add(scope);
  blockedByScope.delete(scope);
  notifyRemoteContentChanged();
}

/** ブロックした 1 件を登録する（ゲートされた render が呼ぶ）。 */
export function registerBlockedRemoteBlock(scope: string, blockId: string): void {
  if (!scope || !blockId) return;
  let counts = blockedByScope.get(scope);
  if (!counts) {
    counts = new Map();
    blockedByScope.set(scope, counts);
  }
  counts.set(blockId, (counts.get(blockId) ?? 0) + 1);
  notifyRemoteContentChanged();
}

/** 登録を取り消す（nodeView の destroy / 読み込みへの切り替え時に呼ぶ）。 */
export function unregisterBlockedRemoteBlock(scope: string, blockId: string): void {
  const counts = blockedByScope.get(scope);
  if (!counts) return;
  const next = (counts.get(blockId) ?? 0) - 1;
  if (next > 0) {
    counts.set(blockId, next);
  } else {
    counts.delete(blockId);
    if (counts.size === 0) blockedByScope.delete(scope);
  }
  notifyRemoteContentChanged();
}

/** 取り込み開始を登録する（use-remote-image-import が呼ぶ）。 */
export function markRemoteImportPending(scope: string, blockId: string): void {
  if (!scope || !blockId) return;
  let pending = importingByScope.get(scope);
  if (!pending) {
    pending = new Set();
    importingByScope.set(scope, pending);
  }
  pending.add(blockId);
  notifyRemoteContentChanged();
}

/** 取り込みの終了を登録する（成功・失敗どちらでも呼ぶ）。 */
export function clearRemoteImportPending(scope: string, blockId: string): void {
  const pending = importingByScope.get(scope);
  if (!pending?.delete(blockId)) return;
  if (pending.size === 0) importingByScope.delete(scope);
  notifyRemoteContentChanged();
}

/** この scope でブロック中のメディアブロック数（取り込み中のものは除く）。 */
export function blockedRemoteCount(scope: string): number {
  const counts = blockedByScope.get(scope);
  if (!counts) return 0;
  const pending = importingByScope.get(scope);
  if (!pending?.size) return counts.size;
  let n = 0;
  for (const blockId of counts.keys()) if (!pending.has(blockId)) n += 1;
  return n;
}

/** テスト用: セッション同意と件数を初期化する。 */
export function resetRemoteContentGate(): void {
  allowedScopes.clear();
  blockedByScope.clear();
  importingByScope.clear();
}

// ── scope の作り方 ──
//
// scope は「いま開いているエディタ 1 つ」に 1 個。ノート ID から作らない理由が 2 つある:
//
//   1. 未保存のノートは ID を持たない。ID が無いときの代用（"new" のような固定文字列）は
//      どの新規ノートでも同じ値になるので、片方で押した同意がもう片方にも効いてしまう。
//   2. 新規ノートは自動保存で ID が付く。ID から作ると保存した瞬間に scope が変わり、
//      押したはずの同意が外れ、取り込み中の画像は書き戻し先を見失う。
//
// 値が変わるのは useRemoteContentScope を呼ぶコンポーネントが作り直されたとき
// （メインエディタは key={fm.editorKey}、SidePeek は key={noteId} で、どちらもノートを
// 開くたびに作り直される）。同意はそのノートを開いている間だけ生き、閉じれば消える。
// 永続化はしない（冒頭を参照）ので、同じノートを開き直せばまた押してもらうことになる。

let scopeSequence = 0;

/**
 * 新しい scope を 1 つ作る。値そのものに意味は無く、他と重ならないことだけが要件。
 * （StrictMode の二重レンダーで 1 つ余分に採番されることがあるが、捨てられるだけ。）
 */
export function createRemoteContentScope(): string {
  scopeSequence += 1;
  return `remote-scope-${scopeSequence}`;
}

/**
 * scope に紐づく状態を捨てる（エディタを閉じたとき）。
 * 同じ scope は二度と作られないので、残しておいても読まれることはないが、
 * 開くたびに増える一方になるため閉じたところで消す。
 */
export function releaseRemoteContentScope(scope: string): void {
  if (!scope) return;
  allowedScopes.delete(scope);
  blockedByScope.delete(scope);
  importingByScope.delete(scope);
  notifyRemoteContentChanged();
}

/**
 * このエディタ 1 回分の scope を取る hook。マウントしている間は同じ値を返し、
 * アンマウントでその scope の同意・件数を捨てる。
 *
 * ノートの識別子は受け取らない。開いているノートに保存で ID が付いても、また
 * BlockNote のエディタだけが作り直されても、同じ本文を開き続けている限り
 * scope は変わらない、が欲しい形のため。
 */
export function useRemoteContentScope(): string {
  const [scope] = useState(createRemoteContentScope);
  useEffect(() => () => releaseRemoteContentScope(scope), [scope]);
  return scope;
}

/**
 * 状態変化の購読（ブロック render 用。React の外から呼べる）。
 * 同一タブの切替イベントに加えて storage イベントも見るので、別タブで設定を
 * 変えた場合にも追従する。
 */
export function subscribeRemoteContentChange(handler: () => void): () => void {
  try {
    window.addEventListener(REMOTE_CONTENT_CHANGED_EVENT, handler);
    window.addEventListener("storage", handler);
  } catch {
    return () => {};
  }
  return () => {
    window.removeEventListener(REMOTE_CONTENT_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export type RemoteContentGate = {
  /** ブロック中の件数（読み込み済み・許可済みなら 0 として扱ってよい） */
  blockedCount: number;
  /** このノートの外部メディアを読み込んでよい状態か */
  allowed: boolean;
  /** このノートについて読み込みを許可する */
  allow: () => void;
};

/** ノート単位のゲート状態を反応的に読む hook。 */
export function useRemoteContentGate(scope: string): RemoteContentGate {
  const read = useCallback(
    () => ({ blockedCount: blockedRemoteCount(scope), allowed: isRemoteContentAllowed(scope) }),
    [scope],
  );
  const [state, setState] = useState(read);

  useEffect(() => {
    const handler = () =>
      setState((prev) => {
        const next = read();
        // 値が同じなら同じオブジェクトを返して再レンダリングを止める
        // （ブロック描画のたびにイベントが飛ぶため）
        return prev.blockedCount === next.blockedCount && prev.allowed === next.allowed
          ? prev
          : next;
      });
    handler();
    return subscribeRemoteContentChange(handler);
  }, [read]);

  const allow = useCallback(() => allowRemoteContentFor(scope), [scope]);
  return { ...state, allow };
}

/**
 * この scope が許可されているかだけを反応的に読む hook（React で書かれたブロック用）。
 * 許可に切り替わった瞬間に再描画させるのが目的なので、件数は返さない。
 */
export function useRemoteContentAllowed(scope: string): boolean {
  const [allowed, setAllowed] = useState(() => isRemoteContentAllowed(scope));
  useEffect(() => {
    const handler = () => setAllowed(isRemoteContentAllowed(scope));
    handler();
    return subscribeRemoteContentChange(handler);
  }, [scope]);
  return allowed;
}

/**
 * 「このブロックはいま外部参照をブロックしている」をバーの件数に登録する hook。
 * React で書かれたブロック（pdf / bookmark）用。blocked が false の間は何もしない。
 */
export function useBlockedRemoteBlock(scope: string, blockId: string, blocked: boolean): void {
  useEffect(() => {
    if (!blocked) return;
    registerBlockedRemoteBlock(scope, blockId);
    return () => unregisterBlockedRemoteBlock(scope, blockId);
  }, [scope, blockId, blocked]);
}

// ── エディタ → scope の受け渡し ──
//
// ブロック render が受け取るのは block と editor だけなので、そのブロックが
// どの scope に属するかはエディタインスタンスに載せて運ぶ。base/editor.tsx が
// remoteContentScope prop を受け取って useCreateBlockNote の直後に代入する
// （effect にすると最初のブロック描画に間に合わない）。

const SCOPE_KEY = "__graphiumRemoteScope";

/** エディタに scope を刻む（base/editor.tsx から呼ぶ）。 */
export function setEditorRemoteScope(editor: unknown, scope: string | undefined): void {
  if (!editor || typeof editor !== "object") return;
  (editor as Record<string, unknown>)[SCOPE_KEY] = scope ?? "";
}

/**
 * エディタから scope を読む。scope の無いエディタ（stories 等）は空文字になり、
 * isRemoteContentAllowed が必ず false を返す＝ブロック側に倒れる。
 */
export function editorRemoteScope(editor: unknown): string {
  if (!editor || typeof editor !== "object") return "";
  const scope = (editor as Record<string, unknown>)[SCOPE_KEY];
  return typeof scope === "string" ? scope : "";
}
