// @github/copilot-sdk が FFI 実行モード（RuntimeConnection.forInProcess）でのみ参照する
// koffi（ネイティブ FFI ライブラリ）の差し替えスタブ。
//
// sidecar は esbuild の単一ファイル ESM バンドルで、.node ネイティブバイナリを同梱できない。
// かといって koffi を external にすると、ESM 出力では external import がトップレベルへ
// 巻き上げられて起動時に即ロード → モジュール不在で sidecar が起動不能になる
//（ESM バンドルの既知の罠）。Graphium は常に forStdio（CLI subprocess）接続で
// FFI 経路を実行しないため、ビルド時にこのスタブへ差し替えて両方の問題を回避する。
export default new Proxy(
  {},
  {
    get() {
      throw new Error(
        "koffi is not bundled in the Graphium sidecar (the Copilot FFI runtime mode is unsupported; stdio mode is always used)",
      );
    },
  },
);
