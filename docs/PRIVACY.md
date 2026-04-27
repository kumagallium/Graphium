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

If you configure an LLM provider (optional, opt-in) for AI features, your prompts are sent to that provider per their terms — Graphium does not relay or log this traffic.

## Children's Privacy

Graphium does not knowingly collect information from children under 13.

## Changes to This Policy

Updates will be posted in this file and reflected in the "Last updated" date above.

## Contact

For questions about this policy, please open an issue on the [GitHub repository](https://github.com/kumagallium/Graphium).

## Open Source

Graphium is open-source software licensed under the MIT License. You can review all source code at [https://github.com/kumagallium/Graphium](https://github.com/kumagallium/Graphium).
