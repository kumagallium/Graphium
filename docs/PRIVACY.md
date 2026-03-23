# Privacy Policy

**Last updated:** 2026-03-23

ProvNote is an open-source, client-side note editor with provenance tracking. This privacy policy explains how the application handles your data.

## What ProvNote Does

ProvNote is a block-based note editor that optionally integrates with Google Drive for saving and loading notes. All editing happens in your browser — there is no backend server.

## Data Collection

**ProvNote does not collect, store, or transmit any personal data to any server.**

- No analytics or tracking
- No cookies (beyond what Google Identity Services requires for authentication)
- No server-side storage — all processing happens locally in your browser

## Google Drive Integration

When you choose to sign in with Google, ProvNote requests the following permission:

- **`drive.file`** — Access only to files that ProvNote creates or that you explicitly open with ProvNote

### What this means:

- ProvNote **can** read and write its own files in your Google Drive
- ProvNote **cannot** access any other files in your Google Drive
- Your Google access token is stored only in `sessionStorage` (cleared when you close the browser tab)
- No refresh tokens are stored
- You can revoke access at any time via [Google Account Permissions](https://myaccount.google.com/permissions)

## Data Storage

| Data | Where it is stored |
|------|-------------------|
| Notes (local mode) | Your browser's local storage |
| Notes (Drive mode) | Your Google Drive, in a "ProvNote" folder |
| Authentication token | Browser `sessionStorage` (temporary) |
| Personal information | Nowhere — not collected |

## Third-Party Services

ProvNote uses only:

- **Google Identity Services** — for OAuth 2.0 authentication
- **Google Drive API** — for file storage (only when you sign in)

No other third-party services are used.

## Children's Privacy

ProvNote does not knowingly collect information from children under 13.

## Changes to This Policy

Updates will be posted in this file and reflected in the "Last updated" date above.

## Contact

For questions about this policy, please open an issue on the [GitHub repository](https://github.com/kumagallium/provnote).

## Open Source

ProvNote is open-source software licensed under the MIT License. You can review all source code at [https://github.com/kumagallium/provnote](https://github.com/kumagallium/provnote).
