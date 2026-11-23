import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetConversationSummaryCacheForTest,
  listClaudeConversations,
  listClaudeProjectDirs,
  listClaudeSessionFiles,
  listClaudeWorkdirs,
  readClaudeSession,
  summarizeClaudeProjectDir,
} from "./claude-code-sessions";

const SID1 = "11111111-2222-4333-8444-555555555555";
const SID2 = "22222222-3333-4444-8555-666666666666";
const DIR = "-Users-example-bakery-notes";

/** symlinkSync が使えるか（権限の無い環境では飛ばす） */
const canSymlink = (() => {
  const d = mkdtempSync(join(tmpdir(), "cc-symcheck-"));
  try {
    writeFileSync(join(d, "a"), "");
    symlinkSync(join(d, "a"), join(d, "b"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
})();

function rec(type: "user" | "assistant", text: string, o: { cwd?: string; at?: string; id?: string } = {}): string {
  return JSON.stringify({
    type,
    uuid: `${type}-${text}-${o.id ?? ""}`,
    sessionId: SID1,
    cwd: o.cwd ?? "/Users/example/bakery-notes",
    timestamp: o.at ?? "2026-11-03T00:00:00.000Z",
    ...(type === "user" ? { origin: { kind: "human" } } : {}),
    message: { role: type, content: text },
  });
}

let base: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "cc-sessions-base-"));
  outside = mkdtempSync(join(tmpdir(), "cc-sessions-outside-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function putSession(dir: string, sid: string, lines: string[], eol = "\n"): void {
  mkdirSync(join(base, dir), { recursive: true });
  writeFileSync(join(base, dir, `${sid}.jsonl`), lines.join(eol) + eol);
}

describe("一覧", () => {
  it(".jsonl だけを数える（サブフォルダ・別の拡張子は数えない）", async () => {
    putSession(DIR, SID1, [rec("user", "辛さは中辛で")]);
    putSession(DIR, SID2, [rec("user", "お願いします")]);
    writeFileSync(join(base, DIR, "memo.txt"), "x");
    mkdirSync(join(base, DIR, `${SID1}-sub`));
    mkdirSync(join(base, DIR, "dir.jsonl"));
    const files = await listClaudeSessionFiles(DIR, base);
    expect(files.map((f) => f.sessionId).sort()).toEqual([SID1, SID2]);
    const dirs = await listClaudeProjectDirs(base);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toMatchObject({ dirName: DIR, sessionFiles: 2 });
  });

  it("フォルダ名が不正（空白や . を含む）なら出ない", async () => {
    putSession("bad name", SID1, [rec("user", "x")]);
    putSession("bad.name", SID1, [rec("user", "x")]);
    putSession(DIR, SID1, [rec("user", "x")]);
    expect((await listClaudeProjectDirs(base)).map((d) => d.dirName)).toEqual([DIR]);
    expect(await listClaudeSessionFiles("bad name", base)).toEqual([]);
    expect(await listClaudeSessionFiles("bad.name", base)).toEqual([]);
  });

  it(".jsonl の無いフォルダは出ない", async () => {
    mkdirSync(join(base, DIR));
    expect(await listClaudeProjectDirs(base)).toEqual([]);
  });
});

describe("readClaudeSession", () => {
  it("作り物の記録を読める", async () => {
    putSession(DIR, SID1, [rec("user", "全粒粉は 2 割までにする"), rec("assistant", "了解です"), rec("user", "お願いします")]);
    const m = await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base);
    expect(m?.sessionId).toBe(SID1);
    expect(m?.workdir).toBe("/Users/example/bakery-notes");
    expect(m?.turns.map((t) => t.text)).toEqual(["全粒粉は 2 割までにする", "了解です", "お願いします"]);
  });

  it("create_note の結果の noteId が createdNoteIds として届く", async () => {
    const NOTE = "aaaaaaaa-1111-4222-8333-444444444441";
    putSession(DIR, SID1, [
      rec("user", "発酵の結論をノートにして"),
      JSON.stringify({
        type: "assistant",
        uuid: "a-tool",
        sessionId: SID1,
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__graphium__create_note", input: {} }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u-result",
        sessionId: SID1,
        toolUseResult: "x",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `タイトル: パン\nnoteId: ${NOTE}\nファイル: /x/notes/${NOTE}.json` }] },
      }),
    ]);
    const m = await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base);
    expect(m?.createdNoteIds).toEqual([NOTE]);
  });

  it.each(["..", "a/b", "", "/etc"])("フォルダ名 %j は null / 空配列", async (dir) => {
    putSession(DIR, SID1, [rec("user", "x")]);
    expect(await readClaudeSession(dir, `${SID1}.jsonl`, {}, base)).toBeNull();
    expect(await listClaudeSessionFiles(dir, base)).toEqual([]);
  });

  it("絶対パスのフォルダ名は null", async () => {
    putSession(DIR, SID1, [rec("user", "x")]);
    expect(await readClaudeSession(join(base, DIR), `${SID1}.jsonl`, {}, base)).toBeNull();
  });

  it.each(["../x.jsonl", "x.txt", "a/b.jsonl", ""])("ファイル名 %j は null", async (file) => {
    putSession(DIR, SID1, [rec("user", "x")]);
    expect(await readClaudeSession(DIR, file, {}, base)).toBeNull();
  });

  it("存在しないファイルは null", async () => {
    mkdirSync(join(base, DIR));
    expect(await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base)).toBeNull();
  });
});

