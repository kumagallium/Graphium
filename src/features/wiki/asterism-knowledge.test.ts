import { describe, expect, it } from "vitest";

import type { WikiMeta } from "../../lib/document-types";
import {
  KNOWLEDGE_FORMAT,
  buildKnowledgeBundle,
  roleOfTopicType,
  safeKnowledgeId,
  sourceKindOf,
  type KnowledgeItem,
  type KnowledgeBundle,
} from "./asterism-knowledge";

const AT = "2026-01-01T00:00:00.000Z";
const meta = (m: Partial<WikiMeta> & { kind: WikiMeta["kind"] }): WikiMeta =>
  ({ derivedFromNotes: [], derivedFromChats: [], generatedAt: "", generatedBy: { model: "", version: "" }, ...m }) as WikiMeta;

const ok = (r: ReturnType<typeof buildKnowledgeBundle>): KnowledgeBundle => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

const sid = safeKnowledgeId;
const items: KnowledgeItem[] = [
  { id: "c2", title: "生地は 24 時間寝かせると香りが増す", meta: meta({ kind: "claim", status: "verified", level: "finding", derivedFromNotes: ["pdf:abc", "n1", "w1"], topicIds: ["t1"] }) },
  { id: "c1", title: "Bi2Te3 の熱伝導率は低い", meta: meta({ kind: "claim", status: "candidate", epistemicStatus: "established", modalQualifier: "probably", derivedFromNotes: ["pdf:abc"], generatedAt: AT }) },
  { id: "t1", title: "Bi2Te3 の 熱伝導率", meta: meta({ kind: "topic", topicType: "concept", derivedFromClaims: ["c1", "ghost"], derivedFromNotes: ["document:d1", "chat:x y", "url:https://e.test/a", "weird:1"] }) },
  { id: "t2", title: "ライ麦粉", meta: meta({ kind: "topic", topicType: "material" }) },
  { id: "t3", title: "発酵", meta: meta({ kind: "topic", topicType: "place" }) },
  { id: "t4", title: "手ごね", meta: meta({ kind: "topic" }) },
];

const build = () =>
  ok(
    buildKnowledgeBundle(items, {
      exportedAt: AT,
      isWikiId: (id) => id === "w1",
      sourceName: (ref) => (ref === "pdf:abc" ? "パン作りの本" : ref === "n1" ? "仕込みメモ" : undefined),
    }),
  );

