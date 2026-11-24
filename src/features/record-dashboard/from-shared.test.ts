import { describe, expect, it } from "vitest";
import type { SharedEntry } from "../../lib/storage/shared";
import { buildSharedRecords, SHARED_TEXT_LIMIT, sharedIdOfRecord, type SharedRecordSources } from "./from-shared";

/** テストでの「いま」。封筒の日時はこれより前に置く */
const NOW = "2026-11-25T00:00:00Z";
const build = (sources: SharedRecordSources) => buildSharedRecords({ now: NOW, ...sources });

function entry(id: string, over: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: "佐藤 花", email: "sato@example.com" },
    created_at: "2026-11-20T00:00:00Z",
    updated_at: "2026-11-21T03:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    extra: { title: `題 ${id}` },
    ...over,
  } as SharedEntry;
}

const planRow = (planIds: string[], rowName: string) => ({ planIds, tableBlockId: "tbl-1", rowId: "row_a", rowName });

describe("buildSharedRecords", () => {
  it("ノートを、共有の作者の記録として写す（いつ = 最後に共有した時点）", () => {
    const [item] = build({ entries: [entry("n1")] });
    expect(item).toEqual({
      id: "shared:n1",
      kind: "note",
      at: "2026-11-21T03:00:00.000Z",
      origin: "shared",
      who: { type: "other", name: "佐藤 花" },
      title: "題 n1",
    });
  });

  it("AI のページは wiki として写す。コメント・提案・テンプレート・文献・データは写さない", () => {
    const types = ["knowledge", "comment", "proposal", "template", "reference", "data-manifest", "report"] as const;
    const items = build({ entries: types.map((type) => entry(type, { type })) });
    expect(items.map((i) => [i.id, i.kind])).toEqual([["shared:knowledge", "wiki"]]);
  });

  it("共有をやめたものと、自分が共有したものは写さない", () => {
    const entries = [
      entry("gone", { status: "unshared" }),
      entry("mine", { author: { name: "自分", email: "me@example.com" } }),
      entry("theirs"),
    ];
    expect(build({ entries, selfEmail: "me@example.com" }).map((i) => i.id)).toEqual(["shared:theirs"]);
    // 自分のメールアドレスが分からないときは外さない
    expect(build({ entries }).map((i) => i.id).sort()).toEqual(["shared:mine", "shared:theirs"]);
  });

  it("新しく共有した順に並べる。updated_at が無ければ created_at を使う", () => {
    const items = build({
      entries: [
        entry("old", { updated_at: "2026-11-19T00:00:00Z" }),
        entry("new", { updated_at: "2026-11-23T00:00:00Z" }),
        entry("created-only", { updated_at: undefined as unknown as string, created_at: "2026-11-22T00:00:00Z" }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["shared:new", "shared:created-only", "shared:old"]);
  });

  it("先に行きすぎた日時・読めない日時は使わない（一覧の先頭に居座らせない）", () => {
    const items = build({
      entries: [
        // 時計が少し進んだ端末: いまの時刻として扱う
        entry("skew", { updated_at: "2026-11-25T00:30:00Z" }),
        // 1 日より先: updated_at を捨てて created_at を使う
        entry("future", { updated_at: "2999-01-01T00:00:00Z", created_at: "2026-11-20T00:00:00Z" }),
        // どちらも使えない: 日付の無い記録として最後に置く
        entry("garbage", { updated_at: "garbage", created_at: 42 as unknown as string }),
        entry("huge", { updated_at: `2026-11-21T00:00:00Z${" ".repeat(200)}`, created_at: "2999-01-01T00:00:00Z" }),
        entry("normal", { updated_at: "2026-11-22T00:00:00Z" }),
      ],
    });
    expect(items.map((i) => [i.id, i.at])).toEqual([
      ["shared:skew", "2026-11-25T00:00:00.000Z"],
      ["shared:normal", "2026-11-22T00:00:00.000Z"],
      ["shared:future", "2026-11-20T00:00:00.000Z"],
      ["shared:garbage", ""],
      ["shared:huge", ""],
    ]);
  });

  it("作者の名前が無ければメールアドレスを出す", () => {
    const [item] = build({ entries: [entry("n1", { author: { name: " ", email: "sato@example.com" } })] });
    expect(item.who).toEqual({ type: "other", name: "sato@example.com" });
  });

  it("計画の行の記録には、計画の題と行の名前を添える（先頭の @ は外す）", () => {
    const entries = [
      entry("plan", { extra: { title: "食パンの計画" } }),
      entry("rec", { extra: { title: "こね", planRow: planRow(["missing", "plan"], "@こね") } }),
    ];
    const rec = build({ entries }).find((i) => i.id === "shared:rec");
    expect(rec?.planRow).toEqual({ planTitle: "食パンの計画", rowName: "こね" });
  });

  it("計画が共有フォルダに無い・共有をやめているときは、計画の題を省く", () => {
    const entries = [
      entry("plan", { status: "unshared", extra: { title: "食パンの計画" } }),
      entry("rec", { extra: { title: "こね", planRow: planRow(["plan"], "こね") } }),
      entry("rec2", { extra: { title: "焼成", planRow: planRow(["nowhere"], "焼成") } }),
    ];
    const items = build({ entries });
    expect(items.find((i) => i.id === "shared:rec")?.planRow).toEqual({ rowName: "こね" });
    expect(items.find((i) => i.id === "shared:rec2")?.planRow).toEqual({ rowName: "焼成" });
  });

  it("チェックの件数は、計画の行の記録にだけ添える（本文と同じ版の写しがあるとき）", () => {
    const checklist = { checked: 3, total: 5, bodyHash: "sha256:body" };
    const entries = [
      entry("rec", { extra: { title: "こね", bodyHash: "sha256:body", checklist, planRow: planRow(["plan"], "こね") } }),
      entry("stale", { extra: { title: "発酵", bodyHash: "sha256:newer", checklist, planRow: planRow(["plan"], "発酵") } }),
      entry("free", { extra: { title: "配合", bodyHash: "sha256:body", checklist } }),
    ];
    const items = build({ entries });
    expect(items.find((i) => i.id === "shared:rec")?.checks).toEqual({ checked: 3, total: 5 });
    expect(items.find((i) => i.id === "shared:stale")?.checks).toBeUndefined();
    expect(items.find((i) => i.id === "shared:free")?.checks).toBeUndefined();
    expect(items.find((i) => i.id === "shared:free")?.planRow).toBeUndefined();
  });

  it("この端末で確かめた本文から数えた控えがあれば、そちらを使う", () => {
    const rec = entry("rec", { extra: { title: "こね", planRow: planRow(["plan"], "こね") } });
    const derived = { rec: { hash: rec.hash, noteContexts: [], checklist: { checked: 1, total: 4 } } };
    const [item] = build({ entries: [rec], derived });
    expect(item.checks).toEqual({ checked: 1, total: 4 });
  });

  it("形の合わない封筒でも落ちない。長すぎる題と名前は切る", () => {
    const long = "あ".repeat(SHARED_TEXT_LIMIT + 50);
    const entries = [
      entry("broken", { extra: { title: 42, planRow: "x" } as unknown as SharedEntry["extra"], author: undefined as unknown as SharedEntry["author"] }),
      entry("long", { extra: { title: long }, author: { name: long, email: "a@example.com" } }),
      entry("noextra", { extra: undefined }),
    ];
    const items = build({ entries });
    expect(items).toHaveLength(3);
    const broken = items.find((i) => i.id === "shared:broken");
    expect(broken?.title).toBe("");
    expect(broken?.who).toEqual({ type: "other", name: "" });
    expect(broken?.planRow).toBeUndefined();
    const clipped = items.find((i) => i.id === "shared:long");
    expect(clipped?.title).toHaveLength(SHARED_TEXT_LIMIT);
    expect(clipped?.who).toEqual({ type: "other", name: "あ".repeat(SHARED_TEXT_LIMIT) });
  });
});

describe("sharedIdOfRecord", () => {
  it("共有の記録の id から、共有エントリの id を取り出す", () => {
    expect(sharedIdOfRecord({ id: "shared:abc" })).toBe("abc");
    expect(sharedIdOfRecord({ id: "shared:a:b" })).toBe("a:b");
    expect(sharedIdOfRecord({ id: "note:abc" })).toBeNull();
  });
});
