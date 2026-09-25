// @vitest-environment jsdom
// @メンションのクリック先の解決と振り分け（メインエディタ・サイドピーク共通）の回帰ガード
import { describe, expect, it, vi } from "vitest";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumIndex } from "../navigation/index-file";
import {
  assetIdsForName,
  openPeekTarget,
  readMentionAt,
  resolveMentionClickTarget,
} from "./mention-click";

const noteEntry = (noteId: string, title: string, source?: "ai") =>
  ({ noteId, title, source, modifiedAt: "t", createdAt: "t", headings: [], labels: [], outgoingLinks: [] }) as any;
const noteIndex = {
  version: 1,
  updatedAt: "t",
  notes: [noteEntry("n1", "Index Note"), noteEntry("w1", "焼成の知見", "ai")],
} as unknown as GraphiumIndex;

const asset = (fileId: string, name: string, type: MediaIndexEntry["type"]): MediaIndexEntry => ({
  fileId,
  name,
  type,
  mimeType: "text/plain",
  url: `media-server://${fileId}`,
  thumbnailUrl: "",
  uploadedAt: "t",
  usedIn: [],
});
const media = [
  asset("f1", "spectrum.txt", "data"),
  asset("f2", "data.txt", "data"),
  asset("f3", "data.txt", "data"),
  asset("p1", "論文.pdf", "pdf"),
  asset("i1", "写真.jpg", "image"),
  asset("v1", "clip.mp4", "video"),
];
const mediaIndex = { version: 9, updatedAt: "t", media } as MediaIndex;

const ref = (sourceBlockId: string, targetNoteId: string, sourceRowIdentity?: string) => ({
  sourceBlockId,
  targetNoteId,
  type: "reference",
  ...(sourceRowIdentity ? { sourceRowIdentity } : {}),
});