describe("buildKnowledgeBundle", () => {
  it("形・6 ファイル・件数", () => {
    const b = build();
    expect(b.format).toBe(KNOWLEDGE_FORMAT);
    expect(b.title).toBe("Graphium");
    expect(b.exported_at).toBe(AT);
    expect(Object.keys(b.files)).toEqual(["claims.json", "topics.json", "sources.json", "term_candidates.json", "term_claims.json", "term_relations.json"]);
    for (const [k, v] of Object.entries(b.files)) expect(b.counts[k as keyof typeof b.counts]).toBe(v.length);
    expect(b.bases.claim).toMatch(/\/claim\/$/);
  });

  it("0 件でも 6 ファイルを [] で出す", () => {
    const b = ok(buildKnowledgeBundle([], { exportedAt: AT }));
    expect(Object.values(b.files).every((v) => Array.isArray(v) && v.length === 0)).toBe(true);
    expect(Object.values(b.counts).every((n) => n === 0)).toBe(true);
  });

  it("知見の行: 全キー・id 順・札の写し・wiki の id を出典から除く", () => {
    const rows = build().files["claims.json"];
    expect(rows.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(Object.keys(rows[0])).toEqual(Object.keys(rows[1]));
    expect(rows[0]).toMatchObject({ review_state: "candidate", epistemic_status: "established", modal_qualifier: "probably", level: null, generated_at: AT });
    expect(rows[1]).toMatchObject({ review_state: "verified", level: "finding", epistemic_status: null, generated_at: null });
    expect(rows[1].source_iri).toEqual([
      `https://kumagallium.github.io/Graphium/source/${sid("pdf:abc")}`,
      "https://kumagallium.github.io/Graphium/source/n1",
    ]);
    expect(rows[0].iri).toBe("https://kumagallium.github.io/Graphium/claim/c1");
    expect(rows[0].source_url).toBe("https://kumagallium.github.io/Graphium/app/#knowledge/claim/c1");
  });

  it("トピックの行: 題を割る・材料の種類・claim_iri は束に入った知見だけ", () => {
    const rows = build().files["topics.json"];
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(rows[0]).toMatchObject({ material: "Bi2Te3", property: "熱伝導率", topic_type: "concept" });
    expect(rows[0].claim_iri).toEqual(["https://kumagallium.github.io/Graphium/claim/c1"]);
    expect(rows[1]).toMatchObject({ material: "ライ麦粉", property: null, claim_iri: [] });
    expect(rows[2]).toMatchObject({ material: null, property: null, topic_type: "place" });
    expect(rows[3].topic_type).toBeNull();
    for (const r of rows) expect(Object.keys(r)).toEqual(Object.keys(rows[0]));
    expect(rows[0].source_url).toContain("#knowledge/topic/t1");
  });

  it("資料: 重複なし・最初に出た順・名前が引けなければ参照・種類・id の安全化", () => {
    const rows = build().files["sources.json"];
    expect(rows.map((r) => r.id)).toEqual(
      ["pdf:abc", "n1", "document:d1", "chat:x y", "url:https://e.test/a", "weird:1"].map(sid),
    );
    expect(rows[0].id).toMatch(/^pdf-abc~[0-9a-f]{14}$/);
    expect(rows.map((r) => r.kind)).toEqual(["pdf", "note", "document", "chat", "url", "other"]);
    expect(rows[0].name).toBe("パン作りの本");
    expect(rows[2].name).toBe("document:d1");
    expect(rows.some((r) => r.id === "w1")).toBe(false);
  });

  it("語の候補: id・種別・役割の写し", () => {
    const rows = build().files["term_candidates.json"];
    expect(rows.map((r) => [r.id, r.name, r.kind, r.role])).toEqual([
      ["t1.m", "Bi2Te3", "class", "material"],
      ["t1.p", "熱伝導率", "property", null],
      ["t2", "ライ麦粉", "class", "material"],
      ["t3", "発酵", "class", "other"],
      ["t4", "手ごね", "class", null],
    ]);
    expect(rows[0]).toMatchObject({ aliases: [], origin_id: "t1", origin_iri: "https://kumagallium.github.io/Graphium/claim/t1" });
  });

  it("語 ↔ 知見: 両方向から重複なし・割ったトピックは材料と物性の両方に付く", () => {
    const rows = build().files["term_claims.json"];
    // t1 は derivedFromClaims に c1・知見 c2 の topicIds に t1
    expect(rows.map((r) => `${r.term_id}:${r.claim_id}`)).toEqual(["t1.m:c1", "t1.m:c2", "t1.p:c1", "t1.p:c2"]);
    expect(rows[0].claim_iri).toBe("https://kumagallium.github.io/Graphium/claim/c1");
  });

  it("語どうしの関係: 割れたトピック 1 件につき 1 行", () => {
    expect(build().files["term_relations.json"]).toEqual([
      { from_term: "t1.m", rel: "has_property", to_term: "t1.p", origin_id: "t1", origin_iri: "https://kumagallium.github.io/Graphium/claim/t1" },
    ]);
  });

  it("基底の指定: 末尾に / を補う・不正は error", () => {
    const b = ok(buildKnowledgeBundle(items, { exportedAt: AT, claimBaseIri: "https://x.test/c", termBaseIri: "https://x.test/t#", noteUrlBase: "https://g.test/app" }));
    expect(b.bases).toMatchObject({ claim: "https://x.test/c/", term: "https://x.test/t#" });
    expect(b.files["claims.json"][0].source_url).toBe("https://g.test/app/#knowledge/claim/c1");
    expect(buildKnowledgeBundle([], { exportedAt: AT, claimBaseIri: "ftp://x" })).toEqual({ error: "claim-base-iri-invalid" });
    expect(buildKnowledgeBundle([], { exportedAt: AT, sourceBaseIri: "https://a b" })).toEqual({ error: "source-base-iri-invalid" });
    expect(buildKnowledgeBundle([], { exportedAt: AT, termBaseIri: "nope" })).toEqual({ error: "term-base-iri-invalid" });
    expect(buildKnowledgeBundle([], { exportedAt: AT, noteUrlBase: "https://g.test/a#x" })).toEqual({ error: "note-url-base-invalid" });
  });

  it("claim・topic 以外は出さない", () => {
    const b = ok(buildKnowledgeBundle([{ id: "s1", title: "要約", meta: meta({ kind: "summary" as never }) }], { exportedAt: AT }));
    expect(b.counts["claims.json"] + b.counts["topics.json"]).toBe(0);
  });
});

describe("補助関数", () => {
  it("safeKnowledgeId・sourceKindOf・roleOfTopicType", () => {
    expect(safeKnowledgeId("pdf:abc")).toMatch(/^pdf-abc~[0-9a-f]{14}$/);
    expect(safeKnowledgeId("a_b.c~d-e f/g")).toMatch(/^a_b\.c~d-e-f-g~[0-9a-f]{14}$/);
    expect(["pdf:1", "document:1", "chat:1", "url:x", "n1", "memo:1"].map(sourceKindOf)).toEqual(["pdf", "document", "chat", "url", "note", "other"]);
    expect([undefined, "agent", "place", "method", "concept", "material"].map((t) => roleOfTopicType(t as never))).toEqual([null, "other", "other", "method", "concept", "material"]);
  });
});

describe("id の安全化", () => {
  it("安全な id はそのまま・同じ id なら毎回同じ・元が違えば違う・出来た id は IRI に入る文字だけ", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(safeKnowledgeId(uuid)).toBe(uuid);
    expect(safeKnowledgeId("a_b.c~d-e")).toBe("a_b.c~d-e");
    expect(safeKnowledgeId("url:https://a/b")).toBe(safeKnowledgeId("url:https://a/b"));
    expect(safeKnowledgeId("url:https://a/b")).not.toBe(safeKnowledgeId("url:https://a-b"));
    for (const raw of ["url:https://a/b", "日本語 id", "x".repeat(200) + ":", ""]) {
      expect(safeKnowledgeId(raw)).toMatch(/^[A-Za-z0-9._~-]+$/);
    }
    expect(safeKnowledgeId("x".repeat(200) + ":").length).toBe(64 + 1 + 14);
  });

  it("url: の資料が別の物なら 2 行に分かれ、知見の source_iri は sources.json の iri と一致する", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "c1", title: "知見 1", meta: meta({ kind: "claim", derivedFromNotes: ["url:https://a/b"] }) },
          { id: "c2", title: "知見 2", meta: meta({ kind: "claim", derivedFromNotes: ["url:https://a-b"] }) },
        ],
        { exportedAt: AT },
      ),
    );
    const sources = b.files["sources.json"];
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map((r) => r.iri)).size).toBe(2);
    const iris = new Set(sources.map((r) => r.iri));
    for (const c of b.files["claims.json"]) for (const i of c.source_iri) expect(iris.has(i)).toBe(true);
    expect(b.files["claims.json"][0].source_iri[0]).toBe(sources.find((r) => r.name === "url:https://a/b")!.iri);
  });

  it("安全化が要る id でも、知見・トピック・語・対応が同じ id で参照し合う", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "c:1", title: "知見", meta: meta({ kind: "claim", topicIds: ["t:1"] }) },
          { id: "t:1", title: "PbTe の 硬さ", meta: meta({ kind: "topic", topicType: "concept", derivedFromClaims: ["c:1"] }) },
        ],
        { exportedAt: AT },
      ),
    );
    const claimId = b.files["claims.json"][0].id;
    const topic = b.files["topics.json"][0];
    expect(topic.claim_iri).toEqual([b.files["claims.json"][0].iri]);
    expect(b.files["term_candidates.json"].map((r) => r.id)).toEqual([`${topic.id}.m`, `${topic.id}.p`]);
    expect(b.files["term_candidates.json"].every((r) => r.origin_id === topic.id && r.origin_iri === topic.iri)).toBe(true);
    expect(b.files["term_claims.json"].every((r) => r.claim_id === claimId)).toBe(true);
    expect(b.files["term_relations.json"][0]).toMatchObject({ from_term: `${topic.id}.m`, to_term: `${topic.id}.p` });
  });
});

