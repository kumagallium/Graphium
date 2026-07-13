// Composer（Cmd+K）の型定義
// 現状 UI で公開されているのは Ask のみ。残り 3 モードは実装を残しつつ
// 意図的に UI から隠している（project_composer_mode_redesign.md 参照）。

import type { ComposerVerb } from "./verbs";
import type { GroundingScope } from "../../lib/grounding-scope";

export const COMPOSER_MODES = ["ask", "compose", "insert-prov", "insert-media"] as const;
export type ComposerMode = (typeof COMPOSER_MODES)[number];

/** 中段の発見カード — 直近の文脈から自動生成される提案 */
export type DiscoveryCard = {
  id: string;
  title: string;
  hint?: string;
  /** クリック時の挙動を呼び出し側に伝えるためのタグ。ボタンが何をするかは呼び出し側で解決する。 */
  action:
    | { kind: "continue-writing" }
    | { kind: "summarize-note" }
    | { kind: "visualize-prov" }
    | { kind: "make-concept-wiki" }
    | { kind: "custom"; key: string };
};

export type ComposerSubmission = {
  mode: ComposerMode;
  prompt: string;
  /** R2: verb メニュー由来の送信のとき、選ばれた動詞 id。
   *  PROV-DM の Activity subtype 記録（後続 PR）に伝播するため optional で持つ。 */
  verb?: ComposerVerb;
  /** grounding スコープ（外部参照/内部参照/ノート内参照）。AI 送信時に何を根拠として渡すか。
   *  未指定なら呼び出し側のデフォルト（DEFAULT_GROUNDING_SCOPE = ノート内参照）。 */
  scope?: GroundingScope;
};
