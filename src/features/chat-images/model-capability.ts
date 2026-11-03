// チャットに使うモデルが画像を読めるか（入力欄の案内と、送信時の OCR 切り替えに使う）。
//
// Web 版はモデルの設定をブラウザが持ち、デスクトップ版はサーバー（sidecar）が持つ。
// 先にブラウザ側を見て、無ければ /models の一覧から名前で引く（設定画面と同じ順）。

import { useEffect, useState } from "react";
import { modelAcceptsImages } from "../../lib/model-vision";
import { getChatSynthesisLLMModel, getChatSynthesisModelName } from "../settings/store";
import { fetchModels } from "../ai-assistant/api";

export async function resolveChatModelAcceptsImages(): Promise<boolean> {
  const local = getChatSynthesisLLMModel();
  if (local) return modelAcceptsImages(local);
  try {
    const { models, default: defaultName } = await fetchModels();
    const name = getChatSynthesisModelName() || defaultName;
    const m = models.find((x) => x.name === name) ?? models.find((x) => x.name === defaultName);
    return m ? modelAcceptsImages({ provider: m.provider, modelId: m.model_id, apiBase: m.api_base || undefined }) : false;
  } catch {
    // 判定できないときは読める扱いにしておく。サーバー側でも読めないモデルには
    // 画像を注記に置き換えるので、送っても会話は壊れない
    return true;
  }
}

/**
 * 画像を貼ったときだけ判定する（入力欄を開くたびに /models を叩かない）。
 * 判定中・未判定は null。
 */
export function useChatModelAcceptsImages(active: boolean): boolean | null {
  const [accepts, setAccepts] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void resolveChatModelAcceptsImages().then((v) => {
      if (!cancelled) setAccepts(v);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);
  return active ? accepts : null;
}
