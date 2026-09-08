// フォルダツリー（noteContexts のフォルダ見せ）のカタログ。
// 議論用途: エクスプローラー慣れのユーザー向けに「タグ＋フィルタ」ではなく
// 「フォルダを開く」ナビゲーションモデルで見せる（design.md 決定事項 2026-08-31）。
// - ツリーの見た目・開閉・選択・件数（親 = 直下 + 子合計）
// - 未分類（文脈なしノート）の置き場
// - インライン新規作成と 2 階層制約
// 右クリックメニュー（名前の変更・削除）は FolderMenu 側の担当で、ツリーは入口だけ持つ。
// D&D のドロップ受けも持つが、ドラッグ元はノート一覧なので Storybook では再現しない
// （挙動の規則は folder-drop.ts の純関数とそのテストに置いてある）。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollapsibleSection } from "../../components/CollapsibleSection";
import { FolderTree, UNFILED_PATH } from "./FolderTree";

const meta: Meta = {
  title: "Molecules/FolderTree",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

// デモ用: 会話モックと同じ世界観（プロジェクトA 合計 12 = 直下 4 + 実験 5 + 実験 3）
const DEMO_FOLDERS = [
  { value: "プロジェクトA", count: 4 },
  { value: "プロジェクトA/実験シリーズ1", count: 5 },
  { value: "プロジェクトA/実験シリーズ2", count: 3 },
  { value: "材料X", count: 8 },
  { value: "哲学", count: 2 },
];

// ── 基本形 ──────────────────────────────────────────────
export const Tree: Story = {
  name: "ツリー（選択・開閉）",
  render: () => {
    const [selected, setSelected] = useState<string | null>("プロジェクトA/実験シリーズ1");
    return (
      <div className="p-4 bg-background max-w-[240px]">
        <FolderTree
          folders={DEMO_FOLDERS}
          unfiledCount={24}
          selected={selected}
          onSelectFolder={setSelected}
          onSelectUnfiled={() => setSelected(UNFILED_PATH)}
        />
        <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
          行クリック＝フォルダを開く（選択 + 子があれば展開）。シェブロン＝開閉のみ。
          親の件数は直下 + 子の合計。選択中フォルダの親は自動で開く。
          選択中: <code>{selected ?? "なし"}</code>
        </p>
      </div>
    );
  },
};

// ── サイドバー配置 ──────────────────────────────────────
export const InSidebar: Story = {
  name: "サイドバー配置（フォルダセクション）",
  render: () => {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="w-64 bg-sidebar border border-sidebar-border rounded-lg py-2">
        <CollapsibleSection storageKey="sb-demo-folders" title="フォルダ" count={22}>
          <FolderTree
            folders={DEMO_FOLDERS}
            unfiledCount={24}
            selected={selected}
            onSelectFolder={setSelected}
            onSelectUnfiled={() => setSelected(UNFILED_PATH)}
            onCreateFolder={() => {}}
          />
        </CollapsibleSection>
      </div>
    );
  },
};

// ── 新規作成 ────────────────────────────────────────────
export const CreateFolder: Story = {
  name: "新しいフォルダ（インライン作成・2 階層制約）",
  render: () => {
    const [extra, setExtra] = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="p-4 bg-background max-w-[240px]">
        <FolderTree
          folders={DEMO_FOLDERS}
          emptyFolders={extra}
          unfiledCount={24}
          selected={selected}
          onSelectFolder={setSelected}
          onSelectUnfiled={() => setSelected(UNFILED_PATH)}
          onCreateFolder={(path) => setExtra((prev) => [...prev, path])}
        />
        <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
          「＋ 新しいフォルダ」→ 名前を入れて Enter。まだノートが無いフォルダは件数なしで並ぶ
          （空フォルダ。appdata の定義ファイルに永続化される）。
          「親/子」と書くとサブフォルダ。「a/b/c」は 2 階層制約でエラーになる。
          Esc・フォーカスアウトでキャンセル。
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          親フォルダにホバー、または選択中のとき右端に「＋」が出る。ここから作るとスラッシュを
          打たずにその中のフォルダを作れる（子フォルダには 2 階層制約のため出ない）。
          「＋」は絶対配置で、件数はその左へ逃がす — 行の流れに置くと件数が押し出されて、
          素材・ラベルなど他セクションの件数と縦に揃わなくなるため。
        </p>
      </div>
    );
  },
};

