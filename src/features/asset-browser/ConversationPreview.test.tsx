// @vitest-environment jsdom
// 会話の本文の出し方のテスト（要素にならないこと・読み込み中・見つからないとき）

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { ConversationPreview, ConversationPreviewView } from "./ConversationPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

const META = {
  provider: "claude-code",
  sessionId: "s1",
  workdir: "/work/bread-notes",
  startedAt: "2026-10-05T09:00:00",
  endedAt: "2026-10-06T09:30:00",
  ownTurns: 2,
  ownChars: 40,
  bodyChars: 120,
  importedAt: "2026-10-07T00:00:00",
} as never;

function view(text: string | null | undefined, conversation: unknown = META) {
  return render(
    <LocaleProvider>
      <ConversationPreviewView entry={{ conversation } as never} text={text} />
    </LocaleProvider>,
  );
}

describe("ConversationPreviewView", () => {
  it("<script> や <img onerror> は要素にならず文字として出る", () => {
    const { container } = view('## 2026-10-05\n\n- 私（09:12）: <script>alert(1)</script>\n  <img src=x onerror=alert(1)>');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>\n<img src=x onerror=alert(1)>");
  });

  it("AI の行は薄く、本人の側の行は通常の色", () => {
    const { container } = view("## 2026-10-05\n\n- AI (previous reply): Rye\n- Me (09:12): Stop at 6 hours");
    const ai = [...container.querySelectorAll("div")].find((d) => d.textContent === "Rye");
    const me = [...container.querySelectorAll("div")].find((d) => d.textContent === "Stop at 6 hours");
    expect(ai?.className).toContain("text-muted-foreground");
    expect(me?.className).toContain("text-foreground");
  });

  it("来歴の 1 行に作業フォルダと期間が出る。conversation が無ければ出ない", () => {
    const a = view("x");
    expect(a.container.textContent).toContain("/work/bread-notes");
    expect(a.container.textContent).toContain("2026-10-05 〜 2026-10-06");
    cleanup();
    const b = view("x", null);
    expect(b.container.textContent).not.toContain("/work");
  });

  it("読み込み中と、見つからないとき", () => {
    expect(view(undefined).container.textContent).toContain("Loading the conversation");
    cleanup();
    expect(view(null).container.textContent).toContain("was not found");
  });
});

describe("この会話で作ったノート", () => {
  it("見出しと題のリンクが出て、押すとそのノートを開く。渡さなければ見出しも出ない", () => {
    const opened: string[] = [];
    const { container, getByText, rerender } = render(
      <LocaleProvider>
        <ConversationPreviewView
          entry={{ conversation: META } as never}
          text="x"
          createdNotes={[{ noteId: "n-1", title: "パンの発酵は 6 時間で止める" }]}
          onOpenNote={(id) => opened.push(id)}
        />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-testid=conversation-created-notes] h3")).not.toBeNull();
    getByText("パンの発酵は 6 時間で止める").click();
    expect(opened).toEqual(["n-1"]);
    rerender(
      <LocaleProvider>
        <ConversationPreviewView entry={{ conversation: META } as never} text="x" createdNotes={[]} />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-testid=conversation-created-notes]")).toBeNull();
  });

  it("ConversationPreview は呼び出し側の noteTitleOf で題を引く。undefined（消した・ゴミ箱）のノートは出さない", () => {
    const titles: Record<string, string> = { "n-1": "パンの発酵は 6 時間で止める" };
    const entry = { fileId: "conv-x", conversation: { ...(META as object), createdNoteIds: ["n-1", "n-gone"] } } as never;
    const { container } = render(
      <LocaleProvider>
        <ConversationPreview entry={entry} noteTitleOf={(id) => titles[id]} />
      </LocaleProvider>,
    );
    const items = container.querySelectorAll("[data-testid=conversation-created-notes] li");
    expect([...items].map((li) => li.textContent)).toEqual(["パンの発酵は 6 時間で止める"]);
  });
});
