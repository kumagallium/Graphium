// 一括操作バー — ノート・素材・メモ・知見の一覧で複数選択したときに出る行の見本。
// 件数は左に 1 回、ボタンは動詞だけ、よく使う 3 つ＋「その他」、削除は右端のアイコン。
// 「狭い枠」はサイドピークを並べたとき・Windows 150% の実効幅を想定した見本。

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Archive,
  BookMarked,
  Bot,
  Download,
  Folder,
  Globe2,
  Images,
  RefreshCw,
  ScanText,
  Share2,
  Type,
  Eraser,
} from "lucide-react";
import { useT } from "../i18n";
import { BulkActionBar, type BulkAction } from "./bulk-action-bar";

const meta: Meta<typeof BulkActionBar> = {
  title: "Molecules/BulkActionBar",
  component: BulkActionBar,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof BulkActionBar>;

const noop = () => {};

function Frame({ width, children }: { width?: number; children: React.ReactNode }) {
  return (
    <div className="bg-background border-r border-border min-h-[240px]" style={{ width: width ?? "100%" }}>
      {/* 一覧のヘッダー行（パンくず）の代わり */}
      <div className="px-6 py-4 border-b border-border text-sm text-muted-foreground">…</div>
      {children}
    </div>
  );
}

function NotesBar() {
  const t = useT();
  const primary: BulkAction[] = [
    { id: "share", label: t("bulk.share"), icon: <Share2 size={12} />, onClick: noop },
    { id: "folders", label: t("bulk.folders"), icon: <Folder size={12} />, onClick: noop },
    { id: "knowledge", label: t("bulk.knowledge"), icon: <Bot size={12} />, onClick: noop },
  ];
  const more: BulkAction[] = [
    { id: "export", label: t("bulk.exportMarkdown"), icon: <Download size={12} />, onClick: noop },
    { id: "archive", label: t("bulk.archive"), icon: <Archive size={12} />, onClick: noop },
  ];
  return (
    <BulkActionBar
      count={11}
      onClear={noop}
      primary={primary}
      more={more}
      onDelete={noop}
      deleteLabel={t("nav.deleteSelected", { count: "11" })}
    />
  );
}

function MaterialsBar({ busy }: { busy?: boolean }) {
  const t = useT();
  const primary: BulkAction[] = [
    { id: "share", label: t("bulk.share"), icon: <Share2 size={12} />, onClick: noop },
    { id: "folders", label: t("bulk.folders"), icon: <Folder size={12} />, onClick: noop },
    { id: "knowledge", label: t("bulk.knowledge"), icon: <Bot size={12} />, onClick: noop },
  ];
  const more: BulkAction[] = [
    { id: "steps", label: t("bulk.extractSteps"), icon: <Bot size={12} />, onClick: noop },
    { id: "rename", label: t("bulk.renameByTitle"), icon: <Type size={12} />, subsetCount: 5, onClick: noop },
    {
      id: "doi",
      label: t("bulk.fillFromDoi"),
      icon: <BookMarked size={12} />,
      subsetCount: 1,
      onClick: noop,
    },
    {
      id: "ocr",
      label: t("bulk.ocr"),
      icon: <ScanText size={12} />,
      subsetCount: 3,
      busyLabel: busy ? t("asset.bulkOcrRunning", { done: "1", total: "3" }) : undefined,
      onClick: noop,
    },
    { id: "images", label: t("bulk.extractImages"), icon: <Images size={12} />, subsetCount: 4, onClick: noop },
    { id: "download", label: t("bulk.download"), icon: <Download size={12} />, subsetCount: 5, onClick: noop },
  ];
  return (
    <BulkActionBar
      count={5}
      onClear={noop}
      primary={primary}
      more={more}
      onDelete={noop}
      deleteLabel={t("asset.deleteSelected", { count: "5" })}
    />
  );
}

function MemosBar() {
  const t = useT();
  return (
    <BulkActionBar
      count={3}
      onClear={noop}
      primary={[
        { id: "folders", label: t("bulk.folders"), icon: <Folder size={12} />, onClick: noop },
        { id: "knowledge", label: t("bulk.knowledge"), icon: <Bot size={12} />, onClick: noop },
        { id: "archive", label: t("bulk.archive"), icon: <Archive size={12} />, onClick: noop },
      ]}
      onDelete={noop}
      deleteLabel={t("memo.deleteSelected", { count: "3" })}
    />
  );
}

function ClaimsBar() {
  const t = useT();
  return (
    <BulkActionBar
      count={4}
      onClear={noop}
      primary={[
        { id: "share", label: t("bulk.share"), icon: <Share2 size={12} />, onClick: noop },
        { id: "world", label: t("bulk.worldCheck"), icon: <Globe2 size={12} />, onClick: noop },
        { id: "regen", label: t("bulk.regenerate"), icon: <RefreshCw size={12} />, onClick: noop },
      ]}
      more={[{ id: "clear", label: t("bulk.clearWorld"), icon: <Eraser size={12} />, onClick: noop }]}
      onDelete={noop}
      deleteLabel={t("wikiList.deleteSelected", { count: "4" })}
    />
  );
}

export const Notes: Story = {
  name: "ノート一覧",
  render: () => <Frame><NotesBar /></Frame>,
};

export const Materials: Story = {
  name: "素材一覧（対象が一部の操作は件数つき）",
  render: () => <Frame><MaterialsBar /></Frame>,
};

export const MaterialsBusy: Story = {
  name: "素材一覧（実行中はメニューから表へ出る）",
  render: () => <Frame><MaterialsBar busy /></Frame>,
};

export const Memos: Story = {
  name: "メモ一覧（その他なし）",
  render: () => <Frame><MemosBar /></Frame>,
};

export const Claims: Story = {
  name: "知見一覧",
  render: () => <Frame><ClaimsBar /></Frame>,
};

export const Narrow: Story = {
  name: "狭い枠（サイドピーク並び・150%）",
  render: () => (
    <div className="flex flex-col gap-6">
      <Frame width={720}><NotesBar /></Frame>
      <Frame width={520}><MaterialsBar /></Frame>
    </div>
  ),
};
