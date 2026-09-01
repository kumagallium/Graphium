/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { defaultExclude } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "node:child_process";
import { writeFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// pdfjs-dist の実体ディレクトリを解決する。pnpm は node_modules/pdfjs-dist を
// .pnpm 配下への symlink にするため、package.json を resolve して実パスを得る。
const pdfjsDistDir = path.dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);

/**
 * pdf.js の cmap / 標準フォント / worker を public/pdfjs/ にコピーする Vite プラグイン。
 *
 * CJK（日本語等）PDF は CID フォントを使い、これらを描画するには cmap データが
 * 必須。未指定だとフォントが埋め込まれていても文字だけ消える。実体は
 * pdfjs-dist に同梱されているので、バージョン追従のため public/ にコミットせず
 * node_modules からビルド/dev 起動時にコピーする（public 配下なので dev も
 * build も BASE_URL 経由で同じ URL で配信される）。
 * 出力先 public/pdfjs/{cmaps,standard_fonts} は src/lib/pdfjs-config.ts と対応。
 */
function pdfjsAssetsPlugin(): Plugin {
  const copy = () => {
    const dest = path.resolve(__dirname, "public/pdfjs");
    mkdirSync(dest, { recursive: true });
    for (const sub of ["cmaps", "standard_fonts"]) {
      const from = path.join(pdfjsDistDir, sub);
      if (existsSync(from)) {
        cpSync(from, path.join(dest, sub), { recursive: true });
      }
    }
    // pdf.js worker を .js 拡張子でコピーする。pdf.js は worker を
    // `new Worker(workerSrc, { type: "module" })` で生成するので workerSrc は
    // 同一オリジンの URL でよい。Tauri の asset protocol は worker の .mjs を
    // module worker 用の MIME で配信できず起動に失敗するが、.js はアプリ本体の
    // スクリプトと同様に正しく配信されるため module worker を起動できる。
    // workerSrc 方式は <Document> ごとに worker を生成・破棄するため、単一
    // workerPort を共有したときの「the worker is being destroyed」も起きない。
    const workerFrom = path.join(pdfjsDistDir, "build", "pdf.worker.min.mjs");
    if (existsSync(workerFrom)) {
      cpSync(workerFrom, path.join(dest, "pdf.worker.min.js"));
    }
  };
  return {
    name: "copy-pdfjs-assets",
    buildStart: copy,
  };
}

// tesseract.js（画像 OCR）の実体ディレクトリを解決する（pnpm の symlink を辿る）。
const tesseractDistDir = path.join(
  path.dirname(createRequire(import.meta.url).resolve("tesseract.js/package.json")),
  "dist",
);
const tesseractCoreDir = path.dirname(
  createRequire(import.meta.url).resolve("tesseract.js-core/package.json"),
);

/**
 * tesseract.js の worker / wasm コア / 学習データを public/tesseract/ にコピーする。
 *
 * tesseract.js は既定でこれらを jsdelivr から読む（worker を blob で作り、その中で
 * `importScripts("https://cdn.jsdelivr.net/...")` する）。デスクトップ（Tauri）の CSP は
 * `script-src 'self'` なので、この外部スクリプト読み込みがブロックされ OCR が起動しない。
 * 同一オリジンに置けば CSP を緩めずに通り、ついでにオフラインでも動く
 * （画像は元から端末外に出ないが、初回だけネットが要る状態も解消される）。
 *
 * コアは wasm を内包した `*.wasm.js` 単体で動くため `.wasm` は運ばない。SIMD 版を既定にし、
 * 非対応環境用に無印も置く（worker が実行時に選ぶ）。学習データは軽量な `4.0.0_best_int`
 * （eng 2.9MB / jpn 2.0MB）を使う。既定の `4.0.0`（best）は計 25MB で配布物には重すぎる。
 * 出力先 public/tesseract/ は src/lib/ocr.ts の各パス指定と対応。
 */
