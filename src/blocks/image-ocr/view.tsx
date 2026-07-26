// OCR 画像ブロック
//
// 画像を挿入し、クライアント内（Tesseract.js）で文字を抽出する。
// 抽出テキストは block props（ocrText）に保存されるため、ドキュメントに
// そのまま永続化・同期され、全ノート横断検索の対象になる（index-file.ts が回収）。
//
// OCR は「挿入時の元 File」から実行する。表示用 URL（Google CDN 等）は
// クロスオリジンで fetch できないことがあるため、通信不要・CORS 回避の File 経路を使う。

import { createReactBlockSpec } from "@blocknote/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
import {
  recognizeImage,
  DEFAULT_OCR_LANG,
  OCR_LANGS,
  type OcrProgress,
} from "../../lib/ocr";

type OcrStatus = "idle" | "running" | "done" | "error";

type ImageOcrProps = {
  url: string;
  name: string;
  ocrText: string;
  ocrStatus: OcrStatus;
  ocrConfidence: number;
  ocrLang: string;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ImageOcrView({ block, editor }: any) {
  const t = useT();
  const props = block.props as ImageOcrProps;
  const editable = editor.isEditable !== false;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 表示用 URL。保存済み画像はプロバイダ内部スキーム（local-media:// 等）で
  // 保存されており、<img src> でも fetch でも直接は読めない。標準のメディア
  // ブロックは SandboxEditor の resolveFileUrl を通って解決されるが、カスタム
  // ブロックはその経路を通らないため、pdf-viewer と同じく provider 経由で
  // blob URL に解決する（未解決だと画像が出ず、再スキャンも fetch に失敗する）。
  const [displayUrl, setDisplayUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rerunHint, setRerunHint] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const update = useCallback(
    (patch: Partial<ImageOcrProps>) => {
      editor.updateBlock(block.id, { props: patch });
    },
    [editor, block.id],
  );

  useEffect(() => {
    const url = props.url;
    if (!url) {
      setDisplayUrl("");
      return;
    }
    const fileId = getActiveProvider().extractFileId(url);
    if (!fileId) {
      // データ URL / blob URL / 通常の http URL はそのまま表示できる
      setDisplayUrl(url);
      return;
    }
    let cancelled = false;
    getActiveProvider()
      .getMediaBlobUrl(fileId)
      .then((blob) => {
        if (!cancelled) setDisplayUrl(blob);
      })
      .catch(() => {
        if (!cancelled) setDisplayUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [props.url]);

  const runOcr = useCallback(
    async (source: File | string, langs: string) => {
      setProgress(0);
      setRerunHint(false);
      try {
        const { text, confidence } = await recognizeImage(source, {
          langs,
          onProgress: (p: OcrProgress) => setProgress(p.progress),
        });
        update({
          ocrText: text,
          ocrConfidence: confidence,
          ocrStatus: "done",
          ocrLang: langs,
        });
      } catch (e) {
        console.warn("OCR に失敗:", e);
        update({ ocrStatus: "error" });
        // URL 経由（再OCR）の失敗は CORS の可能性が高いのでヒントを出す
        if (typeof source === "string") setRerunHint(true);
      }
    },
    [update],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const langs = props.ocrLang || DEFAULT_OCR_LANG;
      update({ ocrStatus: "running", name: file.name });

      // 表示用に画像をアップロード（Drive 等）。失敗時はデータ URL でフォールバック。
      let url = "";
      try {
        if (typeof editor.uploadFile === "function") {
          url = await editor.uploadFile(file);
        }
      } catch (e) {
        console.warn("画像アップロードに失敗、データURLにフォールバック:", e);
      }
      if (!url) url = await fileToDataUrl(file).catch(() => "");
      update({ url, name: file.name, ocrStatus: "running" });

      // OCR は元 File から（通信不要・CORS 回避）
      await runOcr(file, langs);
    },
    [editor, props.ocrLang, runOcr, update],
  );

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.ocrText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可環境は無視 */
    }
  }, [props.ocrText]);

  const changeLang = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      update({ ocrLang: e.target.value });
    },
    [update],
  );

  // ── 空状態: アップローダ ──
  if (!props.url) {
    if (!editable) {
      return <div style={S.placeholder}>{t("ocr.selectImage")}</div>;
    }
    return (
      <div
        style={{ ...S.dropzone, ...(dragOver ? S.dropzoneActive : null) }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div style={S.dropIcon}>🖼️</div>
        <div style={S.dropTitle}>{t("ocr.selectImage")}</div>
        <div style={S.dropHint}>{t("ocr.dropHint")}</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onPickFile}
          style={{ display: "none" }}
        />
      </div>
    );
  }

  const pct = Math.round(progress * 100);
  const charCount = props.ocrText ? props.ocrText.replace(/\s/g, "").length : 0;

  return (
    <div style={S.card}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {displayUrl && <img src={displayUrl} alt={props.name || "image"} style={S.img} />}

      <div style={S.footer}>
        {/* 状態表示 */}
        {props.ocrStatus === "running" && (
          <span style={S.statusRunning}>
            <Spinner />
            {t("ocr.running")} {pct}%
          </span>
        )}
        {props.ocrStatus === "done" && charCount > 0 && (
          <button
            type="button"
            style={S.statusButton}
            onClick={() => setShowText((v) => !v)}
            title={showText ? t("ocr.hideText") : t("ocr.showText")}
          >
            <span style={S.okDot}>✓</span>
            {t("ocr.done")}
            <span style={S.meta}>
              {t("ocr.chars", { count: String(charCount) })} ·{" "}
              {t("ocr.confidence", { value: String(props.ocrConfidence) })}
            </span>
            <span style={S.caret}>{showText ? "▲" : "▼"}</span>
          </button>
        )}
        {props.ocrStatus === "done" && charCount === 0 && (
          <span style={S.statusMuted}>{t("ocr.noText")}</span>
        )}
        {props.ocrStatus === "error" && (
          <span style={S.statusError}>⚠ {t("ocr.error")}</span>
        )}
        {props.ocrStatus === "idle" && (
          <span style={S.statusMuted}>{t("ocr.notRun")}</span>
        )}

        {/* 操作 */}
        {editable && (
          <span style={S.actions}>
            <select
              value={props.ocrLang || DEFAULT_OCR_LANG}
              onChange={changeLang}
              disabled={props.ocrStatus === "running"}
              style={S.select}
              title={t("ocr.lang")}
            >
              {OCR_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={S.smallButton}
              disabled={props.ocrStatus === "running"}
              onClick={() => void runOcr(displayUrl || props.url, props.ocrLang || DEFAULT_OCR_LANG)}
              title={t("ocr.rerun")}
            >
              {t("ocr.rerun")}
            </button>
          </span>
        )}
      </div>

      {rerunHint && <div style={S.hint}>{t("ocr.rerunHint")}</div>}

      {/* 抽出テキスト */}
      {showText && charCount > 0 && (
        <div style={S.textPanel}>
          <div style={S.textHeader}>
            <span style={S.textLabel}>{t("ocr.showText")}</span>
            <button type="button" style={S.smallButton} onClick={() => void copyText()}>
              {copied ? t("ocr.copied") : t("ocr.copy")}
            </button>
          </div>
          <pre style={S.textBody}>{props.ocrText}</pre>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        marginRight: 6,
        border: "2px solid #cbd5e1",
        borderTopColor: "#2563eb",
        borderRadius: "50%",
        animation: "provnote-ocr-spin 0.8s linear infinite",
        verticalAlign: "-2px",
      }}
    />
  );
}

