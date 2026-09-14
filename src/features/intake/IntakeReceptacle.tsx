// 投入口の受け皿（点線の箱＋アイコン＋2 行＋ボタン 2 つ）
//
// 元は IntakeModal の idle 本文に直書きしていたものを切り出した共通部品。
// 見た目は変えていない。IntakeModal のほか、フルスクリーンのドロップ案内とは
// 別に「モーダルを開かず直接この受け皿を置きたい」場面（例: ノート一覧の空状態）
// でも同じものを使い回せるようにする。

import { useEffect, useRef, useState, type DragEvent } from "react";
import { FolderInput, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/ui/button";
import { collectDroppedFiles } from "./collect-dropped-files";
import { toIntakeFiles, type IntakeFile, type IntakeSource } from "./types";

type IntakeReceptacleProps = {
  /** 1 行目。未指定は intake.dropHere */
  lead?: string;
  /** 外側からの強調（ウィンドウのどこかでドラッグ中） */
  emphasized?: boolean;
  /** 「中身を確認しています」の表示を外から固定する（Storybook 用） */
  checking?: boolean;
  onFilesSelected: (files: IntakeFile[], source: IntakeSource) => void;
};

export function IntakeReceptacle({ lead, emphasized = false, checking = false, onFilesSelected }: IntakeReceptacleProps) {
  const t = useT();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  // 受け皿の中に入っているかどうか（外側の emphasized とは独立に、
  // 部品内のドラッグ判定でも強調できるようにする）
  const [internalOver, setInternalOver] = useState(false);
  // 選択画面を開いてから change が来るまで。フォルダを選ぶと、ブラウザが中身を全部
  // たどってから change を起こすので、NAS のような遅い場所では選んだ後に数十秒〜
  // 数分の空白ができる。その間「動いていない」と見えないよう表示を切り替える。
  // ユーザーがキャンセルすると input の cancel イベントで戻す
  const [picking, setPicking] = useState(false);

  // input の cancel イベントは React 18 の型に無いので、直接購読する
  useEffect(() => {
    const inputs = [folderInputRef.current, filesInputRef.current];
    const onCancel = () => setPicking(false);
    for (const el of inputs) el?.addEventListener("cancel", onCancel);
    return () => {
      for (const el of inputs) el?.removeEventListener("cancel", onCancel);
    };
  }, []);

  const emphasize = emphasized || internalOver;
  const showChecking = checking || picking;

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setInternalOver(false);
    const files = await collectDroppedFiles(e.dataTransfer);
    if (files.length > 0) onFilesSelected(files, "drop");
  };

  return (
    <div
      data-intake-drop=""
      onDragOver={(e) => {
        e.preventDefault();
        setInternalOver(true);
      }}
      onDragLeave={() => setInternalOver(false)}
      onDrop={handleDrop}
      className={`rounded-xl border border-dashed px-6 py-8 flex flex-col items-center text-center gap-3 transition-colors ${
        emphasize ? "border-primary bg-accent" : "border-border bg-muted/30"
      }`}
    >
      {showChecking ? (
        <>
          <div className="h-12 w-12 rounded-full bg-secondary text-primary flex items-center justify-center">
            <Loader2 size={24} className="animate-spin" />
          </div>
          <p className="text-sm font-medium text-foreground">{t("intake.checking")}</p>
          <p className="text-xs text-muted-foreground">{t("intake.checkingHint")}</p>
        </>
      ) : (
        <>
          <div className="h-12 w-12 rounded-full bg-secondary text-primary flex items-center justify-center">
            <FolderInput size={24} />
          </div>
          <p className="text-sm font-medium text-foreground">{lead ?? t("intake.dropHere")}</p>
          <p className="text-xs text-muted-foreground">{t("intake.rule")}</p>
          <div className="flex gap-3 mt-1">
            <Button
              variant="primary"
              onClick={() => {
                setPicking(true);
                folderInputRef.current?.click();
              }}
            >
              {t("intake.chooseFolder")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPicking(true);
                filesInputRef.current?.click();
              }}
            >
              {t("intake.chooseFiles")}
            </Button>
          </div>
        </>
      )}

      {/* フォルダ選択用（Markdown インポートの既存実装と同じ書き方） */}
      <input
        ref={folderInputRef}
        type="file"
        // webkitdirectory はフォルダ全体を渡す（型に存在しないので型上は ignore）
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = toIntakeFiles(e.target.files ?? []);
          e.target.value = "";
          setPicking(false);
          if (files.length > 0) onFilesSelected(files, "folder");
        }}
      />
      {/* ファイル選択用 */}
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.pdf,.docx,.doc,.pptx,.xlsx,.txt,.csv,.tsv,.dat,image/*,audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const files = toIntakeFiles(e.target.files ?? []);
          e.target.value = "";
          setPicking(false);
          if (files.length > 0) onFilesSelected(files, "files");
        }}
      />
    </div>
  );
}
