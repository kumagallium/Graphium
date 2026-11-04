# Chrome Web Store listing

The text and answers to paste into the Chrome Web Store Developer Dashboard for Graphium Web Clip.
Keep it in sync with the extension (`manifest.json`, permissions) and with
[`public/web-clip-privacy.html`](../../../public/web-clip-privacy.html).

## Package

```bash
pnpm ext:pack          # → dist-extension/graphium-web-clip-<version>.zip
```

Bump `version` in `manifest.json` before uploading an update (the store rejects a version it already has).

Images (re-generate with `node scripts/chrome-web-store-assets.mjs` after re-taking the manual screenshots):

| Field | File |
|---|---|
| Store icon (128×128) | `extensions/chrome/icons/icon-128.png` |
| Screenshots (1280×800) | `screenshot-1-<lang>.png` … `screenshot-3-<lang>.png` |
| Small promo tile (440×280) | `promo-small-<lang>.png` |

## Store listing

- **Category:** Tools
- **Languages:** English (default), Japanese. Name and summary come from `_locales/*/messages.json`.
- **Homepage URL:** https://kumagallium.github.io/Graphium/manual/web-clip
- **Support URL:** https://github.com/kumagallium/Graphium/issues

### Description — English

```
Graphium Web Clip sends what you read in Chrome to Graphium, the note app with provenance tracking, running on your own computer.

Select a sentence on any page and click the toolbar icon (or press Option+Shift+C on macOS, Ctrl+Shift+Y on Windows, or right-click → Clip to Graphium). The selection becomes a memo in Graphium, with the page as its source, and is added as a quote to that page's note in the "Web clips" folder. Clip the same page again and the quote is appended to the same note. With nothing selected, the page itself is saved as a bookmark.

• Works with HTML papers, articles and documentation. In Chrome's PDF viewer, use the right-click menu.
• Connect once: press "Connect to Graphium", check that Graphium shows the same 4-digit number, and press Allow.
• If Graphium is not running, clips wait in the extension and are sent the next time it is.

Privacy
The extension sends data only to the Graphium app on this computer (http://127.0.0.1). It reads a page only when you clip it. No analytics, no tracking, no remote servers, no remote code.

Requires the Graphium desktop app (macOS / Windows) or a self-hosted Graphium server.
Source code: https://github.com/kumagallium/Graphium/tree/main/extensions/chrome
```

### Description — Japanese

```
Graphium Web クリップは、Chrome で読んだところを、あなたのコンピューターで動いている Graphium（来歴を記録するノートアプリ）に送る拡張機能です。

ページの文を選んでツールバーのアイコンを押します（macOS は Option+Shift+C、Windows は Ctrl+Shift+Y、右クリックの「Graphium にクリップ」でも同じです）。選んだ文はそのページを出典にしたメモになり、「Web clips」フォルダにあるそのページのノートへ引用として入ります。同じページから続けてクリップすると、同じノートに追記されます。何も選ばずに押すと、ページをブックマークとして残します。

• HTML 版の論文、記事、ドキュメントで使えます。Chrome で開いた PDF では右クリックメニューを使ってください。
• つなぐのは 1 回だけ。「Graphium とつなぐ」を押し、Graphium に同じ 4 桁の番号が出ていることを確かめて「許可する」を押します。
• Graphium が起動していないときは、クリップは拡張機能の中で待ち、次に起動したときに送られます。

プライバシー
拡張機能がデータを送るのは、このコンピューターの Graphium（http://127.0.0.1）だけです。ページを読むのはクリップしたときだけです。アクセス解析、トラッキング、外部のサーバー、リモートコードはありません。

Graphium のデスクトップ版（macOS / Windows）か、セルフホストの Graphium サーバーが必要です。
ソースコード: https://github.com/kumagallium/Graphium/tree/main/extensions/chrome
```

## Privacy practices tab

### Single purpose

```
Send text the user selects in Chrome (or the current page's URL and title) to the Graphium note app running on the user's own computer, where it is saved as a memo and a quote in a note.
```

### Permission justifications

| Permission | Justification |
|---|---|
| `activeTab` | When the user clicks the toolbar icon, presses the shortcut or uses the context menu, read the selected text, title and URL of that tab only. |
| `scripting` | Run a small function in the active tab, only at the moment the user clips, to read the current selection, title, URL and the page's DOI metadata. No code is injected otherwise. |
| `contextMenus` | Add "Clip to Graphium" (on a selection) and "Clip this page to Graphium" (on a page) to the right-click menu. In Chrome's PDF viewer this is the only way to read the selection. |
| `storage` | Keep the pairing code for the local Graphium app and the clips that could not be sent yet because Graphium was not running. |
| Host permission `http://127.0.0.1/*` | Send clips to the Graphium app on the same computer (its local server listens on 127.0.0.1). No other host is contacted. |

### Remote code

**No, I am not using remote code.** All JavaScript is in the package.

### Data usage

Check:

- **Website content** — the selected text, page title and URL, sent to the Graphium app on the user's own computer when the user clips.

Leave everything else unchecked (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity).

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://kumagallium.github.io/Graphium/web-clip-privacy.html
```

## Distribution

- **Visibility:** Public
- **Regions:** All regions

## Note to the reviewer (Test instructions)

```
This extension talks only to the Graphium desktop app on 127.0.0.1, so it does nothing visible without the app.
To test: install Graphium (https://github.com/kumagallium/Graphium/releases/latest), start it, open the extension's options (right-click the toolbar icon → Options), press "Connect to Graphium", then press "Allow" in Graphium. Select text on any web page and click the toolbar icon; a note appears in Graphium's "Web clips" folder.
No account or sign-in is needed.
```
