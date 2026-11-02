// ノートに紐づかないチャットで「どのフォルダから探すか」を選ぶチップ。
//
// 渡す範囲チップ（外部参照 / 内部参照 = どこまで探すか）とは別の軸。フォルダを選ぶと、
// そのフォルダ（と子フォルダ）のノートと、そこからナレッジ化で生まれた知見・トピックだけを
// 横断検索の対象にする（集合の計算は note-context/folder-scope.ts）。
// 未選択は「すべて」で、今までと同じく手元のノートとナレッジ全体を探す。
//
// 純粋な制御コンポーネント（value / onChange のみ）。フォルダ一覧も呼び出し側が渡す。

import { useRef, useState } from "react";
import { ChevronDown, Folder, X } from "lucide-react";
import { Dropdown, type DropdownPosition } from "@/ui/dropdown";
import { MenuItem } from "@/ui/menu-item";
import { useT } from "@/i18n";
import type { FolderNode } from "../note-context/folder-tree-model";

type Props = {
  /** 選んでいるフォルダの path（"親" または "親/子"）。undefined は「すべて」 */
  value?: string;
  onChange: (folder: string | undefined) => void;
  /** サイドバーと同じフォルダツリー */
  folders: readonly FolderNode[];
};

export function FolderScopeChip({ value, onChange, folders }: Props) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.left, anchorRect: rect });
  };
  const choose = (folder: string | undefined) => {
    onChange(folder);
    setPosition(null);
  };

  const active = !!value;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid var(--rule)",
        borderRadius: 999,
        background: active ? "var(--forest)" : "var(--paper)",
        color: active ? "var(--paper)" : "var(--ink-4)",
        maxWidth: 240,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (position ? setPosition(null) : open())}
        data-tooltip={t("standaloneChat.folderScope.hint")}
        aria-label={t("standaloneChat.folderScope.label")}
        aria-haspopup="menu"
        aria-expanded={!!position}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
          padding: active ? "2px 2px 2px 9px" : "2px 9px",
          border: "none",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "inherit",
          lineHeight: 1.6,
          background: "transparent",
          color: "inherit",
          fontWeight: active ? 600 : 400,
        }}
      >
        <Folder size={12} aria-hidden style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ?? t("standaloneChat.folderScope.all")}
        </span>
        {!active && <ChevronDown size={12} aria-hidden style={{ flexShrink: 0 }} />}
      </button>
      {active && (
        <button
          type="button"
          onClick={() => choose(undefined)}
          aria-label={t("standaloneChat.folderScope.clear")}
          data-tooltip={t("standaloneChat.folderScope.clear")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 7px 2px 3px",
            border: "none",
            borderRadius: 999,
            cursor: "pointer",
            background: "transparent",
            color: "inherit",
          }}
        >
          <X size={12} aria-hidden />
        </button>
      )}
      {position && (
        <Dropdown position={position} onClose={() => setPosition(null)} minWidth={220} maxHeight="50vh">
          <div className="py-1" role="menu" aria-label={t("standaloneChat.folderScope.label")}>
            <MenuItem role="menuitemradio" aria-checked={!value} active={!value} onClick={() => choose(undefined)}>
              {t("standaloneChat.folderScope.all")}
            </MenuItem>
            {folders.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("standaloneChat.folderScope.empty")}</p>
            ) : (
              folders.map((node) => (
                <FolderRows key={node.path} node={node} value={value} onChoose={choose} />
              ))
            )}
          </div>
        </Dropdown>
      )}
    </span>
  );
}

/** 親フォルダ 1 行と、その子フォルダ（字下げ）の行 */
function FolderRows({
  node,
  value,
  onChoose,
}: {
  node: FolderNode;
  value?: string;
  onChoose: (folder: string) => void;
}) {
  const selected = (path: string) => value?.toLowerCase() === path.toLowerCase();
  return (
    <>
      <MenuItem role="menuitemradio" aria-checked={selected(node.path)} active={selected(node.path)} onClick={() => onChoose(node.path)}>
        <Folder size={13} aria-hidden className="mr-1.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        <span className="ml-2 text-xs text-muted-foreground tabular-nums">{node.totalCount}</span>
      </MenuItem>
      {node.children.map((child) => (
        <MenuItem
          key={child.path}
          role="menuitemradio"
          aria-checked={selected(child.path)}
          active={selected(child.path)}
          onClick={() => onChoose(child.path)}
          className="pl-7"
        >
          <Folder size={13} aria-hidden className="mr-1.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{child.name}</span>
          <span className="ml-2 text-xs text-muted-foreground tabular-nums">{child.totalCount}</span>
        </MenuItem>
      ))}
    </>
  );
}
