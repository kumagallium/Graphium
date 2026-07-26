// サイドメニュー関連コンポーネント
// NoteSideMenu, DeriveNoteMenuItem, AiAssistantMenuItem

import { useEffect, useState } from "react";
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
import { SideMenuExtension } from "@blocknote/core/extensions";
import { resolveMemoBlockLabel } from "../features/mobile-capture/block-label";
import { useAiAssistant } from "../features/ai-assistant";
import { useT, getDisplayLabelName } from "../i18n";
import { useLabelStore, useProvLabelsEnabled, type CoreLabel } from "../features/context-label";
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

// 見出しブロックの配下ブロックを収集する（スコープ選択）
// 同じレベル以上の見出しが出てきたら終了
export function collectHeadingScope(doc: any[], headingBlock: any): any[] {
  const level = headingBlock.props?.level ?? 1;
  const blocks = Array.isArray(doc) ? doc : [];
  const idx = blocks.findIndex((b: any) => b.id === headingBlock.id);
  if (idx < 0) return [headingBlock];

  const scope = [blocks[idx]];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading" && (b.props?.level ?? 1) <= level) break;
    scope.push(b);
  }
  return scope;
}

// SideMenu の Floating UI 親は transform: translate(X,Y) で配置されるため、
// その中の position:fixed なドロップダウンは containing block の影響で位置がずれる。
// 親の transform を読み取り、ドロップダウン wrapper に逆オフセットを適用して打ち消す。
function useFixDropdownPosition() {
  useEffect(() => {
    const fix = () => {
      const wrapper = document.querySelector(
        "[data-radix-popper-content-wrapper]"
      ) as HTMLElement;
      if (!wrapper) return;

      // ドロップダウンのトリガー（⠿ ボタン）を探す
      const trigger = document.querySelector(
        ".bn-side-menu .bn-button[draggable]"
      ) as HTMLElement;
      if (!trigger) return;

      // トリガーの viewport 位置
      const triggerRect = trigger.getBoundingClientRect();
      // ドロップダウンの viewport 位置・サイズ
      const wrapperRect = wrapper.getBoundingClientRect();
      const dropdownHeight = wrapperRect.height || 160;

      // 下にスペースがあれば下、なければ上に配置
      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const expectedTop =
        spaceBelow >= dropdownHeight + 8
          ? triggerRect.bottom // 下に表示
          : triggerRect.top - dropdownHeight; // 上に表示

      const actualTop = wrapperRect.top;
      const diffY = actualTop - expectedTop;

      // 大きくずれている場合のみ補正
      if (Math.abs(diffY) > 20) {
        const currentMarginTop = parseFloat(wrapper.style.marginTop) || 0;
        wrapper.style.marginTop = `${currentMarginTop - diffY}px`;
      }
    };

    const observer = new MutationObserver(fix);
    const root = document.getElementById("root");
    if (root) {
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    }
    return () => observer.disconnect();
  }, []);
}

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

  if (!block || !aiAssistant.aiAvailable) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={async () => {
        let targetBlocks: any[];
        if (block.type === "heading") {
          targetBlocks = collectHeadingScope(editor.document, block);
        } else {
          targetBlocks = [block];
        }
        const markdown = await editor.blocksToMarkdownLossy(targetBlocks);
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
// 見出しブロックの section / phase 系
const HEADING_BLOCK_LABELS: CoreLabel[] = ["procedure", "plan", "result"];

const MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/** ブロック種別 → 付与可能なラベルとヒント。null なら「ラベル」セクションを出さない。 */
function resolveBlockLabelSpec(
  blockType: string,
): { labels: CoreLabel[]; hintKey: string } | null {
  if (blockType === "heading")
    return { labels: HEADING_BLOCK_LABELS, hintKey: "editor.blockLabel.headingHint" };
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
  const spec = resolveBlockLabelSpec(blockType);
  if (!spec) return null; // 段落・リスト等はテキスト選択（浮上ツールバー）経路に任せる

  const isMedia = MEDIA_BLOCK_TYPES.has(blockType);
  // メディアは mediaInlineLabels、それ以外（見出し / テーブル）は labels[] を参照
  const currentLabel = isMedia
    ? mediaStore?.getLabel(block.id)?.label
    : labelStore.getLabel(block.id);

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

export function NoteSideMenu() {
  const t = useT();
  useFixDropdownPosition();
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton>
        <TurnIntoMenuItems />
        <DeleteBlockMenuItem />
        <BlockColorsItem>{t("common.color")}</BlockColorsItem>
        <AlignmentMenuItems />
        <BlockLabelMenuItems />
        <ReadImageTextMenuItem />
        <AddMemoMenuItem />
        <DeriveNoteMenuItem />
        <AiAssistantMenuItem />
      </DragHandleButton>
    </SideMenu>
  );
}
