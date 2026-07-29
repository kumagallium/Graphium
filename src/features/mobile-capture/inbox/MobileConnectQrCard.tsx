// デスクトップ設定に置く「接続はスマホ側で」案内カード（QR + URL）。
//
// なぜ QR だけで、接続ボタンが無いのか:
//   モバイル送信は「スマホ = 送る側（OAuth 接続が要る）/ デスクトップ = 受け取る側
//   （同期フォルダを読むだけ）」。OAuth トークンは端末ごとの localStorage に入るので、
//   **デスクトップで接続してもスマホには何の効果もない**。加えて Google Identity
//   Services の認可は window.open を使うため、Tauri の WebView では必ず
//   "Failed to open popup window" で落ちる。だからデスクトップにあるべきなのは
//   「スマホでここを開いて」という導線＝QR だけ。
//
// QR はローカル完結（qrcode.react の SVG レンダラ）。外部 CDN も画像 API も叩かない
// ので、Tauri のオフライン環境でもそのまま出る。
//
// 配色: QR は白地に黒固定（読み取り安定のため）。ダークテーマでも白いカードとして
// 浮くように、白背景のパネルごと角丸で置く。

import { useCallback, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useT } from "../../../i18n";

export type MobileConnectQrCardProps = {
  /** スマホで開く URL（getMobileAppUrl() の結果を親が渡す）。 */
  url: string;
};

export function MobileConnectQrCard({ url }: MobileConnectQrCardProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // クリップボード不可（権限・非セキュアコンテキスト）でも URL は見えているので致命的でない
      });
  }, [url]);

  return (
    <div
      className="rounded-md border border-border bg-background px-3 py-2 space-y-2"
      data-testid="mobile-connect-qr"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <QrCode size={13} className="text-muted-foreground shrink-0" />
        {t("settings.mobilePush.connectOnPhone")}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("settings.mobilePush.connectOnPhoneHelp")}
      </p>
      <div className="flex items-start gap-3 flex-wrap">
        {/* 白地固定 — ダークテーマでもカメラが読める */}
        <div
          className="shrink-0 rounded-md bg-white p-2 border border-border"
          data-testid="mobile-connect-qr-code"
        >
          {/* quiet zone は仕様上 4 モジュール。marginSize 2 + 白パネルの p-2 で確保する */}
          <QRCodeSVG
            value={url}
            size={128}
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
            marginSize={2}
            title={url}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div
            className="text-xs font-mono text-foreground break-all"
            data-testid="mobile-connect-qr-url"
          >
            {url}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {copied ? (
              <>
                <Check size={12} className="text-green-600" />
                {t("settings.mobilePush.urlCopied")}
              </>
            ) : (
              <>
                <Copy size={12} />
                {t("settings.mobilePush.copyUrl")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
