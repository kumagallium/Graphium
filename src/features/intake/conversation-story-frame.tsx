// ストーリー用の枠（Storybook 専用）。
//
// 右上で日本語 / English を切り替え、その下に取り込みのモーダルと同じ幅の箱を置く。
// 撮影のスクリプトが切り替えボタンを押せるよう data-testid を付けている。

import type { ReactNode } from "react";
import { useLocale } from "@/i18n";

type ConversationStoryFrameProps = {
  children: ReactNode;
  /** 箱の幅（px）。既定はモーダルと同じ 560 */
  width?: number;
};

export function ConversationStoryFrame({ children, width = 560 }: ConversationStoryFrameProps) {
  const { locale, setLocale } = useLocale();
  return (
    <div style={{ width }}>
      <div className="mb-2 flex justify-end gap-1 text-xs">
        {(["ja", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            data-testid={`story-locale-${l}`}
            aria-pressed={locale === l}
            className={`rounded-full border px-2 py-0.5 ${locale === l ? "border-primary bg-primary/10 text-foreground" : "border-border-subtle text-muted-foreground"}`}
            onClick={() => setLocale(l)}
          >
            {l === "ja" ? "日本語" : "English"}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-background p-5">{children}</div>
    </div>
  );
}
