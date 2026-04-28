# Changelog

## [v0.3.12](https://github.com/kumagallium/Graphium/compare/v0.3.11...v0.3.12) - 2026-04-28
- refactor: drop Google Drive OAuth, go local-first by @kumagallium in https://github.com/kumagallium/Graphium/pull/176

## [v0.3.11](https://github.com/kumagallium/Graphium/compare/v0.3.10...v0.3.11) - 2026-04-27
- docs: refresh README with recent features by @kumagallium in https://github.com/kumagallium/Graphium/pull/154
- refactor: unify sidebar icons in RecentNotes with Lucide by @kumagallium in https://github.com/kumagallium/Graphium/pull/156
- Revamp wiki ingester prompt for readability + add concept levels by @kumagallium in https://github.com/kumagallium/Graphium/pull/157
- refactor: unify Add to Knowledge / Create PROV Note icons by @kumagallium in https://github.com/kumagallium/Graphium/pull/158
- feat: detect Knowledge state and surface it across the UI by @kumagallium in https://github.com/kumagallium/Graphium/pull/160
- Render markdown inline styles and chat citations in Wiki content by @kumagallium in https://github.com/kumagallium/Graphium/pull/161
- feat: public landing page at /Graphium/, move app to /Graphium/app/ by @kumagallium in https://github.com/kumagallium/Graphium/pull/159
- feat: Composer 'Add to Knowledge' card with keyboard navigation by @kumagallium in https://github.com/kumagallium/Graphium/pull/162
- docs: add 'Beyond the editor' section for save-to-graphium skill by @kumagallium in https://github.com/kumagallium/Graphium/pull/163
- feat: surface 'Already in Knowledge' state across dropdown, modal, peek by @kumagallium in https://github.com/kumagallium/Graphium/pull/164
- feat(settings): add Maintenance tab with bulk wiki Regenerate by @kumagallium in https://github.com/kumagallium/Graphium/pull/165
- fix(landing): unlock html/body scrolling on the LP by @kumagallium in https://github.com/kumagallium/Graphium/pull/167
- fix(landing): remove accent gradient so all sections share visual width by @kumagallium in https://github.com/kumagallium/Graphium/pull/168
- feat(wiki): Synthesis model + error-propagation safeguards by @kumagallium in https://github.com/kumagallium/Graphium/pull/166
- fix(landing): widen Hero/Problem text + restore gradient as full-viewport band by @kumagallium in https://github.com/kumagallium/Graphium/pull/169
- fix(landing): align color tokens with editor (body / header / cards) by @kumagallium in https://github.com/kumagallium/Graphium/pull/171
- fix(wiki): send embedding model credentials in X-LLM-API-Key by @kumagallium in https://github.com/kumagallium/Graphium/pull/170
- fix(landing): tighten section spacing by @kumagallium in https://github.com/kumagallium/Graphium/pull/172
- feat: direct upload to data list and PC memo creation by @kumagallium in https://github.com/kumagallium/Graphium/pull/173
- feat(settings): rename Synthesis model to Chat & Synthesis model by @kumagallium in https://github.com/kumagallium/Graphium/pull/174
- feat(list): unify note/wiki lists, drop profile feature by @kumagallium in https://github.com/kumagallium/Graphium/pull/175

