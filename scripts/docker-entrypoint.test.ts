// docker/entrypoint.sh の分岐テスト。
// id・stat・find・su-exec・実行コマンドを偽物に差し替えた PATH で入口を動かし、
// 最後に何がどの引数で起動されたかを記録から確かめる（Docker は使わない。
// 本物の alpine での確認は PR の Test plan に記録している）。
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENTRY = resolve(__dirname, "../docker/entrypoint.sh");

let dir: string;
let log: string;

function script(name: string, body: string) {
  const p = join(dir, "bin", name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

/** 呼ばれたら「名前|引数|...」を 1 行で log に追記する sh の断片 */
const RECORD = (name: string) =>
  `printf '%s' "${name}" >> "$FAKE_LOG"\nfor a in "$@"; do printf '|%s' "$a" >> "$FAKE_LOG"; done\nprintf '\\n' >> "$FAKE_LOG"`;

function run(env: Record<string, string>, args: string[] = ["node", "server.mjs"]) {
  const r = spawnSync("/bin/sh", [ENTRY, ...args], {
    env: {
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      FAKE_LOG: log,
      DATA_DIR: join(dir, "data"),
      // テストの機械に /proc/self/uid_map があっても（Linux の CI）rootless 扱いにしない
      GRAPHIUM_UID_MAP_FILE: join(dir, "uid_map"),
      ...env,
    },
    encoding: "utf8",
  });
  const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { ...r, lines };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "entrypoint-test-"));
  log = join(dir, "log");
  writeFileSync(log, "");
  writeFileSync(join(dir, "uid_map"), "         0          0 4294967295\n");
  execFileSync("mkdir", ["-p", join(dir, "bin"), join(dir, "data")]);
  // busybox 互換の呼び方以外は失敗させる（GNU 専用の書式を使っていないことの確認）
  script("id", `if [ "$#" = 1 ] && [ "$1" = "-u" ]; then echo "$FAKE_UID"; elif [ "$#" = 2 ] && [ "$1" = "-u" ] && [ "$2" = "node" ]; then echo 1000; else exit 1; fi`);
  script("stat", `[ "$#" = 3 ] && [ "$1" = "-c" ] && [ "$2" = "%u:%g" ] || exit 1\necho "$FAKE_OWNER"`);
  // find: 所有者直し（-depth）だけ記録する。FAKE_FIND_FAIL=1 で失敗
  script("find", `case " $* " in *" -depth "*) ${RECORD("find").replace(/\n/g, "; ")}; [ "\${FAKE_FIND_FAIL:-}" != 1 ] || exit 1;; esac`);
  // su-exec: 下調べ（true / find / sh）は結果だけ返し、それ以外（サーバーの起動）は記録する
  script(
    "su-exec",
    [
      `case "$2" in`,
      `  true) [ "\${FAKE_SUEXEC_FAIL:-}" = 1 ] && exit 1; exit 0;;`,
      `  find) [ -z "\${FAKE_ROOT_ENTRY:-}" ] || echo "$FAKE_ROOT_ENTRY"; exit 0;;`,
      `  sh) [ "\${FAKE_NODE_CAN_WRITE:-}" = 1 ] && exit 0; exit 1;;`,
      `esac`,
      RECORD("su-exec"),
    ].join("\n"),
  );
  script("node", RECORD("node"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("docker/entrypoint.sh", () => {
  it("文法が正しい", () => {
    expect(spawnSync("sh", ["-n", ENTRY]).status).toBe(0);
  });

  it("root 以外で起動されたら、そのまま exec する", () => {
    const r = run({ FAKE_UID: "1000", FAKE_OWNER: "0:0" });
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(["node|server.mjs"]);
  });

  it("GRAPHIUM_RUN_AS_ROOT=1 なら root のまま exec し、警告を出す", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "0:0", GRAPHIUM_RUN_AS_ROOT: "1" });
    expect(r.lines).toEqual(["node|server.mjs"]);
    expect(r.stderr).toContain("GRAPHIUM_RUN_AS_ROOT=1");
  });

  it("rootless（コンテナの root がホストの一般ユーザー）なら、何も直さずそのまま exec する", () => {
    writeFileSync(join(dir, "uid_map"), "         0     100000      65536\n");
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "0:0" });
    expect(r.lines).toEqual(["node|server.mjs"]);
  });

  it("持ち主が root の既存データは、持ち主を node に直してから node で起動する", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "0:0" });
    expect(r.lines).toEqual([
      `find|${join(dir, "data")}|-depth|-exec|chown|-h|node:node|{}|+`,
      "su-exec|node:node|node|server.mjs",
    ]);
    expect(r.stderr).toContain("node に直します");
  });

  it("持ち主が root に見えても node が書けるなら、何も直さず node で起動する", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "0:0", FAKE_NODE_CAN_WRITE: "1" });
    expect(r.lines).toEqual(["su-exec|node:node|node|server.mjs"]);
    expect(r.stderr).toBe("");
  });

  it("持ち主を直せなければ、警告して root のまま起動する", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "0:0", FAKE_FIND_FAIL: "1" });
    expect(r.status).toBe(0);
    expect(r.lines.at(-1)).toBe("node|server.mjs");
    expect(r.stderr).toContain("直せませんでした");
  });

  it("持ち主が node なら（直したあとの 2 回目以降）、直さず node で起動する", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "1000:1000" });
    expect(r.lines).toEqual(["su-exec|node:node|node|server.mjs"]);
    expect(r.stderr).toBe("");
  });

  it("持ち主がほかの uid（bind mount）なら、直さずその uid:gid で起動する", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "1001:1001" });
    expect(r.lines).toEqual(["su-exec|1001:1001|env|HOME=/tmp|node|server.mjs"]);
    expect(r.stderr).toBe("");
  });

  it("bind mount の中に以前の版（root）のファイルが残っていれば、直さずに root のまま起動して直し方を知らせる", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "1001:1001", FAKE_ROOT_ENTRY: "/x/old.json" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("今までどおり root で起動します");
    expect(r.stderr).toContain("/x/old.json");
    expect(r.stderr).toContain("chown -R 1001:1001");
    // root 以外に落とすと既存のノートに書けなくなるので、落とさない
    expect(r.lines).toEqual(["node|server.mjs"]);
  });

  it("ユーザーを切り替えられない環境（cap_drop など）では、落ちずに root のまま起動する", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "1000:1000", FAKE_SUEXEC_FAIL: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("ユーザーを切り替えられません");
    expect(r.lines).toEqual(["node|server.mjs"]);
  });

  it("DATA_DIR が無ければ作る（空白入りのパスでも）", () => {
    const target = join(dir, "no such", "data");
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "0:0", DATA_DIR: target });
    expect(existsSync(target)).toBe(true);
    expect(r.lines[0]).toBe(`find|${target}|-depth|-exec|chown|-h|node:node|{}|+`);
    expect(r.lines.at(-1)).toBe("su-exec|node:node|node|server.mjs");
  });

  it("引数に空白が入っても壊れない", () => {
    const r = run({ FAKE_UID: "0", FAKE_OWNER: "1000:1000" }, ["node", "a b", "c  d"]);
    expect(r.lines.at(-1)).toBe("su-exec|node:node|node|a b|c  d");
  });
});
