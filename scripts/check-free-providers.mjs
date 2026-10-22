#!/usr/bin/env node
// 無料枠のある AI 接続先の一覧（src/features/settings/free-providers/providers.json）の点検。
// 月 1 回の Actions（.github/workflows/free-providers-check.yml）と手元の両方で動く。
//
// 見ること:
// 1. 確認日（checkedAt）が REVIEW_AFTER_DAYS を過ぎていないか — 過ぎていたら人が見直す合図
// 2. 各社の API がまだ応答するか — 無効なダミーのキーで /models を叩き、400/401/403/405 などの
//    「断られた」応答を生きている印とみなす。404・410・5xx・接続できない場合だけ問題にする
//    （キーが無いと 404 を返す接続先があるため、ダミーを付ける。{accountId} はゼロで埋める）
//
// 本物のキーは使わない。問題があれば一覧を出して終了コード 1（Actions はこれで Issue を立てる）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REVIEW_AFTER_DAYS = 90;
const TIMEOUT_MS = 15_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { providers } = JSON.parse(
  readFileSync(join(root, "src/features/settings/free-providers/providers.json"), "utf8"),
);

const now = Date.now();
const problems = [];

async function probe(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: "Bearer invalid-key-for-reachability-check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

for (const p of providers) {
  const ageDays = Math.floor((now - Date.parse(`${p.checkedAt}T00:00:00Z`)) / 86_400_000);
  if (!(ageDays <= REVIEW_AFTER_DAYS)) {
    problems.push(`${p.name}: 確認日 ${p.checkedAt} から ${ageDays} 日。無料枠・学習の扱い・登録の条件を各社のページで見直し、checkedAt を更新する`);
  }

  const base = p.apiBase.replace("{accountId}", "0".repeat(32)).replace(/\/$/, "");
  const url = `${base}/models`;
  const r = await probe(url);
  const alive = r.status !== undefined && r.status < 500 && r.status !== 404 && r.status !== 410;
  const shown = r.status !== undefined ? `HTTP ${r.status}` : r.error;
  console.log(`${alive ? "ok " : "NG "} ${p.name.padEnd(24)} ${url} → ${shown}（確認日から ${ageDays} 日）`);
  if (!alive) {
    problems.push(`${p.name}: ${url} が ${shown}。API の場所が変わったか、提供が終わった可能性がある`);
  }
}

if (problems.length > 0) {
  console.log("\n見直しが要るもの:");
  for (const line of problems) console.log(`- ${line}`);
  process.exit(1);
}
console.log("\n問題なし");
