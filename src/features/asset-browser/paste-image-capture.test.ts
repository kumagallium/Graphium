import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isCapturablePastedImageUrl,
  capturePastedImages,
  schedulePastedImageCapture,
} from "./paste-image-capture";

// 画像バイトの取得は globalThis.fetch を spy して差し替える（remote-image.test.ts と同じ方式）
function mockImageResponse(bytes: string, contentType: string, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(status === 200 ? bytes : null, {
      status,
      headers: status === 200 ? { "content-type": contentType } : {},
    }) as Response,
  );
}

/** capturePastedImages が触る最小面だけを持つエディタモック */
function makeEditor(blocks: any[]) {
  const findById = (list: any[], id: string): any | undefined => {
    for (const b of list) {
      if (b.id === id) return b;
      const hit = b.children?.length ? findById(b.children, id) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return {
    document: blocks,
    getBlock: (id: string) => findById(blocks, id),
    updateBlock: vi.fn((blockId: string | { id: string }, update: any) => {
      const id = typeof blockId === "string" ? blockId : blockId.id;
      const block = findById(blocks, id);
      if (!block) throw new Error(`block not found: ${id}`);
      block.props = { ...block.props, ...update.props };
    }),
  };
}

const image = (id: string, url: string) => ({ id, type: "image", props: { url }, children: [] });

describe("isCapturablePastedImageUrl", () => {
  it("外部 http(s) と data:image を対象にする", () => {
    expect(isCapturablePastedImageUrl("https://assets.st-note.com/img/abc.png")).toBe(true);
    expect(isCapturablePastedImageUrl("http://example.com/a.jpg")).toBe(true);
    expect(isCapturablePastedImageUrl("data:image/png;base64,AAA")).toBe(true);
  });

  it("自ストレージのカスタムスキーム・blob・空値は対象外", () => {
    expect(isCapturablePastedImageUrl("file-media://uuid-1")).toBe(false);
    expect(isCapturablePastedImageUrl("local-media://uuid-2")).toBe(false);
    expect(isCapturablePastedImageUrl("media-server://uuid-3")).toBe(false);
    expect(isCapturablePastedImageUrl("blob:http://localhost/xyz")).toBe(false);
    expect(isCapturablePastedImageUrl("data:text/html;base64,AAA")).toBe(false);
    expect(isCapturablePastedImageUrl("")).toBe(false);
    expect(isCapturablePastedImageUrl(undefined)).toBe(false);
  });
});

describe("capturePastedImages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("新規 image ブロックの外部 URL を取り込み、ローカル URL に差し替える", async () => {
    mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([image("a", "https://cdn.example.com/hero.png")]);
    const uploaded: File[] = [];
    const result = await capturePastedImages(editor, new Set(["a"]), async (f) => {
      uploaded.push(f);
      return "file-media://uuid-new";
    });
    expect(result).toEqual({ captured: 1, failed: 0 });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].name).toBe("hero.png");
    expect(editor.getBlock("a").props.url).toBe("file-media://uuid-new");
  });

  it("newIds に含まれない既存ブロックは触らない", async () => {
    const spy = mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([
      image("old", "https://cdn.example.com/old.png"),
      image("new", "https://cdn.example.com/new.png"),
    ]);
    await capturePastedImages(editor, new Set(["new"]), async () => "file-media://u1");
    expect(editor.getBlock("old").props.url).toBe("https://cdn.example.com/old.png");
    expect(editor.getBlock("new").props.url).toBe("file-media://u1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("children にネストした image ブロック（カラム内等）も拾う", async () => {
    mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([
      {
        id: "col",
        type: "columnList",
        props: {},
        children: [image("nested", "https://cdn.example.com/in-column.png")],
      },
    ]);
    const result = await capturePastedImages(
      editor,
      new Set(["col", "nested"]),
      async () => "file-media://u2",
    );
    expect(result.captured).toBe(1);
    expect(editor.getBlock("nested").props.url).toBe("file-media://u2");
  });

  it("同一 URL の複数ブロックは 1 回だけ取得して同じローカル URL を共有する", async () => {
    const fetchSpy = mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([
      image("a", "https://cdn.example.com/same.png"),
      image("b", "https://cdn.example.com/same.png"),
    ]);
    const upload = vi.fn(async () => "file-media://shared");
    const result = await capturePastedImages(editor, new Set(["a", "b"]), upload);
    expect(result.captured).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(editor.getBlock("a").props.url).toBe("file-media://shared");
    expect(editor.getBlock("b").props.url).toBe("file-media://shared");
  });

  it("data URL は File 化して取り込む（プロキシを経由しない）", async () => {
    // data: URL の fetch は spy で差し替わるため、プロキシ URL が呼ばれていないことだけ確認
    const spy = mockImageResponse("JPEGBYTES", "image/jpeg");
    const editor = makeEditor([image("d", "data:image/jpeg;base64,AAAA")]);
    const uploaded: File[] = [];
    const result = await capturePastedImages(editor, new Set(["d"]), async (f) => {
      uploaded.push(f);
      return "file-media://from-data";
    });
    expect(result).toEqual({ captured: 1, failed: 0 });
    expect(spy).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA");
    expect(uploaded[0].name).toBe("image.jpeg");
    expect(editor.getBlock("d").props.url).toBe("file-media://from-data");
  });

  it("取得に失敗した画像は元の URL のまま残す（ベストエフォート）", async () => {
    mockImageResponse("", "application/json", 502);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = makeEditor([image("a", "https://cdn.example.com/broken.png")]);
    const result = await capturePastedImages(editor, new Set(["a"]), async () => "unreached");
    expect(result).toEqual({ captured: 0, failed: 1 });
    expect(editor.getBlock("a").props.url).toBe("https://cdn.example.com/broken.png");
    expect(warn).toHaveBeenCalled();
  });

  it("取得中にブロックが消えた場合は差し替えをスキップする", async () => {
    mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([image("gone", "https://cdn.example.com/gone.png")]);
    const result = await capturePastedImages(editor, new Set(["gone"]), async () => {
      // アップロード完了前にブロックが削除されたことを模す
      (editor.document as any[]).length = 0;
      return "file-media://late";
    });
    expect(result).toEqual({ captured: 0, failed: 0 });
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });

  it("対象がなければ fetch もアップロードもしない", async () => {
    const spy = mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([
      image("local", "file-media://already-local"),
      { id: "p", type: "paragraph", props: {}, children: [] },
    ]);
    const result = await capturePastedImages(
      editor,
      new Set(["local", "p"]),
      async () => "unreached",
    );
    expect(result).toEqual({ captured: 0, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("schedulePastedImageCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("挿入完了後に paste 前後の差分ブロックだけ取り込む", async () => {
    vi.useFakeTimers();
    mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([image("before", "https://cdn.example.com/before.png")]);
    const beforeIds = new Set(["before"]);
    const upload = vi.fn(async () => "file-media://u3");
    schedulePastedImageCapture(editor, beforeIds, upload);
    // BlockNote のネイティブパースがブロックを追加したことを模す
    (editor.document as any[]).push(image("added", "https://cdn.example.com/added.png"));
    await vi.runAllTimersAsync();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(editor.getBlock("added").props.url).toBe("file-media://u3");
    expect(editor.getBlock("before").props.url).toBe("https://cdn.example.com/before.png");
  });

  it("uploadImage が無い文脈（読み取り専用）では何もしない", () => {
    vi.useFakeTimers();
    const editor = makeEditor([]);
    schedulePastedImageCapture(editor, new Set(), undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("同一 paste イベントからの再スケジュールは無視する（リスナー二重登録対策）", async () => {
    vi.useFakeTimers();
    mockImageResponse("PNGBYTES", "image/png");
    const editor = makeEditor([]);
    const upload = vi.fn(async () => "file-media://once");
    // クリップボードリスナーが二重登録されると同一イベントで 2 回呼ばれる
    const event = new Event("paste") as ClipboardEvent;
    schedulePastedImageCapture(editor, new Set(), upload, event);
    schedulePastedImageCapture(editor, new Set(), upload, event);
    (editor.document as any[]).push(image("a", "https://cdn.example.com/a.png"));
    await vi.runAllTimersAsync();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
