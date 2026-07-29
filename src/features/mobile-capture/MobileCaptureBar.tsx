// 捕獲履歴ホームの画面下固定・捕獲バー（モバイルの唯一の捕獲入口）。
// [書く][URL][写真][動画][音声][ライブラリ] — 捕獲の入口だけを担う。撮った / 書いた
// ものの行き先（送信キュー or ローカル保存フォールバック）は親
// （MobileCaptureView）の責務。
//
// - [書く] は常に出す（メモはキュー不可でもローカル保存の退路がある）。
// - [URL] は onAddUrl が渡されたときだけ（経路が無い環境では袋小路を作らない）。
// - 撮影 4 ボタン（写真/動画/音声/ライブラリ）は showMediaButtons の間だけ。
//   mediaDisabled でローカル保存フォールバックのアップロード中などを一時無効化する。
// - 390px 幅で 6 個並ぶ前提: アイコン + 短ラベル（text-[10px]）の縦積みで潰れない。
// - accept は image/* のまま置く（iOS はこれで HEIC を JPEG に変換して渡す。
//   accept に image/heic を含めると逆に HEIC のまま来る）。

import { useRef } from "react";
import { Camera, Video, Mic, Images, PenLine, Link as LinkIcon } from "lucide-react";
import { useT } from "../../i18n";

export type MobileCaptureBarProps = {
  /** [書く]（メモ捕獲）。入力 UI（CaptureDialog）は親の責務。 */
  onComposeMemo: () => void;
  /** [URL] 捕獲。渡されたときだけ出す（入力 UI は親の UrlBookmarkModal）。 */
  onAddUrl?: () => void;
  /** 撮影 4 ボタンを出すか（キュー経路もローカル保存も無い環境では隠す）。 */
  showMediaButtons: boolean;
  /** 撮影ボタンの一時無効化（ローカル保存フォールバックのアップロード中など）。 */
  mediaDisabled?: boolean;
  /** 撮影・選択したファイルの受け口（キュー行きかローカル保存かは親が決める）。 */
  onAddFiles: (files: File[]) => void;
};

/** ボタン数 → グリッド列数。Tailwind の purge 対策でクラス名を列挙して選ぶ。 */
const GRID_COLS = [
  "grid-cols-1",
  "grid-cols-2",
  "grid-cols-3",
  "grid-cols-4",
  "grid-cols-5",
  "grid-cols-6",
] as const;

export function MobileCaptureBar({
  onComposeMemo,
  onAddUrl,
  showMediaButtons,
  mediaDisabled,
  onAddFiles,
}: MobileCaptureBarProps) {
  const t = useT();
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // 同じファイルをもう一度撮り直し / 選び直しできるように毎回リセットする
    e.target.value = "";
    if (picked.length > 0) onAddFiles(picked);
  };

  const buttons: {
    key: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }[] = [
    { key: "memo", icon: <PenLine size={18} />, label: t("mobile.send.addMemo"), onClick: onComposeMemo },
    ...(onAddUrl
      ? [{ key: "url", icon: <LinkIcon size={18} />, label: t("mobile.send.addUrl"), onClick: onAddUrl }]
      : []),
    ...(showMediaButtons
      ? [
          { key: "photo", icon: <Camera size={18} />, label: t("mobile.send.addPhoto"), onClick: () => photoRef.current?.click(), disabled: mediaDisabled },
          { key: "video", icon: <Video size={18} />, label: t("mobile.send.addVideo"), onClick: () => videoRef.current?.click(), disabled: mediaDisabled },
          { key: "audio", icon: <Mic size={18} />, label: t("mobile.send.addAudio"), onClick: () => audioRef.current?.click(), disabled: mediaDisabled },
          { key: "library", icon: <Images size={18} />, label: t("mobile.send.addLibrary"), onClick: () => libraryRef.current?.click(), disabled: mediaDisabled },
        ]
      : []),
  ];

  return (
    <div className="border-t border-border bg-background px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className={`grid ${GRID_COLS[buttons.length - 1]} gap-1`}>
        {buttons.map((b) => (
          <button
            key={b.key}
            onClick={b.onClick}
            disabled={b.disabled}
            className="min-w-0 flex flex-col items-center justify-center gap-1 py-2 rounded-lg text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
          >
            {b.icon}
            <span className="text-[10px] leading-none text-foreground whitespace-nowrap">
              {b.label}
            </span>
          </button>
        ))}
      </div>

      {showMediaButtons && (
        <>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid="capture-bar-photo"
            onChange={addFiles}
          />
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            data-testid="capture-bar-video"
            onChange={addFiles}
          />
          <input
            ref={audioRef}
            type="file"
            accept="audio/*"
            capture="environment"
            className="hidden"
            data-testid="capture-bar-audio"
            onChange={addFiles}
          />
          {/* フォトライブラリからは複数選択。撮影用の capture は付けない */}
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            data-testid="capture-bar-library"
            onChange={addFiles}
          />
        </>
      )}
    </div>
  );
}
