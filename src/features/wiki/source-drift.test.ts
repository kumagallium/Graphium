import { describe, expect, it } from "vitest";
import { driftCandidates, findSourceDrift, passagesBySource, passagesGoneFrom } from "./source-drift";

const md = [
  "## 要点",
  "- 一次発酵の湿度は 65%。[[source:n1|一次発酵の湿度は 65% だった]]",
  "- 焼成は 230 度。[[source:pdf:f|焼成は 230 度で 35 分]]",
  "- 室温は 24 度。[[source:n2|?|室温は 24 度だった]]",
].join("\n");

function doc(extra: Record<string, unknown> = {}): any {
  return {
    title: "t",
    pages: [],
    modifiedAt: "2026-11-01T00:00:00.000Z",
    wikiMeta: { kind: "topic", topicMarkdown: md, lastIngestedAt: "2026-11-01T00:00:00.000Z" },
    ...extra,
  };
}

describe("source-drift", () => {
  it("照合済みの一節だけを資料ごとに集める（印の付いた一節は除く）", () => {
    const m = passagesBySource(md);
    expect([...m.keys()]).toEqual(["n1", "pdf:f"]);
    expect(m.get("n1")).toEqual([{ statement: "一次発酵の湿度は 65%。", passage: "一次発酵の湿度は 65% だった" }]);
  });

  it("書いたあとで更新されたノートだけを対象にする（PDF・素材は除く）", () => {
    const mod = (id: string) => ({ n1: "2026-11-20T00:00:00.000Z", n2: "2026-11-20T00:00:00.000Z" } as Record<string, string>)[id];
    expect(driftCandidates(doc(), mod)).toEqual([{ sourceId: "n1", editedAt: "2026-11-20T00:00:00.000Z" }]);
    expect(driftCandidates(doc(), () => "2026-10-01T00:00:00.000Z")).toEqual([]);
  });

  it("最後に読んだ時刻はページの来歴（そのノートを used に含む活動）を優先する", () => {
    const d = doc({ documentProvenance: { activities: [{ id: "a", type: "x", used: ["n1"], endedAt: "2026-11-25T00:00:00.000Z" }] } });
    expect(driftCandidates(d, () => "2026-11-20T00:00:00.000Z")).toEqual([]);
  });

  it("関係ない編集では知らせず、一節が消えたときだけ知らせる", async () => {
    expect(passagesGoneFrom(md, "n1", "追記した段落。一次発酵の湿度は 65% だった。")).toEqual([]);
    const drift = await findSourceDrift(doc(), () => "2026-11-20T00:00:00.000Z", async () => "一次発酵の湿度は 72% だった。");
    expect(drift).toEqual([{ sourceId: "n1", editedAt: "2026-11-20T00:00:00.000Z", gone: [{ statement: "一次発酵の湿度は 65%。", passage: "一次発酵の湿度は 65% だった" }], contextChanged: [] }]);
  });

  it("読めないノート・一節の無いページは何も出さない", async () => {
    expect(await findSourceDrift(doc(), () => "2026-11-20T00:00:00.000Z", async () => undefined)).toEqual([]);
    expect(await findSourceDrift({ ...doc(), wikiMeta: { kind: "topic" } }, () => "2026-11-20T00:00:00.000Z", async () => "x")).toEqual([]);
  });

  it("一節は残っていて前後の文が変わったときは、前後の文の変化として知らせる", async () => {
    const d = doc();
    d.wikiMeta.passageContexts = [{ sourceId: "n1", passage: "一次発酵の湿度は 65% だった", before: "室温は 24 度。", after: "生地はよく膨らんだ。" }];
    const drift = await findSourceDrift(d, () => "2026-11-20T00:00:00.000Z", async () => "室温は 24 度。一次発酵の湿度は 65% だった。ただし湿度計は校正前だった。");
    expect(drift).toEqual([{
      sourceId: "n1",
      editedAt: "2026-11-20T00:00:00.000Z",
      gone: [],
      contextChanged: [{
        statement: "一次発酵の湿度は 65%。",
        passage: "一次発酵の湿度は 65% だった",
        after: { was: "生地はよく膨らんだ。", now: "ただし湿度計は校正前だった。" },
      }],
    }]);
    // 控えと同じなら何も出さない
    expect(await findSourceDrift(d, () => "2026-11-20T00:00:00.000Z", async () => "室温は 24 度。一次発酵の湿度は 65% だった。生地はよく膨らんだ。")).toEqual([]);
  });
});
