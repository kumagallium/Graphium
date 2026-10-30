#!/usr/bin/env node
// 依存とランタイムの脆弱性を照合し、見つかったら Issue を 1 本だけ立てる（直ったら閉じる）。
//
// 使い方: node .github/scripts/security-scan.mjs <npm|cargo|node>
//   GITHUB_TOKEN と GITHUB_REPOSITORY があれば Issue を操作する。
//   DRY_RUN=1 なら結果を表示するだけ（手元での確認用）。
//
// 種類ごとに題を固定し、同じ題の open Issue があれば本文を更新する（重複して立てない）。
// 照合がきれいになったら、その Issue にコメントを残して閉じる。
// 照合そのものが失敗したとき（ネットワーク断・ツールの異常終了）は Issue を触らず
// 非ゼロで終了する — 「見えていない」を「問題なし」と取り違えないため（fail-closed）。

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const kind = process.argv[2];
const DRY_RUN = process.env.DRY_RUN === "1";
const LABEL = "security";

const TITLES = {
  npm: "🔒 Security: high/critical advisories in production npm dependencies",
  cargo: "🔒 Security: RustSec advisories in the desktop app (Cargo.lock)",
  node: "🔒 Security: bundled/hosted Node.js runtime needs an update",
};

// ── 照合 ─────────────────────────────────────────────

// pnpm audit は脆弱性があると非ゼロで終わるので、終了コードではなく JSON で判定する
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (e.stdout) return e.stdout;
    throw e;
  }
}

function scanNpm() {
  const out = run("pnpm", ["audit", "--prod", "--json"]);
  const audit = JSON.parse(out);
  if (audit.error) throw new Error(`pnpm audit failed: ${JSON.stringify(audit.error)}`);
  const all = Object.values(audit.advisories ?? {});
  const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  all.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const serious = all.filter((a) => a.severity === "critical" || a.severity === "high");
  const rows = all.map((a) => {
    const via = [...new Set(a.findings.flatMap((f) => f.paths).map((p) => p.split(">").slice(1, 3).join(" > ")))]
      .slice(0, 2)
      .join("<br>");
    return `| ${a.severity} | \`${a.module_name}\` | ${a.vulnerable_versions} | ${a.patched_versions} | ${via} | [${a.github_advisory_id ?? a.id}](${a.url}) |`;
  });
  return {
    found: serious.length > 0,
    summary: `${serious.length} high/critical of ${all.length} advisories (pnpm audit --prod)`,
    body: [
      "`pnpm audit --prod` reports advisories in dependencies that ship with the app.",
      "",
      "| Severity | Package | Vulnerable | Patched | Via | Advisory |",
      "|---|---|---|---|---|---|",
      ...rows,
      "",
      "## How to fix",
      "Follow the recipe used in #1368 / #1399: raise direct dependencies within their major,",
      "`pnpm update --depth Infinity <pkg>` for transitive ones, and only then a",
      "`pnpm.overrides` entry **bounded to the same major** (`\"pkg@1\": \">=1.2.3 <2\"`).",
      "Verify with tsc, lint:deps, vitest, build, `pnpm run test:e2e:mcp` and a sidecar `/api/health`.",
    ].join("\n"),
  };
}

function scanCargo() {
  const out = run("cargo", ["audit", "--json", "--file", "src-tauri/Cargo.lock"]);
  const audit = JSON.parse(out);
  const vulns = audit.vulnerabilities?.list ?? [];
  const rows = vulns.map((v) => {
    const a = v.advisory;
    const patched = v.versions?.patched?.join(", ") || "none";
    return `| \`${v.package.name}\` ${v.package.version} | ${a.title} | ${patched} | [${a.id}](https://rustsec.org/advisories/${a.id}) |`;
  });
  return {
    found: vulns.length > 0,
    summary: `${vulns.length} vulnerabilities (cargo audit)`,
    body: [
      "`cargo audit` (RustSec) reports vulnerabilities in the desktop app's Rust dependencies.",
      "Unmaintained/yanked warnings are not counted here.",
      "",
      "| Crate | Advisory | Patched | ID |",
      "|---|---|---|---|",
      ...rows,
      "",
      "## How to fix",
      "`cd src-tauri && cargo update -p <crate>` within the compatible range, then build the",
      "desktop app (`pnpm tauri build` or the Windows test build) and smoke-test it.",
    ].join("\n"),
  };
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      lastError = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 10_000));
  }
  throw lastError;
}

