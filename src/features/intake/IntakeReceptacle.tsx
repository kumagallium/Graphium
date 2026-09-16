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
import {
  cancelFolderScanNative,
  createFolderScanId,
  isNativeScanAvailable,
  pickFolderNative,
  scanFolderNative,
} from "./native-scan";
import { toIntakeFiles, type IntakeFile, type IntakeSource } from "./types";

type IntakeReceptacleProps = {
  /** 1 行目。未指定は intake.dropHere */
  lead?: string;
  /** 外側からの強調（ウィンドウのどこかでドラッグ中） */
  emphasized?: boolean;
  /** 「中身を確認しています」の表示を外から固定する（Storybook 用） */
  checking?: boolean;
  /** ネイティブ走査中で件数が分かっている状態を外から固定する（Storybook 用） */
  scanningCount?: number;
  /** ネイティブ走査中のフォルダ数を外から固定する（Storybook 用。scanningCount とセットで使う） */
  scanningFolders?: number;
  /** 打ち切り確認の表示を件数だけ与えて固定する（Storybook 用） */
  truncatedCount?: number;
  onFilesSelected: (files: IntakeFile[], source: IntakeSource) => void;
};

export function IntakeReceptacle({
  lead,
  emphasized = false,
  checking = false,
  scanningCount,
  scanningFolders,
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
  // フォルダを選び終えて Rust 側の走査が動いている間だけ true。
  // ダイアログを開いている間（picking は true だがこれはまだ false）は
  // 件数も停止ボタンも出さない
  const [isNativeScanning, setIsNativeScanning] = useState(false);
  // 走査中に "intake-scan-progress" イベントで随時更新される、見つかった件数とフォルダ数
  const [nativeScanFound, setNativeScanFound] = useState(0);
  const [nativeScanFolders, setNativeScanFolders] = useState(0);
  // ネイティブ走査が上限で打ち切られたとき、そのまま黙って一部だけ入れると
  // 「全部入った」と誤解されるので、続けるかどうかを一度確かめる
  const [truncatedFiles, setTruncatedFiles] = useState<IntakeFile[] | null>(null);
  // このインスタンスがいま走らせている走査の ID。IntakeReceptacle はノート一覧の
  // 空状態・素材ギャラリーの空状態・IntakeModal の 3 か所に同時にマウントされうる
  // （モーダルはオーバーレイなので重なって存在できる）。プロセス全体で 1 つの
  // 中止フラグを共有すると、片方の「停止」がもう片方の走査まで止めてしまう
  // （逆に片方の停止直後にもう片方が走査を始めると、開始時のフラグ初期化で
  // 停止要求が消えてしまう）ため、走査ごとに ID を発行してインスタンスに紐付ける
  const scanIdRef = useRef<string | null>(null);
  // アンマウント後に setState しないためのガード
  const mountedRef = useRef(true);

  // input の cancel イベントは React 18 の型に無いので、直接購読する
  useEffect(() => {
    const inputs = [folderInputRef.current, filesInputRef.current];
    const onCancel = () => setPicking(false);
    for (const el of inputs) el?.addEventListener("cancel", onCancel);
    return () => {
      for (const el of inputs) el?.removeEventListener("cancel", onCancel);
    };
  }, []);

  // アンマウント時、自分が走らせている走査があれば中止する
  useEffect(() => {
    // マウントのたびに立て直す。開発ビルドの StrictMode はマウント → アンマウント →
    // 再マウントを 1 回行うので、クリーンアップで倒したままにすると以降の setState が
    // すべて捨てられ、件数も出ず「停止」も効かないまま受け皿が固まる
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scanIdRef.current) {
        cancelFolderScanNative(scanIdRef.current).catch((err) => {
          console.warn("[intake] アンマウント時の走査中止に失敗:", err);
        });
      }
    };
  }, []);

  const emphasize = emphasized || internalOver;
  // 実際に打ち切られた件数を優先し、無ければ Storybook から渡された件数を見る
  const shownTruncatedCount = truncatedFiles?.length ?? truncatedCount;
  // Storybook から scanningCount / scanningFolders が渡されたときは、実際の走査が
  // 動いていなくても「走査中で件数が分かっている」表示を固定する
  const scanningActive = isNativeScanning || scanningCount != null || scanningFolders != null;
  const shownScanningCount = scanningCount ?? (isNativeScanning ? nativeScanFound : undefined);
  const shownScanningFolders =
    scanningFolders ?? (isNativeScanning ? nativeScanFolders : undefined);
  const showChecking = checking || picking || scanningActive;

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
      // ここから先が実際の走査区間。件数表示と停止ボタンはこの間だけ出す
      const scanId = createFolderScanId();
      scanIdRef.current = scanId;
      setNativeScanFound(0);
      setNativeScanFolders(0);
      setIsNativeScanning(true);
      const { files, truncated, cancelled } = await scanFolderNative(root, {
        scanId,
        onProgress: ({ found, folders }) => {
          if (!mountedRef.current) return;
          setNativeScanFound(found);
          setNativeScanFolders(folders);
        },
      });
      // 停止して別フォルダを選び直した等で、この結果がもう自分がいま持っている
      // 走査のものでなければ無視する（古い結果で状態を上書きしない）
      if (scanIdRef.current !== scanId) return;
      scanIdRef.current = null;
      if (!mountedRef.current) return;
      setIsNativeScanning(false);
      setPicking(false);
      // 中止された場合は files が空で返ってくる。受け皿は既に最初の表示に戻っている
      if (cancelled) return;
      if (files.length === 0) return;
      if (truncated) {
        setTruncatedFiles(files);
        return;
      }
      onFilesSelected(files, "folder");
    } catch (err) {
      if (scanIdRef.current) scanIdRef.current = null;
      if (!mountedRef.current) return;
      // ネイティブ側で失敗しても取り込みを諦めず、ブラウザ標準の経路に戻す。
      // picking は立てたままにして、input の change / cancel で下ろす
      console.warn("[intake] ネイティブのフォルダ走査に失敗。input に切り替えます:", err);
      setIsNativeScanning(false);
      folderInputRef.current?.click();
    }
  };

  /** 走査中止ボタン。押した後の受け皿の巻き戻しは scanFolderNative の戻り値（cancelled）側で行う */
  const handleCancelScan = () => {
    const scanId = scanIdRef.current;
    if (!scanId) return;
    cancelFolderScanNative(scanId).catch((err) => {
      console.warn("[intake] 走査の中止に失敗:", err);
    });
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
          {((shownScanningCount != null && shownScanningCount > 0) ||
            (shownScanningFolders != null && shownScanningFolders > 0)) && (
            <p className="text-xs text-muted-foreground">
              {t("intake.scanningProgress", {
                files: String(shownScanningCount ?? 0),
                folders: String(shownScanningFolders ?? 0),
              })}
            </p>
          )}
          {scanningActive && (
            <Button variant="outline" onClick={handleCancelScan} className="mt-1">
              {t("intake.scanStop")}
            </Button>
          )}
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
