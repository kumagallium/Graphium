// Callout ブロック
// Notion 風の「枠付き・絵文字アイコン付き」の注記ブロック。
// 本文はインライン編集可能。絵文字はクリックで定番セットから選べる。
//
// 色（backgroundColor / textColor）と配置（textAlignment）は BlockNote の
// defaultProps をそのまま採用するため、サイドメニューの「色」「配置」から
// 標準の仕組みで変更できる（カスタム実装は不要）。

import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { useState, useRef, useEffect } from "react";

// クリックで切り替えできる定番の絵文字（シンプル版: 全部入りピッカーは持たない）
const PRESET_EMOJIS = ["💡", "⚠️", "✅", "❌", "📌", "🔥", "📝", "❓", "ℹ️", "⭐"];

export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      // 色・配置は BlockNote 標準の既定プロパティを流用
      backgroundColor: defaultProps.backgroundColor,
      textColor: defaultProps.textColor,
      textAlignment: defaultProps.textAlignment,
      // 先頭に表示する絵文字アイコン
      emoji: { default: "💡" },
    },
    content: "inline" as const,
  },
  {
    render: (props) => {
      const { emoji } = props.block.props;
      const [pickerOpen, setPickerOpen] = useState(false);
      const rootRef = useRef<HTMLDivElement>(null);

      // 外側クリックでピッカーを閉じる
      useEffect(() => {
        if (!pickerOpen) return;
        const onDown = (e: MouseEvent) => {
          if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [pickerOpen]);

      const pickEmoji = (e: string) => {
        (props.editor as any).updateBlock(props.block, { props: { emoji: e } });
        setPickerOpen(false);
      };

      return (
        <div ref={rootRef} style={styles.callout} data-test="callout-block">
          {/* 絵文字アイコン（クリックで定番セットを開く） */}
          <div style={styles.iconWrap} contentEditable={false}>
            <button
              type="button"
              style={styles.iconButton}
              onClick={() => setPickerOpen((v) => !v)}
              title="アイコンを変更"
              aria-label="アイコンを変更"
            >
              {emoji}
            </button>
            {pickerOpen && (
              <div style={styles.picker} role="menu">
                {PRESET_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    style={styles.pickerItem}
                    onClick={() => pickEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 本文（インライン編集領域） */}
          <div style={styles.content} ref={props.contentRef} />
        </div>
      );
    },
  }
);

// ── スタイル ──
// 背景色は BlockNote の backgroundColor prop が未設定（default）のときの
// 既定の見た目。design.md の自然色パレットに合わせ、彩度を抑えた情報色を使う。
const styles: Record<string, React.CSSProperties> = {
  callout: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    background: "var(--color-info-bg, rgba(122,166,196,0.10))",
    border: "1px solid var(--color-info-border, rgba(122,166,196,0.28))",
    alignItems: "flex-start",
    width: "100%",
  },
  iconWrap: {
    position: "relative",
    flex: "0 0 auto",
  },
  iconButton: {
    fontSize: 18,
    lineHeight: "1.4",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 0,
    userSelect: "none",
  },
  picker: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 20,
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 2,
    padding: 6,
    borderRadius: 8,
    background: "var(--color-card, #fff)",
    border: "1px solid var(--color-border, rgba(0,0,0,0.12))",
    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  },
  pickerItem: {
    fontSize: 18,
    lineHeight: "1",
    padding: "4px 6px",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  content: {
    flex: 1,
    minWidth: 0,
    lineHeight: "1.6",
  },
};
