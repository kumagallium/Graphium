// ストーリーで部品を置く台。アプリの地の色の上に、決めた幅で置く。
// width を渡すと、その幅の画面（スマホなら 375）に置いたときの形を確かめられる。
// app.css が html / body のスクロールを止めているので、この台がスクロールする。
// 余白は内側の箱に付ける（スクロールする箱に付けると、上に張り付く見出しが余白の分だけ下がる）。
import { type ReactNode, useLayoutEffect } from "react";
import { type Locale, syncLocale } from "../../i18n";

export function StoryFrame({ width, locale, children }: { width?: number; locale?: Locale; children: ReactNode }) {
  // 表示言語をストーリーの引数に合わせる（アプリと同じ辞書・同じ切り替えの経路を通す）
  useLayoutEffect(() => {
    if (locale) syncLocale(locale);
  }, [locale]);
  return (
    <div data-story-frame style={{ height: "100vh", overflowY: "auto", background: "var(--paper)" }}>
      <div
        style={
          width
            ? { width, margin: "0 auto", padding: "16px 12px 40px", borderInline: "1px dashed var(--rule)", minHeight: "100%" }
            : { padding: "32px 24px 64px" }
        }
      >
        {children}
      </div>
    </div>
  );
}

/** 行や 1 日分を単体で見せるときの白い面（ダッシュボードの中と同じ地） */
export function StorySheet({ children, maxWidth = 720 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div className="rd-root" style={{ maxWidth, margin: "0 auto" }}>
      <div className="rd-sheet">{children}</div>
    </div>
  );
}

export function StoryCaption({ children }: { children: ReactNode }) {
  return (
    <p style={{ maxWidth: 720, margin: "0 auto 12px", fontSize: 14, lineHeight: 1.6, color: "var(--ink-3)" }}>{children}</p>
  );
}
