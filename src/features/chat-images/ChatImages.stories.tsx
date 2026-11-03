// チャットに画像を添える部品のストーリー。
// 入力欄（ノートなしのチャットの部品で確認。ノートのチャットも同じ部品を並べている）と、
// 送った後の吹き出しの見え方を確かめる。画像は play の中で canvas に描いて貼り付ける。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { ChatMessage } from "../../lib/document-types";
import { StandaloneChatComposer } from "../standalone-chat/StandaloneChatComposer";
import { StandaloneChatView } from "../standalone-chat/StandaloneChatView";
import { saveChatImage } from "./storage";

const meta: Meta = {
  title: "Molecules/ChatImages",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "チャットの入力欄に画像を添える（ボタン・⌘V の貼り付け・ドロップ）。1 通に 4 枚まで。送る前に長辺 1568px の JPEG に縮める。画像を見られない AI では、端末内 OCR で読んだ文字を代わりに送る。",
      },
    },
  },
  decorators: [
    (Story, context) => {
      syncLocale((context.parameters.locale as "ja" | "en" | undefined) ?? "ja");
      const width = (context.parameters.frameWidth as number | undefined) ?? 640;
      return (
        <LocaleProvider>
          <div style={{ width, padding: 12, background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

/** 見本の画像（パン作りのメモ・生地の写真の代わり）を描いて File にする */
async function makeImageFile(label: string, color: string, name = "image.png"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 640, 420);
  ctx.fillStyle = "#3b2a1a";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(label, 40, 120);
  ctx.font = "28px sans-serif";
  ctx.fillText("Flour 500 g / Water 350 g", 40, 200);
  ctx.fillText("Salt 10 g / Yeast 3 g", 40, 250);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

/** 入力欄に画像を貼り付ける（⌘V と同じ経路） */
async function pasteImages(canvasElement: HTMLElement, files: File[]) {
  const textarea = canvasElement.querySelector("textarea");
  if (!textarea) return;
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  // 縮小（createImageBitmap → canvas）が終わるのを待つ
  await new Promise((r) => setTimeout(r, 300));
}

export const ComposerEmpty: Story = {
  name: "入力欄（画像を添えるボタン）",
  render: () => <StandaloneChatComposer onSend={() => {}} imagesAccepted />,
};

export const ComposerWithImages: Story = {
  name: "画像を 2 枚添えた（画像を見られる AI）",
  render: () => <StandaloneChatComposer onSend={(t, imgs) => console.info("[story] onSend", t, imgs)} imagesAccepted />,
  play: async ({ canvasElement }) => {
    await pasteImages(canvasElement, [
      await makeImageFile("Recipe card", "#f6e7c8", "recipe-card.png"),
      await makeImageFile("Dough after 1st rise", "#e9d3b0"),
    ]);
  },
};

export const ComposerTextOnlyModel: Story = {
  name: "画像を見られない AI のとき",
  render: () => <StandaloneChatComposer onSend={() => {}} imagesAccepted={false} />,
  play: async ({ canvasElement }) => {
    await pasteImages(canvasElement, [await makeImageFile("Recipe card", "#f6e7c8", "recipe-card.png")]);
  },
};

export const ComposerTooMany: Story = {
  name: "上限（5 枚目を貼った）",
  render: () => <StandaloneChatComposer onSend={() => {}} imagesAccepted />,
  play: async ({ canvasElement }) => {
    const files = await Promise.all(
      ["#f6e7c8", "#e9d3b0", "#dcc29a", "#cfae84", "#c29a6e"].map((c, i) => makeImageFile(`Photo ${i + 1}`, c)),
    );
    await pasteImages(canvasElement, files);
  },
};

export const ComposerNarrow: Story = {
  name: "右パネルの幅（320px）",
  parameters: { frameWidth: 320 },
  render: () => <StandaloneChatComposer onSend={() => {}} imagesAccepted={false} />,
  play: async ({ canvasElement }) => {
    await pasteImages(canvasElement, [
      await makeImageFile("Recipe card", "#f6e7c8"),
      await makeImageFile("Crumb", "#e9d3b0"),
      await makeImageFile("Crust", "#dcc29a"),
    ]);
  },
};

export const ComposerEnglish: Story = {
  name: "英語 UI",
  parameters: { locale: "en" },
  render: () => <StandaloneChatComposer onSend={() => {}} imagesAccepted={false} />,
  play: async ({ canvasElement }) => {
    await pasteImages(canvasElement, [await makeImageFile("Recipe card", "#f6e7c8")]);
  },
};

/** 吹き出しに出す画像を、保存先の代わりにメモリへ置いて参照を作る */
async function seededMessages(): Promise<ChatMessage[]> {
  const fake = { saveMediaText: async () => {} };
  const toDataUrl = async (f: File) =>
    new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(f);
    });
  const a = await saveChatImage(fake, { dataUrl: await toDataUrl(await makeImageFile("Recipe card", "#f6e7c8")), mimeType: "image/jpeg" }, "recipe-card.png");
  const b = await saveChatImage(fake, { dataUrl: await toDataUrl(await makeImageFile("Dough after 1st rise", "#e9d3b0")), mimeType: "image/jpeg" });
  const now = new Date().toISOString();
  return [
    { role: "user", content: "このレシピで一次発酵が足りているか見てもらえますか？", timestamp: now, images: [a, b] },
    {
      role: "assistant",
      content: "写真では生地が元の約 2 倍に膨らんでいて、表面もなめらかです。一次発酵は足りていると考えられます。",
      timestamp: now,
    },
    // 共有されたノートなど、画像が手元に無い場合
    { role: "user", content: "前に送った写真と比べるとどうですか？", timestamp: now, images: [{ ref: "media-text:chatimg_missing", mimeType: "image/jpeg" }] },
  ];
}

export const BubbleWithImages: Story = {
  name: "送った画像の吹き出し（手元に無い画像を含む）",
  parameters: { frameWidth: 720 },
  loaders: [async () => ({ messages: await seededMessages() })],
  render: (_args, { loaded }) => (
    <div style={{ height: 600, display: "flex" }}>
      <StandaloneChatView messages={loaded.messages as ChatMessage[]} loading={false} onSend={() => {}} onResend={() => {}} />
    </div>
  ),
};

/** 見本の写真（パンの断面）を描く。乱数は固定して毎回同じ絵にする */
async function makeCrumbPhoto(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#efe6d6";
  ctx.fillRect(0, 0, 720, 480);
  ctx.fillStyle = "#9a5a26";
  ctx.beginPath();
  ctx.ellipse(360, 260, 300, 190, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f3e2bd";
  ctx.beginPath();
  ctx.ellipse(360, 265, 278, 168, 0, 0, Math.PI * 2);
  ctx.fill();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = "#d8bf8f";
  for (let i = 0; i < 160; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = 360 + Math.cos(a) * r * 250;
    const y = 265 + Math.sin(a) * r * 145;
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + rand() * 14, 3 + rand() * 9, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], "crumb.png", { type: "image/png" });
}

async function manualMessages(): Promise<ChatMessage[]> {
  const fake = { saveMediaText: async () => {} };
  const toDataUrl = async (f: File) =>
    new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(f);
    });
  const crumb = await saveChatImage(fake, { dataUrl: await toDataUrl(await makeCrumbPhoto()), mimeType: "image/jpeg" }, "crumb.jpg");
  const card = await saveChatImage(fake, { dataUrl: await toDataUrl(await makeImageFile("Country loaf", "#f6e7c8")), mimeType: "image/jpeg" }, "recipe-card.jpg");
  const now = new Date().toISOString();
  return [
    { role: "user", content: "Here is the crumb from today's country loaf, and the recipe I used. Did it ferment long enough?", timestamp: now, images: [crumb, card] },
    {
      role: "assistant",
      content:
        "The crumb is open and fairly even, with no dense band near the bottom crust, so the bulk fermentation looks long enough. The recipe card shows 350 g of water to 500 g of flour (70% hydration), which fits that structure. For larger holes, try a slightly longer final proof before adding more water.",
      timestamp: now,
    },
  ];
}

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  parameters: { locale: "en", frameWidth: 900 },
  loaders: [async () => ({ messages: await manualMessages() })],
  render: (_args, { loaded }) => (
    <div style={{ height: 600, display: "flex" }}>
      <StandaloneChatView messages={loaded.messages as ChatMessage[]} loading={false} onSend={() => {}} onResend={() => {}} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await pasteImages(canvasElement, [await makeCrumbPhoto()]);
    const textarea = canvasElement.querySelector("textarea");
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "And this one from yesterday?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
};
