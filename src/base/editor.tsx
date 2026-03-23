import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { useCreateBlockNote } from "@blocknote/react";
import { SideMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { FC, useEffect } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SideMenuProps } from "@blocknote/react";

type SandboxEditorProps = {
  blocks?: CustomBlockEntry[];
  initialContent?: any[];
  /**
   * カスタムSideMenuコンポーネントを渡す。
   * - undefined: デフォルトのSideMenu
   * - false: SideMenuを非表示
   * - FC: カスタムSideMenuコンポーネント
   */
  sideMenu?: FC<SideMenuProps> | false;
  /** エディタインスタンスを外部に公開するコールバック */
  onEditorReady?: (editor: any) => void;
};

// サンドボックス共通エディタ
// blocks を渡すだけでカスタムブロック入りエディタが立ち上がる
export function SandboxEditor({
  blocks = [],
  initialContent,
  sideMenu,
  onEditorReady,
}: SandboxEditorProps) {
  const customSpecs = Object.fromEntries(
    blocks.map((b) => [b.type, typeof b.spec === "function" ? b.spec() : b.spec])
  );

  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      ...customSpecs,
    } as any,
  });

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialContent?.length ? (initialContent as any) : undefined,
  });

  // エディタインスタンスを外部に公開
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // カスタムSideMenuを渡した場合: デフォルトを無効にして手動レンダリング
  const usesCustomSideMenu = sideMenu !== undefined && sideMenu !== false;

  return (
    <BlockNoteView
      editor={editor as any}
      theme="light"
      sideMenu={sideMenu === false ? false : usesCustomSideMenu ? false : undefined}
    >
      {usesCustomSideMenu && (
        <SideMenuController sideMenu={sideMenu as FC<SideMenuProps>} />
      )}
    </BlockNoteView>
  );
}
