// window.confirm を src に戻さないための検査。
//
// デスクトップ版（Tauri）では tauri-plugin-dialog が window.confirm を async 関数に
// 差し替えるので、同期で呼ぶと Promise（truthy）が返って確認が素通りする。
// 確認は confirmAction（src/ui/confirm-dialog.tsx）を await すること。
// ESLint を入れていないので、ソースを読んで呼び出しを探す。

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|stories)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** コメントを除いた行で、window.confirm / globalThis.confirm / 素の confirm( 呼び出しを探す */
function findConfirmCalls(source: string): number[] {
  const lines: number[] = [];
  let inBlock = false;
  source.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const start = line.indexOf("/*");
    if (start >= 0) {
      line = line.slice(0, start);
      inBlock = true;
    }
    line = line.replace(/\/\/.*$/, "");
    if (/\b(window|globalThis|self)\s*\.\s*confirm\b/.test(line) || /(^|[^.\w$])confirm\s*\(/.test(line)) {
      lines.push(i + 1);
    }
  });
  return lines;
}

// 素の confirm( でも別物のもの（ローカル関数・引数名）。理由を添えて足す
const ALLOWED = new Set<string>([
  // コンポーネント内のローカル関数 confirm(key)（window.confirm ではない）
  "features/wiki/WikiFrameSection.tsx",
]);

describe("window.confirm を使わない", () => {
  it("src のどこにも window.confirm の呼び出しが無い", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      for (const line of findConfirmCalls(readFileSync(file, "utf8"))) hits.push(`${rel}:${line}`);
    }
    expect(hits, "window.confirm はデスクトップ版で素通りする。confirmAction を await すること").toEqual([]);
  });

  it("検出器そのもの: 呼び出しは拾い、コメントとメソッド名は拾わない", () => {
    expect(findConfirmCalls("if (!window.confirm(x)) return;")).toEqual([1]);
    expect(findConfirmCalls("const ok = confirm(msg);")).toEqual([1]);
    expect(findConfirmCalls("// window.confirm は使わない")).toEqual([]);
    expect(findConfirmCalls("/* window.confirm */ foo();")).toEqual([]);
    expect(findConfirmCalls("deps.confirm(msg); onConfirm(); handleConfirm()")).toEqual([]);
  });
});
