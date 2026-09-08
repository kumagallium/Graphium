// 共有ノートの投影キャッシュのテスト。
//
// 検証の軸:
//   - 抽出が個人側と同じ関数を通っていること（ラベルは buildIndexEntry、
//     プロセスは buildProcessEntry の戻り値そのまま = P-1）
//   - 受け取った側で解決できない情報を持ち帰らないこと（crossNoteLinks / outgoingLinks）
//   - 差分投影（同じ hash はスキップ）と、消えた id の掃除
//   - 版が合わない控えは捨てること（再構築可能なキャッシュ）

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SHARED_PROJECTION_VERSION,
  __resetSharedProjectionForTest,
  buildReverseLinks,
  buildSharedProcessIndex,
  buildSharedPseudoIndex,
  countProjectedLabelNotes,
  countProjectedProcessNotes,
  createEmptySharedProjection,
  getSharedProjection,
  parseStoredProjection,
  projectSharedNote,
  pruneSharedProjection,
  recordSharedProjectionFromBody,
  subscribeSharedProjection,
  type SharedProjection,
} from "./shared-projection";
import { INDEX_SCHEMA_VERSION } from "../navigation/index-file";
import { PROCESS_INDEX_VERSION } from "../network-graph/process-index";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
  type: "text",
  text,
  styles,
});

const para = (id: string, content: any[]) => ({ id, type: "paragraph", content, children: [] });

const step = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [styled(title)],
  children,
});

const doc = (blocks: any[], title = "共有ノート"): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
  }) as any;

function sharedEntry(overrides: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id: "shared-1",
    type: "note",
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    hash: "sha256:aaa",
    prov: { derived_from: [] },
    extra: { title: "共有された手順" },
    ...overrides,
  };
}

/** 手順とラベルを持つノート */
function procedureDoc(): GraphiumDocument {
  const d = doc([
    step("s1", "焼成", [
      para("b1", [styled("前駆体粉末", { inlineMaterial: "material_m1" })]),
      para("b2", [styled("電気炉", { inlineTool: "tool_t1" })]),
      para("b3", [styled("焼成体", { inlineOutput: "output_o1" })]),
    ]),
  ]);
  d.pages[0].labels = { b1: "material" };
  return d;
}

const encode = (d: GraphiumDocument) => new TextEncoder().encode(JSON.stringify(d));

beforeEach(() => {
  __resetSharedProjectionForTest();
});

