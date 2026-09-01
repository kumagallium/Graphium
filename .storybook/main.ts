import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: [
    "../src/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-docs",
  ],
  framework: "@storybook/react-vite",
  // staticDirs は敢えて指定しない。builder-vite はルートの vite.config.ts を
  // 読み込んでからマージするので、Vite の publicDir デフォルト（<root>/public）が
  // そのまま効き、public/ 配下は dev / storybook build のどちらでも配信される。
  // ここで staticDirs: ["../public"] を足すと同じ 8MB 超の日本語フォントが
  // 二重にコピーされるだけなので追加しない。
  // → .storybook/preview-head.html の <link href="./fonts/jp/fonts.css"> はこれで解決される。
};
export default config;
