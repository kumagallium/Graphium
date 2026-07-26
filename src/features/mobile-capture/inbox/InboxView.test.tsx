// @vitest-environment jsdom
// 受信箱ビューの中核（選択取り込み / 全部取り込み / 取り込み後の再スキャン / プレビュー）のテスト。
//
// 対象の不変条件:
// - 接続済みなら開いた瞬間に listPending して中身を出す（取り込み操作は不要）
// - 「選択したものを取り込み」は選んだ ref だけを onImport に渡す
// - 「全部取り込み」は refs を渡さない（importer 側の全件挙動に落ちる）
// - 取り込み後は再スキャンする（_imported/ へ移動したものが一覧から消える）
// - 未接続なら一覧でなく接続 CTA を出す
// - 行クリックでサイドピークにプレビューが出る（チェックボックスは選択のまま）
// - プレビューの blob URL は閉じたとき・切り替えたとき・unmount で必ず revoke する
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { InboxView, type InboxSource } from "./InboxView";
import { LocaleProvider } from "../../../i18n";
import type { CaptureRef } from "./types";

// プレビューは素材サイドピーク（MaterialSidePeek → MediaPreview → PdfViewer）を流用する。
// react-pdf は import しただけで pdfjs が DOMMatrix を触り jsdom では落ちるので、
// 描画しないスタブに差し替える（ここで検証したいのはピークの開閉と blob の後始末）。
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom は matchMedia を持たない。useIsDesktop（ビュー / サイドピーク双方が使う）が
// 落ちるので、常に「デスクトップでない」= overlay 表示としてスタブする。
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom は createObjectURL を実装しないので、サムネイル・プレビュー経路のためにスタブする。
// 発行するたびに別 URL を返し、「どの URL が revoke されたか」を検証できるようにする。
let blobSeq = 0;
const createObjectURL = vi.fn(() => `blob:stub-${++blobSeq}`);
const revokeObjectURL = vi.fn();
Object.assign(URL, { createObjectURL, revokeObjectURL });

afterEach(() => {
  cleanup();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  blobSeq = 0;
});

/** listPending が呼ばれるたびに pages を順に返す（再スキャンの検証用）。 */
function makeSource(pages: CaptureRef[][]) {
  let call = 0;
  const listPending = vi.fn(async () => pages[Math.min(call++, pages.length - 1)]);
  const readBlob = vi.fn(
    async (_ref: CaptureRef) => new Blob([new Uint8Array([1]) as BlobPart], { type: "image/jpeg" }),
  );
  return { source: { listPending, readBlob } satisfies InboxSource, listPending, readBlob };
}

function renderView(
  source: InboxSource | null,
  onImport: (refs?: CaptureRef[]) => Promise<void> = vi.fn(async (_refs?: CaptureRef[]) => {}),
  rootConfigured = true,
) {
  render(
    <LocaleProvider>
      <InboxView
        rootConfigured={rootConfigured}
        source={source}
        onPickRoot={vi.fn()}
        onImport={onImport}
        onBack={vi.fn()}
      />
    </LocaleProvider>,
  );
}

const ITEMS: CaptureRef[] = [
  { name: "IMG_1.jpg", bytes: 1024, modifiedAt: "2026-07-24T10:00:00Z" },
  { name: "IMG_2.jpg", bytes: 2048, modifiedAt: "2026-07-24T09:00:00Z" },
];