describe("同じ id を 2 回出さない", () => {
  it("割れたトピックの .m と、id が t1.m のトピック自身の候補が重なったら 2 つ目は出さない", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "c1", title: "知見", meta: meta({ kind: "claim", topicIds: ["t1.m"] }) },
          { id: "t1", title: "PbTe の 硬さ", meta: meta({ kind: "topic", topicType: "concept" }) },
          { id: "t1.m", title: "パン生地", meta: meta({ kind: "topic", topicType: "concept" }) },
        ],
        { exportedAt: AT },
      ),
    );
    const ids = b.files["term_candidates.json"].map((r) => r.id);
    expect(ids).toEqual(["t1.m", "t1.p"]);
    expect(new Set(ids).size).toBe(ids.length);
    // t1.m は先に出た t1 の物。後の t1.m トピックの候補・対応は出ない
    expect(b.files["term_candidates.json"][0].name).toBe("PbTe");
    expect(b.files["term_claims.json"]).toEqual([]);
  });

  it("関係は 2 つの候補が揃って出たときだけ出す", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "a", title: "パン生地", meta: meta({ kind: "topic", topicType: "concept" }) },
          { id: "t1", title: "PbTe の 硬さ", meta: meta({ kind: "topic", topicType: "concept" }) },
          { id: "t1.m", title: "小麦", meta: meta({ kind: "topic", topicType: "concept" }) },
        ],
        { exportedAt: AT },
      ),
    );
    // t1 が先（id 順で t1 < t1.m）なので t1.m トピックの候補が落ちる。関係は t1 の 1 行
    expect(b.files["term_relations.json"]).toHaveLength(1);
    const dup = ok(
      buildKnowledgeBundle(
        [
          { id: "t1.m", title: "小麦", meta: meta({ kind: "topic", topicType: "concept" }) },
          { id: "t1", title: "PbTe の 硬さ", meta: meta({ kind: "topic", topicType: "concept" }) },
        ],
        { exportedAt: AT },
      ),
    );
    const cand = dup.files["term_candidates.json"].map((r) => r.id);
    expect(new Set(cand).size).toBe(cand.length);
    for (const r of dup.files["term_relations.json"]) {
      expect(cand).toContain(r.from_term);
      expect(cand).toContain(r.to_term);
    }
  });

  it("知見と同じ id になったトピックは出さず、その語・対応・関係も出さない", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "x", title: "知見", meta: meta({ kind: "claim", topicIds: ["x"] }) },
          { id: "x", title: "PbTe の 硬さ", meta: meta({ kind: "topic", topicType: "concept", derivedFromClaims: ["x"] }) },
        ],
        { exportedAt: AT },
      ),
    );
    expect(b.files["claims.json"]).toHaveLength(1);
    expect(b.files["topics.json"]).toEqual([]);
    expect(b.files["term_candidates.json"]).toEqual([]);
    expect(b.files["term_claims.json"]).toEqual([]);
    expect(b.files["term_relations.json"]).toEqual([]);
  });

  it("derivedFromClaims に同じ id が 2 回あっても claim_iri は 1 つ", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "c1", title: "知見", meta: meta({ kind: "claim" }) },
          { id: "t1", title: "発酵", meta: meta({ kind: "topic", derivedFromClaims: ["c1", "c1"] }) },
        ],
        { exportedAt: AT },
      ),
    );
    expect(b.files["topics.json"][0].claim_iri).toHaveLength(1);
  });

  it("行の並びは安全化した後の id の順", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "b", title: "B", meta: meta({ kind: "claim" }) },
          { id: "a:1", title: "A", meta: meta({ kind: "claim" }) },
          { id: "a", title: "A0", meta: meta({ kind: "claim" }) },
        ],
        { exportedAt: AT },
      ),
    );
    const ids = b.files["claims.json"].map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("束に渡されなかった知見・トピックへの参照", () => {
  it("ゴミ箱の知見（束に無い）を指す derivedFromClaims・topicIds は claim_iri にも term_claims にも出ない。束に無いトピックを指す topicIds は無視", () => {
    const b = ok(
      buildKnowledgeBundle(
        [
          { id: "c1", title: "知見", meta: meta({ kind: "claim", topicIds: ["t1", "gone-topic"] }) },
          { id: "t1", title: "発酵", meta: meta({ kind: "topic", derivedFromClaims: ["c1", "trashed"] }) },
        ],
        { exportedAt: AT },
      ),
    );
    expect(b.files["topics.json"][0].claim_iri).toEqual([`https://kumagallium.github.io/Graphium/claim/c1`]);
    expect(b.files["term_claims.json"].map((r) => r.claim_id)).toEqual(["c1"]);
    expect(JSON.stringify(b)).not.toContain("trashed");
    expect(JSON.stringify(b)).not.toContain("gone-topic");
  });
});

