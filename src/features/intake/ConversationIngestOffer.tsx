// 取り込んだ会話のうち、ナレッジ化の候補の本数と費用の見込みを伝える 1 行。
// 「まとめてナレッジ化」のボタンの上に置く想定（ボタンは含まない）。

import { useLocale } from "@/i18n";
import { estimateConversationIngestTokens } from "@/lib/conversation/types";

type ConversationIngestOfferProps = {
  /** 取り込んだ会話の本数 */
  total: number;
  /** ナレッジ化の候補の本数 */
  candidates: number;
  variant?: "full" | "short";
};

export function ConversationIngestOffer({ total, candidates, variant = "full" }: ConversationIngestOfferProps) {
  const { locale, t } = useLocale();

  if (candidates <= 0) {
    return <p className="text-xs text-muted-foreground">{t("intake.conversation.offerNone")}</p>;
  }

  const { low, high } = estimateConversationIngestTokens(candidates);
  // ja は万の単位、ほかは桁区切りの全数
  const fmt = (n: number) =>
    locale === "ja" ? String(Math.round(n / 10_000)) : n.toLocaleString("en-US");
  const tokens = t("intake.conversation.tokensRange", { low: fmt(low), high: fmt(high) });

  return (
    <p className="text-xs text-muted-foreground">
      {variant === "short"
        ? t("intake.conversation.offerShort", { candidates: String(candidates), tokens })
        : t("intake.conversation.offer", { total: String(total), candidates: String(candidates), tokens })}
    </p>
  );
}
