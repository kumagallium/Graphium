// サイドメニュー関連コンポーネント
// NoteSideMenu, DeriveNoteMenuItem, AiAssistantMenuItem

import { useState } from "react";
import {
  AddBlockButton,
  DragHandleButton,
  BlockColorsItem,
  SideMenu,
  useBlockNoteEditor,
  useExtensionState,
  useComponentsContext,
} from "@blocknote/react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  ListCollapse,
  Quote,
  Code,
} from "lucide-react";
import { useBlockAlignmentStoreOptional, type BlockAlignment } from "../features/block-alignment";
import { applyLogTableTimestamps } from "../features/log-table";
import { useTableMetaStoreOptional } from "../features/table-meta/store";
import { readFirstColumnName } from "../features/table-meta/table-cells";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { resolveMemoBlockLabel } from "../features/mobile-capture/block-label";
import { useAiAssistant } from "../features/ai-assistant";
import { useDuplicateBlocks } from "../features/block-duplicate";
import { blocksToMarkdown } from "../features/markdown-export/blocks-to-markdown";
import { useT, getDisplayLabelName } from "../i18n";
import { useLabelStore, useProvLabelsEnabled, type CoreLabel } from "../features/context-label";
import { isBlockInsideStep } from "../blocks/step/view";
import {
  useMediaInlineLabelStoreOptional,
  makeMediaEntityId,
  type MediaInlineLabelType,
} from "../features/inline-label/media-store";
import {
  useMediaOcrStoreOptional,
  runOcrForImage,
  OCR_CAPABLE_BLOCK_TYPES,
} from "../features/media-ocr";

// 派生ノート作成用のグローバルコールバック
let openLinkDropdownFn: ((params: {
  type: "prevStep" | "general";
  sourceBlockId: string;
  anchorRect: { top: number; left: number };
}) => void) | null = null;

export function setOpenLinkDropdownFn(
  fn: typeof openLinkDropdownFn,
) {
  openLinkDropdownFn = fn;
}

// ブロック紐付きメモ作成用のグローバルコールバック
// （openLinkDropdownFn と同じ流儀。note-app.tsx がダイアログ表示を担当する）
let openBlockMemoFn: ((params: {
  blockId: string;
  blockText: string;
}) => void) | null = null;

export function setOpenBlockMemoFn(fn: typeof openBlockMemoFn) {
  openBlockMemoFn = fn;
}

// ブロックの「配下」を収集する（スコープ選択）
// - 見出し: 同じレベル以上の見出しが出てきたら終了（後続の兄弟が範囲）
// - step コンテナ: 子ブロックがそのまま範囲（containment）
// どちらも「このまとまりの中身」を返す、という意味では同じ。
export function collectBlockScope(doc: any[], block: any): any[] {
  // step は範囲が親子関係で決まるので、文書中の位置を探す必要がない
  if (block?.type === "step") {
    return [block, ...(Array.isArray(block.children) ? block.children : [])];
  }

  const level = block.props?.level ?? 1;
  const blocks = Array.isArray(doc) ? doc : [];
  const idx = blocks.findIndex((b: any) => b.id === block.id);
  if (idx < 0) return [block];

  const scope = [blocks[idx]];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading" && (b.props?.level ?? 1) <= level) break;
    scope.push(b);
  }
  return scope;
}

// かつてここには useFixDropdownPosition という位置補正フックがあった。
// ドラッグハンドルのメニューが明後日の位置に出るのを、DOM を直接動かして
// 押し戻すものだったが、原因は「Floating UI 親の transform」ではなく、
// 同梱の shadcn Button が ref を受け取れず Radix が anchor を掴めていないこと
// だった（base/blocknote-shadcn-overrides.tsx 参照）。根本側を直したので撤去する。
//
// 復活させないこと: このフックは document 内で最初に見つかった
// [data-radix-popper-content-wrapper] を掴むため、テーブルの列ハンドルの
// メニューをサイドメニューのハンドル基準で動かしてしまう。

// DragHandle メニュー内: 派生ノート作成
function DeriveNoteMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        openLinkDropdownFn?.({
          type: "general",
          sourceBlockId: block.id,
          anchorRect: { top: 0, left: 0 },
        });
      }}
    >
      {t("editor.derive")}
    </Components.Generic.Menu.Item>
  );
}

