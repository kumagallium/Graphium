// MathLive（視覚的な数式入力）の遅延ロードと配置設定。
//
// MathLive は 800KB 超あるうえ、数式を編集する瞬間まで要らない。初期バンドルを
// 太らせないよう、編集に入ったときだけ動的 import する。ロードは 1 回だけ行い、
// 以降は同じ Promise を返す。
//
// フォントは CSS でなく実行時に `fontsDirectory` から読まれるため、バンドラでは
// 解決されない。vite.config.ts の mathliveAssetsPlugin が public/mathlive/fonts/ に
// 配るので、そこを BASE_URL 経由で指す（Web の /Graphium/ と Tauri の / の双方で解決）。
// 未設定だと数式の記号がすべて豆腐になる。

let loadPromise: Promise<typeof import("mathlive")> | null = null;

/** MathLive を読み込み、フォント・音の配置を設定して返す（多重ロードしない） */
export function loadMathLive(): Promise<typeof import("mathlive")> {
  if (!loadPromise) {
    loadPromise = import("mathlive").then((mathlive) => {
      const { MathfieldElement } = mathlive;
      MathfieldElement.fontsDirectory = `${import.meta.env.BASE_URL}mathlive/fonts`;
      // 仮想キーボードのクリック音は使わない。音声ファイルを配る必要もなくなる。
      MathfieldElement.soundsDirectory = null;
      return mathlive;
    });
  }
  return loadPromise;
}
