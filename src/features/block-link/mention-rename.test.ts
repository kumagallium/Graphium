import { describe, it, expect, vi } from "vitest";
import {
  buildMentionPatterns,
  replaceMentionRunsInContent,
  rewriteMentionRunsForBlock,
  applyMentionRenameToDoc,
  applyMentionRenameToLiveEditor,
  createLiveMentionRenameQueue,
  type PendingMentionRename,
} from "./mention-rename";
import type { GraphiumDocument } from "../../lib/document-types";

const blueMention = (label: string) => ({
  type: "text",
  text: `@${label}`,
  styles: { textColor: "blue" },
});
const plainText = (text: string) => ({ type: "text", text, styles: {} });
const pat = (oldTitle: string, newTitle: string) => buildMentionPatterns(oldTitle, newTitle);

describe("buildMentionPatterns", () => {
  it("通常ノートは @旧 → @新 の 1 パターン", () => {
    expect(buildMentionPatterns("旧", "新")).toEqual([{ from: "@旧", to: "@新", prefix: "@" }]);
  });

  it("wiki は装飾付きラベル（Summary / Concept / Topic）も含む 4 パターン", () => {
    const patterns = buildMentionPatterns("旧", "新", { includeWikiLabels: true });
    expect(patterns).toEqual([
      { from: "@旧", to: "@新", prefix: "@" },
      { from: "@🤖 Summary: 旧", to: "@🤖 Summary: 新", prefix: "@🤖 Summary: " },
      { from: "@🤖 Concept: 旧", to: "@🤖 Concept: 新", prefix: "@🤖 Concept: " },
      { from: "@🤖 Topic: 旧", to: "@🤖 Topic: 新", prefix: "@🤖 Topic: " },
    ]);
  });
});

describe("rewriteMentionRunsForBlock（一意フォールバック）", () => {
  it("完全一致しない旧世代ラベルでも、候補 run が 1 個なら新ラベルへ修復する", () => {
    const content = [plainText("出典: "), blueMention("2世代前のラベル")];
    const result = rewriteMentionRunsForBlock(content, pat("現タイトル", "新タイトル"), {
      uniqueFallback: true,
    });
    expect(result).not.toBeNull();
    expect(result![1].text).toBe("@新タイトル");
    expect(result![0].text).toBe("出典: ");
  });

  it("装飾付きの旧世代ラベルは装飾（prefix）を保って修復する", () => {
    const content = [blueMention("🤖 Concept: 大昔のタイトル")];
    const result = rewriteMentionRunsForBlock(
      content,
      buildMentionPatterns("現タイトル", "新タイトル", { includeWikiLabels: true }),
      { uniqueFallback: true },
    );
    expect(result).not.toBeNull();
    expect(result![0].text).toBe("@🤖 Concept: 新タイトル");
  });

  it("青い @run が複数あるブロックでは発動しない", () => {
    const content = [blueMention("ラベルA"), plainText(" "), blueMention("ラベルB")];
    expect(
      rewriteMentionRunsForBlock(content, pat("現", "新"), { uniqueFallback: true }),
    ).toBeNull();
  });

  it("uniqueFallback が偽なら完全一致のみ（従来挙動）", () => {
    const content = [blueMention("旧世代")];
    expect(rewriteMentionRunsForBlock(content, pat("現", "新"))).toBeNull();
  });

  it("既に新ラベルなら変更なし", () => {
    const content = [blueMention("新タイトル")];
    expect(
      rewriteMentionRunsForBlock(content, pat("現", "新タイトル"), { uniqueFallback: true }),
    ).toBeNull();
  });
});

