// @vitest-environment jsdom
// 保存内容からエディタを作れないノートでも、画面全体を落とさずに開く（SandboxEditor 実物）
//
// BlockNote は initialContent が 1 か所でもスキーマに合わないとエディタの生成で throw する。
// 以前は受ける境界が無く「画面を表示できなくなりました」になり、再読み込みしても同じ
// ノートを開いてまた落ちた。合わないブロックだけ文字にして開き、そのことを知らせる。

import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider } from "../i18n";
import { AiAssistantProvider } from "../features/ai-assistant/store";
import { LabelStoreProvider } from "../features/context-label/store";
import { LinkStoreProvider } from "../features/block-link/store";
import { SandboxEditor } from "./editor";

function Providers({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <AiAssistantProvider>
        <LabelStoreProvider>
          <LinkStoreProvider>{children}</LinkStoreProvider>
        </LabelStoreProvider>
      </AiAssistantProvider>
    </LocaleProvider>
  );
}

const good = { id: "ok", type: "paragraph", props: {}, children: [], content: [{ type: "text", text: "そのまま", styles: {} }] };
// 読込サニタイズを通らない壊れ方（段落の中に段落）
const broken = { id: "bad", type: "paragraph", props: {}, children: [], content: [{ type: "text", text: "残す文字", styles: {} }, { type: "paragraph", content: "x" }] };

describe("SandboxEditor の initialContent 境界", () => {
  it("合わないブロックを文字にして開き、知らせを出す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let editor: any = null;
    let view: ReturnType<typeof render> | null = null;
    await act(async () => {
      view = render(
        <Providers>
          <SandboxEditor initialContent={[good, broken]} onEditorReady={(e) => (editor = e)} />
        </Providers>,
      );
    });
    expect(editor).toBeTruthy();
    const doc = editor.document as any[];
    expect(doc.map((b) => b.id)).toEqual(["ok", "bad"]);
    expect(doc[1].content.map((c: any) => c.text).join("")).toBe("残す文字");
    expect(view!.container.querySelector('[role="status"]')?.textContent ?? "").not.toBe("");
    // 修復した内容が本文の編集で保存されないよう、読み取り専用で開く
    expect(editor.isEditable).toBe(false);
    warn.mockRestore();
    error.mockRestore();
  });

  it("壊れていないノートでは知らせを出さない", async () => {
    let editor: any = null;
    let view: ReturnType<typeof render> | null = null;
    await act(async () => {
      view = render(
        <Providers>
          <SandboxEditor initialContent={[good]} onEditorReady={(e) => (editor = e)} />
        </Providers>,
      );
    });
    expect(editor.document[0].id).toBe("ok");
    expect(view!.container.querySelector('[role="status"]')).toBeNull();
    expect(editor.isEditable).toBe(true);
  });

  it("内容の読み込みと関係ないエラーは握りつぶさず外へ投げる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => {
      throw new Error("ほかの不具合");
    };
    await expect(
      act(async () => {
        render(
          <Providers>
            <SandboxEditor initialContent={[good]} onEditorReady={boom} />
          </Providers>,
        );
      }),
    ).rejects.toThrow("ほかの不具合");
    error.mockRestore();
  });
});