describe("projectSharedNote", () => {
  it("ラベル・インラインラベル・手順を取り出し、プロセスを投影する", () => {
    const projected = projectSharedNote(sharedEntry(), procedureDoc());

    expect(projected.hash).toBe("sha256:aaa");
    // extra.title を優先する（一覧の題名と揃える）
    expect(projected.title).toBe("共有された手順");
    expect(projected.author).toBe("Ada");
    expect(projected.labels.map((l) => l.label)).toContain("material");
    expect(projected.inlineLabels?.map((l) => l.text)).toEqual(
      expect.arrayContaining(["前駆体粉末", "電気炉", "焼成体"]),
    );
    expect(projected.steps?.map((s) => s.text)).toEqual(["焼成"]);
    expect(projected.process?.noteId).toBe("shared-1");
    // 鮮度の基準は共有エントリの更新時刻
    expect(projected.process?.sourceModifiedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(projected.process?.summary.stepCount).toBe(1);
  });

  it("crossNoteLinks は持ち帰らない（参照先が共有元のローカルノート id のため）", () => {
    const d = doc([step("s1", "観察")]);
    d.pages[0].provLinks = [
      {
        id: "link-1",
        sourceBlockId: "s1",
        targetBlockId: "source-step",
        type: "informed_by",
        layer: "prov",
        createdBy: "human",
        targetNoteId: "local-note-999",
        targetEntityId: "source-output",
        sourceEntityId: "current-input",
      },
    ] as any;

    const projected = projectSharedNote(sharedEntry(), d);
    expect(projected.process?.crossNoteLinks).toEqual([]);
  });

  it("手順を持たないノートは process が null", () => {
    const projected = projectSharedNote(sharedEntry(), doc([para("b1", [styled("ただのメモ")])]));
    expect(projected.process).toBeNull();
  });

  it("extra.title が無ければ本文のタイトルを使う", () => {
    const projected = projectSharedNote(sharedEntry({ extra: {} }), doc([], "本文タイトル"));
    expect(projected.title).toBe("本文タイトル");
  });
});

describe("recordSharedProjectionFromBody", () => {
  it("note 本文を読んだときに投影が載る", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true);
    expect(Object.keys(getSharedProjection().entries)).toEqual(["shared-1"]);
  });

  it("同じ hash なら投影し直さない（差分投影）", () => {
    const entry = sharedEntry();
    recordSharedProjectionFromBody(entry, encode(procedureDoc()), true);
    const first = getSharedProjection().entries["shared-1"];

    // 本文だけ差し替えても hash が同じなら読み直さない
    recordSharedProjectionFromBody(entry, encode(doc([step("s9", "別の手順")])), true);
    expect(getSharedProjection().entries["shared-1"]).toBe(first);

    // hash が変われば投影し直す
    recordSharedProjectionFromBody(
      sharedEntry({ hash: "sha256:bbb" }),
      encode(doc([step("s9", "別の手順")])),
      true,
    );
    expect(getSharedProjection().entries["shared-1"].steps?.[0].text).toBe("別の手順");
  });

  it("hash が合わない本文（verified=false）と note 以外は載せない", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), false);
    recordSharedProjectionFromBody(
      sharedEntry({ id: "shared-2", type: "knowledge" }),
      encode(procedureDoc()),
      true,
    );
    expect(getSharedProjection().entries).toEqual({});
  });

  it("壊れた本文は投影しない", () => {
    recordSharedProjectionFromBody(sharedEntry(), new TextEncoder().encode("{ not json"), true);
    expect(getSharedProjection().entries).toEqual({});
  });

  // 語彙索引レーンは同じ body を索引にも渡す。両方が別々にパースすると
  // 本文の大きいノートで JSON.parse が丸ごと 2 回走るので、渡された doc を使う
  it("パース済みの本文を渡されたら body を読み直さない", () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    // body はわざと壊す。パースし直していればここで投影が落ちる
    recordSharedProjectionFromBody(
      sharedEntry(),
      new TextEncoder().encode("{ not json"),
      true,
      procedureDoc(),
    );
    expect(parseSpy).not.toHaveBeenCalled();
    expect(getSharedProjection().entries["shared-1"].steps?.length).toBeGreaterThan(0);
    parseSpy.mockRestore();
  });

  it("パース済みが null（呼び出し側で壊れていた）なら投影しない", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true, null);
    expect(getSharedProjection().entries).toEqual({});
  });
});

describe("購読者への通知", () => {
  // 初回バックフィルでは共有ノートが 1 件ずつ投影される。1 件ごとに通知すると
  // Library のラベル / プロセスタブが逐次作り直されてちらつくので、通知は束ねる
  it("連続した投影をまとめて 1 回だけ通知する（中身は即座に最新）", () => {
    vi.useFakeTimers();
    try {
      const notified = vi.fn();
      const unsubscribe = subscribeSharedProjection(notified);
      recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true);
      recordSharedProjectionFromBody(
        sharedEntry({ id: "shared-2", hash: "sha256:ccc" }),
        encode(procedureDoc()),
        true,
      );

      // 通知はまだ出ていない。それでも読む側は最新のスナップショットを取れる
      expect(notified).not.toHaveBeenCalled();
      expect(Object.keys(getSharedProjection().entries)).toEqual(["shared-1", "shared-2"]);

      vi.advanceTimersByTime(500);
      expect(notified).toHaveBeenCalledTimes(1);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pruneSharedProjection", () => {
  it("共有から消えた id の投影を落とす", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true);
    recordSharedProjectionFromBody(
      sharedEntry({ id: "shared-2", hash: "sha256:ccc" }),
      encode(procedureDoc()),
      true,
    );

    pruneSharedProjection(["shared-2"]);
    expect(Object.keys(getSharedProjection().entries)).toEqual(["shared-2"]);
  });

  it("消える id が無ければスナップショットを差し替えない", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true);
    const before = getSharedProjection();
    pruneSharedProjection(["shared-1"]);
    expect(getSharedProjection()).toBe(before);
  });
});

