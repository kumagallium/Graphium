// 外の AI（ChatGPT など）から届いた素材の受け取り待ちの部品のストーリー。
//
//   - Notice*: 画面右下の知らせ（届いた 1 件・ノートに貼れる 1 件・3 件以上・結果のピル）
//   - Section*: 取り込みの画面の「届いたもの」区画
//   - SidebarCount: サイドバー「取り込み」に添える件数
//
// 見本の題材はパン作り。設計: docs/internal/design_chatgpt_attachment_offer.md

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderInput } from "lucide-react";
import { useLocale, useT } from "@/i18n";
import { ConversationStoryFrame } from "../intake/conversation-story-frame";
import { MaterialOfferNoticeView, type MaterialOfferResult } from "./MaterialOfferNoticeView";
import { MaterialOfferSection } from "./MaterialOfferSection";
import { PendingOfferCount } from "./PendingOfferCount";
import type { MaterialOffer } from "./types";

// 見た目の代わり（焼き色の四角）。実物ではアプリが写しから作る
const CRUMB_PREVIEW =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#e9d3a8"/><ellipse cx="40" cy="44" rx="30" ry="22" fill="#b97a3c"/><ellipse cx="40" cy="44" rx="22" ry="15" fill="#f3e3c3"/><circle cx="33" cy="41" r="3" fill="#d9bf8f"/><circle cx="46" cy="47" r="2.5" fill="#d9bf8f"/><circle cx="42" cy="38" r="2" fill="#d9bf8f"/></svg>`,
  );

const PHOTO: MaterialOffer = {
  id: "o1",
  name: "crumb-after-48h.jpg",
  mimeType: "image/jpeg",
  size: 2_431_000,
  sourcePath: "/tmp/codex-remote-attachments/01a0feb9-7662/CA5DE6B8-3A9E/1-crumb-after-48h.jpg",
  client: "ChatGPT",
  offeredAt: "2026-11-24T09:12:00Z",
  previewUrl: CRUMB_PREVIEW,
};

const PHOTO_WITH_NOTE: MaterialOffer = {
  ...PHOTO,
  id: "o2",
  noteId: "n1",
  noteTitle: "Rye sourdough, 48 h cold proof",
};

const PDF: MaterialOffer = {
  id: "o3",
  name: "hydration-table.pdf",
  mimeType: "application/pdf",
  size: 184_000,
  sourcePath: "/Users/someone/Downloads/hydration-table.pdf",
  client: "ChatGPT",
  offeredAt: "2026-11-24T09:13:00Z",
  noteId: "n1",
  noteTitle: "Rye sourdough, 48 h cold proof",
};

const CSV: MaterialOffer = {
  id: "o4",
  name: "oven-log.csv",
  mimeType: "text/csv",
  size: 9_800,
  sourcePath: "/Users/someone/Documents/Bakery/logs/2026-11/oven-log.csv",
  client: "Codex",
  offeredAt: "2026-11-24T09:14:00Z",
};

/** 右下に固定される知らせを、画面の大きさの枠の中で見せる */
function NoticeFrame({
  offers,
  busy = null,
  result = null,
}: {
  offers: MaterialOffer[];
  busy?: string | null;
  result?: MaterialOfferResult | null;
}) {
  const { locale, setLocale } = useLocale();
  const [paste, setPaste] = useState<Record<string, boolean>>({});
  return (
    <div className="relative h-[560px] w-full bg-background" style={{ transform: "translateZ(0)" }}>
      <div className="absolute top-3 left-3 flex gap-1 text-xs">
        {(["ja", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            data-testid={`story-locale-${l}`}
            aria-pressed={locale === l}
            className={`rounded-full border px-2 py-0.5 ${locale === l ? "border-primary bg-primary/10 text-foreground" : "border-border-subtle text-muted-foreground"}`}
            onClick={() => setLocale(l)}
          >
            {l === "ja" ? "日本語" : "English"}
          </button>
        ))}
      </div>
      <MaterialOfferNoticeView
        offers={offers}
        pasteToNote={paste}
        onPasteToNoteChange={(id, v) => setPaste((p) => ({ ...p, [id]: v }))}
        busy={busy}
        result={result}
        onAccept={() => {}}
        onDecline={() => {}}
        onLater={() => {}}
        onOpenIntake={() => {}}
      />
    </div>
  );
}

const meta: Meta = {
  title: "Features/MaterialOffer",
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

export const NoticeOne: Story = { render: () => <NoticeFrame offers={[PHOTO]} /> };

export const NoticeWithNote: Story = { render: () => <NoticeFrame offers={[PHOTO_WITH_NOTE]} /> };

export const NoticeMany: Story = { render: () => <NoticeFrame offers={[PHOTO_WITH_NOTE, PDF, CSV]} /> };

export const NoticeBusy: Story = { render: () => <NoticeFrame offers={[PHOTO_WITH_NOTE]} busy="o2" /> };

export const NoticeResult: Story = {
  render: () => (
    <NoticeFrame offers={[]} result={{ kind: "added", name: "crumb-after-48h.jpg", noteTitle: "Rye sourdough, 48 h cold proof" }} />
  ),
};

function SectionDemo({ offers }: { offers: MaterialOffer[] }) {
  const [paste, setPaste] = useState<Record<string, boolean>>({});
  return (
    <ConversationStoryFrame>
      <MaterialOfferSection
        offers={offers}
        pasteToNote={paste}
        onPasteToNoteChange={(id, v) => setPaste((p) => ({ ...p, [id]: v }))}
        busy={null}
        onAccept={() => {}}
        onDecline={() => {}}
        onAcceptAll={() => {}}
        expireDays={14}
      />
    </ConversationStoryFrame>
  );
}

export const SectionMany: Story = {
  parameters: { layout: "padded" },
  render: () => <SectionDemo offers={[PHOTO_WITH_NOTE, PDF, CSV]} />,
};

export const SectionOne: Story = {
  parameters: { layout: "padded" },
  render: () => <SectionDemo offers={[CSV]} />,
};

/** サイドバーの取り込みの行（FileSidebar の twins と同じクラス）に件数を添えた形 */
function SidebarRow({ count }: { count: number }) {
  const t = useT();
  return (
    <button
      type="button"
      className="w-full flex items-center gap-2 rounded-lg px-3 py-1 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
    >
      <FolderInput size={14} />
      <span>{t("sidebar.intake")}</span>
      <span className="ml-auto">
        <PendingOfferCount count={count} />
      </span>
    </button>
  );
}

export const SidebarCount: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <ConversationStoryFrame width={260}>
      <div className="bg-sidebar rounded-md p-1 flex flex-col gap-1">
        <SidebarRow count={3} />
        <SidebarRow count={0} />
      </div>
    </ConversationStoryFrame>
  ),
};
