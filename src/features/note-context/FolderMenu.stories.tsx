// フォルダの右クリックメニューのカタログ。
// 議論用途: 名前の変更のインライン入力と、削除確認の文面
//（フォルダ削除は「中のノートは消えない」— ファイルマネージャと挙動が違うので、
// その差を削除の瞬間に見せる）。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderMenu } from "./FolderMenu";

const meta: Meta = {
  title: "Molecules/FolderMenu",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

export const Menu: Story = {
  name: "メニュー（名前の変更 / 削除）",
  render: () => {
    const [log, setLog] = useState<string[]>([]);
    return (
      <div className="p-6 bg-background" style={{ minHeight: 320 }}>
        <p className="text-xs text-muted-foreground mb-3">
          「名前を変更」はその場で入力欄になり、Enter で確定・Esc で取り消し。
          スラッシュを含む名前は階層が動いてしまうので弾く（階層はドラッグで動かす想定）。
          「フォルダを削除」は確認に進み、中のノートが消えないことを文面で明示する。
        </p>
        <FolderMenu
          path="プロジェクトA"
          name="プロジェクトA"
          noteCount={12}
          position={{ top: 120, left: 40 }}
          onClose={() => setLog((l) => [...l, "closed"])}
          onRename={(from, to) => setLog((l) => [...l, `rename: ${from} → ${to}`])}
          onDelete={(path) => setLog((l) => [...l, `delete: ${path}`])}
        />
        <div className="mt-[220px] text-[11px] text-muted-foreground font-mono">
          {log.length === 0 ? "（操作するとここに出ます）" : log.join(" / ")}
        </div>
      </div>
    );
  },
};

export const ChildFolder: Story = {
  name: "子フォルダ（親は変えずに末尾だけ変える）",
  render: () => (
    <div className="p-6 bg-background" style={{ minHeight: 320 }}>
      <p className="text-xs text-muted-foreground mb-3">
        子フォルダの名前を変えても親は動かない（「プロジェクトA/実験1」→「プロジェクトA/本実験」）。
      </p>
      <FolderMenu
        path="プロジェクトA/実験1"
        name="実験1"
        noteCount={5}
        position={{ top: 120, left: 40 }}
        onClose={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
    </div>
  ),
};
