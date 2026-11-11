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
// チャットのシステムプロンプトだけは「毎回同じ前半」と「質問ごとに変わる後半」が 1 本の文字列に
// 入っている。前半はナレッジの題の一覧（<wiki-index>）までで、ページ数に比例して大きい
// （2,624 ページの実測で約 8 万トークン）。後半は検索で選んだ本文（<knowledge> / <notes>）。
// 1 ブロックのまま目印を置くと、質問が変わるたびに全体が別物になり、書き込みの割増だけ払って
// 読み出されない（2026-11 の測定: 32 問のうち 31 問が書き込み約 8.4 万・読み出し 0。読み出せたのは、
// 直前の問とたまたま同じ断片が選ばれた 1 問だけ）。
// そこで </wiki-index> の直後でブロックを 2 つに分け、前半にも目印を置く。文面は 1 文字も変えない。
// 続けて質問すれば、2 問目からは前半が読み出しになる。前半が変わるのは、ナレッジのページが
// 増減・更新されて一覧が変わったときと、旧形式の Idea のページが選ばれて説明が 1 行増えたとき。
//
// トップレベルの自動キャッシュは比較的新しい仕様なので、Anthropic 互換のほかの endpoint は
// 受け付けないことがある。公式 API に向けたときだけ付ける。ブロック単位の目印は
// 互換 endpoint でも広く通る（読まなければ無視される）ので、どの base でも付ける。
// 最小長（現行モデルで 512 トークン）に満たない先頭部分は、目印があっても黙って
// キャッシュされず、割増もかからない。

import type { LanguageModelMiddleware } from "ai";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";

const EPHEMERAL = { type: "ephemeral" } as const;

/** チャットのシステムプロンプトで、質問をまたいで変わらない部分の終わり（retriever.ts の formatRetrievedContext が出す） */
const STABLE_PREFIX_END = "</wiki-index>";

/** 変わらない前半と、質問ごとに変わる後半に分ける。分ける場所が無い・後半が空なら null */
function splitStablePrefix(content: string): [string, string] | null {
  const at = content.indexOf(STABLE_PREFIX_END);
  if (at < 0) return null;
  const end = at + STABLE_PREFIX_END.length;
  const rest = content.slice(end);
  if (rest.trim() === "") return null;
  return [content.slice(0, end), rest];
}

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
          const marked = withCacheControl(target.providerOptions as ProviderOptions | undefined);
          const parts = splitStablePrefix(target.content);
          // 分けたときは両方に目印を置く。前半は質問をまたいで読み出され、後半は同じ質問の中で
          // 道具を呼んで続くステップが読み出す（目印は 2 つ + 自動キャッシュ 1 つで、上限の 4 つに収まる）
          const replaced = parts
            ? parts.map((content) => ({ ...target, content, providerOptions: marked }))
            : [{ ...target, providerOptions: marked }];
          prompt = [
            ...prompt.slice(0, lastLeadingSystem),
            ...replaced,
            ...prompt.slice(lastLeadingSystem + 1),
          ] as typeof params.prompt;
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
