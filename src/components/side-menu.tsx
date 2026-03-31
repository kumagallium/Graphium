// サイドメニュー関連コンポーネント
// NoteSideMenu, DeriveNoteMenuItem, AiAssistantMenuItem

import { useEffect } from "react";
import {
  AddBlockButton,
  DragHandleButton,
  RemoveBlockItem,
  BlockColorsItem,
  SideMenu,
  useBlockNoteEditor,
  useExtensionState,
  useComponentsContext,
} from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { useAiAssistant } from "../features/ai-assistant";
import { useT } from "../i18n";

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

  if (!block) return null;

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

export function NoteSideMenu() {
  const t = useT();
  useFixDropdownPosition();
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton>
        <RemoveBlockItem>{t("common.delete")}</RemoveBlockItem>
        <BlockColorsItem>{t("common.color")}</BlockColorsItem>
        <DeriveNoteMenuItem />
        <AiAssistantMenuItem />
      </DragHandleButton>
    </SideMenu>
  );
}
