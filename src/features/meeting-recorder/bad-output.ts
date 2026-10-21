// 清書・要約の 502（AI の答えを読めなかった）の文言

import { t } from "../../i18n";

/**
 * 出力が上限で切れていた（AI_OUTPUT_TRUNCATED。考える部分で枠を使い切ったときなど）なら
 * その理由を、それ以外は fallback（「読み取れませんでした」）を返す
 */
export async function badOutputMessage(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return json?.code === "AI_OUTPUT_TRUNCATED" ? t("aiError.outputTruncated") : fallback;
}