function tesseractAssetsPlugin(): Plugin {
  const copy = () => {
    const dest = path.resolve(__dirname, "public/tesseract");
    mkdirSync(dest, { recursive: true });

    const workerFrom = path.join(tesseractDistDir, "worker.min.js");
    if (existsSync(workerFrom)) {
      cpSync(workerFrom, path.join(dest, "worker.min.js"));
    }

    // wasm 内包の JS のみ運ぶ（`.wasm` 単体は使われない）。worker が実行時に
    // relaxed SIMD → SIMD → 無印 の順で対応を見て選ぶため、3 種そろえる。
    // relaxedsimd を落とすと今の Chromium 系で「script failed to load」になる（実測）。
    for (const core of [
      "tesseract-core-relaxedsimd-lstm.wasm.js",
      "tesseract-core-simd-lstm.wasm.js",
      "tesseract-core-lstm.wasm.js",
    ]) {
      const from = path.join(tesseractCoreDir, core);
      if (existsSync(from)) cpSync(from, path.join(dest, core));
    }

    // 学習データ。langPath 配下の `{lang}.traineddata.gz` を worker が読む。
    const langDest = path.join(dest, "lang");
    mkdirSync(langDest, { recursive: true });
    for (const lang of ["eng", "jpn"]) {
      try {
        const pkgDir = path.dirname(
          createRequire(import.meta.url).resolve(`@tesseract.js-data/${lang}/package.json`),
        );
        const from = path.join(pkgDir, "4.0.0_best_int", `${lang}.traineddata.gz`);
        if (existsSync(from)) cpSync(from, path.join(langDest, `${lang}.traineddata.gz`));
      } catch {
        // 学習データ未インストール時はスキップ（OCR は CDN フォールバックで動く）
      }
    }
  };
  return {
    name: "copy-tesseract-assets",
    // dev サーバーの初期化より前に置く必要がある。buildStart だけだと、
    // public/tesseract が無い状態（clone / worktree 直後）の初回起動では
    // コピーが publicDir の配信対象に入らず、その回だけ OCR が動かない。
    configResolved: copy,
    buildStart: copy,
  };
}

// mathlive の実体ディレクトリを解決する（pnpm の symlink を辿る）。
// pdfjs-dist と違い mathlive は package.json を exports に出していないので、
// エントリ（mathlive.min.js）を解決してその隣を見る。fonts はその直下にある。
const mathliveDir = path.dirname(
  createRequire(import.meta.url).resolve("mathlive"),
);

/**
 * MathLive のフォントを public/mathlive/fonts/ にコピーする Vite プラグイン。
 *
 * MathLive はフォントを CSS 経由ではなく実行時に `fontsDirectory` から読むため、
 * バンドラが解決してくれない。未配置だと数式エディタの記号がすべて豆腐になる。
 * pdfjs と同じ方針で、バージョン追従のため public/ にコミットせず node_modules
 * からコピーする。配信 URL は src/features/math/mathlive-setup.ts と対応。
 *
 * 音（soundsDirectory）は使わないのでコピーしない。
 */
function mathliveAssetsPlugin(): Plugin {
  const copy = () => {
    const from = path.join(mathliveDir, "fonts");
    if (!existsSync(from)) return;
    const dest = path.resolve(__dirname, "public/mathlive/fonts");
    mkdirSync(dest, { recursive: true });
    cpSync(from, dest, { recursive: true });
  };
  return {
    name: "copy-mathlive-assets",
    buildStart: copy,
  };
}

/**
 * dev/build 起動時に git log からリリースノート JSON を生成する Vite プラグイン。
 * public/release_notes.json に出力する（.gitignore 済み）。
 */
function releaseNotesPlugin(): Plugin {
  const generate = () => {
    try {
      const raw = execSync(
        'git log --pretty=format:"%H|||%s|||%ci" -50',
        { encoding: "utf-8" },
      ).trim();
      const commits = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, message, date] = line.split("|||", 3);
          return { sha: sha.slice(0, 7), message, date: date.slice(0, 10) };
        });
      writeFileSync(
        path.resolve(__dirname, "public/release_notes.json"),
        JSON.stringify(commits, null, 2),
        "utf-8",
      );
    } catch {
      // git が使えない環境（CI など）ではスキップ
    }
  };

  return {
    name: "generate-release-notes",
    buildStart: generate,
  };
}

// Tauri / Vercel 環境では base を "/" にする
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;
const isVercel = process.env.VERCEL === "1";

