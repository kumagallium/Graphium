// dev サーバーの /api proxy が転送する Origin を決める（vite.config.ts から使う）。
// サーバーは書き込み系の要求の Origin を見て、ループバックの任意ポートは信頼しない。
// 要求の Origin が dev サーバー自身のもの（Origin の host が Host ヘッダーと同じ）なら、
// この画面からの要求なので宛先のオリジンに書き換えて通す。
// ほかのサイトの Origin・"null"・解釈できない値は書き換えない（サーバーが 403 にする）。

export function rewriteDevProxyOrigin(
  origin: string | string[] | undefined,
  host: string | undefined,
  targetOrigin: string,
): string | undefined {
  if (typeof origin !== "string" || !host) return undefined;
  try {
    if (new URL(origin).host === host) return targetOrigin;
  } catch {
    // URL にならない Origin（"null" など）は書き換えない
  }
  return undefined;
}
