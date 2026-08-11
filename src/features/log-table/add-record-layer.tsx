// 記録テーブルの「+ 記録」ボタンレイヤー
// IndexTableIconLayer と同じパターンで body ポータルに描画する。
// 登録済みの各記録テーブルの左下（テーブル下端のすぐ下）にボタンを重ね、
// クリックで末尾に現在日時入りの行を足す。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useLogTableStore } from "./store";
import { addRecordRow } from "./add-record";

type ButtonPos = {
  blockId: string;
  top: number;
  left: number;
};

export function LogTableAddRecordLayer({
  editorRef,
}: {
  editorRef: React.RefObject<any>;
}) {
  const store = useLogTableStore();
  const [buttons, setButtons] = useState<ButtonPos[]>([]);

  // テーブルの位置を計算。
  // ノート読み込み直後など editor / DOM がまだ準備できていない場合は
  // 検出失敗時に短い遅延で再試行する（icon-layer と同じ保険）。
  const retryRef = useRef<number | null>(null);
  const compute = useCallback(() => {
    const next: ButtonPos[] = [];
    const editor = editorRef.current;
    if (!editor) {
      if (store.tables.size > 0 && retryRef.current === null) {
        retryRef.current = window.setTimeout(() => {
          retryRef.current = null;
          compute();
        }, 200);
      }
      return;
    }

    let domMissing = false;
    store.tables.forEach((_config, blockId) => {
      const block = editor.getBlock?.(blockId);
      if (!block || block.type !== "table") return;

      const blockEl = document.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      );
      if (!blockEl) {
        domMissing = true;
        return;
      }
      // blockOuter は BlockNote の行追加帯（テーブル下の + バー）まで含むため、
      // その直下に置くと次のブロックに重なる。table 要素自体の下端を基準にして
      // + バーと同じ帯にボタンを並べる（意味的にも両方「行を足す」操作）。
      const tableEl = blockEl.querySelector("table");
      const rect = (tableEl ?? blockEl).getBoundingClientRect();
      // 画面外（スクロールで見えていない）テーブルにはボタンを出さない
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      next.push({ blockId, top: rect.bottom + 2, left: rect.left });
    });

    setButtons(next);

    if (domMissing && retryRef.current === null) {
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        compute();
      }, 200);
    }
  }, [store.tables, editorRef]);

  useEffect(() => {
    return () => {
      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, []);

  // store.tables 変更時に再計算
  useEffect(() => {
    const timer = setTimeout(compute, 50);
    return () => {
      clearTimeout(timer);
      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [compute]);

  // スクロール・リサイズ・DOM 変化にも追従
  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);

    const editorEl = document.querySelector("[data-label-wrapper]");
    let observer: MutationObserver | null = null;
    if (editorEl) {
      observer = new MutationObserver(compute);
      observer.observe(editorEl, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }

    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      observer?.disconnect();
    };
  }, [compute]);

  const handleAddRecord = useCallback(
    (blockId: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      addRecordRow(editor, blockId);
      // 追加した行が見える位置ならフォーカスは維持したまま。再計算だけ促す
      setTimeout(compute, 50);
    },
    [editorRef, compute]
  );

  if (buttons.length === 0) return null;

  return createPortal(
    <>
      {buttons.map((btn) => (
        <button
          key={btn.blockId}
          onClick={() => handleAddRecord(btn.blockId)}
          title={t("logTable.addRecordHint")}
          style={{
            position: "fixed",
            top: btn.top,
            left: btn.left,
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: 22,
            padding: "0 8px",
            borderRadius: 4,
            border: "1px solid var(--color-border-subtle)",
            background: "var(--color-surface)",
            cursor: "pointer",
            fontSize: 12,
            zIndex: 50,
            transition: "all 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            color: "var(--color-text-tertiary)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "var(--color-text-tertiary)";
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 1px 4px rgba(0,0,0,0.1)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "var(--color-border-subtle)";
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 1px 2px rgba(0,0,0,0.05)";
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("logTable.addRecord")}
        </button>
      ))}
    </>,
    document.body
  );
}
