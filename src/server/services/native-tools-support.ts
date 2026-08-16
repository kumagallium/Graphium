// OpenAI 互換 endpoint がネイティブの tool calling を扱えるかを実行時に学習して記憶する。
//
// 背景:
//   「OpenAI 互換」は HTTP の形が同じというだけで、tools / tool_choice を実際に処理するかは
//   endpoint 次第。さくらの AI Engine のように tool_calls 配列を正しく返すものもあれば、
//   tools を渡すと 400 を返すものもある。provider 名だけで一律に text-tool-call フォールバックへ
//   落とすと、前者のネイティブ機能を丸ごと捨てることになる（ツール利用が強いモデルほど損をする）。
//
// 方式:
//   まずネイティブで投げ、tools 起因のエラーが出たときだけフォールバックし、その結果を
//   モデル単位で記憶する。以降は記憶した経路へ直行するので、余計な往復は初回だけ。
//   400 で弾かれる場合はトークンを消費しないため、探索コストは実質ゼロ。
//
// 適用範囲外:
//   「200 で返るがツールを黙って無視する」endpoint はここでは検出できない（エラーが出ないため）。
//   その場合ユーザーには「ツールが呼ばれない」として現れる。検出には試行プロンプトが要るので、
//   実害が観測されるまでは踏み込まない。

/** ネイティブ tool calling の可否判定。unknown は「未探索」で、次回の呼び出しで探索する。 */
export type NativeToolsVerdict = "unknown" | "supported" | "unsupported";

const verdicts = new Map<string, NativeToolsVerdict>();

/**
 * 判定のキャッシュキー。同じ modelId でも endpoint が違えば挙動が違うため apiBase も含める。
 */
export function nativeToolsCacheKey(input: {
  provider?: string;
  apiBase?: string | null;
  modelId?: string;
}): string {
  return `${input.provider ?? ""}|${input.apiBase ?? ""}|${input.modelId ?? ""}`;
}

export function getNativeToolsVerdict(key: string): NativeToolsVerdict {
  return verdicts.get(key) ?? "unknown";
}

export function setNativeToolsVerdict(key: string, verdict: NativeToolsVerdict): void {
  verdicts.set(key, verdict);
}

/** テスト用。プロセス内キャッシュを空にする。 */
export function resetNativeToolsVerdicts(): void {
  verdicts.clear();
}

/** エラーオブジェクトから判定に使える文字列を集める（AI SDK は cause に元エラーを包むことがある）。 */
function collectErrorText(err: unknown, depth = 0): string {
  if (err == null || depth > 3) return "";
  if (typeof err === "string") return err;
  const e = err as {
    name?: unknown;
    message?: unknown;
    responseBody?: unknown;
    data?: unknown;
    cause?: unknown;
  };
  const parts: string[] = [];
  if (typeof e.name === "string") parts.push(e.name);
  if (typeof e.message === "string") parts.push(e.message);
  if (typeof e.responseBody === "string") parts.push(e.responseBody);
  if (e.data != null) {
    try {
      parts.push(JSON.stringify(e.data));
    } catch {
      // 循環参照等は諦める
    }
  }
  if (e.cause != null) parts.push(collectErrorText(e.cause, depth + 1));
  return parts.join(" ");
}

function statusOf(err: unknown): number | undefined {
  const e = err as { statusCode?: unknown; status?: unknown; cause?: unknown } | undefined;
  if (typeof e?.statusCode === "number") return e.statusCode;
  if (typeof e?.status === "number") return e.status;
  if (e?.cause != null) return statusOf(e.cause);
  return undefined;
}

/**
 * 「この endpoint は tools を扱えない」と判断してよいエラーかを判定する。
 *
 * 誤判定するとネイティブに対応した endpoint を不要にフォールバックさせてしまうため、
 * 「tools / function に言及したクライアントエラー」だけを対象にする保守的な判定にしている。
 * 認証・レート制限・サーバー障害・中断は明示的に除外する（再試行や設定修正で直る種類のため）。
 */
export function isToolsUnsupportedError(err: unknown): boolean {
  if (err == null) return false;

  // 中断はユーザー操作。フォールバックせずそのまま伝播させる。
  const name = (err as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") return false;

  // AI SDK が「この機能はこのプロバイダで使えない」と型付きで投げるケースは確実。
  if (typeof name === "string" && name.includes("UnsupportedFunctionality")) return true;

  const status = statusOf(err);
  // 認証・権限・レート制限・サーバー障害は tools とは無関係。
  if (status === 401 || status === 403 || status === 408 || status === 429) return false;
  if (status !== undefined && status >= 500) return false;

  const text = collectErrorText(err).toLowerCase();
  if (!text) return false;
  if (text.includes("abort")) return false;

  const mentionsTools = /\btools?\b|tool_call|tool_choice|function[_ ]?call|functions?\b/.test(text);
  if (!mentionsTools) return false;

  // ステータスが取れる場合はクライアントエラーに限定する。
  if (status !== undefined && (status < 400 || status >= 500)) return false;

  // 「対応していない / 知らないパラメータ」を示す語を伴うときだけ非対応と見なす。
  // （"invalid tool arguments" のようなモデル側の一時的失敗を拾わないため）
  const mentionsUnsupported =
    /unsupport|not support|unknown|unrecogni|unexpected|no such|not allowed|not implemented|does not support|invalid[_ ]?(request[_ ]?)?(parameter|argument|field)|extra[_ ]?field/.test(
      text,
    );
  return mentionsUnsupported;
}