// DragHandle メニュー内: ブロック紐付きメモ作成
// このブロックを出典（sourceNote.blockId）にしたメモの入力ダイアログを開く。
// コールバック未登録の文脈（Storybook 等）では項目自体を出さない。
function AddMemoMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block || !openBlockMemoFn) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        // メニュー表示中の block は content が古い可能性があるため、
        // クリック時点の最新ブロックから表示ラベルを取り直す
        const latest = editor.getBlock(block.id) ?? block;
        openBlockMemoFn?.({ blockId: block.id, blockText: resolveMemoBlockLabel(latest) });
      }}
    >
      {t("memo.addToBlock")}
    </Components.Generic.Menu.Item>
  );
}

// DragHandle メニュー内: AI アシスタント（スコープ選択対応）
function AiAssistantMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  const aiAssistant = useAiAssistant();
  const tableMetaStore = useTableMetaStoreOptional();

  if (!block || !aiAssistant.aiAvailable) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={async () => {
        // 見出し・step は「まとまり」なので配下ごと AI に渡す
        const targetBlocks: any[] =
          block.type === "heading" || block.type === "step"
            ? collectBlockScope(editor.document, block)
            : [block];
        // 「表 N」の自動名は文書順で決まるので、番号付けはページ全体で行う
        const markdown = await blocksToMarkdown(editor, targetBlocks, {
          tableMeta: tableMetaStore?.getSnapshot(),
          documentBlocks: editor.document,
        });
        aiAssistant.openChat({
          sourceBlockIds: targetBlocks.map((b: any) => b.id),
          quotedMarkdown: markdown,
        });
      }}
    >
      {t("editor.aiAssistant")}
    </Components.Generic.Menu.Item>
  );
}

// ──────────────────────────────────────────────
// DragHandle メニュー内: ブロック全体の Entity 化ラベル（案 Y-1）
//
// 「ブロック全体 = 1 概念」のラベル付与をここに集約する。テキストの一部（span）の
// Entity 化は浮上ツールバー据え置き。入口は共通だが、保存先はブロック種別で分岐する:
//   - 見出し / テーブル → labelStore（page.labels[blockId]）
//   - メディア          → mediaInlineLabelStore（page.mediaInlineLabels[blockId]）
// メディアは entity-subtype 系（インラインハイライトと同じファミリ）なので、
// labels[] のブロックラベルには変換せず mediaInlineLabels の carrier を維持する。
// ──────────────────────────────────────────────

// 色は context-label/ui.tsx の LABEL_COLORS と同値（正準のラベルピッカーに揃える）
const BLOCK_LABEL_COLORS: Record<string, string> = {
  procedure: "#5b8fb9",
  plan: "#7aa6c4",
  result: "#9b7fb8",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  output: "#c26356",
};

// entity-subtype 系（テーブル / メディアのブロック全体に付与）
const ENTITY_BLOCK_LABELS: CoreLabel[] = ["material", "tool", "attribute", "output"];
// 旧方式（見出し + ラベル）で工程を書いていたノート向け。新規付与の導線は無い。
const LEGACY_HEADING_LABELS: CoreLabel[] = ["procedure", "plan", "result"];

const MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/**
 * ブロック種別 → 付与可能なラベルとヒント。null なら「ラベル」セクションを出さない。
 *
 * 工程は step ブロックが表すようになったので、見出しに工程ラベルを新しく
 * 付ける導線は無い。ただし旧方式で書かれたノートを直せなくなると困るので、
 * 既にラベルが付いている見出しでは従来のメニューを出す（変更・解除のため）。
 */
function resolveBlockLabelSpec(
  blockType: string,
  opts: { hasLegacyLabel: boolean },
): { labels: CoreLabel[]; hintKey: string } | null {
  if (blockType === "heading") {
    return opts.hasLegacyLabel
      ? { labels: LEGACY_HEADING_LABELS, hintKey: "editor.blockLabel.headingHint" }
      : null;
  }
  if (blockType === "table")
    return { labels: ENTITY_BLOCK_LABELS, hintKey: "editor.blockLabel.tableHint" };
  if (MEDIA_BLOCK_TYPES.has(blockType))
    return { labels: ENTITY_BLOCK_LABELS, hintKey: "editor.blockLabel.mediaHint" };
  return null;
}

function BlockLabelMenuItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const provLabelsEnabled = useProvLabelsEnabled();
  const labelStore = useLabelStore();
  const mediaStore = useMediaInlineLabelStoreOptional();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;
  // 来歴ラベル機能がオフなら「ラベル ▸」サブメニューを出さない。
  if (!provLabelsEnabled) return null;
  const blockType = block.type as string;
  const isMedia = MEDIA_BLOCK_TYPES.has(blockType);
  // メディアは mediaInlineLabels、それ以外（見出し / テーブル）は labels[] を参照
  const currentLabel = isMedia
    ? mediaStore?.getLabel(block.id)?.label
    : labelStore.getLabel(block.id);

  const spec = resolveBlockLabelSpec(blockType, {
    hasLegacyLabel:
      currentLabel === "procedure" ||
      currentLabel === "plan" ||
      currentLabel === "result",
  });
  if (!spec) return null; // 段落・リスト等はテキスト選択（浮上ツールバー）経路に任せる

  // テーブル / メディアのラベルも step の中でだけ新規付与できる
  // （工程の外の Entity は束縛先の Activity が無い）。既存ラベルは外せるよう残す。
  if (!currentLabel && !isBlockInsideStep((editor as any).document ?? [], block.id)) {
    return null;
  }

  const applyLabel = (label: CoreLabel) => {
    const active = currentLabel === label;
    if (isMedia) {
      if (!mediaStore) return;
      if (active) {
        mediaStore.setLabel(block.id, null);
      } else {
        const existing = mediaStore.getLabel(block.id);
        mediaStore.setLabel(block.id, {
          label: label as MediaInlineLabelType,
          entityId:
            existing?.entityId ?? makeMediaEntityId(label as MediaInlineLabelType),
        });
      }
    } else {
      labelStore.setLabel(block.id, active ? null : label);
    }
  };

  // 「色」と同じく Generic.Menu の sub プロップでサブメニュー（flyout）にする。
  // ブロック全体の Entity 化を「ラベル ▸」の階層に畳み、トップのメニューを浅く保つ。
  return (
    <Components.Generic.Menu.Root position="right" sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>
          {t("editor.blockLabel")}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub={true} className="bn-menu-dropdown">
        {spec.labels.map((label) => {
          const active = currentLabel === label;
          return (
            <Components.Generic.Menu.Item
              key={label}
              className="bn-menu-item"
              onClick={() => applyLabel(label)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    background: BLOCK_LABEL_COLORS[label] ?? "#6b7280",
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ fontWeight: active ? 700 : 400 }}>
                  {getDisplayLabelName(label)}
                </span>
                {active && <span style={{ marginLeft: 4, opacity: 0.7 }}>✓</span>}
              </span>
            </Components.Generic.Menu.Item>
          );
        })}
        <Components.Generic.Menu.Label>
          <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>{t(spec.hintKey)}</span>
        </Components.Generic.Menu.Label>
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

// ──────────────────────────────────────────────
// DragHandle メニュー内: ブロック複製
//
// 直下に同じブロックを作る。ラベル・step 属性・内部リンク・配置・記録テーブルの
// 登録は複製先に引き継ぐ（引き継ぎ範囲の根拠は use-duplicate-blocks.ts のコメント）。
// ⌘D / Ctrl+D と同じ経路を通るので、導線が違っても結果は同じになる。
// ──────────────────────────────────────────────
export function DuplicateBlockMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const duplicate = useDuplicateBlocks();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        duplicate([block.id]);
      }}
    >
      {t("editor.duplicate")}
    </Components.Generic.Menu.Item>
  );
}

// ──────────────────────────────────────────────
// DragHandle メニュー内: ブロック削除
//
// BlockNote 標準の <RemoveBlockItem> は配布版デスクトップ（WKWebView）で
// 「押しても消えない」報告があったため、他のカスタム項目（派生 / AI）と
// 同じく明示的な onClick + editor.removeBlocks に置き換える。
// removeBlocks は段落・テーブル・メディア・唯一のブロックすべてで動作する
// （唯一のブロックは空ブロックに置換される）ことを実機で確認済み。
// ──────────────────────────────────────────────
export function DeleteBlockMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        editor.removeBlocks([block.id]);
      }}
    >
      {t("common.delete")}
    </Components.Generic.Menu.Item>
  );
}