## [v0.3.10](https://github.com/kumagallium/Graphium/compare/v0.3.9...v0.3.10) - 2026-04-25
- [refactor] Introduce useBlockLifecycle facade for labels and provLinks by @kumagallium in https://github.com/kumagallium/Graphium/pull/134
- [refactor] i18n internal keys for PROV labels by @kumagallium in https://github.com/kumagallium/Graphium/pull/136
- [feat] Carry labels and provLinks across block copy/paste by @kumagallium in https://github.com/kumagallium/Graphium/pull/137
- [feat] Add oklch scene tokens as primitives for UX Audit redesign by @kumagallium in https://github.com/kumagallium/Graphium/pull/138
- [feat] Scaffold Cmd+K Composer overlay (AI wiring deferred) by @kumagallium in https://github.com/kumagallium/Graphium/pull/139
- [feat] Derive whole note from header menu by @kumagallium in https://github.com/kumagallium/Graphium/pull/140
- [feat] Empty-note guide for discovering Cmd+K / # / @ / / by @kumagallium in https://github.com/kumagallium/Graphium/pull/141
- [feat] Wire Composer Ask mode to existing Chat panel by @kumagallium in https://github.com/kumagallium/Graphium/pull/142
- [feat] Composer: ship Ask-only UI and wire it end-to-end by @kumagallium in https://github.com/kumagallium/Graphium/pull/143
- feat: Generate PROV-labeled notes from URL by @kumagallium in https://github.com/kumagallium/Graphium/pull/144
- [feat] Add local save directory setting (G-SAVEDIR) by @kumagallium in https://github.com/kumagallium/Graphium/pull/146
- fix: MediaPickerModal image thumbnails broken for local storage by @kumagallium in https://github.com/kumagallium/Graphium/pull/145
- feat: UX Audit B — fonts, heading scale, color tokens, WikiBanner refine by @kumagallium in https://github.com/kumagallium/Graphium/pull/147
- feat: /template slash command with Plan and Run templates by @kumagallium in https://github.com/kumagallium/Graphium/pull/148
- feat: Wire Composer discovery cards to real data by @kumagallium in https://github.com/kumagallium/Graphium/pull/149
- feat(composer): unified Cmd+K palette with note search by @kumagallium in https://github.com/kumagallium/Graphium/pull/151
- feat: AI labeled output — auto context labels + PROV edges by @kumagallium in https://github.com/kumagallium/Graphium/pull/152
- feat: AI labeled output Phase 2 — Replace + Derive label propagation by @kumagallium in https://github.com/kumagallium/Graphium/pull/153
- feat: UX Audit cleanup — fonts, sidebar spacing, font setting, label affordance by @kumagallium in https://github.com/kumagallium/Graphium/pull/150

## [v0.3.9](https://github.com/kumagallium/Graphium/compare/v0.3.8...v0.3.9) - 2026-04-24
- [fix] Unblock desktop close button and unify release notes by @kumagallium in https://github.com/kumagallium/Graphium/pull/132
- chore: Limit desktop release to macOS Apple Silicon by @kumagallium in https://github.com/kumagallium/Graphium/pull/131

## [v0.3.8](https://github.com/kumagallium/Graphium/compare/v0.3.7...v0.3.8) - 2026-04-24
- fix: Bundle Node.js runtime for distributed desktop app by @kumagallium in https://github.com/kumagallium/Graphium/pull/129

## [v0.3.7](https://github.com/kumagallium/Graphium/compare/v0.3.6...v0.3.7) - 2026-04-24
- [fix] Allow AI chat on unsaved new notes by @kumagallium in https://github.com/kumagallium/Graphium/pull/124
- feat: Add UI controls to restart sidecar backend by @kumagallium in https://github.com/kumagallium/Graphium/pull/126
- Add save-to-graphium Claude Code skill and surface author/model in lists by @kumagallium in https://github.com/kumagallium/Graphium/pull/127
- [fix] Add missing skill file Tauri commands by @kumagallium in https://github.com/kumagallium/Graphium/pull/128

## [v0.3.6](https://github.com/kumagallium/Graphium/compare/v0.3.5...v0.3.6) - 2026-04-22
- Remove wiki status and Approve workflow by @kumagallium in https://github.com/kumagallium/Graphium/pull/117
- feat: List navigation with side peek, URL routing, and breadcrumbs by @kumagallium in https://github.com/kumagallium/Graphium/pull/118
- Add linked notes list view in graph panel by @kumagallium in https://github.com/kumagallium/Graphium/pull/119
- Add Skill (prompt template) feature by @kumagallium in https://github.com/kumagallium/Graphium/pull/120
- Add @mention to attach note/wiki context in AI chat by @kumagallium in https://github.com/kumagallium/Graphium/pull/121
- fix(i18n): localize relative time labels in recent notes by @kumagallium in https://github.com/kumagallium/Graphium/pull/122
- [docs] Polish README for international audience: AI Knowledge + hide JP-only spec by @kumagallium in https://github.com/kumagallium/Graphium/pull/123

