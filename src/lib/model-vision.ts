// チャットに貼った画像を、そのモデルにそのまま見せてよいかの判定。
//
// クライアント（送る前に OCR へ切り替えるか決める）とサーバー（読めないモデルに
// 画像が届いたら文字の注記に置き換える）の両方で同じ規則を使う。
//
// 判定は「確実に読めるもの」だけ true にする控えめな規則:
//   - Anthropic / Google / Copilot: 現行のチャット向けモデルはすべて画像を読める
//   - OpenAI（公式）: 画像を読めない古い系列だけ外す
//   - OpenAI 互換・自前の API Base: モデル名に画像対応の系列名があるときだけ
//     （gpt-oss・Llama 3 など文字だけのモデルが多く、送ると 400 になるか黙って無視される）
// 外れたモデルでも会話は止めない。呼び出し側が端末内 OCR の文字で代わりに渡す。

export type VisionModelInfo = {
  provider: string;
  modelId: string;
  apiBase?: string | null;
};

/** OpenAI 公式で画像を読めない系列 */
const OPENAI_TEXT_ONLY_RE = /^(gpt-3\.5|gpt-4(-0314|-0613|-32k.*)?$|o1-mini|o1-preview|o3-mini|gpt-oss)/i;

/** OpenAI 互換のモデル名で、画像を読めると分かっている系列 */
const COMPATIBLE_VISION_RE =
  /(vision|[-_.]vl([-_.:]|$)|llava|pixtral|gemma-?3|qwen[\d.]*-?vl|internvl|minicpm-v|moondream|llama-?4|gpt-4o|gpt-4\.1|gpt-5|claude|gemini)/i;

export function modelAcceptsImages(model: VisionModelInfo | null | undefined): boolean {
  if (!model) return false;
  const id = model.modelId ?? "";
  switch (model.provider) {
    case "anthropic":
    case "google":
    case "copilot-subscription":
      return true;
    case "openai":
      // apiBase 付きは中身が OpenAI とは限らない（互換サーバー）ので名前で見る
      if (model.apiBase) return COMPATIBLE_VISION_RE.test(id);
      return !OPENAI_TEXT_ONLY_RE.test(id);
    case "openai-compatible":
      return COMPATIBLE_VISION_RE.test(id);
    default:
      return false;
  }
}
