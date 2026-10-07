// ブロック左の ＋ / ⠿ のツールチップと、ドラッグ中のドロップ先の案内のカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HintBubble } from "./side-menu-hint";
import { useT } from "../i18n";

const meta: Meta<typeof HintBubble> = {
  title: "Components/SideMenuHint",
  component: HintBubble,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof HintBubble>;

/** 慣れるまで（使った回数が少ないうち）は名前と使い方の 2 行 */
export const WithUsage: Story = {
  name: "名前＋使い方（慣れるまで）",
  render: () => {
    const t = useT();
    return (
      <div className="flex gap-6 items-start">
        <HintBubble title={t("sideMenuHint.addTitle")} usage={t("sideMenuHint.addUsage")} />
        <HintBubble title={t("sideMenuHint.dragTitle")} usage={t("sideMenuHint.dragUsage")} />
      </div>
    );
  },
};

/** 数回使ったあとは名前だけ */
export const TitleOnly: Story = {
  name: "名前だけ（慣れたあと）",
  render: () => {
    const t = useT();
    return (
      <div className="flex gap-6 items-start">
        <HintBubble title={t("sideMenuHint.addTitle")} />
        <HintBubble title={t("sideMenuHint.dragTitle")} />
      </div>
    );
  },
};

/** ドラッグ中だけ出るドロップ先の案内: 上下の並べ替えの線・横並べの面・中に入れる枠（本物は body 直下の固定配置） */
export const DropZoneLabels: Story = {
  name: "ドロップ先の案内",
  render: () => {
    const t = useT();
    const zone = { position: "relative" as const, height: 56, marginTop: 16 };
    return (
      <div className="flex flex-col gap-8" style={{ width: 420 }}>
        <div style={{ position: "relative", height: 24 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 10, height: 4, background: "var(--color-primary)" }} />
          <div data-reorder-drop-label="" style={{ position: "absolute", display: "block", left: "100%", top: 12 }}>
            <span data-drop-zone-label="">{t("dropHint.moveHere")}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 rounded border border-border p-3 text-sm">段落のブロック</div>
          <div
            data-column-drop-zone=""
            style={{ ...zone, position: "relative", display: "block", width: 140, marginTop: 0 }}
          >
            <span data-drop-zone-label="">{t("dropHint.sideBySide")}</span>
          </div>
        </div>
        <div data-merge-drop-target="" style={{ ...zone, display: "block" }}>
          <span data-drop-zone-label="">{t("dropHint.moveInside")}</span>
          <div className="p-3 text-sm">引用ブロック</div>
        </div>
      </div>
    );
  },
};