describe("replaceMentionRunsInContent", () => {
  it("青文字の完全一致メンションだけを置換する", () => {
    const content = [
      plainText("前置き "),
      blueMention("旧タイトル"),
      plainText(" 後置き"),
    ];
    const result = replaceMentionRunsInContent(content, pat("旧タイトル", "新タイトル"));
    expect(result).not.toBeNull();
    expect(result![1].text).toBe("@新タイトル");
    expect(result![1].styles?.textColor).toBe("blue");
    expect(result![0].text).toBe("前置き ");
    expect(result![2].text).toBe(" 後置き");
  });

  it("wiki の装飾付きラベルを kind を保って置換する", () => {
    const content = [
      blueMention("🤖 Concept: 旧タイトル"),
      plainText(" と "),
      blueMention("🤖 Summary: 旧タイトル"),
    ];
    const result = replaceMentionRunsInContent(
      content,
      buildMentionPatterns("旧タイトル", "新タイトル", { includeWikiLabels: true }),
    );
    expect(result).not.toBeNull();
    expect(result![0].text).toBe("@🤖 Concept: 新タイトル");
    expect(result![2].text).toBe("@🤖 Summary: 新タイトル");
  });

  it("青文字でないテキストは同じ文字列でも置換しない", () => {
    const content = [plainText("@旧タイトル")];
    expect(replaceMentionRunsInContent(content, pat("旧タイトル", "新"))).toBeNull();
  });

  it("部分一致（文中に @旧タイトル を含む run）は置換しない", () => {
    const content = [
      { type: "text", text: "これは @旧タイトル を含む文", styles: { textColor: "blue" } },
    ];
    expect(replaceMentionRunsInContent(content, pat("旧タイトル", "新"))).toBeNull();
  });

  it("link run の内側コンテンツにも再帰する", () => {
    const content = [
      {
        type: "link",
        href: "https://example.com/Graphium/app/#note/abc",
        content: [blueMention("旧タイトル")],
      },
    ];
    const result = replaceMentionRunsInContent(content, pat("旧タイトル", "新タイトル"));
    expect(result).not.toBeNull();
    expect((result![0] as any).content[0].text).toBe("@新タイトル");
  });

  it("配列でない content（table 等）は null", () => {
    expect(replaceMentionRunsInContent({ type: "tableContent" }, pat("a", "b"))).toBeNull();
    expect(replaceMentionRunsInContent(undefined, pat("a", "b"))).toBeNull();
  });
});

const makeDoc = (blocks: any[], knowledgeLinks: any[] = [], provLinks: any[] = []): GraphiumDocument =>
  ({
    version: 5,
    title: "参照元ノート",
    pages: [
      {
        id: "main",
        title: "参照元ノート",
        blocks,
        labels: {},
        provLinks,
        knowledgeLinks,
      },
    ],
    createdAt: "2026-07-01T00:00:00.000Z",
    modifiedAt: "2026-07-01T00:00:00.000Z",
  }) as GraphiumDocument;

const refLink = (sourceBlockId: string, targetNoteId: string) => ({
  id: `link-${sourceBlockId}-${targetNoteId}`,
  sourceBlockId,
  targetBlockId: "",
  type: "reference",
  layer: "knowledge",
  createdBy: "human",
  targetNoteId,
});

const para = (id: string, content: any[]) => ({
  id,
  type: "paragraph",
  props: {},
  content,
  children: [],
});