describe("buildSharedPseudoIndex", () => {
  it("noteId = sharedId、outgoingLinks は空、source は human", () => {
    const entry = sharedEntry();
    recordSharedProjectionFromBody(entry, encode(procedureDoc()), true);

    const index = buildSharedPseudoIndex(getSharedProjection(), [entry]);
    expect(index.version).toBe(INDEX_SCHEMA_VERSION);
    expect(index.notes).toHaveLength(1);
    expect(index.notes[0].noteId).toBe("shared-1");
    expect(index.notes[0].outgoingLinks).toEqual([]);
    expect(index.notes[0].source).toBe("human");
    expect(index.notes[0].author).toBe("Ada");
    expect(index.notes[0].modifiedAt).toBe("2026-08-20T00:00:00.000Z");
  });

  it("投影がまだ無いエントリと note 以外は並べない", () => {
    const known = sharedEntry();
    recordSharedProjectionFromBody(known, encode(procedureDoc()), true);
    const index = buildSharedPseudoIndex(getSharedProjection(), [
      known,
      sharedEntry({ id: "unread" }),
      sharedEntry({ id: "shared-k", type: "knowledge" }),
    ]);
    expect(index.notes.map((n) => n.noteId)).toEqual(["shared-1"]);
  });
});

describe("buildSharedProcessIndex", () => {
  it("手順を持つ投影だけを並べる", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true);
    recordSharedProjectionFromBody(
      sharedEntry({ id: "memo", hash: "sha256:ddd" }),
      encode(doc([para("b1", [styled("ただのメモ")])])),
      true,
    );

    const index = buildSharedProcessIndex(getSharedProjection());
    expect(index.version).toBe(PROCESS_INDEX_VERSION);
    expect(index.processes.map((p) => p.noteId)).toEqual(["shared-1"]);
  });
});

describe("件数バッジ", () => {
  it("ラベルを持つ数・手順を持つ数を数える", () => {
    recordSharedProjectionFromBody(sharedEntry(), encode(procedureDoc()), true);
    recordSharedProjectionFromBody(
      sharedEntry({ id: "memo", hash: "sha256:ddd" }),
      encode(doc([para("b1", [styled("ただのメモ")])])),
      true,
    );

    const projection = getSharedProjection();
    const ids = ["shared-1", "memo"];
    expect(countProjectedLabelNotes(projection, ids)).toBe(1);
    expect(countProjectedProcessNotes(projection, ids)).toBe(1);
  });
});

describe("parseStoredProjection", () => {
  const stored = (over: Partial<SharedProjection> = {}): unknown => ({
    ...createEmptySharedProjection(),
    entries: { "shared-1": { hash: "sha256:aaa", title: "t", updatedAt: "", createdAt: "", author: "", headings: [], labels: [], process: null } },
    ...over,
  });

  it("版が揃っていれば受け入れる", () => {
    const parsed = parseStoredProjection(stored());
    expect(parsed?.version).toBe(SHARED_PROJECTION_VERSION);
    expect(Object.keys(parsed!.entries)).toEqual(["shared-1"]);
  });

  it("ファイルの版が違えば捨てる", () => {
    expect(parseStoredProjection(stored({ version: SHARED_PROJECTION_VERSION + 1 }))).toBeNull();
  });

  it("抽出ロジックの版が違えば捨てる（全再投影）", () => {
    expect(
      parseStoredProjection(
        stored({ logic: { index: INDEX_SCHEMA_VERSION - 1, process: PROCESS_INDEX_VERSION } }),
      ),
    ).toBeNull();
    expect(
      parseStoredProjection(
        stored({ logic: { index: INDEX_SCHEMA_VERSION, process: PROCESS_INDEX_VERSION + 1 } }),
      ),
    ).toBeNull();
  });

  it("hash を持たないエントリは採らない（差分投影の判定に使えない）", () => {
    const parsed = parseStoredProjection(stored({ entries: { bad: {} as any } }));
    expect(parsed?.entries).toEqual({});
  });

  it("null / 非オブジェクトは捨てる", () => {
    expect(parseStoredProjection(null)).toBeNull();
    expect(parseStoredProjection("x")).toBeNull();
  });
});