// ── スタイル（light テーマ想定・inline） ──
const S: Record<string, React.CSSProperties> = {
  dropzone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: "28px 16px",
    border: "2px dashed #cbd5e1",
    borderRadius: 10,
    background: "#f8fafc",
    color: "#64748b",
    cursor: "pointer",
    userSelect: "none",
    transition: "border-color 0.15s, background 0.15s",
  },
  dropzoneActive: { borderColor: "#2563eb", background: "#eff6ff" },
  dropIcon: { fontSize: 24, lineHeight: 1 },
  dropTitle: { fontSize: 14, fontWeight: 600, color: "#334155" },
  dropHint: { fontSize: 12, color: "#94a3b8" },
  placeholder: {
    padding: "16px",
    border: "1px dashed #e2e8f0",
    borderRadius: 8,
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
  },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    background: "#fff",
  },
  img: { display: "block", maxWidth: "100%", height: "auto" },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: "6px 10px",
    borderTop: "1px solid #f1f5f9",
    background: "#f8fafc",
    fontSize: 12,
  },
  statusRunning: { display: "inline-flex", alignItems: "center", color: "#2563eb", fontWeight: 500 },
  statusButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: "#059669",
    fontWeight: 600,
    fontSize: 12,
  },
  statusMuted: { color: "#94a3b8" },
  statusError: { color: "#dc2626", fontWeight: 500 },
  okDot: { color: "#059669" },
  meta: { color: "#94a3b8", fontWeight: 400 },
  caret: { color: "#94a3b8", fontSize: 10 },
  actions: { display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" },
  select: {
    fontSize: 11,
    padding: "2px 4px",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    background: "#fff",
    color: "#475569",
  },
  smallButton: {
    fontSize: 11,
    padding: "3px 8px",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    background: "#fff",
    color: "#475569",
    cursor: "pointer",
  },
  hint: {
    padding: "6px 10px",
    fontSize: 11,
    color: "#b45309",
    background: "#fffbeb",
    borderTop: "1px solid #fef3c7",
  },
  textPanel: { borderTop: "1px solid #f1f5f9", background: "#fff" },
  textHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    borderBottom: "1px solid #f1f5f9",
  },
  textLabel: { fontSize: 12, fontWeight: 600, color: "#475569" },
  textBody: {
    margin: 0,
    padding: "10px",
    maxHeight: 220,
    overflow: "auto",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "#334155",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans JP', monospace",
  },
};

/**
 * OCR 画像ブロックの BlockSpec。
 * 抽出テキストは ocrText prop に保存され、ドキュメントに永続化される。
 */
export const ImageOcrBlock = createReactBlockSpec(
  {
    type: "imageOcr" as const,
    propSchema: {
      url: { default: "" },
      name: { default: "" },
      ocrText: { default: "" },
      ocrStatus: { default: "idle" as OcrStatus },
      ocrConfidence: { default: 0 },
      ocrLang: { default: DEFAULT_OCR_LANG },
    },
    content: "none" as const,
  },
  {
    render: (props) => <ImageOcrView {...props} />,
  },
);
