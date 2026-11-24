// 開いているナレッジのページの一覧を `appdata/app-open-pages.json` に書くフック（アプリ → MCP）。
// MCP は、ここに載っているページを書き換えない（未保存の編集と衝突するため）。
// このファイルが今回の起動より後に書かれていることは、MCP が「知らせを受け取れる版のアプリ」と
// 見分ける印にもなる。デスクトップ版は Rust のハートビート開始より後の時刻で必ず 1 回書くため、
// 有効になった 3 秒後にも書く。形式は format.ts
//
// busy: true を書くと、MCP は既存のページを書き換えない（安全側）。次の 2 つのとき立てる
// ・アプリの中でナレッジを書き換える処理が動いている（options.busy / options.pollBusy）
// ・開いているページの id に、ファイル名として使えない（isSafePageId を通らない）ものがある。
//   一覧に載せられないので、代わりに全体を止める

import { useEffect, useRef } from "react";
import { allLivePeekIds, onAnyLivePeeksChange, pendingEditorWorkIds } from "../../lib/peek-save-queue";
import { isSafePageId, MCP_LIVE_FORMAT_VERSION, OPEN_PAGES_KEY, type AppOpenPages } from "./format";

/** 有効になってから、もう一度書くまでの時間（ハートビート開始より後の時刻を残す） */
export const OPEN_PAGES_RECHECK_MS = 3000;
/** 開いているページが変わってから書くまでの待ち（続けて変わる間はまとめる） */
export const OPEN_PAGES_DEBOUNCE_MS = 300;
/** 書き込みに失敗したときの書き直しまでの待ちと、最大回数（成功したら数え直す） */
export const OPEN_PAGES_RETRY_MS = 5000;
/** 閉じた直後の保存が残っている間、一覧から外してよいか確かめ直す間隔 */
export const OPEN_PAGES_SAVING_RECHECK_MS = 1000;
export const OPEN_PAGES_RETRY_MAX = 3;
/** pollBusy を見る間隔 */
export const OPEN_PAGES_BUSY_POLL_MS = 2000;

export type OpenPagesStorage = {
  writeAppData?(key: string, data: unknown): Promise<void>;
};

export type OpenPagesBeaconOptions = {
  /** アプリの中でナレッジを書き換える処理が動いているか（変わったらすぐ書く） */
  busy?: boolean;
  /** 状態を持たない処理（手入れの実行など）を拾うための getter。一定間隔で見て、変わったら書く */
  pollBusy?: () => boolean;
};

/** いまエディタで開いているナレッジのページ。unsafe は一覧に載せられない id がある印 */
/**
 * 開いているエディタに加え、閉じた直後でまだ保存が終わっていないノートも「開いている」に数える
 * （書き込み中のページを外の AI が書き換えると、人の編集が消える）
 */
export function openOrSavingIds(): string[] {
  return [...new Set([...allLivePeekIds(), ...pendingEditorWorkIds()])];
}

export function currentOpenWikiPages(ids: string[] = openOrSavingIds()): { wikiIds: string[]; unsafe: boolean } {
  const out = new Set<string>();
  let unsafe = false;
  for (const id of ids) {
    if (!id.startsWith("wiki:")) continue;
    const wikiId = id.slice("wiki:".length);
    if (isSafePageId(wikiId)) out.add(wikiId);
    else unsafe = true;
  }
  return { wikiIds: [...out], unsafe };
}

/** いまエディタで開いているナレッジのページの id（`wiki:` を外したもの。安全な id だけ） */
export function currentOpenWikiIds(ids: string[] = openOrSavingIds()): string[] {
  return currentOpenWikiPages(ids).wikiIds;
}

