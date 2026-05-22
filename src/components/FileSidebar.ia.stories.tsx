// 左サイドバーの情報アーキテクチャ（IA）見直し用ストーリー
// - Current: 現状の FileSidebar
// - Proposed: 新 IA（ノート→ナレッジ → 区切り → 素材→ラベル / Skill はフッターへ）
//
// 本ストーリーは Storybook 上での視覚合意用。確定したら FileSidebar.tsx に反映する。

import { useMemo, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Image, FileText, Video, Volume2, Link, StickyNote, Bot, History,
  PanelLeftClose, Trash2, Settings as SettingsIcon, Wrench, ShieldCheck, ArrowRight,
} from "lucide-react";
import { FileSidebar } from "./FileSidebar";
import { CollapsibleSection } from "./CollapsibleSection";
import { type RecentNote } from "../features/navigation";
import type { GraphiumIndex } from "../features/navigation/index-file";
import type { MediaIndex, MediaType } from "../features/asset-browser";
import { useT, getDisplayLabelName, LocaleProvider } from "../i18n";
import "../app.css";

// ── モックデータ ─────────────────────────────────────────

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const MOCK_RECENT: RecentNote[] = [
  { noteId: "n1", title: "低温度差で相変態を観察したメモ", lastAccessedAt: hoursAgo(2) },
  { noteId: "n2", title: "微量置換で格子定数を変える試み", lastAccessedAt: hoursAgo(5) },
  { noteId: "n3", title: "ゼーベック係数の温度依存性", lastAccessedAt: daysAgo(1) },
];

