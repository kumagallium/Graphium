# Privacy Policy

**Last updated:** 2026-04-27

Graphium is an open-source, local-first note editor with provenance tracking. This privacy policy explains how the application handles your data.

## What Graphium Does

Graphium is a block-based note editor. Notes are stored on your filesystem (desktop app) or in your browser's IndexedDB (web). All editing happens locally — Graphium itself does not send your notes anywhere.

## Data Collection

**Graphium does not collect, store, or transmit any personal data to any server.**

- No analytics or tracking
- No cookies
- No account or sign-in
- No server-side note storage

## Data Storage

| Data | Where it is stored |
|------|-------------------|
| Notes (desktop app) | Plain JSON files on your filesystem (default: `~/Documents/Graphium/`, configurable in Settings) |
| Notes (web / Docker self-host) | Your browser's IndexedDB |
| Personal information | Nowhere — not collected |

If you point the desktop app's save folder at a synced cloud folder (Google Drive / iCloud / Dropbox / etc.), your OS-level cloud sync will replicate the files to that provider. Graphium itself does not communicate with any cloud storage API.

## Third-Party Services

Graphium does not use any third-party services for storage or authentication.

If you configure an LLM provider (optional, opt-in) for AI features, your prompts are sent to that provider per their terms — Graphium does not relay or log this traffic. On the macOS desktop app, the API key you enter is stored in the macOS Keychain rather than on disk. The first launch of a version that supports Keychain storage automatically migrates any previously-stored plaintext key out of `models.json` and into the Keychain.

If you connect external tools (MCP servers), Graphium talks to them when you test a connection and when the AI chat lists or uses their tools, sending what each tool call needs. When you search **Search the official list** in Settings, the search words (and nothing else) are sent to the official MCP Registry (`registry.modelcontextprotocol.io`) through the Graphium backend. When you connect a checked tool that offers a key check (Tavily), the key is sent once to that tool's own API (`api.tavily.com/usage`) to confirm it before saving.

When you press **Seal as evidence** on a saved point in a note's history, a value computed from its content (a 32-byte SHA-256 hash) is sent to timestamp services (FreeTSA, and the public OpenTimestamps calendars) through the Graphium backend. The text and media are not sent. The OpenTimestamps calendars receive that hash mixed with a random value, so they cannot match it with the one sent to FreeTSA. The services can see the sending IP address, the time and the User-Agent. Later, to complete the proof and check it, Graphium asks the calendars whether it is confirmed and fetches Bitcoin block information (`blockstream.info`, `mempool.space`). Nothing is sent until you press the button, and the web build, which has no backend, sends nothing.

## Children's Privacy

Graphium does not knowingly collect information from children under 13.

## Changes to This Policy

Updates will be posted in this file and reflected in the "Last updated" date above.

## Contact

For questions about this policy, please open an issue on the [GitHub repository](https://github.com/kumagallium/Graphium).

## Open Source

Graphium is open-source software licensed under the Apache License 2.0. You can review all source code at [https://github.com/kumagallium/Graphium](https://github.com/kumagallium/Graphium).