// ──────────────────────────────────────────────
// DragHandle メニュー内: 配置（左 / 中央 / 右）
//
// 配置揃えはテキスト選択時の浮上ツールバーにもあるが、見出し・画像・Callout・
// テーブルなどを「選択せずに」揃えたい場面が多く、Notion 同様ブロックメニューからも
// 操作できるようにする（発見性の改善）。
//
// 保存先はブロック種別で分岐する:
//   - textAlignment プロパティを持つブロック（段落 / 見出し / 画像 / 動画 /
//     Callout）→ block.props.textAlignment（BlockNote 標準）
//   - 持たないブロック（table / audio / file）→ blockAlignmentStore（サイドストア）
//     ※ BlockNote はテーブル等に textAlignment を持たせられないため。
//        ストアが無い文脈（Storybook 等）では非対応ブロックの項目を出さない。
// ──────────────────────────────────────────────
const ALIGN_OPTIONS: {
  value: BlockAlignment;
  labelKey: string;
  Icon: typeof AlignLeft;
}[] = [
  { value: "left", labelKey: "editor.align.left", Icon: AlignLeft },
  { value: "center", labelKey: "editor.align.center", Icon: AlignCenter },
  { value: "right", labelKey: "editor.align.right", Icon: AlignRight },
];

export function AlignmentMenuItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const alignStore = useBlockAlignmentStoreOptional();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;
  // textAlignment プロパティを持つブロックは標準プロパティで、持たないブロックは
  // サイドストアで配置を保存する。ストアが無い文脈では非対応ブロックは出さない。
  const supportsNativeAlign = Boolean(
    (editor as any).schema?.blockSchema?.[block.type]?.propSchema?.textAlignment,
  );
  const useStore = !supportsNativeAlign;
  if (useStore && !alignStore) return null;

  const current: BlockAlignment = useStore
    ? alignStore!.getAlignment(block.id) ?? "left"
    : ((block.props as any)?.textAlignment ?? "left");

  const apply = (value: BlockAlignment) => {
    if (useStore) {
      alignStore!.setAlignment(block.id, value);
    } else {
      editor.updateBlock(block, { props: { textAlignment: value } } as any);
    }
  };

  return (
    <Components.Generic.Menu.Root position="right" sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>
          {t("editor.align")}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub={true} className="bn-menu-dropdown">
        {ALIGN_OPTIONS.map(({ value, labelKey, Icon }) => {
          const active = current === value;
          return (
            <Components.Generic.Menu.Item
              key={value}
              className="bn-menu-item"
              onClick={() => apply(value)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icon size={14} />
                <span style={{ fontWeight: active ? 700 : 400 }}>{t(labelKey)}</span>
                {active && <span style={{ marginLeft: 4, opacity: 0.7 }}>✓</span>}
              </span>
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

// ──────────────────────────────────────────────
// DragHandle メニュー内: 種類を変更（Turn into）
//
// Notion の「Turn into」に相当。既存ブロックの種類を段落・見出し・各種リスト・
// トグル・引用・コードへ後から変換する。テキスト選択時の浮上ツールバーにも
// BlockTypeSelect（同等の変換）はあるが、見出しや空行を「選択せずに」ブロック単位で
// 変換したい場面が多いため、Notion 同様ブロックメニューからも操作できるようにする。
//
// 変換は BlockNote 標準の editor.updateBlock(block, { type, props }) 一発。content を
// 渡さないので本文（インラインテキスト）は保持される。
//
// 出すのはテキスト系ブロックのときだけ。メディア（image/video/audio/file/pdf）・
// table・pageBreak は種類変換で本文が壊れる/意味を成さないため対象外。
// ──────────────────────────────────────────────

// Turn into メニューを出す「変換元」ブロック種別。
const TURN_INTO_SOURCE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "codeBlock",
]);

// 変換候補（Notion 準拠の並び）。
//   - props は変換先が要求するもののみ（見出しの level）。
//   - match は「現在このタイプか」をチェックマーク表示 / no-op 判定に使う。
const TURN_INTO_OPTIONS: {
  labelKey: string;
  type: string;
  props?: Record<string, unknown>;
  Icon: typeof AlignLeft;
  match: (block: any) => boolean;
}[] = [
  {
    labelKey: "editor.turnIntoType.paragraph",
    type: "paragraph",
    Icon: Type,
    match: (b) => b.type === "paragraph",
  },
  {
    labelKey: "editor.turnIntoType.heading1",
    type: "heading",
    props: { level: 1 },
    Icon: Heading1,
    match: (b) => b.type === "heading" && (b.props?.level ?? 1) === 1,
  },
  {
    labelKey: "editor.turnIntoType.heading2",
    type: "heading",
    props: { level: 2 },
    Icon: Heading2,
    match: (b) => b.type === "heading" && b.props?.level === 2,
  },
  {
    labelKey: "editor.turnIntoType.heading3",
    type: "heading",
    props: { level: 3 },
    Icon: Heading3,
    match: (b) => b.type === "heading" && b.props?.level === 3,
  },
  {
    labelKey: "editor.turnIntoType.bulletList",
    type: "bulletListItem",
    Icon: List,
    match: (b) => b.type === "bulletListItem",
  },
  {
    labelKey: "editor.turnIntoType.numberedList",
    type: "numberedListItem",
    Icon: ListOrdered,
    match: (b) => b.type === "numberedListItem",
  },
  {
    labelKey: "editor.turnIntoType.checkList",
    type: "checkListItem",
    Icon: ListChecks,
    match: (b) => b.type === "checkListItem",
  },
  {
    labelKey: "editor.turnIntoType.toggleList",
    type: "toggleListItem",
    Icon: ListCollapse,
    match: (b) => b.type === "toggleListItem",
  },
  {
    labelKey: "editor.turnIntoType.quote",
    type: "quote",
    Icon: Quote,
    match: (b) => b.type === "quote",
  },
  {
    labelKey: "editor.turnIntoType.codeBlock",
    type: "codeBlock",
    Icon: Code,
    match: (b) => b.type === "codeBlock",
  },
];

export function TurnIntoMenuItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;
  // テキスト系ブロックのみ変換導線を出す（メディア / テーブル / 改ページは対象外）。
  if (!TURN_INTO_SOURCE_TYPES.has(block.type as string)) return null;

  const apply = (option: (typeof TURN_INTO_OPTIONS)[number]) => {
    // 既に同じ種類なら何もしない（no-op 変換で余計な変更履歴を作らない）。
    if (option.match(block)) return;
    editor.updateBlock(block, {
      type: option.type,
      props: option.props ?? {},
    } as any);
  };

  // 「配置」「ラベル」と同じく Generic.Menu の sub でサブメニュー（flyout）にする。
  return (
    <Components.Generic.Menu.Root position="right" sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>
          {t("editor.turnInto")}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub={true} className="bn-menu-dropdown">
        {TURN_INTO_OPTIONS.map((option) => {
          const active = option.match(block);
          const { Icon } = option;
          return (
            <Components.Generic.Menu.Item
              key={option.labelKey}
              className="bn-menu-item"
              onClick={() => apply(option)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icon size={14} />
                <span style={{ fontWeight: active ? 700 : 400 }}>{t(option.labelKey)}</span>
                {active && <span style={{ marginLeft: 4, opacity: 0.7 }}>✓</span>}
              </span>
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

// ──────────────────────────────────────────────
// DragHandle メニュー内: 画像から文字を読む（端末内 OCR, LLM 不使用）
//
// 専用ブロックを設けず標準の image ブロックに対して実行する。貼り方
// （/image・ペースト・ドラッグ&ドロップ・素材ギャラリー）を問わずどの画像でも
// 後から読めるようにするため。結果は mediaOcr サイドストアに入り、ノート横断検索・
// PROV グラフ・素材ギャラリーから参照される。
// ──────────────────────────────────────────────
function ReadImageTextMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const ocrStore = useMediaOcrStoreOptional();
  const [running, setRunning] = useState(false);
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block || !ocrStore) return null;
  if (!OCR_CAPABLE_BLOCK_TYPES.has(block.type as string)) return null;
  const url = block.props?.url as string | undefined;
  if (!url) return null; // 画像未設定のプレースホルダには出さない

  const existing = ocrStore.getEntry(block.id);
  const charCount = existing?.text ? existing.text.replace(/\s/g, "").length : 0;

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const entry = await runOcrForImage(url);
      // 文字が取れなかった画像はエントリを残さない（検索ノイズを避ける）
      ocrStore.setEntry(block.id, entry.text ? entry : null);
    } catch (e) {
      console.warn("OCR に失敗:", e);
    } finally {
      setRunning(false);
    }
  };

  const label = running
    ? t("ocr.running")
    : charCount > 0
      ? `${t("ocr.done")}（${t("ocr.chars", { count: String(charCount) })}）`
      : t("ocr.readText");

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => void run()}
    >
      {label}
    </Components.Generic.Menu.Item>
  );
}

/**
 * テーブルブロックの「時系列テーブル」トグル。
 * 時系列テーブルは独立したブロック型ではなく、標準テーブルに後から付け外し
 * できる「ふるまい」（行を足すと日時が入る）— テーブルの種類を増やさないための
 * 統合方針。実装としては先頭列に datetime-auto を付け外しするショートカットで、
 * スラッシュメニューの「時系列テーブル」は、このふるまいが最初から付いた
 * テーブルを一発で作るテンプレートという位置づけになる。
 */
function LogTableToggleMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const tableMeta = useTableMetaStoreOptional();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  if (!block || !tableMeta) return null;
  if ((block.type as string) !== "table") return null;
  const isLog = tableMeta.hasColumnType(block.id, "datetime-auto");
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        if (isLog) {
          tableMeta.removeColumnType(block.id, "datetime-auto");
        } else {
          tableMeta.addColumnType(block.id, readFirstColumnName(block), "datetime-auto");
          // 付けた直後の行追加から日時が入るよう、現在の行数を初見として記録する
          applyLogTableTimestamps(editor, [block.id]);
        }
      }}
    >
      {isLog ? t("logTable.menuDisable") : t("logTable.menuEnable")}
    </Components.Generic.Menu.Item>
  );
}

