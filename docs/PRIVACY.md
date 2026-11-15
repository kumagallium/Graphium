# Privacy Policy

**Last updated:** 2026-11-08

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
| Which pages AI used (cited in an AI chat answer, or opened by an AI through Graphium's MCP server) | Small files in your own save folder (`appdata/ai-usage-*.json`) — page ids and times only, no questions or answers; never sent anywhere |
| Personal information | Nowhere — not collected |

If you point the desktop app's save folder at a synced cloud folder (Google Drive / iCloud / Dropbox / etc.), your OS-level cloud sync will replicate the files to that provider. Graphium itself does not send your notes to any cloud storage. The one exception is the phone capture screen: only if you connect your own Google Drive there, the files you send from the phone queue go into a `Graphium/Inbox` folder of your Drive (see "What goes over the network" in the [manual](https://kumagallium.github.io/Graphium/manual/storage-and-sync#what-goes-over-the-network)).

## Third-Party Services

Graphium has no storage or sign-in service of its own, and your notes are not stored with any third party. Connections to outside services fall into three groups. The manual lists each one with what it sends, when it runs and how to stop it: [What goes over the network](https://kumagallium.github.io/Graphium/manual/storage-and-sync#what-goes-over-the-network).

- **Nothing is sent by default:** your notes, media and settings stay on your computer or in your browser.
- **Only when you choose it:** an AI provider or external tools (MCP servers) you set up, **Seal as evidence**, the lookup from a DOI (the DOI alone goes to Crossref), world grounding (Wikipedia and OpenAlex, only while it is on; if you have connected web search such as Tavily in Settings, the first 400 characters of the claim text are also sent to that search service), and phone capture to your own Google Drive (the sign-in script from Google is loaded when you open the phone capture screen, even before you connect; nothing of yours is sent at that point).
- **Automatic connections (desktop app):** the update check (GitHub Pages, with GitHub Releases as a fallback; it sends no notes or account details and can be turned off in Settings) and the one-time download of the on-this-computer search model from Hugging Face (only a request for the model files; none of your text is sent).

If you configure an LLM provider (optional, opt-in) for AI features, your prompts are sent to that provider per their terms — Graphium does not relay or log this traffic. On the macOS desktop app, the API key you enter is stored in the macOS Keychain rather than on disk. The first launch of a version that supports Keychain storage automatically migrates any previously-stored plaintext key out of `models.json` and into the Keychain.

If you connect external tools (MCP servers), Graphium talks to them when you test a connection and when the AI chat lists or uses their tools, sending what each tool call needs. When you search **Search the official list** in Settings, the search words (and nothing else) are sent to the official MCP Registry (`registry.modelcontextprotocol.io`) through the Graphium backend. When you connect a checked tool that offers a key check (Tavily), the key is sent once to that tool's own API (`api.tavily.com/usage`) to confirm it before saving.

When you press **Seal as evidence** on a saved point in a note's history, a value computed from its content (a 32-byte SHA-256 hash) is sent to timestamp services (FreeTSA, and the public OpenTimestamps calendars) through the Graphium backend. The text and media are not sent. The OpenTimestamps calendars receive that hash mixed with a random value, so they cannot match it with the one sent to FreeTSA. According to its usage policy (https://freetsa.org/freetsa.html), FreeTSA does not store the hashes it timestamps and records only the sending IP address, to detect and investigate abuse. Requests identify themselves as Graphium (with its version) in the User-Agent. The services can see the sending IP address, the time and the User-Agent. Later, to complete the proof and check it, Graphium asks the calendars whether it is confirmed and fetches Bitcoin block information (`blockstream.info`, `mempool.space`). Nothing is sent until you press the button, and the web build, which has no backend, sends nothing.

## Children's Privacy

Graphium does not knowingly collect information from children under 13.

## Changes to This Policy

Updates will be posted in this file and reflected in the "Last updated" date above.

## Contact

For questions about this policy, please open an issue on the [GitHub repository](https://github.com/kumagallium/Graphium).

## Open Source

Graphium is open-source software licensed under the Apache License 2.0. You can review all source code at [https://github.com/kumagallium/Graphium](https://github.com/kumagallium/Graphium).