describe("基底の検査", () => {
  it("受け側が拒む文字を含む基底は error", () => {
    for (const ch of ['"', "<", ">", "{", "}", "|", "\\", "^", "`", "\u0001", "\u007f"]) {
      expect(buildKnowledgeBundle([], { exportedAt: AT, claimBaseIri: `https://x.test/a${ch}b/` })).toEqual({ error: "claim-base-iri-invalid" });
      expect(buildKnowledgeBundle([], { exportedAt: AT, sourceBaseIri: `https://x.test/a${ch}b/` })).toEqual({ error: "source-base-iri-invalid" });
      expect(buildKnowledgeBundle([], { exportedAt: AT, termBaseIri: `https://x.test/a${ch}b/` })).toEqual({ error: "term-base-iri-invalid" });
      expect(buildKnowledgeBundle([], { exportedAt: AT, noteUrlBase: `https://x.test/a${ch}b` })).toEqual({ error: "note-url-base-invalid" });
    }
  });
});

describe("AI との会話を出典に持つページ", () => {
  it("知見もトピックも束に入れず、資料の一覧にも出さない", () => {
    const src = "conversation:conv-claude-code-s1";
    const b = ok(buildKnowledgeBundle(
      [
        { id: "c9", title: "全粒粉は 2 割まで", meta: meta({ kind: "claim", derivedFromNotes: [src] }) },
        { id: "t9", title: "配合", meta: meta({ kind: "topic", topicType: "concept", derivedFromNotes: [src] }) },
        { id: "c8", title: "残る知見", meta: meta({ kind: "claim", derivedFromNotes: ["n1"] }) },
      ],
      { exportedAt: AT, claimBaseIri: "https://x.test/c", termBaseIri: "https://x.test/t#", sourceBaseIri: "https://x.test/s", noteUrlBase: "https://g.test/app" },
    ));
    const all = JSON.stringify(b.files);
    expect(all).toContain("残る知見");
    expect(all).not.toContain("全粒粉は 2 割まで");
    expect(all).not.toContain("conv-claude-code-s1");
  });
});