/**
 * テーブルブロックの「インデックステーブル」トグル。
 * 時系列テーブルのトグルと同じ統合方針: インデックステーブルも独立したブロック型
 * ではなく、標準テーブルに後から付け外しできる「ふるまい」（行ごとにノートを
 * 持てる）で、実装としては先頭列に note-link を付け外しするショートカット。
 * 解除すると行とノートの紐付け設定は消える（ノート本体は残る）。
 */
function IndexTableToggleMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const tableMeta = useTableMetaStoreOptional();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  if (!block || !tableMeta) return null;
  if ((block.type as string) !== "table") return null;
  const isIndex = tableMeta.hasColumnType(block.id, "note-link");
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        if (isIndex) {
          tableMeta.removeColumnType(block.id, "note-link");
        } else {
          tableMeta.addColumnType(block.id, readFirstColumnName(block), "note-link");
        }
      }}
    >
      {isIndex ? t("indexTable.menuDisable") : t("indexTable.menuEnable")}
    </Components.Generic.Menu.Item>
  );
}

/**
 * テーブルに名前（キャプション）を付ける入口。
 * 名前はどのテーブルにも付けられる — 学術文書の表キャプションと同じ位置に出て、
 * チャートから参照するときの表示名にもなる。空にすれば消える。
 */
function TableCaptionMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const tableMeta = useTableMetaStoreOptional();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  if (!block || !tableMeta) return null;
  if ((block.type as string) !== "table") return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => tableMeta.requestCaptionEdit(block.id)}
    >
      {t("tableMeta.menuSetCaption")}
    </Components.Generic.Menu.Item>
  );
}

export function NoteSideMenu() {
  const t = useT();
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton>
        <TurnIntoMenuItems />
        <DuplicateBlockMenuItem />
        <DeleteBlockMenuItem />
        <BlockColorsItem>{t("common.color")}</BlockColorsItem>
        <AlignmentMenuItems />
        <BlockLabelMenuItems />
        <TableCaptionMenuItem />
        <LogTableToggleMenuItem />
        <IndexTableToggleMenuItem />
        <ReadImageTextMenuItem />
        <AddMemoMenuItem />
        <DeriveNoteMenuItem />
        <AiAssistantMenuItem />
      </DragHandleButton>
    </SideMenu>
  );
}
