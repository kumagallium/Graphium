// EmptyNoteGuide — 空ノート時に 4 トリガーを予示する chip 列のストーリー
// Composer 連携は Cmd+K チップでのみ想定される（ここでは console 出力で代替）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "@/i18n";
import { EmptyNoteGuide } from "./EmptyNoteGuide";

const meta: Meta<typeof EmptyNoteGuide> = {
  title: "Molecules/EmptyNoteGuide",
  component: EmptyNoteGuide,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "新規作成 / 空のノートを開いた直後に、BlockNote エディタ本文の下に表示される予示 UI。⌘K / # / @ / / の 4 つの入力口をさりげなく案内する。編集が始まったら呼び出し側で visible=false にする。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof EmptyNoteGuide>;

export const Visible: Story = {
  name: "表示あり（空ノート状態）",
  render: () => (
    <LocaleProvider>
      <div style={{ background: "var(--paper)", padding: 32, borderRadius: 8 }}>
        <div
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            color: "var(--ink-4)",
            fontStyle: "italic",
            fontSize: 14,
            marginBottom: 4,
          }}
        >
          （上の領域は本来 BlockNote タイトル + 空の本文）
        </div>
        <hr style={{ border: "none", borderTop: "1px dashed var(--rule-2)", margin: "12px 0" }} />
        <EmptyNoteGuide
          visible
          onOpenComposer={() => console.info("[Story] Open composer")}
        />
      </div>
    </LocaleProvider>
  ),
};

export const WithIntake: Story = {
  name: "投入口チップあり（onOpenIntake 指定）",
  render: () => (
    <LocaleProvider>
      <div style={{ background: "var(--paper)", padding: 32, borderRadius: 8 }}>
        <div
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            color: "var(--ink-4)",
            fontStyle: "italic",
            fontSize: 14,
            marginBottom: 4,
          }}
        >
          （上の領域は本来 BlockNote タイトル + 空の本文）
        </div>
        <hr style={{ border: "none", borderTop: "1px dashed var(--rule-2)", margin: "12px 0" }} />
        <EmptyNoteGuide
          visible
          onOpenComposer={() => console.info("[Story] Open composer")}
          onOpenIntake={() => console.info("[Story] Open intake")}
        />
      </div>
    </LocaleProvider>
  ),
};

export const Hidden: Story = {
  name: "非表示（編集が始まっている）",
  render: () => (
    <LocaleProvider>
      <div style={{ background: "var(--paper)", padding: 32, borderRadius: 8, color: "var(--ink-3)" }}>
        visible=false を渡すと何もレンダリングしない。
        <EmptyNoteGuide visible={false} />
      </div>
    </LocaleProvider>
  ),
};