// ── その場での名前変更 ──────────────────────────────────
export const RenameHover: Story = {
  name: "名前変更の入口（選択中: ＋ と鉛筆が並ぶ）",
  render: () => {
    const [selected, setSelected] = useState<string | null>("プロジェクトA");
    return (
      <div className="p-4 bg-background max-w-[240px]">
        <FolderTree
          folders={DEMO_FOLDERS}
          unfiledCount={24}
          selected={selected}
          onSelectFolder={setSelected}
          onSelectUnfiled={() => setSelected(UNFILED_PATH)}
          onCreateFolder={() => {}}
          onRenameFolder={() => {}}
        />
        <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
          選択中の「プロジェクトA」行にマウスを載せると、＋（この中に作る）と鉛筆（名前を変更）が
          並んで出る。他の行はホバーしたときだけ出る。
          入口はほかに: 名前のダブルクリック／行が選択中でフォーカスがあるときの Enter。
        </p>
      </div>
    );
  },
};

export const Renaming: Story = {
  name: "編集中（子フォルダの名前を差し替え中）",
  render: () => (
    <div className="p-4 bg-background max-w-[240px]">
      <FolderTree
        folders={DEMO_FOLDERS}
        unfiledCount={24}
        selected="プロジェクトA/実験シリーズ1"
        onSelectFolder={() => {}}
        onSelectUnfiled={() => {}}
        onRenameFolder={() => {}}
        defaultEditingPath="プロジェクトA/実験シリーズ1"
      />
      <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
        入力欄が名前の位置に差し替わり、＋・鉛筆・件数は隠れて幅を確保する。
        Enter で確定（親はそのまま、葉だけ差し替え）／Escape で取り消し／
        blur は変わっていて有効なら確定、そうでなければ黙って取り消す。
      </p>
    </div>
  ),
};

export const RenamingInvalid: Story = {
  name: "編集中（無効な名前 = エラー表示）",
  render: () => (
    <div className="p-4 bg-background max-w-[240px]">
      <FolderTree
        folders={DEMO_FOLDERS}
        unfiledCount={24}
        selected="プロジェクトA"
        onSelectFolder={() => {}}
        onSelectUnfiled={() => {}}
        onRenameFolder={() => {}}
        defaultEditingPath="プロジェクトA"
        defaultEditingDraft="実験/シリーズ"
      />
      <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
        "/" を含む・空などの無効な名前で Enter を押した直後の状態
        （defaultEditingDraft はエラー表示を見せるためのストーリー専用 prop）。
        入力欄の下に検証エラー文言が出る。blur では同じ入力でも黙って取り消す挙動になる。
      </p>
    </div>
  ),
};

// ── 空の状態 ────────────────────────────────────────────
export const EmptyStates: Story = {
  name: "空の状態（フォルダなし / 空フォルダのみ）",
  render: () => (
    <div className="p-4 bg-background flex gap-8">
      <div className="max-w-[240px] flex-1">
        <p className="text-xs text-muted-foreground mb-2">フォルダなし（未分類だけ）</p>
        <FolderTree folders={[]} unfiledCount={24} onCreateFolder={() => {}} />
      </div>
      <div className="max-w-[240px] flex-1">
        <p className="text-xs text-muted-foreground mb-2">空フォルダのみ（先にフォルダを作った直後）</p>
        <FolderTree
          folders={[]}
          emptyFolders={["プロジェクトB", "プロジェクトB/構想"]}
          unfiledCount={24}
          onCreateFolder={() => {}}
        />
      </div>
    </div>
  ),
};
