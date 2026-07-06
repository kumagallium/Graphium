# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Graphium, please report it responsibly.

### How to Report

1. **Do NOT open a public issue** for security vulnerabilities
2. Email: **kumagallium@gmail.com**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

This is a volunteer-maintained project, so we cannot guarantee specific response times. That said, we will do our best to:

- **Acknowledge** your report promptly
- **Assess** the issue and communicate next steps
- **Prioritize** fixes based on severity

### Scope

The following are in scope:

- Cross-site scripting (XSS) in the editor or rendered content
- Injection vulnerabilities
- Data leakage of provenance data or stored API keys
- Escapes from the desktop app sandbox (e.g. arbitrary file write, arbitrary process control via a Tauri command)

The following are out of scope:

- Issues in third-party dependencies (report upstream)
- Attacks requiring physical access to an unlocked device
- Social engineering

## Security Considerations

Graphium handles research notes and, when AI features are used, third-party LLM API keys. Key measures:

- **Content Security Policy** — the desktop webview ships with a restrictive
  CSP (`src-tauri/tauri.conf.json`, `app.security.csp`). `script-src` is
  `'self'` only, so injected `<script>` from note content, imported URLs, or
  AI output cannot execute. `img-src`/`connect-src` allow `https:` because the
  app renders arbitrary bookmark/OG images and fetches user-pasted URLs for
  link previews.
- **Loopback-only local API** — the desktop sidecar and the local server bind
  to `127.0.0.1` (v0.16.10+; override with `GRAPHIUM_BIND_HOST`), so the mostly
  unauthenticated local API is not reachable from other machines.
- **No central account service** — the hosted PWA is a static site with no
  backend of ours; your data stays in your chosen storage location and your
  keys stay on your device.
- **Constrained desktop commands** — the Tauri commands exposed to the webview
  are scoped to their purpose. Process termination is limited to Graphium's own
  sidecar process, and file save goes through a native save dialog rather than
  accepting an arbitrary path from JavaScript.

## Key storage & threat model

AI features require a third-party LLM API key (Anthropic, OpenAI, a
self-hosted endpoint, etc.). Where that key rests depends on how you run
Graphium. In every case the key is only ever sent to the LLM provider you
configured — never to a Graphium-operated server.

### macOS desktop (Tauri)

- Keys are stored in the **macOS Keychain** (service `com.graphium.app`,
  account = model id) via the `security` CLI, not on disk in plaintext.
- On first run, an existing `models.json` that still contains a plaintext
  `apiKey` is migrated into the Keychain and the field is stripped from the
  file.

### Windows / Linux desktop (Tauri)

- The OS-Keychain path is macOS-specific. On Windows and Linux, keys are
  currently stored **in plaintext** in the sidecar's `models.json`
  (`<app data>/com.graphium.app/server-data/models.json`).
- **Mitigations we recommend until a platform credential store is wired up:**
  - Enable full-disk encryption (BitLocker on Windows, LUKS on Linux).
  - Use a **dedicated, scoped API key with a spending cap** for Graphium, so a
    leaked key has a bounded blast radius and can be revoked independently.
- Wiring Windows Credential Manager / libsecret into the same code path is on
  the roadmap.

### Web (GitHub Pages) and self-hosted

- The PWA has no server of ours. When AI features run against a local/remote
  server, the browser holds keys in **`localStorage` (plaintext)** and sends
  them to that server per request via the `X-LLM-API-Key` header (a passthrough
  to the upstream LLM API, not authentication for Graphium).
- Because a key lives in `localStorage`, any XSS on the page origin could read
  it — this is the main reason the desktop build enforces a CSP and the reason
  we recommend:
  - Use a **short-lived / disposable API key with a spending cap**.
  - Serve the app only over origins you trust.
- **Docker / self-hosted:** the local API has no built-in user auth. Bind it to
  loopback or keep it behind your own boundary (VPN/LAN/reverse proxy), and set
  `GRAPHIUM_AUTH_TOKEN` if you expose it beyond your own machine. See
  `docs/ARCHITECTURE.md` §6.1 for the full trust model.

## Disclosure Policy

We follow a coordinated disclosure process. Please allow us reasonable time to address the issue before public disclosure.