const cmpVersion = (a, b) => {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

async function scanNode() {
  const fetchNode = readFileSync("scripts/fetch-node.mjs", "utf8");
  const bundled = fetchNode.match(/const NODE_VERSION = "(v\d+\.\d+\.\d+)"/)?.[1];
  if (!bundled) throw new Error("NODE_VERSION not found in scripts/fetch-node.mjs");
  const bundledMajor = bundled.split(".")[0]; // "v22"

  // Node のメジャーを宣言している場所（同梱・Docker・CI）
  const majors = new Map(); // "v22" -> [where...]
  const add = (major, where) => majors.set(major, [...(majors.get(major) ?? []), where]);
  add(bundledMajor, `scripts/fetch-node.mjs (${bundled})`);
  for (const m of readFileSync("Dockerfile", "utf8").matchAll(/^FROM node:(\d+)/gm)) add(`v${m[1]}`, "Dockerfile");
  for (const f of readdirSync(".github/workflows")) {
    for (const m of readFileSync(`.github/workflows/${f}`, "utf8").matchAll(/node-version:\s*['"]?(\d+)/g)) {
      add(`v${m[1]}`, `.github/workflows/${f}`);
    }
  }

  const [index, schedule] = await Promise.all([
    fetchJson("https://nodejs.org/dist/index.json"),
    fetchJson("https://raw.githubusercontent.com/nodejs/Release/main/schedule.json"),
  ]);

  const problems = [];

  // 1. 同梱版より新しいセキュリティリリースが同じメジャーに出ていないか
  const newerSecurity = index.filter(
    (r) => r.version.startsWith(`${bundledMajor}.`) && r.security && cmpVersion(r.version, bundled) > 0,
  );
  if (newerSecurity.length > 0) {
    const latest = index.find((r) => r.version.startsWith(`${bundledMajor}.`));
    problems.push(
      [
        `### Bundled Node.js ${bundled} is behind a security release`,
        "",
        `Newer security releases in ${bundledMajor}.x: ${newerSecurity.map((r) => `\`${r.version}\` (${r.date})`).join(", ")}.`,
        `Latest ${bundledMajor}.x is \`${latest.version}\`. Details: https://nodejs.org/en/blog/vulnerability`,
        "",
        "Fix: raise `NODE_VERSION` in `scripts/fetch-node.mjs`, run `node scripts/fetch-node.mjs --force`,",
        "smoke-test the sidecar (`/api/health`) and ship a patch release.",
      ].join("\n"),
    );
  }

  // 2. 使っているメジャーのサポート終了（EOL）が 90 日以内か、もう過ぎていないか
  const soon = Date.now() + 90 * 24 * 3600 * 1000;
  for (const [major, where] of majors) {
    const end = schedule[major]?.end;
    if (!end) continue;
    const endTime = Date.parse(end);
    if (endTime <= soon) {
      const state = endTime <= Date.now() ? `reached end of life on ${end}` : `reaches end of life on ${end}`;
      problems.push(
        [
          `### Node.js ${major} ${state}`,
          "",
          `Used in: ${[...new Set(where)].map((w) => `\`${w}\``).join(", ")}.`,
          "End-of-life majors get no security fixes. Move these to the current LTS together",
          "(the bundled sidecar, the Dockerfile and the workflows should stay on the same major).",
        ].join("\n"),
      );
    }
  }

  return {
    found: problems.length > 0,
    summary: problems.length > 0 ? `${problems.length} runtime issue(s)` : `bundled ${bundled} is current; no EOL within 90 days`,
    body: problems.join("\n\n"),
  };
}

// ── Issue の操作 ─────────────────────────────────────

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === "POST" && path === "/labels" && res.status === 422)) {
    throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function report(title, result) {
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "(local run)";
  const body = [
    result.body,
    "",
    "---",
    `_Updated by security-check.yml on ${new Date().toISOString().slice(0, 10)} — ${runUrl}._`,
    "_This issue closes itself once the check comes back clean._",
  ].join("\n");

  if (DRY_RUN || !process.env.GITHUB_TOKEN) {
    console.log(`[dry-run] ${result.found ? "WOULD OPEN/UPDATE" : "clean"}: ${title}\n${result.summary}\n`);
    if (result.found) console.log(body);
    return;
  }

  const open = await gh("GET", `/issues?state=open&labels=${LABEL}&per_page=100`);
  const existing = open.find((i) => i.title === title && !i.pull_request);

  if (result.found) {
    await gh("POST", "/labels", { name: LABEL, color: "d93f0b", description: "Vulnerability or runtime support issue" });
    if (existing) {
      await gh("PATCH", `/issues/${existing.number}`, { body });
      console.log(`Updated #${existing.number}: ${result.summary}`);
    } else {
      const created = await gh("POST", "/issues", { title, body, labels: [LABEL] });
      console.log(`Opened #${created.number}: ${result.summary}`);
    }
  } else if (existing) {
    await gh("POST", `/issues/${existing.number}/comments`, {
      body: `The check is clean again (${result.summary}). Closing. — ${runUrl}`,
    });
    await gh("PATCH", `/issues/${existing.number}`, { state: "closed", state_reason: "completed" });
    console.log(`Closed #${existing.number}`);
  } else {
    console.log(`Clean: ${result.summary}`);
  }
}

const scanners = { npm: scanNpm, cargo: scanCargo, node: scanNode };
if (!scanners[kind]) {
  console.error(`usage: security-scan.mjs <${Object.keys(scanners).join("|")}>`);
  process.exit(2);
}
const result = await scanners[kind]();
await report(TITLES[kind], result);