describe("resolveMentionClickTarget", () => {
  const base = { blockId: "b1", inTableCell: false, rowIdentity: null, links: [], noteIndex, media };

  describe("表の行に紐づけたリンク", () => {
    // 試料ごとの data.txt（同名の別ファイル）を、同じ表の行ごとに @ で並べた状態
    const rowLinks = [ref("tbl", "data:f2", "row_1"), ref("tbl", "data:f3", "row_2")];
    const cell = { ...base, blockId: "tbl", inTableCell: true, mentionText: "data.txt", links: rowLinks };

    it("同じ表に同じラベルが並んでも、押した行のリンクの素材を開く", () => {
      expect(resolveMentionClickTarget({ ...cell, rowIdentity: "row_1" })).toBe("data:f2");
      expect(resolveMentionClickTarget({ ...cell, rowIdentity: "row_2" })).toBe("data:f3");
    });

    it("別の行に紐づいたリンクは使わない（その行に記録が無ければ名前の逆引きへ）", () => {
      // row_3 には記録が無い。row_1 のリンク（f2）ではなく、引用素材の f3 が選ばれる
      expect(
        resolveMentionClickTarget({ ...cell, rowIdentity: "row_3", citedAssetFileIds: ["f3"] }),
      ).toBe("data:f3");
    });

    it("行の記録が無い旧いリンクは、どの行からも従来どおり使う", () => {
      const legacy = [ref("tbl", "data:f3")];
      expect(resolveMentionClickTarget({ ...cell, rowIdentity: "row_1", links: legacy })).toBe("data:f3");
    });

    it("その行のリンクを旧いリンクより先に見る", () => {
      const mixed = [ref("tbl", "data:f3"), ref("tbl", "data:f2", "row_1")];
      expect(resolveMentionClickTarget({ ...cell, rowIdentity: "row_1", links: mixed })).toBe("data:f2");
    });
  });

  it("段落の @素材 は記録したリンクの外部ソース ID に解決する", () => {
    const id = resolveMentionClickTarget({
      ...base,
      mentionText: "spectrum.txt",
      links: [ref("b1", "data:f1")],
    });
    expect(id).toBe("data:f1");
  });

  it("表の中の @素材 は、同じ表ブロックに先に記録されたノートへのリンクへ飛ばない", () => {
    // 表は 1 ブロックなので、セルごとのメンションのリンクが同じ sourceBlockId に並ぶ
    const id = resolveMentionClickTarget({
      ...base,
      blockId: "tbl",
      inTableCell: true,
      mentionText: "spectrum.txt",
      links: [ref("tbl", "n1"), ref("tbl", "data:f1")],
    });
    expect(id).toBe("data:f1");
  });

  it("表ブロックにリンク記録の無い行ノートは、同じ表の @素材 のリンクへ飛ばずノートに解決する", () => {
    const id = resolveMentionClickTarget({
      ...base,
      blockId: "tbl",
      inTableCell: true,
      mentionText: "Index Note",
      links: [ref("tbl", "data:f1")],
    });
    expect(id).toBe("n1");
  });

  it("知見の「Source: @ラベル」は、ラベルが同名ノートと重なっても記録したリンク（URL 等）を開く", () => {
    const id = resolveMentionClickTarget({
      ...base,
      mentionText: "Index Note",
      links: [ref("b1", "url:https://example.com/a")],
    });
    expect(id).toBe("url:https://example.com/a");
  });

  it("同名の素材が複数あっても、このブロックに記録したリンクの素材を選ぶ", () => {
    const id = resolveMentionClickTarget({
      ...base,
      mentionText: "data.txt",
      links: [ref("b1", "data:f3")],
    });
    expect(id).toBe("data:f3");
  });

  it("リンク記録の無い @素材名 は名前で逆引きし、同名ならこのノートが引用した素材を優先する", () => {
    expect(resolveMentionClickTarget({ ...base, mentionText: "spectrum.txt" })).toBe("data:f1");
    expect(
      resolveMentionClickTarget({ ...base, mentionText: "data.txt", citedAssetFileIds: ["f3"] }),
    ).toBe("data:f3");
    expect(resolveMentionClickTarget({ ...base, mentionText: "data.txt" })).toBe("data:f2");
  });

  it("macOS の NFD のファイル名でも一致する", () => {
    const nfd = "データ.txt".normalize("NFD");
    expect(nfd).not.toBe("データ.txt".normalize("NFC"));
    const id = resolveMentionClickTarget({
      ...base,
      mentionText: "データ.txt".normalize("NFC"),
      media: [asset("nf", nfd, "data")],
    });
    expect(id).toBe("data:nf");
  });

  it("ノートはタイトルで、知見は wiki: 付きで解決する", () => {
    expect(resolveMentionClickTarget({ ...base, mentionText: "Index Note" })).toBe("n1");
    expect(resolveMentionClickTarget({ ...base, mentionText: "焼成の知見" })).toBe("wiki:w1");
    expect(
      resolveMentionClickTarget({ ...base, mentionText: "焼成の知見", links: [ref("b1", "w1")] }),
    ).toBe("wiki:w1");
  });

  it("インデックスに無いノートはファイル一覧のファイル名で拾う", () => {
    const id = resolveMentionClickTarget({
      ...base,
      mentionText: "古いノート",
      files: [{ id: "old1", name: "古いノート.graphium.json" }],
    });
    expect(id).toBe("old1");
  });

  it("@ で引用できない種類の素材（動画など）は素材名が一致しても解決しない", () => {
    expect(resolveMentionClickTarget({ ...base, mentionText: "clip.mp4" })).toBeNull();
  });

  it("どれにも一致しない知見の引用文は派生元の文書・PDF へ橋渡しする", () => {
    const id = resolveMentionClickTarget({
      ...base,
      mentionText: "本文から抜いた一文",
      derivedFromNotes: ["n1", "pdf:gone", "pdf:p1"],
    });
    expect(id).toBe("pdf:p1");
  });

  it("解決できなければ null", () => {
    expect(resolveMentionClickTarget({ ...base, mentionText: "存在しない" })).toBeNull();
  });
});

describe("assetIdsForName", () => {
  it("同名の素材をすべて返す", () => {
    expect(assetIdsForName(media, "data.txt")).toEqual(["data:f2", "data:f3"]);
  });
  it("素材一覧が無ければ空", () => {
    expect(assetIdsForName(null, "data.txt")).toEqual([]);
  });
});

