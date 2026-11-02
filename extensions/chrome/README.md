# Graphium Web Clip (Chrome extension)

Clip a selection or a whole page from Chrome into Graphium running on your computer.
Nothing is sent anywhere except `http://127.0.0.1` (your own machine). No analytics, no remote code.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `extensions/chrome/` folder.

No build step is needed; the extension is plain JavaScript.

## Pair with Graphium

1. In Graphium, open **Settings → Storage → Share with other people → Web clip** and copy the pairing code (`<port>.<token>`).
2. Click the extension's toolbar icon (or open its options page) and paste the code.
3. Press **Save**, then **Test connection**. It should say "Connected."

## Use

- Select text, right-click, **Clip to Graphium**.
- Right-click on a page, **Clip this page to Graphium** (creates a bookmark note only).
- Shortcut: `Ctrl+Shift+Y` (`Command+Shift+Y` on macOS). Clips the selection, or the page if nothing is selected. Change it at `chrome://extensions/shortcuts`.
- Toolbar badge: `✓` sent, `…` saved for later (Graphium not reachable), `!` error (hover for the reason).

If Graphium is closed, clips are kept in the extension (up to 200, oldest dropped first) and sent on the next clip, when Chrome starts, or when you open the options page and press **Send now**.

## Permissions

`activeTab`, `contextMenus`, `scripting`, `storage`, and host access to `http://127.0.0.1/*` only.
The page is read only at the moment you clip, and only the tab you clip from.

## Tests

`pnpm exec vitest run extensions/chrome`
