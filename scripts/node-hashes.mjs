// fetch-node.mjs の --update-hashes から使う、通信を伴わない処理（単体テストできるよう切り出し）

/** SHASUMS256.txt の本文から、指定した版の配布アーカイブの [ハッシュ, ファイル名] を名前順で返す */
export function parseShasums(text, nodeVersion) {
  const wanted = /^node-v[\d.]+-(darwin|linux|win)-(arm64|x64)\.(tar\.gz|zip)$/;
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([hash, name]) =>
        /^[0-9a-f]{64}$/.test(hash ?? "") &&
        wanted.test(name ?? "") &&
        name.startsWith(`node-${nodeVersion}-`),
    )
    .sort((a, b) => a[1].localeCompare(b[1]));
}

/** begin/end マーカーの間を entries から作った NODE_SHA256 の表で置き換える */
export function replaceHashTable(source, entries) {
  const body = entries.map(([hash, name]) => `  "${name}": "${hash}",`).join("\n");
  return source.replace(
    /\/\/ <node-sha256:begin>\n[\s\S]*?\/\/ <node-sha256:end>/,
    () => `// <node-sha256:begin>\nconst NODE_SHA256 = {\n${body}\n};\n// <node-sha256:end>`,
  );
}