describe("InboxView", () => {
  it("lists pending files as soon as it opens (no import needed to see them)", async () => {
    const { source, listPending } = makeSource([ITEMS]);
    renderView(source);
    await waitFor(() => expect(screen.getByText("IMG_1.jpg")).toBeTruthy());
    expect(screen.getByText("IMG_2.jpg")).toBeTruthy();
    expect(listPending).toHaveBeenCalledTimes(1);
  });

  it("imports only the checked rows", async () => {
    const { source } = makeSource([ITEMS, [ITEMS[0]]]);
    const onImport = vi.fn(async (_refs?: CaptureRef[]) => {});
    renderView(source, onImport);
    await waitFor(() => expect(screen.getByText("IMG_2.jpg")).toBeTruthy());

    // 行のチェックボックスは aria-label にファイル名を持つ
    fireEvent.click(screen.getByLabelText("IMG_2.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Import selected (1)" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toEqual([ITEMS[1]]);
  });

  it("imports everything with no refs when 'import all' is used, then rescans", async () => {
    // 2 回目の listPending は空 = 取り込んだものが _imported/ へ移動して消えた状態
    const { source, listPending } = makeSource([ITEMS, []]);
    const onImport = vi.fn(async (_refs?: CaptureRef[]) => {});
    renderView(source, onImport);
    await waitFor(() => expect(screen.getByText("IMG_1.jpg")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Import all" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(undefined));
    // 取り込み後に再スキャン → 一覧から消えて空状態になる
    await waitFor(() => expect(listPending).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Nothing new")).toBeTruthy());
  });

  it("shows the connect CTA instead of a list when no folder is connected", () => {
    renderView(null, vi.fn(async (_refs?: CaptureRef[]) => {}), false);
    expect(screen.getAllByText("Connect sync folder").length).toBeGreaterThan(0);
  });
});

// プレビュー（サイドピーク）。サムネイル読み込みと混ざらないよう、
// サムネ対象外（画像でない）ファイルだけを並べて blob の発行元をプレビューに限定する。
const NON_IMAGE: CaptureRef[] = [
  { name: "REC_1.mov", bytes: 4096, modifiedAt: "2026-07-24T10:00:00Z" },
  { name: "PAPER_1.pdf", bytes: 8192, modifiedAt: "2026-07-24T09:00:00Z" },
];

describe("InboxView preview side peek", () => {
  it("opens a preview peek on row click and reads the file in full", async () => {
    const { source, readBlob } = makeSource([NON_IMAGE]);
    renderView(source);
    await waitFor(() => expect(screen.getByText("REC_1.mov")).toBeTruthy());
    // 一覧の時点ではサムネ対象外なので本体は読まれていない
    expect(readBlob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("REC_1.mov"));

    await waitFor(() => expect(readBlob).toHaveBeenCalledTimes(1));
    expect(readBlob.mock.calls[0][0]).toEqual(NON_IMAGE[0]);
    // ピークが開いている（ピーク内の取り込み導線が出る）
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import this file" })).toBeTruthy(),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // 動画は blob URL がそのまま <video> に載る（ストレージプロバイダを経由しない）。
    // jsdom が HTMLMediaElement.load() 未実装の警告を出すが再生要素の生成自体は起きる。
    await waitFor(() =>
      expect(document.querySelector("video")?.getAttribute("src")).toBe(
        createObjectURL.mock.results[0].value,
      ),
    );
  });

  it("keeps checkbox clicks to selection only (no preview)", async () => {
    const { source, readBlob } = makeSource([NON_IMAGE]);
    renderView(source);
    await waitFor(() => expect(screen.getByText("REC_1.mov")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("REC_1.mov"));

    // 選択はされるがプレビューは開かない
    expect(screen.getByRole("button", { name: "Import selected (1)" })).toBeTruthy();
    expect(readBlob).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Import this file" })).toBeNull();
  });

  it("revokes the preview blob URL when the peek is closed", async () => {
    const { source } = makeSource([NON_IMAGE]);
    renderView(source);
    await waitFor(() => expect(screen.getByText("PAPER_1.pdf")).toBeTruthy());

    fireEvent.click(screen.getByText("PAPER_1.pdf"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const url = createObjectURL.mock.results[0].value;
    expect(revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Close"));

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(url));
    expect(screen.queryByRole("button", { name: "Import this file" })).toBeNull();
  });

  it("revokes the previous blob URL when switching to another item", async () => {
    const { source, readBlob } = makeSource([NON_IMAGE]);
    renderView(source);
    await waitFor(() => expect(screen.getByText("REC_1.mov")).toBeTruthy());

    fireEvent.click(screen.getByText("REC_1.mov"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const first = createObjectURL.mock.results[0].value;

    fireEvent.click(screen.getByText("PAPER_1.pdf"));

    await waitFor(() => expect(readBlob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(first));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    // 新しい方はまだ生きている
    expect(revokeObjectURL).not.toHaveBeenCalledWith(createObjectURL.mock.results[1].value);
  });

  it("revokes the preview blob URL on unmount", async () => {
    const { source } = makeSource([NON_IMAGE]);
    renderView(source);
    await waitFor(() => expect(screen.getByText("REC_1.mov")).toBeTruthy());
    fireEvent.click(screen.getByText("REC_1.mov"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const url = createObjectURL.mock.results[0].value;

    cleanup();

    expect(revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it("imports just the previewed file from inside the peek", async () => {
    const { source } = makeSource([NON_IMAGE, [NON_IMAGE[1]]]);
    const onImport = vi.fn(async (_refs?: CaptureRef[]) => {});
    renderView(source, onImport);
    await waitFor(() => expect(screen.getByText("REC_1.mov")).toBeTruthy());

    fireEvent.click(screen.getByText("REC_1.mov"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import this file" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import this file" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toEqual([NON_IMAGE[0]]);
    // 取り込んだものは再スキャンで消えるので、ピークも閉じる
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Import this file" })).toBeNull(),
    );
  });
});
