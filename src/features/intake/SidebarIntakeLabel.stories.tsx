// サイドバーの「取り込み」の呼び名の前後を並べるストーリー（部品は作らない）。
// 文言は改名の案をここに直接書く。src/i18n の sidebar.intake はまだ変えない。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderInput } from "lucide-react";
import { useLocale } from "@/i18n";
import { ConversationStoryFrame } from "./conversation-story-frame";

const meta: Meta = {
  title: "Features/Intake/Conversation/SidebarLabel",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

// FileSidebar の「ファイル取り込み」の行と同じクラス
function IntakeRow({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="w-full flex items-center gap-2 rounded-lg px-3 py-1 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
    >
      <FolderInput size={14} />
      <span>{label}</span>
    </button>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-muted-foreground mb-1">{children}</p>;
}

function BeforeAfterBody() {
  const { locale, t } = useLocale();
  const ja = locale === "ja";
  const afterLabel = ja ? "取り込み" : "Bring in";
  const afterTooltip = ja
    ? "手元のファイルや、AI との会話を取り込む"
    : "Bring in files you already have, or conversations with an AI";
  const afterTitle = ja ? "手元にあるものを取り込む" : "Bring in what you already have";
  const titleBefore = t("intake.title");
  const titleUnchanged = !ja && titleBefore === afterTitle;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <Caption>{ja ? "いま" : "Now"}</Caption>
          <div className="w-64 rounded-lg bg-sidebar-background border border-sidebar-border p-2">
            <IntakeRow label={t("sidebar.intake")} />
          </div>
        </div>
        <div>
          <Caption>{ja ? "変更後（案）" : "After (proposal)"}</Caption>
          <div className="w-64 rounded-lg bg-sidebar-background border border-sidebar-border p-2">
            <IntakeRow label={afterLabel} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm text-foreground">
        <Caption>{ja ? "ツールチップの文" : "Tooltip text"}</Caption>
        <p>
          <span className="text-muted-foreground">{ja ? "いま: " : "Now: "}</span>
          {t("sidebar.intakeTooltip")}
        </p>
        <p>
          <span className="text-muted-foreground">{ja ? "変更後（案）: " : "After (proposal): "}</span>
          {afterTooltip}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-sm text-foreground">
        <Caption>{ja ? "モーダルの題" : "Modal title"}</Caption>
        <p>
          <span className="text-muted-foreground">{ja ? "いま: " : "Now: "}</span>
          {titleBefore}
        </p>
        <p>
          <span className="text-muted-foreground">{ja ? "変更後（案）: " : "After (proposal): "}</span>
          {afterTitle}
          {titleUnchanged && <span className="text-muted-foreground"> (No change)</span>}
        </p>
      </div>
    </div>
  );
}

export const BeforeAfter: Story = {
  render: () => (
    <ConversationStoryFrame>
      <BeforeAfterBody />
    </ConversationStoryFrame>
  ),
};
