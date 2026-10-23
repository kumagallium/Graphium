// 「素材のデータから系列を足す」の一連の流れ（ホスト側に置くモーダル群）
//
// データピッカー（中身が見える・チャート専用）→ 取り込みダイアログ → 確定、の 3 段を
// 1 つのコンポーネントにまとめる。取り込みダイアログは /データ で表を作るときと同じ
// ものを行き先だけチャートに変えて通す — 見出し行や区切りの決め方をチャート用に
// 別に持たない。ピッカーは列名・行数・線の形を見せるため、本文を読んだ上で
// 取り込み段へ渡す（選択後に読み直さない）。
//
// ピッカーの「ファイルからアップロード」も受ける。ただし素材への登録は確定後
// （取り込みと同じ: キャンセルしたファイルまで素材に溜めない）。チャートは fileId で
// 素材を指すので、新規ファイルは登録が終わってから onDone を呼ぶ。
//
// note-app（main editor）と SidePeek がそれぞれこれを置き、blocks/chart/callbacks.ts に
// 登録する。ブロック側は requestChartAssetSource を呼ぶだけで、モーダルの存在を知らない。

import { useCallback, useRef, useState } from "react";
import { t } from "../../i18n";
import type { MediaIndex, MediaIndexEntry } from "../../features/asset-browser/media-index";
import { DataImportModal, type DataImportResult } from "../../features/data-import/DataImportModal";
import { readDataFileText } from "../../features/data-import/read-file";
import { ChartDataPickerModal } from "./data-picker";
import type { ChartAssetSourceResult } from "./callbacks";

type Stage =
  | { kind: "pick" }
  | {
      kind: "import";
      fileName: string;
      text: string;
      /** 既存素材ならその fileId。新規ファイルなら未定（確定後に登録する） */
      fileId?: string;
      file?: File;
    }
  | { kind: "registering" };

export function ChartAssetSourceFlow({
  mediaIndex,
  uploadAsset,
  onDone,
  onCancel,
}: {
  mediaIndex: MediaIndex | null;
  /** 新規ファイルを素材にする。無ければピッカーは既存素材だけを見せる */
  uploadAsset?: (file: File) => Promise<{ fileId: string }>;
  onDone: (result: ChartAssetSourceResult) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  // ピッカーは選択・ファイル指定の直後に必ず onClose を呼ぶ。選んだあとの onClose は
  // 「閉じただけ」で、この流れのキャンセルではない
  const pickedRef = useRef(false);

  const fail = useCallback(() => {
    alert(t("dataImport.readError"));
    onCancel();
  }, [onCancel]);

  const handleSelect = useCallback(
    (entry: MediaIndexEntry, text: string) => {
      pickedRef.current = true;
      setStage({ kind: "import", fileName: entry.name, text, fileId: entry.fileId });
    },
    []
  );

  const handlePickLocalFile = useCallback(
    (file: File) => {
      pickedRef.current = true;
      void (async () => {
        try {
          // 素材の読み取りと同じデコード規則（UTF-8 → Shift_JIS）
          const text = await readDataFileText(file);
          setStage({ kind: "import", fileName: file.name, text, file });
        } catch {
          fail();
        }
      })();
    },
    [fail]
  );

  const handleConfirm = useCallback(
    (result: DataImportResult) => {
      if (stage.kind !== "import") return;
      const { fileName, text, fileId, file } = stage;
      const finish = (id: string) =>
        onDone({ fileId: id, fileName, options: result.options, parsed: result.parsed, text });
      if (fileId) {
        finish(fileId);
        return;
      }
      if (!file || !uploadAsset) {
        onCancel();
        return;
      }
      setStage({ kind: "registering" });
      void (async () => {
        try {
          const { fileId: newId } = await uploadAsset(file);
          finish(newId);
        } catch (err) {
          console.warn("チャート用データファイルの素材登録に失敗:", err);
          fail();
        }
      })();
    },
    [stage, uploadAsset, onDone, onCancel, fail]
  );

  if (stage.kind === "pick") {
    return (
      <ChartDataPickerModal
        mediaIndex={mediaIndex}
        onSelect={handleSelect}
        onClose={() => {
          if (!pickedRef.current) onCancel();
        }}
        onPickLocalFile={uploadAsset ? handlePickLocalFile : undefined}
      />
    );
  }
  if (stage.kind === "import") {
    return (
      <DataImportModal
        fileName={stage.fileName}
        text={stage.text}
        // 表を作らないので行数の上限は要らない（スペクトルを途中で切らない）
        rowLimit={null}
        // 表もデータ表も作らない（チャートが素材を直接読む）ので、挿入形式の選択は出さない
        showTargetChoice={false}
        confirmLabel={t("chart.useForChart")}
        // 前置きの条件はどこにも写さない（素材の本文に残るだけ）ので、表の文言を使わない
        headerMetaLabel={t("chart.headerMeta")}
        onCancel={onCancel}
        onConfirm={handleConfirm}
      />
    );
  }
  // 素材登録中はダイアログを閉じたまま待つ（数秒。二重確定を防ぐため何も出さない）
  return null;
}