describe("シンボリックリンク", () => {
  it.skipIf(!canSymlink)("外のフォルダを指すリンクのフォルダは読まない", async () => {
    writeFileSync(join(outside, `${SID1}.jsonl`), rec("user", "外の文") + "\n");
    symlinkSync(outside, join(base, DIR));
    expect(await listClaudeSessionFiles(DIR, base)).toEqual([]);
    expect(await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base)).toBeNull();
    expect(await listClaudeProjectDirs(base)).toEqual([]);
  });

  it.skipIf(!canSymlink)("外のファイルを指すリンクの .jsonl は読まず、一覧にも出ない", async () => {
    const target = join(outside, "secret.jsonl");
    writeFileSync(target, rec("user", "外の文") + "\n");
    mkdirSync(join(base, DIR));
    symlinkSync(target, join(base, DIR, `${SID1}.jsonl`));
    putSession(DIR, SID2, [rec("user", "中の文")]);
    expect((await listClaudeSessionFiles(DIR, base)).map((f) => f.sessionId)).toEqual([SID2]);
    expect(await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base)).toBeNull();
  });
});

describe("1 行の上限と改行", () => {
  it("上限を超える行だけが飛び、前後の行は読める", async () => {
    putSession(DIR, SID1, [rec("user", "前の文"), rec("user", "あ".repeat(300)), rec("user", "後の文")]);
    const m = await readClaudeSession(DIR, `${SID1}.jsonl`, { maxLineBytes: 400 }, base);
    // 前後の行は 400 バイト以下、長い行は日本語 300 字（900 バイト超）で飛ぶ
    expect(m?.turns.map((t) => t.text)).toEqual(["前の文", "後の文"]);
  });

  it("200 バイトの上限で、超えた行だけが飛ぶ", async () => {
    const short = (t: string) => JSON.stringify({ type: "user", uuid: t, sessionId: SID1, message: { content: t } });
    expect(Buffer.byteLength(short("前"))).toBeLessThan(200);
    putSession(DIR, SID1, [short("前"), short("x".repeat(300)), short("後")]);
    const m = await readClaudeSession(DIR, `${SID1}.jsonl`, { maxLineBytes: 200 }, base);
    expect(m?.turns.map((t) => t.text)).toEqual(["前", "後"]);
  });

  it("最後の行に改行が無くても読める", async () => {
    mkdirSync(join(base, DIR));
    writeFileSync(join(base, DIR, `${SID1}.jsonl`), [rec("user", "一行目"), rec("user", "最後の行")].join("\n"));
    const m = await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base);
    expect(m?.turns.map((t) => t.text)).toEqual(["一行目", "最後の行"]);
  });

  it("CRLF の行も読める", async () => {
    putSession(DIR, SID1, [rec("user", "一行目"), rec("user", "二行目")], "\r\n");
    const m = await readClaudeSession(DIR, `${SID1}.jsonl`, {}, base);
    expect(m?.turns.map((t) => t.text)).toEqual(["一行目", "二行目"]);
  });
});

describe("集計", () => {
  it("summarizeClaudeProjectDir は会話ごとの集計を返す", async () => {
    putSession(DIR, SID1, [rec("user", "辛さは中辛で")]);
    putSession(DIR, SID2, [rec("assistant", "返答だけ"), rec("user", "お願いします")]);
    const s = await summarizeClaudeProjectDir(DIR, base);
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.ownTurns)).toEqual([1, 1]);
  });

  it("listClaudeWorkdirs は作業フォルダ（cwd）ごとにまとまる", async () => {
    putSession(DIR, SID1, [rec("user", "辛さは中辛で")]);
    putSession(DIR, SID2, [rec("user", "お願いします")]);
    const other = "-Users-example-curry-lab";
    putSession(other, SID1, [rec("user", "スパイスを足す", { cwd: "/Users/example/curry-lab", at: "2026-11-10T00:00:00.000Z" })]);
    const rows = await listClaudeWorkdirs({}, base);
    expect(rows.map((r) => [r.workdir, r.sessions])).toEqual([
      ["/Users/example/curry-lab", 1],
      ["/Users/example/bakery-notes", 2],
    ]);
    const only = await listClaudeWorkdirs({ dirNames: [DIR] }, base);
    expect(only).toHaveLength(1);
    expect(only[0].workdir).toBe("/Users/example/bakery-notes");
  });
});

