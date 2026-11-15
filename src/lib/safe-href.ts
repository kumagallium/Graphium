// 外部由来の URL を <a href> や window.open に渡す前の検査。
//
// 取り込んだノート・共有フォルダ・LLM の出力・GitHub のリリース本文などに書かれた URL は
// 信頼できない。javascript: / data: / file: / smb: などを通さず、http / https / mailto だけを許す。
// 通らない URL は undefined を返す。呼び出し側はリンクにせず文字として出す。

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** 空白・制御文字を除いてから URL として解釈し、許可スキームなら正規化した文字列を返す。 */
export function safeExternalHref(url: string | null | undefined): string | undefined {
  if (typeof url !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const trimmed = url.replace(/[\u0000-\u001f\u007f-\u009f]+/g, "").trim();
  if (!trimmed) return undefined;
  // スキームを持たない値（相対パス・"//host"）は外部リンクとして扱わない
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  try {
    const u = new URL(trimmed);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}