describe("applyMentionRenameToDoc", () => {
  it("リンクレコードで特定したブロックのメンションを書き換える", () => {
    const doc = makeDoc(
      [
        para("b1", [blueMention("旧B"), plainText(" 説明")]),
        // リンクレコードの無いブロックは同じ見た目でも触らない
        para("b2", [blueMention("旧B")]),
      ],
      [refLink("b1", "note-B")],
    );
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.changedBlockIds).toEqual(["b1"]);
    const blocks = result!.doc.pages[0].blocks;
    expect(blocks[0].content[0].text).toBe("@新B");
    expect(blocks[1].content[0].text).toBe("@旧B");
    expect(result!.doc.modifiedAt).not.toBe(doc.modifiedAt);
  });

  it("includeWikiLabels 指定で wiki の装飾付きメンションも書き換える", () => {
    const doc = makeDoc(
      [
        para("b1", [
          blueMention("🤖 Concept: 旧W"),
          plainText(" と引用 "),
          blueMention("旧W"),
        ]),
      ],
      [refLink("b1", "wiki-W")],
    );
    const result = applyMentionRenameToDoc(doc, "wiki-W", "旧W", "新W", () => undefined, {
      includeWikiLabels: true,
    });
    expect(result).not.toBeNull();
    const content = result!.doc.pages[0].blocks[0].content;
    expect(content[0].text).toBe("@🤖 Concept: 新W");
    expect(content[2].text).toBe("@新W");
  });

  it("同名曖昧ガード: 同ブロックに現タイトルが同じ別ノート参照があれば触らない", () => {
    const doc = makeDoc(
      [para("b1", [blueMention("同名"), plainText(" と "), blueMention("同名")])],
      [refLink("b1", "note-B"), refLink("b1", "note-C")],
    );
    // note-C の現在のタイトルも「同名」→ どの run がどちらか判別不能
    const result = applyMentionRenameToDoc(doc, "note-B", "同名", "新B", (id) =>
      id === "note-C" ? "同名" : undefined,
    );
    expect(result).toBeNull();
  });

  it("同ブロックの別ノート参照でも現タイトルが異なればガードしない", () => {
    const doc = makeDoc(
      [para("b1", [blueMention("旧B"), plainText(" と "), blueMention("別ノート")])],
      [refLink("b1", "note-B"), refLink("b1", "note-C")],
    );
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", (id) =>
      id === "note-C" ? "別ノート" : undefined,
    );
    expect(result).not.toBeNull();
    const content = result!.doc.pages[0].blocks[0].content;
    expect(content[0].text).toBe("@新B");
    expect(content[2].text).toBe("@別ノート");
  });

  it("children 内のブロックにも再帰する", () => {
    const doc = makeDoc(
      [
        {
          ...para("parent", [plainText("親")]),
          children: [para("child", [blueMention("旧B")])],
        },
      ],
      [refLink("child", "note-B")],
    );
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.changedBlockIds).toEqual(["child"]);
    expect(result!.doc.pages[0].blocks[0].children[0].content[0].text).toBe("@新B");
  });

  it("v1 互換の links フィールドも参照する", () => {
    const doc = makeDoc([para("b1", [blueMention("旧B")])]);
    (doc.pages[0] as any).links = [refLink("b1", "note-B")];
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.doc.pages[0].blocks[0].content[0].text).toBe("@新B");
  });

  it("対象リンクが無ければ null", () => {
    const doc = makeDoc([para("b1", [blueMention("旧B")])], [refLink("b1", "note-X")]);
    expect(applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined)).toBeNull();
  });

  it("テキスト不一致でも参照が対象宛てのみなら一意フォールバックで修復する", () => {
    // skip 等でラベルが旧世代のまま取り残されたケース。ブロックの参照リンクが
    // リネーム対象宛てのみ + 青い @run が 1 個なら一意に特定できるので書き換える。
    const doc = makeDoc([para("b1", [blueMention("取り残された旧ラベル")])], [refLink("b1", "note-B")]);
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.doc.pages[0].blocks[0].content[0].text).toBe("@新B");
  });

  it("別ノート宛てリンクが同居するブロックでは一意フォールバックは発動しない", () => {
    const doc = makeDoc(
      [para("b1", [blueMention("取り残された旧ラベル"), plainText(" と "), blueMention("別ノート")])],
      [refLink("b1", "note-B"), refLink("b1", "note-C")],
    );
    expect(
      applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", (id) =>
        id === "note-C" ? "別ノート" : undefined,
      ),
    ).toBeNull();
  });

  it("タイトルが同一・空のときは null", () => {
    const doc = makeDoc([para("b1", [blueMention("旧B")])], [refLink("b1", "note-B")]);
    expect(applyMentionRenameToDoc(doc, "note-B", "旧B", "旧B", () => undefined)).toBeNull();
    expect(applyMentionRenameToDoc(doc, "note-B", "", "新B", () => undefined)).toBeNull();
  });
});

// ── applyMentionRenameToLiveEditor（mention-live: 開いているエディタの中で直す） ──