describe("baseDir が使えないとき", () => {
  it("存在しないなら空配列／null", async () => {
    const missing = join(base, "no-such-dir");
    expect(await listClaudeProjectDirs(missing)).toEqual([]);
    expect(await listClaudeSessionFiles(DIR, missing)).toEqual([]);
    expect(await readClaudeSession(DIR, `${SID1}.jsonl`, {}, missing)).toBeNull();
    expect(await listClaudeWorkdirs({}, missing)).toEqual([]);
  });

  it("ファイルを指すなら空配列／null", async () => {
    const file = join(base, "file.txt");
    writeFileSync(file, "x");
    expect(await listClaudeProjectDirs(file)).toEqual([]);
    expect(await listClaudeSessionFiles(DIR, file)).toEqual([]);
    expect(await readClaudeSession(DIR, `${SID1}.jsonl`, {}, file)).toBeNull();
  });
});

describe("listClaudeConversations", () => {
  it("会話ごとの集計と名前の組を返し、読めない記録は飛ばす", async () => {
    putSession(DIR, SID1, [rec("user", "生地をこねる")]);
    putSession("-Users-example-curry-lab", SID2, [rec("user", "スパイスを足す", { cwd: "/Users/example/curry-lab" })]);
    // 会話として読めないファイル
    writeFileSync(join(base, DIR, "33333333-4444-4555-8666-777777777777.jsonl"), "not json\n");
    const list = await listClaudeConversations(base);
    const refs = list.map((l) => `${l.ref.dirName}/${l.ref.fileName}`).sort();
    expect(refs).toContain(`${DIR}/${SID1}.jsonl`);
    expect(refs).toContain(`-Users-example-curry-lab/${SID2}.jsonl`);
    const bakery = list.find((l) => l.ref.dirName === DIR && l.ref.fileName === `${SID1}.jsonl`);
    expect(bakery?.summary.ownTurns).toBe(1);
    expect(bakery?.summary.workdir).toBe("/Users/example/bakery-notes");
  });

  it("存在しない baseDir は空配列", async () => {
    expect(await listClaudeConversations(join(base, "no-such-dir"))).toEqual([]);
  });

  it("大きさと更新時刻が同じ記録は読み直さず、変わった記録だけ読み直す", async () => {
    __resetConversationSummaryCacheForTest();
    putSession(DIR, SID1, [rec("user", "生地をこねる")]);
    const path = join(base, DIR, `${SID1}.jsonl`);
    const fixed = new Date("2026-01-02T03:04:05.000Z");
    utimesSync(path, fixed, fixed);
    const first = await listClaudeConversations(base);
    expect(first[0]?.summary.ownTurns).toBe(1);

    // 中身だけ差し替えて、大きさと更新時刻を戻す → 覚えた集計が返る（読み直していない）
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace("生地をこねる", "生地をまるめ"));
    expect(statSync(path).size).toBe(Buffer.byteLength(original));
    utimesSync(path, fixed, fixed);
    const second = await listClaudeConversations(base);
    expect(second[0]?.summary).toBe(first[0]?.summary);

    // 発言が増えて更新時刻も変わる → 読み直す
    putSession(DIR, SID1, [rec("user", "生地をこねる"), rec("user", "一次発酵を待つ")]);
    const third = await listClaudeConversations(base);
    expect(third[0]?.summary.ownTurns).toBe(2);
  });

  it("消えた記録は一覧から外れる", async () => {
    __resetConversationSummaryCacheForTest();
    putSession(DIR, SID1, [rec("user", "生地をこねる")]);
    putSession(DIR, SID2, [rec("user", "窯を温める")]);
    expect(await listClaudeConversations(base)).toHaveLength(2);
    rmSync(join(base, DIR, `${SID2}.jsonl`));
    const list = await listClaudeConversations(base);
    expect(list.map((l) => l.ref.fileName)).toEqual([`${SID1}.jsonl`]);
  });
});
