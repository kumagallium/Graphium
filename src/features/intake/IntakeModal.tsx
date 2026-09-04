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

import { useT } from "@/i18n";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/ui/modal";
import { Button } from "@/ui/button";
import { IntakeReceptacle } from "./IntakeReceptacle";
import type { IntakeFile, IntakeSource } from "./types";

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
      /** 対象外で入れなかった件数 */
      skipped: number;
      aiAvailable: boolean;
    };

type IntakeModalProps = {
  open: boolean;
  onClose: () => void;
  state: IntakeState;
  /** 呼び出し側が「ウィンドウのどこかでドラッグ中」を知らせたいとき用。受け皿を強調する */
  dragActive?: boolean;
  /** 隠し input（webkitdirectory）でフォルダを選んだとき / ファイルを選んだとき / 受け皿に落としたとき。すべて同じ形で渡す */
  onFilesSelected: (files: IntakeFile[], source: IntakeSource) => void;
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

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-[560px] max-w-[calc(100vw-2rem)]">
        <ModalHeader onClose={onClose}>
          {state.kind === "done" ? t("intake.doneTitle") : t("intake.title")}
        </ModalHeader>

        {state.kind === "idle" && (
          <ModalBody>
            <IntakeReceptacle emphasized={dragActive} onFilesSelected={onFilesSelected} />
            <p className="text-xs text-muted-foreground mt-3">{t("intake.obsidianHint")}</p>
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
                {state.skipped > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("intake.skipped", { count: String(state.skipped) })}
                  </p>
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
