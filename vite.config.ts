import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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

// Tauri 環境では base を "/" にする（ローカルファイル配信のため）
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

export default defineConfig({
  base: isTauri ? "/" : "/Graphium/",
  plugins: [releaseNotesPlugin(), tailwindcss(), react()],
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
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // Tauri 環境ではホスト情報をクリアテキストで渡さない
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
