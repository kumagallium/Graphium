// Anthropic のプロンプトキャッシュを、呼び出し元を書き換えずに全機能へ効かせるミドルウェア。
//
// 目印（cache_control）を置かないと、同じ指示文やツール定義を毎回フル単価で送ることになる。
// 2026-11 の実モデル評価（Opus 5）ではキャッシュの読み出しが 0 件だった。
//
// 置き方は 2 つ:
//   1. 先頭のシステムプロンプト（ツール定義を含む、その手前まで）に明示の目印を 1 つ。
//      各機能のシステムプロンプトは言語ごとに固定で、ページ本文や質問は user メッセージに入る。
//      したがってここに置くと、知識パイプラインのように同じ指示で何十回も呼ぶ処理が 2 回目から読み出しになる。
//   2. ツールを渡す呼び出し（チャット・agentic search）には、リクエスト全体の自動キャッシュ
//      （トップレベル cache_control）を付ける。道具を呼ぶたびに会話が伸びるので、
//      目印が末尾へ動き、前のステップまでを毎回読み出せる。
//
// ツールの無い 1 回きりの呼び出しには 2 を付けない。末尾はページ本文など毎回違う内容なので、
// 書き込みの割増（1.25 倍）だけ払って読み出されない。
//
// トップレベルの自動キャッシュは比較的新しい仕様なので、Anthropic 互換のほかの endpoint は
// 受け付けないことがある。公式 API に向けたときだけ付ける。ブロック単位の目印は
// 互換 endpoint でも広く通る（読まなければ無視される）ので、どの base でも付ける。
// 最小長（現行モデルで 512 トークン）に満たない先頭部分は、目印があっても黙って
// キャッシュされず、割増もかからない。

import type { LanguageModelMiddleware } from "ai";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";

const EPHEMERAL = { type: "ephemeral" } as const;

type ProviderOptions = SharedV3ProviderOptions;

function hasCacheControl(options: ProviderOptions | undefined): boolean {
  const anthropic = options?.anthropic;
  return !!anthropic && (anthropic.cacheControl != null || anthropic.cache_control != null);
}

function withCacheControl(options: ProviderOptions | undefined): ProviderOptions {
  return {
    ...(options ?? {}),
    anthropic: { ...(options?.anthropic ?? {}), cacheControl: EPHEMERAL },
  };
}

export function createAnthropicPromptCacheMiddleware(opts: {
  /** リクエスト全体の自動キャッシュ（トップレベル cache_control）を付けてよいか */
  allowAutomatic: boolean;
}): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      // 先頭から続く system メッセージの最後に目印を置く（途中に挟まる system メッセージは対象外）
      let lastLeadingSystem = -1;
      for (let i = 0; i < params.prompt.length; i++) {
        if (params.prompt[i].role !== "system") break;
        lastLeadingSystem = i;
      }
      // 呼び出し側が自分で目印を置いていたら、こちらは何も足さない（置き場所・TTL は呼び出し側の判断。
      // 1 時間の目印の手前に 5 分の目印を足すと TTL の並び順の規則に反して 400 になる）
      const providerOptions = params.providerOptions as ProviderOptions | undefined;
      const alreadyMarked =
        hasCacheControl(providerOptions) ||
        params.prompt.some(
          (m) =>
            hasCacheControl(m.providerOptions as ProviderOptions | undefined) ||
            (Array.isArray(m.content) &&
              m.content.some((part) => hasCacheControl((part as { providerOptions?: ProviderOptions }).providerOptions))),
        );
      if (alreadyMarked) return params;

      let prompt = params.prompt;
      if (lastLeadingSystem >= 0) {
        const target = prompt[lastLeadingSystem];
        if (target.role === "system" && target.content.trim() !== "") {
          prompt = prompt.map((m, i) =>
            i === lastLeadingSystem
              ? { ...m, providerOptions: withCacheControl(m.providerOptions as ProviderOptions | undefined) }
              : m,
          ) as typeof params.prompt;
        }
      }

      const hasTools = (params.tools?.length ?? 0) > 0;
      const addAutomatic = opts.allowAutomatic && hasTools;

      return {
        ...params,
        prompt,
        ...(addAutomatic ? { providerOptions: withCacheControl(providerOptions) } : {}),
      };
    },
  };
}

/** 公式 API（api.anthropic.com）に向いているか。互換 endpoint ではトップレベルの自動キャッシュを付けない */
export function isOfficialAnthropicBase(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}
