// ストーリーで部品を置く台。アプリの地の色の上に、決めた幅で置く。
// width を渡すと、その幅の画面（スマホなら 375）に置いたときの形を確かめられる。
import type { ReactNode } from "react";

export function StoryFrame({ width, children }: { width?: number; children: ReactNode }) {
  return (
    <div
      data-story-frame
      style={{ height: "100vh", overflowY: "auto", background: "var(--paper)", padding: width ? 0 : "32px 24px 64px" }}
    >
      <div
        style={
          width
            ? { width, margin: "0 auto", padding: "16px 12px 40px", borderInline: "1px dashed var(--rule)", minHeight: "100%" }
            : undefined
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
