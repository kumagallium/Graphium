# Graphium Web Clip (Chrome extension)

Clip a selection or a whole page from Chrome into Graphium running on your computer.
Nothing is sent anywhere except `http://127.0.0.1` (your own machine). No analytics, no remote code.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `extensions/chrome/` folder.

No build step is needed; the extension is plain JavaScript.

## Publish to the Chrome Web Store

`pnpm ext:pack` creates `dist-extension/graphium-web-clip-<version>.zip`. The listing text, the
answers for the privacy tab and the images are in [`store/`](store/LISTING.md); the privacy policy is
[`public/web-clip-privacy.html`](../../public/web-clip-privacy.html).

## Pair with Graphium

1. Start Graphium. Click the extension's toolbar icon; while it is not connected, its options page opens.
2. Press **Connect to Graphium**. A 4-digit number appears.
3. Graphium asks whether to connect the extension and shows the same number. Press **Allow**. The options page says "Connected."

The request is accepted only from a `chrome-extension://` origin, waits at most two minutes, and only the extension that asked receives the code.

To connect by hand instead (an older Graphium, or a self-hosted server on another port), copy the pairing code (`<port>.<token>`) from **Settings → Storage → Share with other people → Web clip** and paste it under **More settings** on the options page.

## Use

- Select text, then click the toolbar icon. With nothing selected, it clips the page (a bookmark note only).
- Shortcut: `Ctrl+Shift+Y` (`Option+Shift+C` on macOS; `Command+Shift+Y` is taken by the macOS Stickies service). Change it at `chrome://extensions/shortcuts`.
- Right-click menu: **Clip to Graphium** on a selection, **Clip this page to Graphium** on a page. In Chrome's PDF viewer only the right-click menu can read the selection.
- Options: right-click the toolbar icon, **Options**.
- Toolbar badge: `✓` sent, `…` saved for later (Graphium not reachable), `!` error (hover for the reason).

If Graphium is closed, clips are kept in the extension (up to 200, oldest dropped first) and sent on the next clip, when Chrome starts, or when you open the options page and press **Send now**.

## Permissions

`activeTab`, `contextMenus`, `scripting`, `storage`, and host access to `http://127.0.0.1/*` only.
The page is read only at the moment you clip, and only the tab you clip from.

## Tests

`pnpm exec vitest run extensions/chrome`
