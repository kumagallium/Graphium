// dependency-cruiser 設定
// 目的: モジュール境界の「再発防止」。
//  - 循環依存 (no-circular) は error。新規の循環で CI を落とす。
//  - レイヤ逆転 (lib/base/ui/hooks → features 等) は warn（可視化のみ、CI は落とさない）。
// 既存の違反は `.dependency-cruiser-known-violations.json`（baseline）で許容され、
// dependency-cruiser が自動で読み込む。新たに増えた違反だけが報告される。
//
// 注: tsPreCompilationDeps は既定の false。実行時 import グラフのみを辿る
//     （`import type` のみの型循環は実行時に消えるため対象外。実行時の
//      "cannot access before initialization" を生む循環の検出に集中する）。

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "循環依存を禁止。実行時の初期化順序バグの温床。既存分は baseline で許容、新規のみ error。",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-not-to-features",
      comment: "lib（下位レイヤ）は features に依存しない（レイヤ逆転）。",
      severity: "warn",
      from: { path: "^src/lib/" },
      to: { path: "^src/features/" },
    },
    {
      name: "lib-not-to-server",
      comment: "lib はサーバ専用コードに依存しない。",
      severity: "warn",
      from: { path: "^src/lib/" },
      to: { path: "^src/server/" },
    },
    {
      name: "base-not-to-features",
      comment: "base（エディタ基盤）は features に依存しない（レイヤ逆転）。",
      severity: "warn",
      from: { path: "^src/base/" },
      to: { path: "^src/features/" },
    },
    {
      name: "ui-not-to-features",
      comment: "ui（汎用 UI）は features に依存しない（レイヤ逆転）。",
      severity: "warn",
      from: { path: "^src/ui/" },
      to: { path: "^src/features/" },
    },
    {
      name: "hooks-not-to-features",
      comment: "hooks（共有フック）は features に依存しない（レイヤ逆転）。",
      severity: "warn",
      from: { path: "^src/hooks/" },
      to: { path: "^src/features/" },
    },
  ],
  options: {
    // tsconfig の paths エイリアス（@/ など）を解決する
    tsConfig: { fileName: "tsconfig.json" },
    // 解析対象は src 配下のみ
    includeOnly: "^src/",
    // 解析しないもの
    doNotFollow: { path: "node_modules" },
    // テスト/ストーリー/型定義はグラフから除外（本番コードの依存に集中）
    exclude: {
      path: "\\.(test|spec)\\.(ts|tsx)$|\\.stories\\.(ts|tsx)$|\\.d\\.ts$",
    },
    enhancedResolveOptions: {
      // .ts/.tsx を解決
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
