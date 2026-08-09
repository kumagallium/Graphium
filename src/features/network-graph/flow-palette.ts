// フロービューの配色（design.md「手順フロービュー」の表が正）。
//
// ノード・エッジ・種類ピッカーが同じ定義を見るための 1 か所。ここに置くのは
// PROV ラベルの 4 色だけで、枠・面・三次テキストなどの UI ニュートラル色は
// `--color-*` トークンを使う（実値の hex を増やさない）。
//
//   main  ノードの枠・エッジ・点の色（ラベル色そのもの）
//   bg    タイトル帯の薄い面（--color-label-*-bg）
//   text  その帯の上に載る文字。ラベル色の暗い変種で、薄い面の上で 4.5:1 を確保する

import type { ActivityIoKind } from "./activity-graph-adapter";

export type FlowNodeKind = ActivityIoKind | "activity";

export type FlowKindColors = { main: string; bg: string; text: string };

export const KIND_PALETTE: Record<FlowNodeKind, FlowKindColors> = {
  activity: { main: "#5b8fb9", bg: "var(--color-label-activity-bg)", text: "#3f6c92" },
  material: { main: "#4B7A52", bg: "var(--color-label-entity-bg)", text: "#2d4a32" },
  tool: { main: "#c08b3e", bg: "var(--color-label-parameter-bg)", text: "#7a5a22" },
  output: { main: "#c26356", bg: "var(--color-label-result-bg)", text: "#a8513f" },
};

/** 選択の表し方。枠の太さは変えずリングにする（実寸が変わると React Flow が測り直す） */
export const selectionRing = (main: string) => `0 0 0 3px ${main}33, var(--shadow-2)`;