export default defineConfig({
  base: (isTauri || isVercel) ? "/" : "/Graphium/",
  optimizeDeps: {
    // rtf.js の EMFJS は UMD バンドルのため、dev で素通しすると ESM として
    // 実行されて export が取れない（this=undefined で TypeError）。esbuild の
    // CJS→ESM 変換を通すために明示 include する（docx-import の EMF 変換で使用）。
    include: ["rtf.js/dist/EMFJS.bundle.js"],
  },
  build: {
    rollupOptions: {
      // Multi-page: root `/` serves the landing page, `/app/` serves the editor.
      input: {
        main: path.resolve(__dirname, "index.html"),
        app: path.resolve(__dirname, "app/index.html"),
      },
    },
  },
  plugins: [
    releaseNotesPlugin(),
    pdfjsAssetsPlugin(),
    mathliveAssetsPlugin(),
    tesseractAssetsPlugin(),
    tailwindcss(),
    react(),
    // PWA: スタンドアローン対応（ホーム画面追加時にオフラインでもアプリシェルを表示）
    !isTauri && VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // アプリシェル（HTML/JS/CSS/フォント）をキャッシュ
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // precache から外すもの。列挙すると workbox の既定値ごと上書きされるので、
        // 既定の node_modules 除外も併せて書く。
        // - tesseract: OCR のコアと学習データ（計 10MB 超）はアプリシェルではない。
        //   `*.wasm.js` は上の js パターンに当たってしまうため明示的に除外する。
        // - fonts/jp/*.woff2: セルフホストした日本語フォント（490 チャンク約 8MB）。
        //   unicode-range で必要なチャンクだけ遅延取得される設計なので、全部を SW
        //   インストール時に落とすと分割の意味が無くなる。実際に使われたチャンクは
        //   下の runtimeCaching で CacheFirst に載る
        //   （fonts/jp/fonts.css は @font-face 定義そのものなので precache 対象のまま）。
        globIgnores: [
          "**/node_modules/**/*",
          "**/tesseract/**",
          "fonts/jp/*.woff2",
          "fonts/jp/**/*.woff2",
        ],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB（BlockNote 等のバンドルが大きいため）
        // Google API や Drive API はキャッシュしない
        navigateFallback: null,
        runtimeCaching: [
          {
            // 日本語フォントのサブセット（同一オリジン）。一度使った字はオフラインでも出る。
            urlPattern: /\/fonts\/jp\/.*\.woff2$/,
            handler: "CacheFirst",
            options: {
              cacheName: "jp-font-subsets",
              expiration: { maxEntries: 512, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            // モバイル送信の Google サインイン。静的な <script> は index.html から
            // 外したが、この機能を使ったときだけ動的に読む
            // （features/mobile-capture/inbox/push/google-auth.ts）ので規則は残す
            urlPattern: /^https:\/\/accounts\.google\.com\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/www\.googleapis\.com\//,
            handler: "NetworkOnly",
          },
          {
            // モバイル送信の切断（トークン revoke）。認可系は絶対にキャッシュしない
            urlPattern: /^https:\/\/oauth2\.googleapis\.com\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/lh3\.googleusercontent\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "media-thumbnails",
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: "Graphium",
        short_name: "Graphium",
        description: "Block editor with PROV-DM provenance tracking",
        theme_color: "#fafdf7",
        background_color: "#fafdf7",
        display: "standalone",
        // PWA points at the editor, not the marketing page — anyone who has
        // installed Graphium to their home screen wants the app to launch.
        scope: isVercel ? "/" : "/Graphium/app/",
        start_url: isVercel ? "/" : "/Graphium/app/",
        icons: [
          { src: "logo.png", sizes: "192x192", type: "image/png" },
          { src: "apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@base": path.resolve(__dirname, "src/base"),
      "@blocks": path.resolve(__dirname, "src/blocks"),
      "@features": path.resolve(__dirname, "src/features"),
      "@scenarios": path.resolve(__dirname, "src/scenarios"),
      "@ui": path.resolve(__dirname, "src/ui"),
    },
  },
  // Tauri 開発時のホットリロード用
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // /api/* をバックエンドサーバーに転送
      // （サーバーは 127.0.0.1 バインドなので localhost 表記を避ける）
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  // Tauri 環境ではホスト情報をクリアテキストで渡さない
  envPrefix: ["VITE_", "TAURI_ENV_"],
  test: {
    // .claude/worktrees/ には別セッションの git worktree が丸ごと入る（.gitignore 済み）。
    // そこまで走査すると、react は repo root・react-dom は worktree の node_modules から
    // 解決されて React インスタンスが二重になり、複製されたテストが軒並み
    // "Cannot read properties of null (reading 'useState')" で落ちる。
    // defaultExclude を展開しないと node_modules の除外ごと消えるので必ず残す。
    exclude: [...defaultExclude, ".claude/**"],
  },
});
