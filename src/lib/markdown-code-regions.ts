// Markdown のコード領域（``` / ~~~ フェンスと `インラインコード`）の退避・復元
//
// Markdown から数式（features/math/markdown-math.ts）や上付き・下付きのタグ
// （lib/script-styles.ts）を拾うとき、コードの中身は対象にしない。LaTeX や HTML の
// サンプルコードを載せたノートを壊さないため。拾う前にコード領域をセンチネルへ
// 退避し、拾い終わったら元に戻す。

const CODE_PREFIX = "{{GWCODE_";
const CODE_SUFFIX = "}}";

/** コード領域をセンチネルに退避する */
export function maskCodeRegions(markdown: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  const stash = (m: string): string => {
    codes.push(m);
    return `${CODE_PREFIX}${codes.length - 1}${CODE_SUFFIX}`;
  };
  const text = markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, stash)
    .replace(/`[^`\n]*`/g, stash);
  return { text, codes };
}

/** maskCodeRegions で退避したコード領域を元に戻す */
export function unmaskCodeRegions(text: string, codes: string[]): string {
  if (codes.length === 0) return text;
  return text.replace(/\{\{GWCODE_(\d+)\}\}/g, (full, n: string) => {
    const code = codes[Number(n)];
    return code === undefined ? full : code;
  });
}
