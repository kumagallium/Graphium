// ImageOcrBlock のストーリー
// - Editor: 空の OCR ブロック（ドロップゾーン）と抽出済みブロックの見た目
// - SelfTest: canvas で既知テキストの画像を生成し、実際に OCR を走らせて検証する
//   （Tesseract.js のランタイム動作確認用。初回は CDN から言語データを取得するため通信が必要）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, useState, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { imageOcrBlock } from "./index";
import { recognizeImage } from "../../lib/ocr";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#c26356", fontSize: 13 }}>
          <strong>描画エラー:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

const meta: Meta = {
  title: "Blocks/ImageOcrBlock",
  parameters: { layout: "padded" },
};
export default meta;

// 空状態（ドロップゾーン）。画像をドロップすると端末内で OCR が走る。
export const Empty: StoryObj = {
  name: "空状態（アップローダ）",
  render: () => (
    <ErrorBoundary>
      <div style={{ maxWidth: 760 }}>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
          画像をドロップ / 選択すると、端末内（Tesseract.js）で文字を抽出します。
        </p>
        <SandboxEditor blocks={[imageOcrBlock]} initialContent={[{ type: "imageOcr" }]} />
      </div>
    </ErrorBoundary>
  ),
};

// 抽出済みの見た目（OCR は走らせず、保存済みテキストの表示を確認）
export const Extracted: StoryObj = {
  name: "抽出済み（表示確認）",
  render: () => (
    <ErrorBoundary>
      <div style={{ maxWidth: 760 }}>
        <SandboxEditor
          blocks={[imageOcrBlock]}
          initialContent={[
            {
              type: "imageOcr",
              props: {
                url: "https://placehold.co/600x180/eef/223?text=PROVNOTE",
                name: "sample.png",
                ocrText: "焼結温度 800℃ で 2 時間 保持\nX線回折 XRD で相を同定",
                ocrStatus: "done",
                ocrConfidence: 88,
                ocrLang: "jpn+eng",
              },
            },
          ]}
        />
      </div>
    </ErrorBoundary>
  ),
};

// ── ランタイム検証: canvas で画像を作って実際に OCR する ──

const SELF_TEST_TEXT = "PROVNOTE OCR 12345";

function makeTextImage(text: string): Promise<Blob> {
  const font = "bold 64px Arial, sans-serif";
  const pad = 32;
  // 一旦テキスト幅を計測してから、はみ出さないサイズの canvas を作る
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textWidth = Math.ceil(measure.measureText(text).width);

  const canvas = document.createElement("canvas");
  canvas.width = textWidth + pad * 2;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, canvas.height / 2);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

function SelfTest() {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string>("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [pass, setPass] = useState<boolean | null>(null);

  const run = async () => {
    setStatus("running");
    setResult("");
    setConfidence(null);
    setPass(null);
    try {
      const blob = await makeTextImage(SELF_TEST_TEXT);
      const { text, confidence } = await recognizeImage(blob, {
        langs: "eng",
        onProgress: (p) => {
          setStatus(p.status);
          setProgress(p.progress);
        },
      });
      setResult(text);
      setConfidence(confidence);
      // 記号や空白を無視して主要トークンが取れているかで合否判定
      const norm = text.replace(/\s+/g, "").toUpperCase();
      setPass(norm.includes("PROVNOTE") && norm.includes("12345"));
      setStatus("done");
    } catch (e) {
      setResult(String(e));
      setPass(false);
      setStatus("error");
    }
  };

  return (
    <div style={{ maxWidth: 680, fontSize: 13 }}>
      <p style={{ color: "#64748b", marginBottom: 8 }}>
        canvas で「{SELF_TEST_TEXT}」の画像を生成し、実際に OCR を実行します。
        初回は言語データ取得のため通信します。
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={status === "running" || (status !== "idle" && status !== "done" && status !== "error")}
        data-testid="ocr-selftest-run"
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "1px solid #2563eb",
          background: "#2563eb",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        OCR セルフテストを実行
      </button>

      <div style={{ marginTop: 12, color: "#475569" }}>
        状態: <span data-testid="ocr-selftest-status">{status}</span>{" "}
        {status !== "idle" && `(${Math.round(progress * 100)}%)`}
      </div>

      {pass !== null && (
        <div
          data-testid="ocr-selftest-verdict"
          style={{
            marginTop: 8,
            fontWeight: 700,
            color: pass ? "#059669" : "#dc2626",
          }}
        >
          {pass ? "✓ PASS — OCR ランタイム動作" : "✗ FAIL"}
          {confidence !== null && ` (信頼度 ${confidence}%)`}
        </div>
      )}

      {result && (
        <pre
          data-testid="ocr-selftest-output"
          style={{
            marginTop: 8,
            padding: 10,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {result}
        </pre>
      )}
    </div>
  );
}

export const SelfTest_Runtime: StoryObj = {
  name: "OCR セルフテスト（ランタイム検証）",
  render: () => (
    <ErrorBoundary>
      <SelfTest />
    </ErrorBoundary>
  ),
};
