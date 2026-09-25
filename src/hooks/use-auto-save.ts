// オートセーブ管理 hook
// dirty 管理、3秒デバウンス保存、Ctrl+S / Cmd+S ハンドラー、アンマウント時の書き出し

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 保存コールバック。false を返したら「書かなかった」（保存中で捨てた・失敗した）とみなし、
 * 編集を未保存のまま持つ（次の保存・アンマウント時の書き出しで書き直す）
 */
export type AutoSaveHandler = () => void | boolean | Promise<void | boolean>;

/**
 * アンマウント時の書き出し。エディタがまだ外されていないレイアウト段階の後片付けから
 * 同期で呼ぶので、本文はこの場で読むこと（最初の await より前）。
 * ready は、本当のアンマウントで、かつそれまでに始めた保存がすべて終わったら true で解決する。
 * StrictMode の試しのアンマウント（直後に同じ部品が再マウントされる）なら false — 書かないこと
 * （未保存の編集は自動保存のタイマーに残っている）
 */
export type UnmountFlushHandler = (ready: Promise<boolean>) => void;

export function useAutoSave(onSave: AutoSaveHandler, onUnmountFlush?: UnmountFlushHandler) {
  const [dirty, setDirty] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<AutoSaveHandler>(() => {});
  const onUnmountFlushRef = useRef(onUnmountFlush);
  onUnmountFlushRef.current = onUnmountFlush;
  // 保存にまだ渡していない編集があるか。markDirty で立て、保存を始めた時点で下ろし、
  // 保存が書かなかったら立て直す。アンマウント時に書き出すかをこれで決める
  // （dirty は描画用。保存中に打った分も、先の保存の完了で false に戻ってしまう）
  const unsavedRef = useRef(false);
  // アンマウント済みか。書き出しの後で保存を張らない・走らせないため
  // （外されたエディタの古い本文を後から書くと、開き直した同じノートの編集を上書きする）
  const unmountedRef = useRef(false);
  // 始めた保存がすべて終わったら解決する。アンマウント時の書き出しはこれを待ってから書く
  // （書き込み中の古い保存が書き出しの後に届いて、直前の編集を巻き戻さないように）
  const inflightRef = useRef<Promise<void>>(Promise.resolve());

  // 常に最新の onSave を ref に保持
  useEffect(() => {
    handleSaveRef.current = onSave;
  }, [onSave]);

  // 保存実行 + dirty リセット
  const executeSave = useCallback(async () => {
    if (unmountedRef.current) return;
    unsavedRef.current = false;
    const run = (async () => {
      try {
        const saved = await handleSaveRef.current();
        if (saved === false) unsavedRef.current = true;
      } catch (err) {
        unsavedRef.current = true;
        throw err;
      } finally {
        setDirty(unsavedRef.current);
      }
    })();
    const prev = inflightRef.current;
    inflightRef.current = Promise.allSettled([prev, run]).then(() => {});
    await run;
  }, []);

  // 変更をマーク → 3秒後に自動保存（ref 経由で常に最新の状態で保存）
  const markDirty = useCallback(() => {
    if (unmountedRef.current) return;
    unsavedRef.current = true;
    setDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      executeSave();
    }, 3000);
  }, [executeSave]);

  // 即時保存（タイマーをキャンセルして即実行）
  const saveNow = useCallback(() => {
    if (unmountedRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    executeSave();
  }, [executeSave]);

  // 自動保存の外で始めた保存（共有・提案など）も「書き込み中」に数える。アンマウント時の
  // 書き出しがその完了を待ち、古い内容が後から届いて直前の編集を巻き戻さないように
  const trackSave = useCallback(<T,>(save: Promise<T>): Promise<T> => {
    const prev = inflightRef.current;
    inflightRef.current = Promise.allSettled([prev, save]).then(() => {});
    return save;
  }, []);

  // 未保存の編集を今すぐ呼び出し側へ渡す（開いているエディタの「今すぐ書き出す」口。
  // 同じノートを別の場所で開くときに使う — lib/peek-save-queue.ts の registerLivePeek）。
  // 未保存が無ければ null。あれば自動保存のタイマーを止めて未保存を下ろし、それまでに
  // 始めた保存がすべて終わったら true で解決する Promise を返す（その後で書くこと）
  const takeUnsaved = useCallback((): Promise<boolean> | null => {
    if (unmountedRef.current || !unsavedRef.current) return null;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    unsavedRef.current = false;
    return inflightRef.current.then(() => true);
  }, []);
  // 渡した書き出しが書けなかったら未保存に戻す（次の保存・アンマウント時にもう一度書く）
  const restoreUnsaved = useCallback(() => {
    if (unmountedRef.current) return;
    unsavedRef.current = true;
    setDirty(true);
  }, []);
  const hasUnsaved = useCallback(() => !unmountedRef.current && unsavedRef.current, []);

  // アンマウント時: 未保存の編集が残っていれば書き出す（ノートを切り替えた・一覧や素材
  // ギャラリーへ移った瞬間の、直前 3 秒の編集を落とさないため）。
  // レイアウト段階の後片付けで行うのは、ここではまだ子のエディタが外されておらず本文を
  // 同期で読めるから（React は削除する木の後片付けを親から子の順に走らせ、BlockNote は
  // ref の解除で外れる。通常の effect の後片付けはその後）。
  // StrictMode の試しのアンマウントでは書かない: 後片付けの直後（同じ呼び出しの中）に
  // effect 本体が走り直すので、フラグはここで下ろし直し、書き出しはマイクロタスクで
  // 「まだアンマウントされたままか」を確かめてから進める
  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (!unsavedRef.current || !onUnmountFlushRef.current) return;
      const ready = Promise.resolve().then(() => {
        if (!unmountedRef.current) return false; // 再マウントされた（試しのアンマウント）
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        unsavedRef.current = false;
        return inflightRef.current.then(() => true);
      });
      onUnmountFlushRef.current(ready);
    };
  }, []);

  // タイマーのクリーンアップ（書き出しを渡さない場合。渡す場合は上の後片付けが書き出しを決めてから消す）
  useEffect(() => {
    return () => {
      if (onUnmountFlushRef.current && unsavedRef.current) return;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Ctrl+S / Cmd+S で保存（複数レベルでキャプチャ）
  // サイドピーク内にフォーカスがある場合はサイドピーク側に任せる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 素の ⌘S / Ctrl+S のみ。macOS Chrome は ⌘⇧S でも e.key が小文字 "s" のまま
      // 届くため、Shift / Alt を除外しないと「版を残す」(⌘⇧S / ⌘⌥S) をここが
      // window capture + stopPropagation で握り潰してしまう。
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        const sidePeekEl = document.querySelector("[data-side-peek]");
        if (sidePeekEl && sidePeekEl.contains(document.activeElement)) {
          return; // サイドピーク側のハンドラに委譲
        }
        e.preventDefault();
        e.stopPropagation();
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        executeSave();
      }
    };
    // document と window 両方でキャプチャフェーズに登録
    document.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("keydown", handler, { capture: true });
    };
  }, []);

  return { dirty, setDirty, markDirty, saveNow, hasUnsaved, takeUnsaved, restoreUnsaved, trackSave };
}