/** getBlock/updateBlock だけを持つ最小限の偽エディタ。BlockNote の editorRef.current 相当 */
function fakeLiveEditor(blocks: Record<string, { id: string; content: unknown }>) {
  const store = new Map(Object.entries(blocks));
  return {
    getBlock: vi.fn((id: string) => store.get(id)),
    updateBlock: vi.fn((block: { id: string }, update: { content: unknown }) => {
      store.set(block.id, { id: block.id, content: update.content });
    }),
    store,
  };
}

describe("applyMentionRenameToLiveEditor", () => {
  it("リンクの対象ブロックのラベルを書き換え、true を返す", () => {
    const editor = fakeLiveEditor({ b1: { id: "b1", content: [blueMention("旧B"), plainText(" 説明")] } });
    const changed = applyMentionRenameToLiveEditor(
      editor,
      [refLink("b1", "note-B")],
      () => undefined,
      "note-B",
      "旧B",
      "新B",
    );
    expect(changed).toBe(true);
    expect(editor.updateBlock).toHaveBeenCalledTimes(1);
    expect((editor.store.get("b1")!.content as any[])[0].text).toBe("@新B");
  });

  it("対象ラベルが見つからなければ false（呼び出し側がファイルを書き換える判定用）", () => {
    const editor = fakeLiveEditor({ b1: { id: "b1", content: [plainText("関係ない本文")] } });
    // リンクレコードが無い = 対象ブロックが特定できない
    expect(
      applyMentionRenameToLiveEditor(editor, [], () => undefined, "note-B", "旧B", "新B"),
    ).toBe(false);
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });

  it("ブロックがまだ読み込まれていない（getBlock が undefined を返す）なら false", () => {
    const editor = fakeLiveEditor({});
    expect(
      applyMentionRenameToLiveEditor(
        editor,
        [refLink("b1", "note-B")],
        () => undefined,
        "note-B",
        "旧B",
        "新B",
      ),
    ).toBe(false);
  });

  it("同名曖昧ガード: 同ブロックに現タイトルが同じ別ノート参照があれば触らず false", () => {
    const editor = fakeLiveEditor({
      b1: { id: "b1", content: [blueMention("同名"), plainText(" と "), blueMention("同名")] },
    });
    const changed = applyMentionRenameToLiveEditor(
      editor,
      [refLink("b1", "note-B"), refLink("b1", "note-C")],
      (id) => (id === "note-C" ? "同名" : undefined),
      "note-B",
      "同名",
      "新B",
    );
    expect(changed).toBe(false);
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });

  it("複数ブロックに渡る場合、書き換えたブロックが 1 つでもあれば true", () => {
    const editor = fakeLiveEditor({
      b1: { id: "b1", content: [blueMention("旧B")] },
      b2: { id: "b2", content: [plainText("無関係")] },
    });
    const changed = applyMentionRenameToLiveEditor(
      editor,
      [refLink("b1", "note-B")],
      () => undefined,
      "note-B",
      "旧B",
      "新B",
    );
    expect(changed).toBe(true);
    expect((editor.store.get("b1")!.content as any[])[0].text).toBe("@新B");
    expect(editor.store.get("b2")!.content).toEqual([plainText("無関係")]);
  });

  it("旧タイトルが空・新旧同一なら false（書き換えない）", () => {
    const editor = fakeLiveEditor({ b1: { id: "b1", content: [blueMention("旧B")] } });
    expect(
      applyMentionRenameToLiveEditor(editor, [refLink("b1", "note-B")], () => undefined, "note-B", "", "新B"),
    ).toBe(false);
    expect(
      applyMentionRenameToLiveEditor(
        editor,
        [refLink("b1", "note-B")],
        () => undefined,
        "note-B",
        "同じ",
        "同じ",
      ),
    ).toBe(false);
  });
});

// ── createLiveMentionRenameQueue（mention-live: 準備待ちの改名を覚えて後で当てる） ──

const rename = (renamedNoteId: string, oldTitle: string, newTitle: string): PendingMentionRename => ({
  renamedNoteId,
  oldTitle,
  newTitle,
  includeWikiLabels: false,
});

