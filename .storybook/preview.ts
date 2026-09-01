import type { Preview } from '@storybook/react-vite'
import { createElement, useEffect, Fragment, type ReactNode } from 'react'
import { LocaleProvider } from '../src/i18n'
import '../src/app.css'

/**
 * 日本語フォント軸（値はアプリ設定の JpFont と同じ ""/zen-kaku/biz-udp）を
 * body[data-jp-font] に反映するラッパー。app.css がこの属性を見て --ui の
 * フォントスタックを差し替えるので、設定モーダルの applyFontMode() と同じ経路で
 * UD 系フォントの見え方を Storybook でも確認できる。
 * @font-face の実体は preview-head.html が読む public/fonts/jp/fonts.css 側にある。
 */
function JpFontAxis({ value, children }: { value: string; children?: ReactNode }) {
  useEffect(() => {
    if (value) document.body.setAttribute('data-jp-font', value);
    else document.body.removeAttribute('data-jp-font');
  }, [value]);
  return createElement(Fragment, null, children);
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  // ツールバーの日本語フォント切り替え。既定 "" はアプリの初期状態と同じ
  // （OS のシステムフォント）なので、既存ストーリーの見た目は変わらない。
  globalTypes: {
    jpFont: {
      name: 'JP font',
      description: '日本語フォント（設定モーダルの「日本語フォント」と同じ軸）',
      toolbar: {
        title: 'JP font',
        icon: 'paragraph',
        items: [
          { value: '', title: 'System (default)' },
          { value: 'zen-kaku', title: 'Zen Kaku Gothic New' },
          { value: 'biz-udp', title: 'BIZ UDPGothic' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    jpFont: '',
  },
  // useT() を使うコンポーネントが Provider 無しで落ちるので、全ストーリーを
  // LocaleProvider で包む。ブラウザロケールに従って en / ja を切り替える既存挙動を
  // そのまま Storybook でも再現できる。
  decorators: [
    (Story, context) =>
      createElement(
        JpFontAxis,
        { value: String(context.globals.jpFont ?? '') },
        createElement(LocaleProvider, null, createElement(Story)),
      ),
  ],
};

export default preview;