const MOCK_INDEX: GraphiumIndex = {
  version: 1,
  updatedAt: now.toISOString(),
  notes: [
    {
      noteId: "n1", title: "低温度差で相変態を観察したメモ",
      modifiedAt: hoursAgo(2), createdAt: daysAgo(14),
      headings: [],
      labels: [
        { blockId: "b1", label: "procedure", preview: "降温プロトコル" },
        { blockId: "b2", label: "material", preview: "Bi2Te3 薄膜" },
        { blockId: "b3", label: "result", preview: "相変態を確認" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "n2", title: "微量置換で格子定数を変える試み",
      modifiedAt: hoursAgo(5), createdAt: daysAgo(20),
      headings: [],
      labels: [
        { blockId: "b4", label: "material", preview: "Sb 0.1at% 置換" },
        { blockId: "b5", label: "attribute", preview: "格子定数: 10.47 Å" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "n3", title: "ゼーベック係数の温度依存性",
      modifiedAt: daysAgo(1), createdAt: daysAgo(10),
      headings: [],
      labels: [
        { blockId: "b6", label: "result", preview: "300 K で 180 µV/K" },
        { blockId: "b7", label: "tool", preview: "ZEM-3" },
      ],
      outgoingLinks: [],
    },
  ],
};

const MOCK_MEDIA: MediaIndex = {
  version: 1,
  updatedAt: now.toISOString(),
  media: [
    ...Array.from({ length: 8 }, (_, i) => ({
      fileId: `img-${i}`, name: `image-${i}.png`, type: "image" as const,
      mimeType: "image/png", url: "", thumbnailUrl: "", uploadedAt: now.toISOString(), usedIn: [],
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      fileId: `pdf-${i}`, name: `paper-${i}.pdf`, type: "pdf" as const,
      mimeType: "application/pdf", url: "", thumbnailUrl: "", uploadedAt: now.toISOString(), usedIn: [],
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      fileId: `url-${i}`, name: `link-${i}`, type: "url" as const,
      mimeType: "text/uri-list", url: "", thumbnailUrl: "", uploadedAt: now.toISOString(), usedIn: [],
    })),
  ],
};

const COMMON_PROPS = {
  activeFileId: null,
  onSelect: () => {},
  onNewNote: () => {},
  onRefresh: () => {},
  onShowReleaseNotes: () => {},
  onShowSettings: () => {},
  agentConfigured: true,
  recentNotes: MOCK_RECENT,
  onShowNoteList: () => {},
  mediaIndex: MOCK_MEDIA,
  onShowAssetGallery: (_type: MediaType) => {},
  noteIndex: MOCK_INDEX,
  onShowLabelGallery: (_label: string) => {},
  activeAssetType: null,
  activeLabel: null,
  filesLoading: false,
  memoCount: 0,
  onShowMemos: () => {},
  memosActive: false,
  wikiCounts: { summary: 9, claim: 14, atom: 3, synthesis: 4 },
  showAtomLayer: true,
  showSynthesisLayer: true,
  onShowWikiList: (_kind: import("../lib/document-types").WikiKind) => {},
  activeWikiKind: null,
  aiAvailable: true,
  skillCount: 2,
  onShowSkillList: () => {},
  skillActive: false,
  onShowTrash: () => {},
  trashActive: false,
  trashCount: 0,
} as const;

// ── 提案版 FileSidebar（IA 見直し版） ─────────────────────────
//
// 違い:
//   1) 並び: 最近のノート → メモ → ナレッジ → ─── → 素材 → ラベル
//   2) 改名: "データ" → "素材"
//   3) 視覚区切り: ドキュメント本体（脳の中身）と入口（網を辿る）の間に divider
//   4) Skill: ナレッジセクションから外し、フッター（メタ）に移動
//   5) ヘッダー: Quick Memo（プライマリ）+ New Note（セカンダリ）を 2 段で配置
//   6) メモ: 素材から独立させ、ノートと同列の第一級セクションに昇格

const LABEL_HEX: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  result: "#c26356",
};

const MEDIA_NAV_ITEMS: { type: MediaType; icon: ReactNode }[] = [
  { type: "image", icon: <Image size={14} /> },
  { type: "pdf", icon: <FileText size={14} /> },
  { type: "video", icon: <Video size={14} /> },
  { type: "audio", icon: <Volume2 size={14} /> },
  { type: "url", icon: <Link size={14} /> },
];

function ProposedFileSidebar(props: typeof COMMON_PROPS) {
  const t = useT();
  const {
    recentNotes, activeFileId, onSelect, onShowNoteList, filesLoading,
    mediaIndex, onShowAssetGallery, activeAssetType,
    memoCount, onShowMemos, memosActive,
    noteIndex, onShowLabelGallery, activeLabel,
    wikiCounts, onShowWikiList, activeWikiKind,
    skillCount, onShowSkillList, skillActive,
    onNewNote, onShowSettings, onShowReleaseNotes,
    onShowTrash, trashActive, trashCount,
    agentConfigured, aiAvailable,
  } = props;

  const mediaCounts = useMemo(() => {
    const acc: Record<MediaType, number> = { image: 0, pdf: 0, video: 0, audio: 0, url: 0, other: 0 };
    for (const m of mediaIndex?.media ?? []) acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, [mediaIndex]);

  const dataCount = (mediaCounts.image ?? 0) + (mediaCounts.pdf ?? 0)
    + (mediaCounts.video ?? 0) + (mediaCounts.audio ?? 0) + (mediaCounts.url ?? 0);

  const wikiTotalCount = (wikiCounts?.summary ?? 0) + (wikiCounts?.claim ?? 0)
    + (wikiCounts?.atom ?? 0) + (wikiCounts?.synthesis ?? 0);

  const labelCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of noteIndex?.notes ?? []) {
      for (const l of note.labels) map.set(l.label, (map.get(l.label) ?? 0) + 1);
    }
    return map;
  }, [noteIndex]);

  return (
    <aside className="w-full md:w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col h-full">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-7 h-7" />
            <img src={`${import.meta.env.BASE_URL}logo-text.png`} alt="Graphium" className="h-[18px] mt-px" />
          </div>
          <button title="collapse" className="text-muted-foreground hover:text-foreground transition-colors">
            <PanelLeftClose size={14} />
          </button>
        </div>
        <button
          className="w-full flex items-center justify-between rounded-lg px-3 py-1.5 mb-1 text-sm font-medium border border-sidebar-border text-sidebar-foreground/85 bg-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          <span>{t("sidebar.newMemo")}</span>
          <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">⌘⇧M</span>
        </button>
        <button
          onClick={onNewNote}
          className="w-full text-left rounded-lg px-3 py-1.5 text-sm font-medium border border-sidebar-border text-sidebar-foreground/85 bg-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          {t("sidebar.newNote")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {/* ── ① ノート（見出し風リンク） ── */}
        <button
          onClick={onShowNoteList}
          className="w-full flex items-center gap-1 px-4 pt-2 pb-1 text-xs font-semibold text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
        >
          <span className="shrink-0 -ml-0.5" aria-hidden>
            <ArrowRight size={12} />
          </span>
          <span className="flex-1 text-left">{t("nav.notes")}</span>
          <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">{recentNotes.length}</span>
        </button>

        {/* ── ①' メモ（見出し風リンク） — ノートと同列 ── */}
        <button
          onClick={onShowMemos}
          className={`w-full flex items-center gap-1 px-4 pt-2 pb-1 mb-1.5 text-xs font-semibold transition-colors ${
            memosActive
              ? "text-primary"
              : "text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
          }`}
        >
          <span className="shrink-0 -ml-0.5" aria-hidden>
            <ArrowRight size={12} />
          </span>
          <span className="flex-1 text-left">{t("memo.title")}</span>
          {memoCount > 0 && (
            <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">{memoCount}</span>
          )}
        </button>

        {/* ── ② ナレッジ（AI が編む脳） — Notes の直下に昇格 ── */}
        <CollapsibleSection
          storageKey="proposal-knowledge"
          title={t("sidebar.knowledge")}
          defaultOpen={true}
          count={wikiTotalCount}
        >
          {(["summary", "claim", "atom", "synthesis"] as const).map((kind) => {
            const count = wikiCounts?.[kind] ?? 0;
            const label =
              kind === "summary" ? t("wikiList.kindSummary")
              : kind === "claim" ? t("wikiList.kindClaim")
              : kind === "atom" ? t("wikiList.kindAtom")
              : t("wikiList.kindSynthesis");
            const isExp = kind === "atom" || kind === "synthesis";
            return (
              <button
                key={kind}
                onClick={() => onShowWikiList(kind)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                  activeWikiKind === kind
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <span className="text-muted-foreground shrink-0"><Bot size={14} /></span>
                <span className="flex-1 text-left flex items-center gap-1.5">
                  {label}
                  {isExp && (
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 border border-muted-foreground/30 rounded px-1 py-px">
                      exp
                    </span>
                  )}
                </span>
                {count > 0 && <span className="text-xs text-muted-foreground">{count}</span>}
              </button>
            );
          })}
          {/* Log / Health（現状実装と同じ位置） */}
          <div className="flex items-center gap-1 px-2 pt-1">
            <button
              title="Activity Log"
              aria-label="Activity Log"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            >
              <History size={12} />
              <span>Log</span>
            </button>
            <button
              title="Health Check"
              aria-label="Health Check"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            >
              <ShieldCheck size={12} />
              <span>Health</span>
            </button>
          </div>
        </CollapsibleSection>

        {/* ── divider（脳の中身 / 入口 の区切り、見出し無し） ── */}
        <div className="mx-4 my-3 border-t border-sidebar-border/50" aria-hidden />

        {/* ── ③ 素材（旧: データ） ── */}
        <CollapsibleSection
          storageKey="proposal-materials"
          title="素材"
          defaultOpen={true}
          count={dataCount}
        >
          {MEDIA_NAV_ITEMS.map(({ type, icon }) => {
            const count = mediaCounts[type] ?? 0;
            return (
              <button
                key={type}
                onClick={() => onShowAssetGallery(type)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                  activeAssetType === type
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <span className="text-muted-foreground shrink-0">{icon}</span>
                <span className="flex-1 text-left">{t(`asset.type.${type}`)}</span>
                {count > 0 && <span className="text-xs text-muted-foreground">{count}</span>}
              </button>
            );
          })}
        </CollapsibleSection>

        {/* ── ④ ラベル ── */}
        {labelCounts.size > 0 && (
          <CollapsibleSection
            storageKey="proposal-labels"
            title={t("label.section")}
            defaultOpen={true}
            count={labelCounts.size}
          >
            {[...labelCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => {
                const color = LABEL_HEX[label] ?? "#8fa394";
                return (
                  <button
                    key={label}
                    onClick={() => onShowLabelGallery(label)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                      activeLabel === label
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="flex-1 text-left truncate">{getDisplayLabelName(label)}</span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </button>
                );
              })}
          </CollapsibleSection>
        )}
      </div>

      {/* ── フッター（メタ群） ── */}
      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        {/* Skill はナレッジから移動 */}
        <button
          onClick={onShowSkillList}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
            skillActive
              ? "text-primary font-semibold bg-sidebar-accent/40"
              : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Wrench size={12} className="shrink-0" />
          <span className="flex-1 text-left">Skill</span>
          {skillCount > 0 && <span className="text-xs">{skillCount}</span>}
        </button>
        <button
          onClick={onShowSettings}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <SettingsIcon size={12} className="shrink-0" />
          <span className="flex-1 text-left">{t("common.settings")}</span>
          {aiAvailable && (agentConfigured ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
          ))}
        </button>
        {onShowTrash && (
          <button
            onClick={onShowTrash}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
              trashActive
                ? "text-primary font-semibold bg-sidebar-accent/40"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <Trash2 size={12} className="shrink-0" />
            <span className="flex-1 text-left">{t("nav.trashAndArchive")}</span>
            {trashCount > 0 && <span className="text-xs">{trashCount}</span>}
          </button>
        )}
        <button
          onClick={onShowReleaseNotes}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <History size={12} className="shrink-0" />
          <span className="flex-1 text-left">{t("sidebar.releaseNotes")}</span>
        </button>
      </div>
    </aside>
  );
}

// ── ストーリー ─────────────────────────────────────────

const meta: Meta = {
  title: "Components/FileSidebar IA Proposal",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "左サイドバーの情報アーキテクチャ見直し案。Current（現状）と Proposed（提案）を比較する。",
      },
    },
  },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <Story />
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

export const Current: Story = {
  name: "現状",
  render: () => (
    <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <FileSidebar {...COMMON_PROPS} />
      <div className="flex-1 p-8 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold mb-2">現状の構造</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>最近のノート</li>
          <li>データ（素材）</li>
          <li>ラベル</li>
          <li>ナレッジ（Skill を内包）</li>
        </ol>
        <p className="mt-4 text-xs">
          フラットな縦並び。ノート本体と入口（ラベル・素材）が混在し、Skill は AI の中。
        </p>
      </div>
    </div>
  ),
};

export const Proposed: Story = {
  name: "提案（IA見直し）",
  render: () => (
    <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <ProposedFileSidebar {...COMMON_PROPS} />
      <div className="flex-1 p-8 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold mb-2">提案の構造</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>最近のノート（自分が書く脳）</li>
          <li>ナレッジ（AI が編む脳）— Notes 直下に昇格</li>
          <li>── divider（区切り線のみ・見出しなし）──</li>
          <li>素材（旧: データ）</li>
          <li>ラベル</li>
        </ol>
        <p className="mt-4 text-xs">
          フッターに Skill / 設定 / ゴミ箱 / Release Notes を集約（メタ群）。
        </p>
        <p className="mt-2 text-xs">
          砂時計：素材 → ノート → ラベル(bottleneck) → ナレッジ。UI は頻度順、概念は別軸として保持。
        </p>
      </div>
    </div>
  ),
};

export const SideBySide: Story = {
  name: "並列比較",
  render: () => (
    <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="flex flex-col border-r-2 border-amber-200">
        <div className="px-3 py-1.5 bg-amber-50 text-[11px] font-semibold text-amber-900 border-b">CURRENT</div>
        <div className="flex-1 flex">
          <FileSidebar {...COMMON_PROPS} />
        </div>
      </div>
      <div className="flex flex-col">
        <div className="px-3 py-1.5 bg-emerald-50 text-[11px] font-semibold text-emerald-900 border-b">PROPOSED</div>
        <div className="flex-1 flex">
          <ProposedFileSidebar {...COMMON_PROPS} />
        </div>
      </div>
    </div>
  ),
};