describe("createLiveMentionRenameQueue", () => {
  it("準備前に呼ぶ → false を返し、apply に触らない（改名は覚えるだけ）", () => {
    const queue = createLiveMentionRenameQueue();
    const apply = vi.fn(() => true);
    const result = queue.applyOrDefer(false, apply, "note-B", "旧B", "新B", false);
    expect(result).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("準備後に呼ぶ → 今までどおり apply をその場で呼び、その結果を返す", () => {
    const queue = createLiveMentionRenameQueue();
    const apply = vi.fn(() => true);
    const result = queue.applyOrDefer(true, apply, "note-B", "旧B", "新B", false);
    expect(result).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(rename("note-B", "旧B", "新B"));
  });

  it("準備前に届いた改名は、準備ができた時点で flushPending が届いた順に当てる", () => {
    const queue = createLiveMentionRenameQueue();
    const applied: PendingMentionRename[] = [];
    const deferApply = vi.fn(() => true);
    queue.applyOrDefer(false, deferApply, "note-A", "旧A", "新A", false);
    queue.applyOrDefer(false, deferApply, "note-B", "旧B", "新B", false);
    expect(deferApply).not.toHaveBeenCalled();

    queue.flushPending((r) => {
      applied.push(r);
      return true;
    });
    expect(applied).toEqual([rename("note-A", "旧A", "新A"), rename("note-B", "旧B", "新B")]);
  });

  it("同じ対象に 2 回続けて改名（A→B、B→C）が準備前に届いた → 準備後は C になる", () => {
    const queue = createLiveMentionRenameQueue();
    // A→B を当てた本文（"@B"）に B→C を届いた順に当てるだけで自然に畳み込まれる想定。
    // ここでは「当てる」呼び出し自体が届いた順であることだけを確認する
    let label = "@A";
    queue.applyOrDefer(false, () => true, "note-X", "A", "B", false);
    queue.applyOrDefer(false, () => true, "note-X", "B", "C", false);
    queue.flushPending((r) => {
      if (label === `@${r.oldTitle}`) label = `@${r.newTitle}`;
      return true;
    });
    expect(label).toBe("@C");
  });

  it("覚えている改名が無ければ flushPending は何もしない", () => {
    const queue = createLiveMentionRenameQueue();
    const apply = vi.fn(() => true);
    queue.flushPending(apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("dispose したあとは flushPending しても当てない（閉じたピークの改名は捨てる）", () => {
    const queue = createLiveMentionRenameQueue();
    queue.applyOrDefer(false, () => true, "note-B", "旧B", "新B", false);
    queue.dispose();
    const apply = vi.fn(() => true);
    queue.flushPending(apply);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("表のセルの @メンション（tableContent）", () => {
  const cell = (runs: unknown[]) => ({ type: "tableCell", content: runs, props: {} });
  const RENAMED = "note-b";
  const tableBlock = () => ({
    id: "t1",
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell([plainText("対象")]), cell([plainText("入力元")])] },
        {
          cells: [
            cell([{ type: "text", text: "@旧", styles: { textColor: "blue", tableRowIdentity: "row_a" } }]),
            cell([]),
          ],
        },
        { cells: [cell([plainText("S-02")]), cell([plainText("旧")])] },
      ],
    },
    children: [],
  });
  const docWithTable = (): GraphiumDocument =>
    ({
      version: 6,
      title: "計画",
      pages: [
        {
          id: "main",
          title: "計画",
          blocks: [tableBlock()],
          labels: {},
          provLinks: [],
          knowledgeLinks: [
            { id: "k1", sourceBlockId: "t1", targetBlockId: "", type: "reference", layer: "knowledge", createdBy: "human", targetNoteId: RENAMED },
          ],
          tableMeta: {
            t1: {
              columns: { 対象: ["note-link"], 入力元: ["planned-input"] },
              noteLinks: { "@旧": RENAMED, "S-02": "note-c" },
              edgeLabels: { "s-02": { 旧: "生地" } },
            },
          },
        },
      ],
      createdAt: "",
      modifiedAt: "",
    }) as unknown as GraphiumDocument;

  it("ファイル直書き: セルのラベル・noteLinks のキー・入力元・線の名前が追従する", () => {
    const result = applyMentionRenameToDoc(docWithTable(), RENAMED, "旧", "新", () => undefined);
    expect(result).not.toBeNull();
    const page = result!.doc.pages[0];
    const rows = (page.blocks[0] as any).content.rows;
    expect(rows[1].cells[0].content[0]).toEqual({
      type: "text",
      text: "@新",
      styles: { textColor: "blue", tableRowIdentity: "row_a" },
    });
    expect(rows[2].cells[1].content[0].text).toBe("新");
    expect(page.tableMeta!.t1.noteLinks).toEqual({ "@新": RENAMED, "S-02": "note-c" });
    expect(page.tableMeta!.t1.edgeLabels).toEqual({ "s-02": { 新: "生地" } });
  });

  it("修正前に取り残された旧世代のラベル（セルもキーも 2 世代前）も、次の改名で揃う", () => {
    const doc = docWithTable();
    const page = doc.pages[0] as any;
    page.blocks[0].content.rows[1].cells[0].content[0].text = "@新しいノート";
    page.blocks[0].content.rows[2].cells[1].content[0].text = "新しいノート";
    page.tableMeta.t1.noteLinks = { "@新しいノート": RENAMED, "S-02": "note-c" };
    // 今のタイトルは「実験」。それを「一次発酵」へ改名する
    const result = applyMentionRenameToDoc(doc, RENAMED, "実験", "一次発酵", () => undefined);
    const next = result!.doc.pages[0] as any;
    expect(next.blocks[0].content.rows[1].cells[0].content[0].text).toBe("@一次発酵");
    expect(next.blocks[0].content.rows[2].cells[1].content[0].text).toBe("一次発酵");
    expect(next.tableMeta.t1.noteLinks).toEqual({ "@一次発酵": RENAMED, "S-02": "note-c" });
  });

  it("別ノート宛ての noteLinks（同じ文字でもノート ID が違う）は付け替えない", () => {
    const doc = docWithTable();
    doc.pages[0].tableMeta!.t1.noteLinks = { "@旧": "note-other" };
    const result = applyMentionRenameToDoc(doc, RENAMED, "旧", "新", () => undefined);
    expect(result!.doc.pages[0].tableMeta!.t1.noteLinks).toEqual({ "@旧": "note-other" });
    // 行名が変わっていないので入力元もそのまま
    expect((result!.doc.pages[0].blocks[0] as any).content.rows[2].cells[1].content[0].text).toBe("旧");
  });

  it("開いているエディタ: 表ブロックを書き換え、表の注釈をストアへ書く", () => {
    const blocks = new Map<string, any>([["t1", tableBlock()]]);
    const metas: Record<string, any> = JSON.parse(JSON.stringify(docWithTable().pages[0].tableMeta));
    const editor = {
      getBlock: (id: string) => blocks.get(id),
      updateBlock: (b: { id: string }, u: { content: unknown }) => {
        blocks.set(b.id, { ...blocks.get(b.id), content: u.content });
      },
      get document() {
        return [...blocks.values()];
      },
    };
    const replaceMeta = vi.fn((id: string, meta: any) => {
      metas[id] = meta;
    });
    const changed = applyMentionRenameToLiveEditor(
      editor,
      [{ sourceBlockId: "t1", targetNoteId: RENAMED }],
      () => undefined,
      RENAMED,
      "旧",
      "新",
      { tableMeta: { getSnapshot: () => metas, replaceMeta } },
    );
    expect(changed).toBe(true);
    const rows = blocks.get("t1").content.rows;
    expect(rows[1].cells[0].content[0].text).toBe("@新");
    expect(rows[2].cells[1].content[0].text).toBe("新");
    expect(metas.t1.noteLinks).toEqual({ "@新": RENAMED, "S-02": "note-c" });
  });
});