## [v0.3.5](https://github.com/kumagallium/Graphium/compare/v0.3.4...v0.3.5) - 2026-04-20
- AI Knowledge Layer (G-ZETTEL) by @kumagallium in https://github.com/kumagallium/Graphium/pull/107
- Add URL and chat ingest sources by @kumagallium in https://github.com/kumagallium/Graphium/pull/108
- Add autonomous Wiki maintenance (lint, cross-update, index, log) by @kumagallium in https://github.com/kumagallium/Graphium/pull/110
- Hide AI features when backend is unavailable by @kumagallium in https://github.com/kumagallium/Graphium/pull/109
- Auto-save knowledge-worthy chat responses to Wiki by @kumagallium in https://github.com/kumagallium/Graphium/pull/111
- Add Synthesis Wiki pages (auto-generated from Concepts) by @kumagallium in https://github.com/kumagallium/Graphium/pull/112
- Add Vercel Serverless Functions support for Web hosting by @kumagallium in https://github.com/kumagallium/Graphium/pull/114
- Deepen llm-wiki: autonomous knowledge management by @kumagallium in https://github.com/kumagallium/Graphium/pull/113
- Add clickable inline citation links in Wiki pages by @kumagallium in https://github.com/kumagallium/Graphium/pull/115

## [v0.3.4](https://github.com/kumagallium/Graphium/compare/v0.3.3...v0.3.4) - 2026-04-16
- Harden app for production readiness by @kumagallium in https://github.com/kumagallium/Graphium/pull/93
- Remove unused sandbox mode by @kumagallium in https://github.com/kumagallium/Graphium/pull/94
- Fix Google OAuth session persistence by @kumagallium in https://github.com/kumagallium/Graphium/pull/95
- Fix iOS mobile viewport scroll and auto-zoom by @kumagallium in https://github.com/kumagallium/Graphium/pull/96
- Update design spec to match current implementation by @kumagallium in https://github.com/kumagallium/Graphium/pull/97
- Add memo editing and bookmark creation on mobile by @kumagallium in https://github.com/kumagallium/Graphium/pull/98
- Generalize spec: Graphium as universal note app by @kumagallium in https://github.com/kumagallium/Graphium/pull/99
- Add index file type definitions to data model spec by @kumagallium in https://github.com/kumagallium/Graphium/pull/100
- Incremental index update instead of full rebuild by @kumagallium in https://github.com/kumagallium/Graphium/pull/101
- feat: Media blocks in PROV graph with thumbnails and audio icons by @kumagallium in https://github.com/kumagallium/Graphium/pull/102
- Filter out index files from listFiles query by @kumagallium in https://github.com/kumagallium/Graphium/pull/103
- Reuse provider credentials & fix desktop model data loss by @kumagallium in https://github.com/kumagallium/Graphium/pull/105
- [feat] Sync block props.name on media rename by @kumagallium in https://github.com/kumagallium/Graphium/pull/104

## [v0.3.3](https://github.com/kumagallium/Graphium/compare/v0.3.2...v0.3.3) - 2026-04-13

