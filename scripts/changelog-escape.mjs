// CHANGELOG.md をマニュアルへ取り込む前に無害化する。
// CHANGELOG は PR タイトルから作られ、題は外部の協力者も書ける。
// 「危ない記法を探して潰す」のでなく、Markdown の構文解釈に頼らない形にしている:
//   - 行内のコードスパンは自分で見つけ、<code v-pre> の HTML に置き換える（中身は文字参照）
//   - それ以外の "<" "{" "}" は文字参照にする（HTML・include・属性記法・Vue 補間の入口を断つ）
//   - 行頭の ``` / ~~~ はフェンスにならないよう記号を \ でエスケープする
// 行ごとの処理で、フェンスの状態は持たない。

/** コードスパンの中身に使う文字参照（Markdown の記号も含め、再解釈されないようにする） */
const CODE_ENTITY = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "{": "&#123;",
  "}": "&#125;",
  '"': "&quot;",
  "*": "&#42;",
  _: "&#95;",
  "`": "&#96;",
  "\\": "&#92;",
  "[": "&#91;",
  "]": "&#93;",
  "~": "&#126;",
  "!": "&#33;",
  "|": "&#124;",
  ":": "&#58;",
};
const encodeCode = (s) => s.replace(/[&<>{}"*_`\\[\]~!|:]/g, (c) => CODE_ENTITY[c]);

/** コードスパンの中身を CommonMark と同じ規則で整える（前後 1 つずつの空白を落とす） */
function trimCodeContent(content) {
  if (
    content.length >= 2 &&
    content.startsWith(" ") &&
    content.endsWith(" ") &&
    content.trim() !== ""
  ) {
    return content.slice(1, -1);
  }
  return content;
}

/** 1 行を無害化する（コードスパン → <code v-pre>、外の < { } → 文字参照） */
export function escapeLine(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === "<" || next === "{" || next === "}") {
        // "\<" "\{" "\}" はバックスラッシュを落として文字参照にする
        out += next === "<" ? "&lt;" : next === "{" ? "&#123;" : "&#125;";
      } else {
        // バックスラッシュで打ったバッククォート等はそのまま（コードスパンの開始にしない）
        out += c + next;
      }
      i += 2;
      continue;
    }
    if (c === "`") {
      let n = 0;
      while (line[i + n] === "`") n++;
      const fence = "`".repeat(n);
      // 閉じは長さがちょうど n の連なりだけ（CommonMark と同じ）
      let close = line.indexOf(fence, i + n);
      while (close !== -1 && (line[close - 1] === "`" || line[close + n] === "`")) {
        let end = close;
        while (line[end] === "`") end++;
        close = line.indexOf(fence, end);
      }
      if (close !== -1) {
        out += `<code v-pre>${encodeCode(trimCodeContent(line.slice(i + n, close)))}</code>`;
        i = close + n;
        continue;
      }
      // 閉じないバッククォートは文字として出す
      out += "\\`".repeat(n);
      i += n;
      continue;
    }
    // 画像構文 "![" は "!\[" にして画像にさせない（外部画像の読み込みで閲覧者の IP が漏れるため）。
    // リンク [..](..) はそのまま。参照形式 ![alt][ref] も "![" を止めるので画像にならない
    if (c === "!" && line[i + 1] === "[") {
      out += "!\\[";
      i += 2;
      continue;
    }
    out += c === "<" ? "&lt;" : c === "{" ? "&#123;" : c === "}" ? "&#125;" : c;
    i++;
  }
  return out;
}

// リスト・引用の接頭辞（入れ子・字下げ込み）
const PREFIX_RE = /^(?:[ \t]*(?:>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+))*[ \t]*/;

/** CHANGELOG 全体を無害化する（行ごと。状態は持たない） */
export function escapeChangelogHtml(text) {
  return text
    .split("\n")
    .map((line) => {
      const prefixLen = PREFIX_RE.exec(line)[0].length;
      // 接頭辞を除いた先頭が ``` / ~~~ ならフェンスにさせない（記号の前に \ を足す）
      if (/^(```|~~~)/.test(line.slice(prefixLen))) {
        line = line.slice(0, prefixLen) + "\\" + line.slice(prefixLen);
      }
      return escapeLine(line);
    })
    .join("\n");
}

/**
 * release-history.md の `<!--@include: ../CHANGELOG.md{3,}-->`（相対パスは `../` の数が違う）を、
 * エスケープ済みの本文に置き換える。VitePress は include を markdown の描画より前に展開するため、
 * それより早い段階（Vite の transform, enforce: pre）で差し替える。
 */
export function inlineEscapedChangelog(source, readChangelog) {
  return source.replace(
    /<!--@include:\s*(?:\.\.\/)+CHANGELOG\.md\{(\d+),\}-->/g,
    (_m, from) => {
      const lines = readChangelog().split("\n").slice(Number(from) - 1);
      // Vue の {{ ... }} 補間が評価されないよう v-pre で包む（コードの外の式も無害化）
      return `::: v-pre\n${escapeChangelogHtml(lines.join("\n"))}\n:::`;
    },
  );
}
