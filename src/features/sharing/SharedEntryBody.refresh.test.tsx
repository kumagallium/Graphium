// @vitest-environment jsdom
// 共有ノートのプレビューは、本文が差し替わったら読み取り専用エディタを作り直して新しい内容を出す
// （エディタは initialContent を最初の 1 回しか使わない。前の版に戻した直後に古い本文のまま残らないため）。

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
// initialContent を最初の 1 回だけ取り込む偽エディタ（実エディタと同じ性質）
vi.mock("../../base/editor", async () => {
  const { useState } = await import("react");
  return {
    SandboxEditor: ({ initialContent }: { initialContent: any[] }) => {
      const [first] = useState(initialContent);
      return <div data-testid="editor-text">{first[0]?.content?.[0]?.text ?? ""}</div>;
    },
  };
});

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedEntryBody } from "./SharedEntryBody";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = {
  id: "note-1",
  type: "note",
  author: { name: "A", email: "a@example.org" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  hash: "sha256:x",
  prov: { derived_from: [] },
  version: 1,
} as SharedEntry;

const bodyOf = (text: string) =>
  JSON.stringify({
    version: 6,
    title: "t",
    pages: [
      {
        id: "p1",
        title: "t",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text, styles: {} }], children: [] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  });

afterEach(cleanup);

describe("SharedEntryBody のノートプレビュー", () => {
  it("本文が差し替わったら、新しい内容を出す", async () => {
    const view = (body: string) => (
      <LocaleProvider>
        <SharedEntryBody entry={ENTRY} body={body} bodyError={null} />
      </LocaleProvider>
    );
    const { rerender } = render(view(bodyOf("前の内容")));
    await waitFor(() => expect(screen.getByTestId("editor-text").textContent).toBe("前の内容"));
    rerender(view(bodyOf("戻した内容")));
    await waitFor(() => expect(screen.getByTestId("editor-text").textContent).toBe("戻した内容"));
  });
});