## [v0.3.2](https://github.com/kumagallium/Graphium/compare/v0.3.1...v0.3.2) - 2026-04-13
- Add mobile responsive layout by @kumagallium in https://github.com/kumagallium/Graphium/pull/83
- Add mobile memo capture view with PC sidebar integration by @kumagallium in https://github.com/kumagallium/Graphium/pull/84
- Add memo insertion into notes with usage tracking by @kumagallium in https://github.com/kumagallium/Graphium/pull/85
- Add memo network graph, slash menu, and mobile media capture by @kumagallium in https://github.com/kumagallium/Graphium/pull/86
- Add customizable core label names + fix label inheritance on Enter by @kumagallium in https://github.com/kumagallium/Graphium/pull/87
- Fix Web OAuth silent refresh reliability by @kumagallium in https://github.com/kumagallium/Graphium/pull/88
- [fix] Clean up orphan links in PROV graph by @kumagallium in https://github.com/kumagallium/Graphium/pull/89

## [v0.3.2](https://github.com/kumagallium/Graphium/compare/v0.3.1...v0.3.2) - 2026-04-13
- Add mobile responsive layout by @kumagallium in https://github.com/kumagallium/Graphium/pull/83
- Add mobile memo capture view with PC sidebar integration by @kumagallium in https://github.com/kumagallium/Graphium/pull/84
- Add memo insertion into notes with usage tracking by @kumagallium in https://github.com/kumagallium/Graphium/pull/85
- Add memo network graph, slash menu, and mobile media capture by @kumagallium in https://github.com/kumagallium/Graphium/pull/86
- Add customizable core label names + fix label inheritance on Enter by @kumagallium in https://github.com/kumagallium/Graphium/pull/87
- Fix Web OAuth silent refresh reliability by @kumagallium in https://github.com/kumagallium/Graphium/pull/88
- [fix] Clean up orphan links in PROV graph by @kumagallium in https://github.com/kumagallium/Graphium/pull/89

## [v0.3.1](https://github.com/kumagallium/Graphium/compare/v0.3.0...v0.3.1) - 2026-04-12
- Enable auto-updater with signing and tagpr release automation by @kumagallium in https://github.com/kumagallium/Graphium/pull/80

## [v0.3.0](https://github.com/kumagallium/Graphium/compare/v0.2.0...v0.3.0) - 2026-04-12
- Introduce StorageProvider abstraction layer by @kumagallium in https://github.com/kumagallium/Graphium/pull/66
- Add Local (IndexedDB) storage provider for offline use by @kumagallium in https://github.com/kumagallium/Graphium/pull/67
- UI polish: header menu, gallery nav, icons, icon rail panel by @kumagallium in https://github.com/kumagallium/Graphium/pull/68
- feat: Page-level AI chat with history persistence by @kumagallium in https://github.com/kumagallium/Graphium/pull/69
- Add AI edit (replace) for selected blocks by @kumagallium in https://github.com/kumagallium/Graphium/pull/70
- Add URL bookmark support to asset browser by @kumagallium in https://github.com/kumagallium/Graphium/pull/72
- feat: Add multi-block selection with floating toolbar by @kumagallium in https://github.com/kumagallium/Graphium/pull/73
- Rename all provnote references to graphium by @kumagallium in https://github.com/kumagallium/Graphium/pull/71
- Add built-in AI backend (Vercel AI SDK) by @kumagallium in https://github.com/kumagallium/Graphium/pull/74
- Add Tauri v2 desktop app shell (Phase D1) by @kumagallium in https://github.com/kumagallium/Graphium/pull/75
- Add Tauri sidecar for AI backend (Phase D3) by @kumagallium in https://github.com/kumagallium/Graphium/pull/76
- Add menu bar, auto-updater, and CI/CD (Phase D4) by @kumagallium in https://github.com/kumagallium/Graphium/pull/77
- Add LocalFilesystemProvider for desktop app by @kumagallium in https://github.com/kumagallium/Graphium/pull/78
- Add Google OAuth for Tauri desktop app by @kumagallium in https://github.com/kumagallium/Graphium/pull/79