describe("投影 v2（逆引きのもと）", () => {
  const citation = (id: string, sharedId: string) => ({
    id,
    type: "sharedCitation",
    props: { sharedId },
    children: [],
  });

  it("本文の共有引用・fork 元・テンプレート元を投影に持ち帰る", () => {
    const d = doc([para("b1", [styled("本文")]), citation("c1", "src-1"), citation("c2", "src-2")]);
    d.forkedFrom = {
      sharedId: "origin-1",
      hash: "sha256:o",
      authorName: "Ada",
      authorEmail: "a@b.co",
      forkedAt: "2026-08-01T00:00:00.000Z",
    };
    d.templateFrom = {
      sharedId: "tmpl-1",
      hash: "sha256:t",
      title: "実験テンプレート",
      usedAt: "2026-08-01T00:00:00.000Z",
    };
    const projected = projectSharedNote(sharedEntry(), d);
    expect(projected.citedSharedIds.sort()).toEqual(["src-1", "src-2"]);
    expect(projected.forkedFromSharedId).toBe("origin-1");
    expect(projected.templateFromSharedId).toBe("tmpl-1");
  });

  it("引用も派生も無ければ配列は空・任意フィールドは付けない", () => {
    const projected = projectSharedNote(sharedEntry(), doc([para("b1", [styled("本文")])]));
    expect(projected.citedSharedIds).toEqual([]);
    expect(projected).not.toHaveProperty("forkedFromSharedId");
    expect(projected).not.toHaveProperty("templateFromSharedId");
  });

  it("buildReverseLinks: 引用・派生・テンプレートを対象 id ごとに束ねる", () => {
    const projection: SharedProjection = {
      version: SHARED_PROJECTION_VERSION,
      logic: { index: INDEX_SCHEMA_VERSION, process: PROCESS_INDEX_VERSION },
      updatedAt: "2026-09-01T00:00:00.000Z",
      entries: {
        a: { citedSharedIds: ["target"], forkedFromSharedId: "target" } as any,
        b: { citedSharedIds: ["target", "other"] } as any,
        c: { citedSharedIds: [], templateFromSharedId: "tmpl" } as any,
        // 自分自身への参照は逆引きに出さない
        d: { citedSharedIds: ["d"], forkedFromSharedId: "d" } as any,
        // 壊れた控え（配列が無い）でも落ちない
        e: {} as any,
      },
    };
    const links = buildReverseLinks(projection);
    expect(links.get("target")).toEqual({ cites: ["a", "b"], forks: ["a"], templates: [] });
    expect(links.get("other")).toEqual({ cites: ["b"], forks: [], templates: [] });
    expect(links.get("tmpl")).toEqual({ cites: [], forks: [], templates: ["c"] });
    expect(links.get("d")).toBeUndefined();
  });

  it("控えに citedSharedIds が無くても空配列で読める", () => {
    const parsed = parseStoredProjection({
      version: SHARED_PROJECTION_VERSION,
      logic: { index: INDEX_SCHEMA_VERSION, process: PROCESS_INDEX_VERSION },
      updatedAt: "2026-09-01T00:00:00.000Z",
      entries: { a: { hash: "sha256:a" } },
    });
    expect(parsed?.entries.a.citedSharedIds).toEqual([]);
  });
});