export function useOpenPagesBeacon(
  provider: OpenPagesStorage | null | undefined,
  enabled: boolean,
  options: OpenPagesBeaconOptions = {},
): void {
  const optsRef = useRef(options);
  optsRef.current = options;
  const busy = options.busy === true;

  // 書き込みの 1 本分（effect の中の beat を busy の変化から呼べるよう、口を ref に置く）
  const beatRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !provider || typeof provider.writeAppData !== "function") return;
    const write = provider.writeAppData.bind(provider);
    let cancelled = false;
    // 書き込みは順番に行う（遅い保存先で、古い一覧が後から届いて新しい一覧を上書きしない）
    let chain: Promise<void> = Promise.resolve();
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastBusy = false;
    // 最後に書いた（書こうとした）一覧。増えるときだけすぐ書くために比べる
    let lastIds = new Set<string>();
    let savingTimer: ReturnType<typeof setTimeout> | null = null;

    const isBusy = (unsafe: boolean) =>
      unsafe || optsRef.current.busy === true || optsRef.current.pollBusy?.() === true;

    const beat = () => {
      if (cancelled) return;
      chain = chain.then(async () => {
        if (cancelled) return;
        // 書く時点の最新を読む（待っている間に変わっていても追従する）
        const { wikiIds, unsafe } = currentOpenWikiPages();
        const nowBusy = isBusy(unsafe);
        lastIds = new Set(wikiIds);
        // 保存中のページが残っている間は、1 秒ごとに確かめ直す（無くなったら一覧から外れる。
        // タイマーが遅れても、載せたまま＝安全側）
        if (savingTimer) clearTimeout(savingTimer);
        savingTimer = pendingEditorWorkIds().length > 0 ? setTimeout(() => { savingTimer = null; beat(); }, OPEN_PAGES_SAVING_RECHECK_MS) : null;
        const data: AppOpenPages = {
          formatVersion: MCP_LIVE_FORMAT_VERSION,
          at: new Date().toISOString(),
          wikiIds,
          ...(nowBusy ? { busy: true } : {}),
        };
        try {
          await write(OPEN_PAGES_KEY, data);
          failures = 0;
          lastBusy = nowBusy;
        } catch (e) {
          console.warn("[mcp-live] 開いているページの一覧を書けませんでした:", e);
          // 一覧が古いままだと MCP が開いているページを書き換えかねない。少し待って書き直す
          if (!cancelled && failures < OPEN_PAGES_RETRY_MAX) {
            failures++;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              retryTimer = null;
              beat();
            }, OPEN_PAGES_RETRY_MS);
          }
        }
      });
    };
    beatRef.current = beat;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const beatSoon = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        beat();
      }, OPEN_PAGES_DEBOUNCE_MS);
    };

    // 一覧に id が増えるときはすぐ書く（debounce しない）。減るときだけ待つ
    const onPeeksChange = () => {
      const now = currentOpenWikiPages().wikiIds;
      if (now.some((id) => !lastIds.has(id))) beat();
      else beatSoon();
    };

    beat();
    const recheck = setTimeout(beat, OPEN_PAGES_RECHECK_MS);
    const unsubscribe = onAnyLivePeeksChange(onPeeksChange);
    window.addEventListener("focus", beat);
    // 状態を持たない処理の busy は、見張って変わったら書く
    const poll = setInterval(() => {
      if (!optsRef.current.pollBusy) return;
      if (isBusy(currentOpenWikiPages().unsafe) !== lastBusy) beat();
    }, OPEN_PAGES_BUSY_POLL_MS);
    return () => {
      cancelled = true;
      beatRef.current = null;
      clearTimeout(recheck);
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      if (retryTimer) clearTimeout(retryTimer);
      if (savingTimer) clearTimeout(savingTimer);
      unsubscribe();
      window.removeEventListener("focus", beat);
    };
  }, [provider, enabled]);

  // busy が変わったらすぐ書く（最初の描画は effect 側の最初の書き込みが担当）
  const firstBusyRef = useRef(true);
  useEffect(() => {
    if (firstBusyRef.current) {
      firstBusyRef.current = false;
      return;
    }
    beatRef.current?.();
  }, [busy]);
}
