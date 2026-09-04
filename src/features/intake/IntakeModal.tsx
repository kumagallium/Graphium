// 投入口モーダル — 既存資料を一括で持ち込むための入口
//
// 「何がノートになり、何が素材になるか」を最初に 1 文で言い切り（idle）、
// 進行中は Obsidian の vault インポートと同じ見た目の進捗バーを見せ（running）、
// 終わったら数字と次の動作を並べる復元レポートを出す（done）。
//
// この部品は状態を持たない。呼び出し側が state を差し替えることで idle →
// running → done を進める。ファイル選択・ドロップの受け取りだけをこの中で
// 完結させ、実際の取り込み処理（Markdown パース・素材登録等）は onFilesSelected
// を受けた呼び出し側の責務にする。

import { useRef, useState, type DragEvent } from "react";
import { FolderInput } from "lucide-react";
import { useT } from "@/i18n";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/ui/modal";
import { Button } from "@/ui/button";

export type IntakeState =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number; current?: string; failed: string[] }
  | {
      kind: "done";
      notes: number;
      materials: number;
      linksResolved: number;
      linksUnresolved: number;
      failed: string[];
      aiAvailable: boolean;
    };

type IntakeModalProps = {
  open: boolean;
  onClose: () => void;
  state: IntakeState;
  /** 呼び出し側が「ウィンドウのどこかでドラッグ中」を知らせたいとき用。受け皿を強調する */
  dragActive?: boolean;
  /** 隠し input（webkitdirectory）でフォルダを選んだとき / ファイルを選んだとき / 受け皿に落としたとき。すべて同じ形で渡す */
  onFilesSelected: (files: File[], source: "folder" | "files" | "drop") => void;
  /** 復元レポートの次の動作 */
  onSearch?: () => void;
  onShowGraph?: () => void;
  onAskAi?: () => void;
  /** AI 未設定のとき「AI を設定する」を押した */
  onSetupAi?: () => void;
};

export function IntakeModal({
  open,
  onClose,
  state,
  dragActive = false,
  onFilesSelected,
  onSearch,
  onShowGraph,
  onAskAi,
  onSetupAi,
}: IntakeModalProps) {
  const t = useT();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  // 受け皿の中に入っているかどうか（呼び出し側の dragActive とは独立に、
  // 部品内のドラッグ判定でも強調できるようにする）
  const [internalOver, setInternalOver] = useState(false);

  const emphasize = dragActive || internalOver;

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setInternalOver(false);
    // フォルダの再帰読み取りはここではやらない。ブラウザの Drop API から
    // フォルダ構造を丁寧に辿るには DataTransferItem.webkitGetAsEntry が要り、
    // 今回は「ファイルとして落とされたものをそのまま渡す」までに留める。
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFilesSelected(files, "drop");
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-[560px] max-w-[calc(100vw-2rem)]">
        <ModalHeader onClose={onClose}>
          {state.kind === "done" ? t("intake.doneTitle") : t("intake.title")}
        </ModalHeader>

        {state.kind === "idle" && (
          <ModalBody>
            <div
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
              <div className="h-12 w-12 rounded-full bg-secondary text-primary flex items-center justify-center">
                <FolderInput size={24} />
              </div>
              <p className="text-sm font-medium text-foreground">{t("intake.dropHere")}</p>
              <p className="text-xs text-muted-foreground">{t("intake.rule")}</p>
              <div className="flex gap-3 mt-1">
                <Button variant="primary" onClick={() => folderInputRef.current?.click()}>
                  {t("intake.chooseFolder")}
                </Button>
                <Button variant="outline" onClick={() => filesInputRef.current?.click()}>
                  {t("intake.chooseFiles")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">{t("intake.obsidianHint")}</p>

            {/* フォルダ選択用（Markdown インポートの既存実装と同じ書き方） */}
            <input
              ref={folderInputRef}
              type="file"
              // webkitdirectory はフォルダ全体を渡す（型に存在しないので型上は ignore）
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) onFilesSelected(files, "folder");
              }}
            />
            {/* ファイル選択用 */}
            <input
              ref={filesInputRef}
              type="file"
              multiple
              accept=".md,.markdown,.pdf,.docx,.doc,.txt,.csv,.tsv,.dat,image/*,audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) onFilesSelected(files, "files");
              }}
            />
          </ModalBody>
        )}

        {state.kind === "running" && (
          <ModalBody>
            {/* × は出すが、押しても取り込みループ自体は中断できない
                （今の実装は一括処理のため）。閉じると進捗の表示だけが消える */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground">
                  {t("intake.running", { done: String(state.done), total: String(state.total) })}
                </span>
                {state.failed.length > 0 && (
                  <span className="text-destructive text-xs">
                    {t("noteList.importFailedCount", { count: String(state.failed.length) })}
                  </span>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }}
                />
              </div>
              {state.current && (
                <div className="text-xs text-muted-foreground truncate">
                  {t("noteList.importProcessing", { name: state.current })}
                </div>
              )}
            </div>
          </ModalBody>
        )}

        {state.kind === "done" && (
          <>
            <ModalBody>
              <div className="space-y-4">
                {/* 数字は 1 列に縦に並べる。2 列グリッドだと左列の数字と右列の見出しが
                    隣り合って「36Materials」のように読めてしまう */}
                <dl className="rounded-lg border border-border divide-y divide-border text-sm">
                  <div className="flex items-baseline justify-between px-4 py-2">
                    <dt className="text-muted-foreground">{t("intake.statNotes")}</dt>
                    <dd className="font-medium tabular-nums text-foreground">{state.notes}</dd>
                  </div>
                  <div className="flex items-baseline justify-between px-4 py-2">
                    <dt className="text-muted-foreground">{t("intake.statMaterials")}</dt>
                    <dd className="font-medium tabular-nums text-foreground">{state.materials}</dd>
                  </div>
                  <div className="flex items-baseline justify-between px-4 py-2">
                    <dt className="text-muted-foreground">{t("intake.statLinks")}</dt>
                    <dd className="font-medium tabular-nums text-foreground">
                      {state.linksResolved}
                      {state.linksUnresolved > 0 && (
                        <span className="text-xs text-muted-foreground font-normal ml-2">
                          {t("intake.statUnresolved", { count: String(state.linksUnresolved) })}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between px-4 py-2">
                    <dt className="text-muted-foreground">{t("intake.statFailed")}</dt>
                    <dd
                      className={`font-medium tabular-nums ${
                        state.failed.length > 0 ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {state.failed.length}
                    </dd>
                  </div>
                </dl>

                {state.linksUnresolved > 0 && (
                  <p className="text-xs text-muted-foreground">{t("import.unresolvedLinksNote")}</p>
                )}
                {state.failed.length > 0 && (
                  <p className="text-xs text-destructive">
                    {t("noteList.importFailedFiles", { names: state.failed.join(", ") })}
                  </p>
                )}

                <div>
                  <p className="text-xs text-muted-foreground mb-2">{t("intake.next")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={onSearch}>
                      {t("intake.search")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={onShowGraph}>
                      {t("intake.graph")}
                    </Button>
                    {state.aiAvailable ? (
                      <Button variant="outline" size="sm" onClick={onAskAi}>
                        {t("intake.askAi")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onSetupAi}
                        title={t("intake.setupAiHint")}
                      >
                        {t("intake.setupAi")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="outline" onClick={onClose}>
                {t("common.close")}
              </Button>
            </ModalFooter>
          </>
        )}
      </div>
    </Modal>
  );
}