## [v0.2.0](https://github.com/kumagallium/Graphium/compare/v0.1.0...v0.2.0) - 2026-04-08
- Phase 1: Foundation — link layers, label UX, PROV naming by @kumagallium in https://github.com/kumagallium/Graphium/pull/34
- [feat] Phase 3: PROV-JSON-LD standardization by @kumagallium in https://github.com/kumagallium/Graphium/pull/35
- Phase 2: AI chat panel with scope context by @kumagallium in https://github.com/kumagallium/Graphium/pull/36
- Phase 4a: Note-level sample detection and scope fix by @kumagallium in https://github.com/kumagallium/Graphium/pull/37
- Phase 4b: Fix build and complete sampleScope custom block by @kumagallium in https://github.com/kumagallium/Graphium/pull/38
- Phase 4: Index table for sample management with side peek by @kumagallium in https://github.com/kumagallium/Graphium/pull/39
- Unify design tokens: replace Slate with Crucible green-gray by @kumagallium in https://github.com/kumagallium/Graphium/pull/40
- Add label support and performance optimizations to side peek by @kumagallium in https://github.com/kumagallium/Graphium/pull/41
- Fix: Persist auth across refresh with silent token renewal by @kumagallium in https://github.com/kumagallium/Graphium/pull/42
- Add left panel navigation with index file by @kumagallium in https://github.com/kumagallium/Graphium/pull/43
- Note list design alignment + @mention click-to-peek by @kumagallium in https://github.com/kumagallium/Graphium/pull/44
- Split monolithic note-app.tsx into hooks and components by @kumagallium in https://github.com/kumagallium/Graphium/pull/45
- Clarify standalone identity, split deployment modes, remove ambiguous wording by @kumagallium in https://github.com/kumagallium/Graphium/pull/46
- Add i18n support with English/Japanese language switching by @kumagallium in https://github.com/kumagallium/Graphium/pull/47
- Add unit tests for i18n, link-types, and utility modules by @kumagallium in https://github.com/kumagallium/Graphium/pull/48
- Add Crucible Registry for MCP tool support by @kumagallium in https://github.com/kumagallium/Graphium/pull/49
- Update README for Crucible integration and add update.sh by @kumagallium in https://github.com/kumagallium/Graphium/pull/50
- Add AI model and system prompt selectors to settings by @kumagallium in https://github.com/kumagallium/Graphium/pull/51
- Add delete UI to note list view by @kumagallium in https://github.com/kumagallium/Graphium/pull/52
- [fix] Persist chat session_id for continuous conversation by @kumagallium in https://github.com/kumagallium/Graphium/pull/53
- Add asset browser (Phase 5a) by @kumagallium in https://github.com/kumagallium/Graphium/pull/54
- Add logo, typography, and favicon branding by @kumagallium in https://github.com/kumagallium/Graphium/pull/55
- Replace /image /video /audio with media picker (Phase 5b) by @kumagallium in https://github.com/kumagallium/Graphium/pull/56
- Add label gallery and sidebar nav (Phase 5c) by @kumagallium in https://github.com/kumagallium/Graphium/pull/57
- Group label gallery by value with network modal by @kumagallium in https://github.com/kumagallium/Graphium/pull/58
- Add Document Provenance (edit history tracking) by @kumagallium in https://github.com/kumagallium/Graphium/pull/59
- Add PDF export with provenance graph by @kumagallium in https://github.com/kumagallium/Graphium/pull/60
- Add audit trail for document provenance by @kumagallium in https://github.com/kumagallium/Graphium/pull/61
- Remove sample-branch pattern expansion by @kumagallium in https://github.com/kumagallium/Graphium/pull/62
- Add PROV-JSON-LD export and material/tool label distinction by @kumagallium in https://github.com/kumagallium/Graphium/pull/63
- [feat] Add PDF viewer block by @kumagallium in https://github.com/kumagallium/Graphium/pull/64
- feat: i18n context label display + orphan label cleanup by @kumagallium in https://github.com/kumagallium/Graphium/pull/65

