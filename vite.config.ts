import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

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
  plugins: [
    releaseNotesPlugin(),
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
        scope: isVercel ? "/" : "/Graphium/",
        start_url: isVercel ? "/" : "/Graphium/",
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
      "/api": {
        target: `http://localhost:${process.env.PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  // Tauri 環境ではホスト情報をクリアテキストで渡さない
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
