// Step ブロック（実現性スパイク版・最小実装）
//
// 「手順（Activity）」を children を持つコンテナブロックとして第一級化するための
// スパイク実装。設計は docs/internal/step-container-block-design-2026-07.md を参照。
//
// このスパイクで検証したいこと（§7 受け入れ条件）:
//   1. 段落・画像・テーブル・コードを「子ブロック」として保持できる
//   2. 子が step の DOM 内に描画される（レール＋タイトル＋子領域の体裁）
//   3. 標準ドラッグハンドルでネスト/アンネストできる
//   4. save→load（blocks: any[]）で children が round-trip する
//   5. 680px 幅で入れ子テーブルが破綻しない
//
// 実装メモ:
//   - content は "inline"。ステップ名（タイトル）は block の content に持たせる（§4.1）。
//     props に置くと generator の deriveActivityName が読めず Activity 名が落ちる。
//   - children（ネストした子ブロック）は BlockNote が blockContainer 内の
//     nested blockGroup として自動描画する。render 側は「タイトル行」だけを描く。
//   - 子領域を 1 本のレールで括る体裁は、blockContainer 単位の global CSS で付与する
//     （子は render 出力の外＝兄弟の blockGroup に出るため、インライン style では括れない）。

import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { ListChecks } from "lucide-react";

// 注: step コンテナの「枠/レール」体裁は blockContainer 単位の CSS で付ける。
// BlockNote(shadcn) の DOM は
//   .bn-block[blockContainer] > .react-renderer.node-step > .bn-block-content[data-content-type=step]
//   .bn-block[blockContainer] > .bn-block-group（子ブロック）
// なので、タイトル + 子をまとめて括るセレクタは
//   .bn-block:has(> .react-renderer.node-step) { ... }
// が正しい（直下に .bn-block-content は来ない）。見た目の最終案が決まり次第、
// ここ（または step.css）にベイクする。スパイクでは view.stories.tsx で 3 案を比較する。

export const StepBlock = createReactBlockSpec(
  {
    type: "step" as const,
    propSchema: {
      // 配置は BlockNote 標準の既定プロパティを流用
      textAlignment: defaultProps.textAlignment,
      // 表示バリアント（構造メタ）。タイトルはここに入れない（§4.1）
      variant: { default: "step" as const },
    },
    content: "inline" as const,
  },
  {
    render: (props) => {
      return (
        <div
          data-test="step-block"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "6px 8px",
            fontWeight: 600,
            width: "100%",
          }}
        >
          {/* ステップアイコン（編集不可） */}
          <span
            contentEditable={false}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              marginTop: 2,
              color: "var(--color-primary, #3a7a3a)",
            }}
          >
            <ListChecks size={18} strokeWidth={2} />
          </span>
          {/* ステップ名（インライン編集領域＝タイトルは content） */}
          <div
            ref={props.contentRef}
            style={{ flex: 1, minWidth: 0, lineHeight: "1.6" }}
          />
        </div>
      );
    },
  }
);