## [v0.1.0](https://github.com/kumagallium/Graphium/commits/v0.1.0) - 2026-03-26
- feat: Google Drive integration with note app UI by @kumagallium in https://github.com/kumagallium/Graphium/pull/1
- feat: Post-merge updates (auto-save, PROV template, privacy) by @kumagallium in https://github.com/kumagallium/Graphium/pull/2
- fix: Deploy with Google client ID and privacy page by @kumagallium in https://github.com/kumagallium/Graphium/pull/3
- Unify color palette with forest green theme and add Storybook stories by @kumagallium in https://github.com/kumagallium/Graphium/pull/4
- Add Google Drive integration, PROV template, and derived notes by @kumagallium in https://github.com/kumagallium/Graphium/pull/5
- Unify design theme and re-apply tab removal fixes by @kumagallium in https://github.com/kumagallium/Graphium/pull/6
- Add Obsidian-like network graph for note derivations by @kumagallium in https://github.com/kumagallium/Graphium/pull/7
- Use block content as derived note title by @kumagallium in https://github.com/kumagallium/Graphium/pull/8
- Add auto-generated release notes with git hook and modal UI by @kumagallium in https://github.com/kumagallium/Graphium/pull/9
- Unify graph colors with design.md theme and add smooth interactions by @kumagallium in https://github.com/kumagallium/Graphium/pull/10
- Fix orphan links when deleting derived notes by @kumagallium in https://github.com/kumagallium/Graphium/pull/11
- Simplify PROV panel: sample tabs + expand modal by @kumagallium in https://github.com/kumagallium/Graphium/pull/12
- Replace emoji icons with lucide-react SVG icons by @kumagallium in https://github.com/kumagallium/Graphium/pull/13
- AI アシスタント機能（crucible-agent 連携） by @kumagallium in https://github.com/kumagallium/Graphium/pull/14
- Fix SideMenu height alignment for custom headings by @kumagallium in https://github.com/kumagallium/Graphium/pull/15
- feat: Extend Activity scoping to all heading levels by @kumagallium in https://github.com/kumagallium/Graphium/pull/16
- Multi-block selection and AI assistant improvements by @kumagallium in https://github.com/kumagallium/Graphium/pull/17
- Move PROV labels to right-side indicator by @kumagallium in https://github.com/kumagallium/Graphium/pull/18
- Add AI agent settings for Pages users by @kumagallium in https://github.com/kumagallium/Graphium/pull/19
- Add API key authentication for crucible-agent by @kumagallium in https://github.com/kumagallium/Graphium/pull/20
- Improve README onboarding for new users by @kumagallium in https://github.com/kumagallium/Graphium/pull/21
- Add Docker Compose for one-command local setup with AI by @kumagallium in https://github.com/kumagallium/Graphium/pull/22
- Fix: remove unpublished container image reference by @kumagallium in https://github.com/kumagallium/Graphium/pull/23
- Use pre-built GHCR image for crucible-agent by @kumagallium in https://github.com/kumagallium/Graphium/pull/24
- Fix postgres healthcheck to check correct database by @kumagallium in https://github.com/kumagallium/Graphium/pull/25
- Fix LiteLLM 401 Unauthorized by adding API key by @kumagallium in https://github.com/kumagallium/Graphium/pull/26
- Fix: separate LiteLLM and Agent databases by @kumagallium in https://github.com/kumagallium/Graphium/pull/27
- Fix init-db.sh for Alpine (sh + chmod) by @kumagallium in https://github.com/kumagallium/Graphium/pull/28
- Add token auto-refresh and media file upload by @kumagallium in https://github.com/kumagallium/Graphium/pull/29
- Skip login screen in Docker (local storage mode) by @kumagallium in https://github.com/kumagallium/Graphium/pull/30
- Fix drag handle dropdown menu position offset by @kumagallium in https://github.com/kumagallium/Graphium/pull/31
- Add atomic design system (Atoms + Molecules) by @kumagallium in https://github.com/kumagallium/Graphium/pull/32
- Replace remaining inline styles and add Organisms layer by @kumagallium in https://github.com/kumagallium/Graphium/pull/33
