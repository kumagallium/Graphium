// 本文にある quote ブロックの ID を、本文の変化に追従して返すフック（近傍グラフ用）。
//
// 近傍グラフのメモのノードは「本文に引用ブロックがあるもの」だけ出す。描画時に editor.document を
// 1 回読むだけだと、タブを開いたままキーボードで引用ブロックを消してもノードが残るため、
// 本文の変更（onEditorContentChange）を購読して読み直す。タイプ毎に全ブロックを組み直すのは
// 無駄なので、少し待って 1 回にまとめる。値が同じなら同じ配列を返す。

import { useEffect, useRef, useState } from "react";
import { collectQuoteBlockIds } from "./memo-quote";

const SEPARATOR = "\u0000";
const EMPTY: readonly string[] = [];
export const QUOTE_BLOCK_IDS_DEBOUNCE_MS = 250;

export function useQuoteBlockIds(editor: any | null | undefined, enabled: boolean): readonly string[] {
  const [key, setKey] = useState<string>("");

  useEffect(() => {
    if (!editor || !enabled) {
      setKey("");
      return;
    }
    const read = () => {
      const next = [...collectQuoteBlockIds(editor.document ?? [])].join(SEPARATOR);
      setKey((prev) => (prev === next ? prev : next));
    };
    read();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off =
      typeof editor.onEditorContentChange === "function"
        ? editor.onEditorContentChange(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(read, QUOTE_BLOCK_IDS_DEBOUNCE_MS);
          })
        : undefined;
    return () => {
      if (timer) clearTimeout(timer);
      if (typeof off === "function") off();
    };
  }, [editor, enabled]);

  // key が同じ間は同じ配列を返す（消費者の依存を無駄に動かさない）
  const cacheRef = useRef<{ key: string; ids: readonly string[] }>({ key: "", ids: EMPTY });
  if (cacheRef.current.key !== key) {
    cacheRef.current = { key, ids: key ? key.split(SEPARATOR) : EMPTY };
  }
  return cacheRef.current.ids;
}
