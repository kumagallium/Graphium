// このパソコンで動くモデル（LM Studio・Ollama など、apiBase がループバック）の手がかり
//
// ローカルのモデルは、読み込むときの「コンテキスト長」と「同時に処理する数」で一度に扱える
// 量が決まる。足りないと LM Studio は「Channel Error」とだけ返し、本当の理由
// （文脈の枠が埋まった）はアプリ側のログにしか出ない。
// - 失敗したら: 枠が足りなかったらしい失敗を見分けて、設定の見直しを案内する（isLocalCapacityError）
// - 送る前に: LM Studio なら読み込み中のコンテキスト長を問い合わせる（fetchLoadedContext）。
//   要りそうな量との比較は画面側（src/lib/context-estimate.ts）

/** apiBase がこのパソコンを指しているか（localhost・127.0.0.1・::1） */
export function isLocalApiBase(apiBase: string | null | undefined): boolean {
  if (!apiBase) return false;
  try {
    const host = new URL(apiBase).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** エラーの文（cause・応答の本文も）をまとめて小文字にする */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    const e = cur as { message?: unknown; responseBody?: unknown; cause?: unknown };
    if (typeof e.message === "string") parts.push(e.message);
    if (typeof e.responseBody === "string") parts.push(e.responseBody);
    cur = e.cause;
  }
  return parts.join(" ").toLowerCase();
}

/**
 * ローカルのモデルの、文脈の枠が足りなかったらしい失敗か。
 * LM Studio は枠が埋まると「Channel Error」（中身は failed to decode）、llama.cpp 系や Ollama は
 * context length / n_ctx を含む文を返す
 */
export function isLocalCapacityError(err: unknown): boolean {
  const text = errorText(err);
  return (
    text.includes("channel error") ||
    text.includes("failed to decode") ||
    text.includes("memory slot") ||
    text.includes("n_ctx") ||
    /context (length|window|size|overflow)/.test(text) ||
    text.includes("exceeds the context") ||
    text.includes("maximum context")
  );
}

/**
 * LM Studio に、読み込み中のモデルのコンテキスト長を問い合わせる（GET <origin>/api/v0/models）。
 * LM Studio でない・読み込まれていない・応答が無いときは null（確かめられないので何も言わない）
 */
export async function fetchLoadedContext(
  apiBase: string,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<number | null> {
  let origin: string;
  try {
    origin = new URL(apiBase).origin;
  } catch {
    return null;
  }
  try {
    const res = await fetchImpl(`${origin}/api/v0/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json.data)) return null;
    const hit = json.data.find(
      (m): m is { id: string; state?: unknown; loaded_context_length?: unknown } =>
        !!m && typeof m === "object" && (m as { id?: unknown }).id === modelId,
    );
    if (!hit || hit.state !== "loaded" || typeof hit.loaded_context_length !== "number") return null;
    return hit.loaded_context_length;
  } catch {
    return null;
  }
}