describe("openPeekTarget", () => {
  const openers = () => ({
    openNote: vi.fn(),
    openMaterial: vi.fn(),
    openUrlFallback: vi.fn(),
    openMemo: vi.fn(),
  });

  it("データ素材（txt）と画像は素材ピークで開く", () => {
    const o = openers();
    expect(openPeekTarget("data:f1", mediaIndex, o)).toBe(true);
    expect(o.openMaterial).toHaveBeenLastCalledWith(media[0]);
    expect(openPeekTarget("image:i1", mediaIndex, o)).toBe(true);
    expect(o.openMaterial).toHaveBeenLastCalledWith(media[4]);
    expect(o.openNote).not.toHaveBeenCalled();
  });

  it("ノート・知見はノートピークで開く", () => {
    const o = openers();
    expect(openPeekTarget("wiki:w1", mediaIndex, o)).toBe(true);
    expect(o.openNote).toHaveBeenCalledWith("wiki:w1");
  });

  it("素材一覧に無い素材・素材ピークの無い画面では何もしない", () => {
    const o = openers();
    expect(openPeekTarget("data:missing", mediaIndex, o)).toBe(false);
    const noMaterial = { openNote: vi.fn() };
    expect(openPeekTarget("data:f1", mediaIndex, noMaterial)).toBe(false);
    expect(noMaterial.openNote).not.toHaveBeenCalled();
    expect(o.openMaterial).not.toHaveBeenCalled();
  });

  it("URL は素材ピーク、素材ピークの無い画面では外部で開く", () => {
    const o = openers();
    expect(openPeekTarget("url:https://example.com/a", mediaIndex, o)).toBe(true);
    expect(o.openMaterial.mock.calls[0][0]).toMatchObject({ type: "url", url: "https://example.com/a" });
    const fallback = { openNote: vi.fn(), openUrlFallback: vi.fn() };
    expect(openPeekTarget("url:https://example.com/a", mediaIndex, fallback)).toBe(true);
    expect(fallback.openUrlFallback).toHaveBeenCalledWith("https://example.com/a");
  });

  it("メモはメモを開き、chat: は開ける実体が無いので何もしない", () => {
    const o = openers();
    expect(openPeekTarget("memo:c1", mediaIndex, o)).toBe(true);
    expect(o.openMemo).toHaveBeenCalledWith("c1");
    expect(openPeekTarget("chat:123", mediaIndex, o)).toBe(false);
    expect(o.openNote).not.toHaveBeenCalled();
  });
});

describe("readMentionAt", () => {
  const mount = (html: string): HTMLElement => {
    document.body.innerHTML = html;
    return document.querySelector("[data-testid=t]") as HTMLElement;
  };
  const blue = (text: string) =>
    `<span data-testid="t" data-style-type="textColor" data-value="blue">${text}</span>`;

  it("エディタ内の青い @ラベル から、@ を除いたラベルとブロック ID を読む", () => {
    const el = mount(`<div class="bn-editor"><div data-id="p1"><p>${blue("@spectrum.txt")}</p></div></div>`);
    expect(readMentionAt(el)).toEqual({
      mentionText: "spectrum.txt",
      blockId: "p1",
      inTableCell: false,
      rowIdentity: null,
    });
  });

  it("表のセル内なら inTableCell。ブロック ID は表ブロック、行 ID は先頭セルの印から", () => {
    const el = mount(
      `<div class="bn-editor"><div data-id="tbl"><table><tr>` +
        `<td><span data-style-type="tableRowIdentity" data-row-identity="row_7">試料A</span></td>` +
        `<td>${blue("@spectrum.txt")}</td></tr></table></div></div>`,
    );
    expect(readMentionAt(el)).toEqual({
      mentionText: "spectrum.txt",
      blockId: "tbl",
      inTableCell: true,
      rowIdentity: "row_7",
    });
  });

  it("未採番の行（先頭セルに印が無い）は行 ID が null", () => {
    const el = mount(
      `<div class="bn-editor"><div data-id="tbl"><table><tr><td>新しい行</td><td>${blue("@spectrum.txt")}</td></tr></table></div></div>`,
    );
    expect(readMentionAt(el)?.rowIdentity).toBeNull();
  });

  it("表の先頭列のように、内側に行 ID のスタイルが重なっていても外側の青文字から読む", () => {
    // 保存時に先頭列のセル文字へ tableRowIdentity が付き、クリックの target は内側の span になる
    const el = mount(
      `<div class="bn-editor"><div data-id="tbl"><table><tr><td><span data-style-type="textColor" data-value="blue">` +
        `<span data-testid="t" data-style-type="tableRowIdentity" data-row-identity="row_1">@spectrum.txt</span>` +
        `</span></td></tr></table></div></div>`,
    );
    expect(readMentionAt(el)).toEqual({
      mentionText: "spectrum.txt",
      blockId: "tbl",
      inTableCell: true,
      rowIdentity: "row_1",
    });
  });

  it("見出しへの参照・@ 無しの青文字・エディタ外は対象外", () => {
    expect(readMentionAt(mount(`<div class="bn-editor">${blue("@# 見出し")}</div>`))).toBeNull();
    expect(readMentionAt(mount(`<div class="bn-editor">${blue("ただの青文字")}</div>`))).toBeNull();
    expect(readMentionAt(mount(`<div>${blue("@spectrum.txt")}</div>`))).toBeNull();
    // 青文字でない先頭列の文字（行 ID だけ付いた普通の名前）は対象外
    expect(
      readMentionAt(
        mount(
          `<div class="bn-editor"><span data-testid="t" data-style-type="tableRowIdentity" data-row-identity="row_2">@試料A</span></div>`,
        ),
      ),
    ).toBeNull();
  });
});
