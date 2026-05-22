import type { Preview } from '@storybook/react-vite'
import { createElement } from 'react'
import { LocaleProvider } from '../src/i18n'
import '../src/app.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
  // useT() を使うコンポーネントが Provider 無しで落ちるので、全ストーリーを
  // LocaleProvider で包む。ブラウザロケールに従って en / ja を切り替える既存挙動を
  // そのまま Storybook でも再現できる。
  decorators: [
    (Story) => createElement(LocaleProvider, null, createElement(Story)),
  ],
};

export default preview;
