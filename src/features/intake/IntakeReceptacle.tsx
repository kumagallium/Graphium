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
import { isNativeScanAvailable, pickFolderNative, scanFolderNative } from "./native-scan";
import { toIntakeFiles, type IntakeFile, type IntakeSource } from "./types";

type IntakeReceptacleProps = {
  /** 1 行目。未指定は intake.dropHere */
  lead?: string;
  /** 外側からの強調（ウィンドウのどこかでドラッグ中） */
  emphasized?: boolean;
  /** 「中身を確認しています」の表示を外から固定する（Storybook 用） */
  checking?: boolean;
  /** 打ち切り確認の表示を件数だけ与えて固定する（Storybook 用） */
  truncatedCount?: number;
  onFilesSelected: (files: IntakeFile[], source: IntakeSource) => void;
};

export function IntakeReceptacle({
  lead,
  emphasized = false,
  checking = false,
  truncatedCount,
  onFilesSelected,
}: IntakeReceptacleProps) {
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
  // ネイティブ走査が上限で打ち切られたとき、そのまま黙って一部だけ入れると
  // 「全部入った」と誤解されるので、続けるかどうかを一度確かめる
  const [truncatedFiles, setTruncatedFiles] = useState<IntakeFile[] | null>(null);

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
  // 実際に打ち切られた件数を優先し、無ければ Storybook から渡された件数を見る
  const shownTruncatedCount = truncatedFiles?.length ?? truncatedCount;
  const showChecking = checking || picking;

  // デスクトップではブラウザの webkitdirectory を通さず、Rust に列挙させる。
  // webkitdirectory は全ファイルに OS 問い合わせを行うため、NAS 越しだと
  // ファイル数に比例して待たされる（native-scan.ts の冒頭に経緯）
  const handleNativeFolderPick = async () => {
    setPicking(true);
    try {
      const root = await pickFolderNative();
      if (!root) {
        setPicking(false);
        return;
      }
      const { files, truncated } = await scanFolderNative(root);
      setPicking(false);
      if (files.length === 0) return;
      if (truncated) {
        setTruncatedFiles(files);
        return;
      }
      onFilesSelected(files, "folder");
    } catch (err) {
      // ネイティブ側で失敗しても取り込みを諦めず、ブラウザ標準の経路に戻す。
      // picking は立てたままにして、input の change / cancel で下ろす
      console.warn("[intake] ネイティブのフォルダ走査に失敗。input に切り替えます:", err);
      folderInputRef.current?.click();
    }
  };

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
      {shownTruncatedCount != null ? (
        <>
          <div className="h-12 w-12 rounded-full bg-secondary text-primary flex items-center justify-center">
            <FolderInput size={24} />
          </div>
          <p className="text-sm font-medium text-foreground">
            {t("intake.scanLimit", { count: String(shownTruncatedCount) })}
          </p>
          <p className="text-xs text-muted-foreground">{t("intake.scanLimitHint")}</p>
          <div className="flex gap-3 mt-1">
            <Button
              variant="primary"
              onClick={() => {
                const files = truncatedFiles;
                setTruncatedFiles(null);
                if (files) onFilesSelected(files, "folder");
              }}
            >
              {t("intake.scanLimitContinue", { count: String(shownTruncatedCount) })}
            </Button>
            <Button variant="outline" onClick={() => setTruncatedFiles(null)}>
              {t("intake.scanLimitCancel")}
            </Button>
          </div>
        </>
      ) : showChecking ? (
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
                if (isNativeScanAvailable()) {
                  void handleNativeFolderPick();
                  return;
                }
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
