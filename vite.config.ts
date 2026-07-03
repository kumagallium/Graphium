import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "node:child_process";
import { writeFileSync, cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

// pdfjs-dist の実体ディレクトリを解決する。pnpm は node_modules/pdfjs-dist を
// .pnpm 配下への symlink にするため、package.json を resolve して実パスを得る。
const pdfjsDistDir = path.dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);

/**
 * pdf.js の cmap / 標準フォントを public/pdfjs/ にコピーする Vite プラグイン。
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
    for (const sub of ["cmaps", "standard_fonts"]) {
      const from = path.join(pdfjsDistDir, sub);
      if (existsSync(from)) {
        cpSync(from, path.join(dest, sub), { recursive: true });
      }
    }
  };
  return {
    name: "copy-pdfjs-assets",
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
    tailwindcss(),
    react(),
    // PWA: スタンドアローン対応（ホーム画面追加時にオフラインでもアプリシェルを表示）
    !isTauri && VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // アプリシェル（HTML/JS/CSS/フォント）をキャッシュ
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB（BlockNote 等のバンドルが大きいため）
        // Google API や Drive API はキャッシュしない
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/accounts\.google\.com\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/www\.googleapis\.com\//,
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
});
