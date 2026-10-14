// @vitest-environment jsdom
// Documents タブ右上の「PDF を追加」「Word を追加」の経路のテスト。
//
// 対象の不変条件:
// - onIntakeFiles があるときは、選んだファイルをそのまま投入口（IntakeModal）に渡す。
//   自前の onUploadMedia ループは回さない（進捗・失敗継続・裏側保持は投入口の責務）
// - 複数ファイルは 1 回の呼び出しに全件載せる（投入口の進捗バーの total になる）
// - 選択後に input の値を戻し、同じファイルを選び直せる
// - onIntakeFiles が無い呼び出し元では従来どおり onUploadMedia に 1 件ずつ渡す

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="fake-editor" />,
}));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: () => null,
    getMediaBlobUrl: async () => "",
  }),
}));

import { LocaleProvider } from "../../i18n";
import { AssetGalleryView } from "./AssetGalleryView";
import type { MediaIndex } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoopObserver;

// 空状態の受け皿（IntakeReceptacle）が出ると input が増えて紛らわしいので、素材を 1 件入れておく
const MEDIA_INDEX: MediaIndex = {
  version: 7,
  updatedAt: "2026-01-04T00:00:00.000Z",
  media: [
    {
      fileId: "doc-1",
      name: "existing.pdf",
      type: "pdf",
      mimeType: "application/pdf",
      url: "https://example.test/existing.pdf",
      thumbnailUrl: "",
      uploadedAt: "2026-01-03T00:00:00.000Z",
      usedIn: [],
    },
  ],
};

function renderDocuments(opts: {
  onIntakeFiles?: (files: { name: string }[], source: string) => void;
  onUploadMedia: (file: File) => Promise<string>;
}) {
  return render(
    <LocaleProvider>
      <AssetGalleryView
        mediaIndex={MEDIA_INDEX}
        mediaType="document"
        onBack={() => {}}
        onNavigateNote={() => {}}
        onDeleteMedia={async () => {}}
        onRenameMedia={async () => {}}
        onUploadMedia={opts.onUploadMedia}
        onIntakeFiles={opts.onIntakeFiles}
      />
    </LocaleProvider>,
  );
}

function pdfInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="file"][accept="application/pdf"]');
  if (!el) throw new Error("PDF 用の input が見つからない");
  return el;
}

function docxInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="file"][accept=".docx"]');
  if (!el) throw new Error("Word 用の input が見つからない");
  return el;
}

function pdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

afterEach(() => cleanup());

describe("Documents タブの PDF / Word の追加", () => {
  it("onIntakeFiles があれば、複数 PDF をまとめて投入口に渡し、自前アップロードは回さない", () => {
    const onIntakeFiles = vi.fn();
    const onUploadMedia = vi.fn(async (_file: File) => "https://example.test/x");
    renderDocuments({ onIntakeFiles, onUploadMedia });

    fireEvent.change(pdfInput(), { target: { files: [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")] } });

    expect(onIntakeFiles).toHaveBeenCalledTimes(1);
    const [files, source] = onIntakeFiles.mock.calls[0];
    expect(files.map((f: { name: string }) => f.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(source).toBe("files");
    expect(onUploadMedia).not.toHaveBeenCalled();
    // 同じファイルを選び直せるように値は戻っている
    expect(pdfInput().value).toBe("");
  });

  it("Word 用の input も同じく投入口に渡す", () => {
    const onIntakeFiles = vi.fn();
    const onUploadMedia = vi.fn(async (_file: File) => "https://example.test/x");
    renderDocuments({ onIntakeFiles, onUploadMedia });

    const docx = new File(["PK"], "report.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(docxInput(), { target: { files: [docx] } });

    expect(onIntakeFiles).toHaveBeenCalledTimes(1);
    expect(onIntakeFiles.mock.calls[0][0].map((f: { name: string }) => f.name)).toEqual(["report.docx"]);
    expect(onUploadMedia).not.toHaveBeenCalled();
  });

  it("onIntakeFiles が無い呼び出し元では従来どおり onUploadMedia に 1 件ずつ渡す", async () => {
    const onUploadMedia = vi.fn(async (_file: File) => "https://example.test/x");
    renderDocuments({ onUploadMedia });

    fireEvent.change(pdfInput(), { target: { files: [pdf("a.pdf"), pdf("b.pdf")] } });

    await waitFor(() => expect(onUploadMedia).toHaveBeenCalledTimes(2));
    expect(onUploadMedia.mock.calls.map(([file]) => file.name)).toEqual(["a.pdf", "b.pdf"]);
  });
});
