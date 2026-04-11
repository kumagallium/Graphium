// 英語翻訳辞書

export const en: Record<string, string> = {
  // ── PROV-DM コアラベル表示名 ──
  "label.step": "Procedure",
  "label.used": "Materials",
  "label.attr": "Attributes",
  "label.result": "Results",
  "label.prevStep": "Prior step",
  "label.material": "Material",
  "label.tool": "Tool",
  "label.step.bracketed": "[Procedure]",
  "label.used.bracketed": "[Materials]",
  "label.material.bracketed": "[Material]",
  "label.tool.bracketed": "[Tool]",
  "label.attr.bracketed": "[Attributes]",
  "label.result.bracketed": "[Results]",
  "label.prevStep.bracketed": "[Prior step]",
  // フリーラベル例
  "label.free.purpose": "[Purpose]",
  "label.free.discussion": "[Discussion]",
  "label.free.question": "[Question]",
  "label.free.evidence": "[Evidence]",
  "label.free.background": "[Background]",
  "label.free.reference": "[Reference]",
  "label.free.impression": "[Impression]",

  // ── ステータス ──
  "status.planned": "Planned",
  "status.inProgress": "In progress",
  "status.done": "Done",
  "status.skipped": "Skipped",

  // ── 実行者タイプ ──
  "executor.human": "Manual",
  "executor.machine": "Machine",
  "executor.ai": "AI",

  // ── リンクタイプ ──
  "linkType.derived_from": "Derived from",
  "linkType.used": "Used",
  "linkType.generated": "Generated",
  "linkType.reproduction_of": "Reproduced",
  "linkType.informed_by": "Prior step",
  "linkType.reference": "Reference",

  // ── リンク作成者 ──
  "createdBy.human": "Manual",
  "createdBy.ai": "AI",
  "createdBy.system": "Auto",

  // ── UI 共通 ──
  "common.save": "Save",
  "common.saving": "Saving...",
  "common.unsaved": "Unsaved",
  "common.saved": "Saved",
  "common.menu": "Menu",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.change": "Change",
  "common.cancel": "Cancel",
  "common.settings": "Settings",
  "common.signIn": "Sign in with Google",
  "common.signOut": "Sign out",
  "common.loading": "Loading...",
  "common.table": "[Table]",
  "common.color": "Color",

  // ── ログイン画面 ──
  "login.subtitle": "Block editor with PROV-DM provenance tracking",
  "login.selectStorage": "Select where to save your notes",
  "login.driveNote": "Notes are saved in the Graphium folder on Google Drive",
  "login.driveDesktopNote": "Your browser will open for Google sign-in",
  "login.localNote": "Notes are saved in this browser (offline)",
  "login.localStart": "Start offline",

  // ── サイドバー ──
  "sidebar.newNote": "+ New Note",
  "sidebar.provTemplate": "+ PROV Template",
  "sidebar.refresh": "Reload",
  "sidebar.releaseNotes": "Release Notes",
  "sidebar.aiConnected": "AI connected",
  "sidebar.aiNotConfigured": "AI not configured",

  // ── エディタ ──
  "editor.titlePlaceholder": "Note title",
  "editor.newNote": "New note",
  "editor.derive": "🔗 Derive new page",
  "editor.aiAssistant": "🤖 AI Assistant",
  "editor.askAi": "Ask AI about selection",
  "editor.derivedNote": "Derived note",

  // ── 右パネルタブ ──
  "panel.prov": "Procedure",
  "panel.generate": "Generate",
  "panel.generateManual": "Regenerate manually",
  "panel.history": "History",

  // ── 編集履歴パネル ──
  "history.empty": "No edit history yet. History will be recorded on save.",
  "history.revisions": "revisions",
  "history.blocks": "blocks",
  "history.labels": "labels",
  "history.type.edit": "Edit",
  "history.type.derive": "Derive",
  "history.type.aiGen": "AI Generate",
  "history.type.aiDerive": "AI Derive",
  "history.type.template": "Template",
  "history.type.deriveSource": "Forked",

  // ── ラベル UI ──
  "labelUi.coreLabels": "Core labels (PROV-DM)",
  "labelUi.freeLabels": "Free labels (examples)",
  "labelUi.custom": "Custom",
  "labelUi.removeLabel": "Remove label",
  "labelUi.placeholder": "[label name]",
  "labelUi.prevStepLink": "Prior step link (wasInformedBy)",
  "labelUi.selectPrevStep": "Select prior step to link",
  "labelUi.selectHeading": "Select target heading",
  "labelUi.insertLabeledBlock": "Insert block with {label} label",
  "labelUi.provLabel": "PROV label",
  "labelUi.noLabel": "No label",

  // ── PROV インジケーター ──
  "provIndicator.clickForDetails": "{label} — Click for details",
  "provIndicator.outLinks": "→ Output links",
  "provIndicator.inLinks": "← Input links",
  "provIndicator.selectStep": "Select [Procedure] to link",
  "provIndicator.noHeadings": "No headings found",

  // ── リンクバッジ ──
  "linkBadge.outLinks": "→ Output links",
  "linkBadge.inLinks": "← Input links",
  "linkBadge.clickToNavigate": "Click to navigate",
  "linkBadge.deleteLink": "Delete link",

  // ── 設定モーダル ──
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.aiNotConfigured": "No AI models registered. Go to Settings → AI Setup to add a model.",

  // ── AI チャット ──
  "aiChat.title": "AI Chat",
  "aiChat.history": "Chat history",
  "aiChat.clearChat": "Clear chat",
  "aiChat.quote": "Quote",
  "aiChat.askQuestion": "Ask a question about the content below.",
  "aiChat.placeholder": "Ask a question...",
  "aiChat.send": "Send",
  "aiChat.insertToScope": "Insert to scope",
  "aiChat.deriveNote": "Derive note",

  // ── PROV パネル ──
  "provPanel.noDoc": "No PROV document generated yet",
  "provPanel.warnings": "Warnings",
  "provPanel.nodes": "Nodes",
  "provPanel.relations": "Relations",

  // ── ナビゲーション ──
  "nav.noteList": "All Notes",
  "nav.recentNotes": "Recent Notes",
  "nav.showAll": "Show all",
  "nav.back": "Back",
  "nav.noNotes": "No notes found",
  "nav.search": "Search notes...",
  "nav.sortByModified": "Sort by modified",
  "nav.sortByCreated": "Sort by created",
  "nav.sortByTitle": "Sort by title",
  "nav.sortByOutgoing": "Sort by outgoing links",

  // ── インデックステーブル ──
  "indexTable.sidePeek": "Side peek",
  "indexTable.openNote": "Open note",
  "indexTable.linkedNote": "Linked note",

  // ── 派生ノート ──
  "derive.creating": "Creating derived note...",
  "derive.savingToDrive": "Saving to Google Drive",
  "derive.sourceNote": "Source note",

  // ── スラッシュメニュー ──
  "slashMenu.group": "PROV labels",

  // ── 追加 UI テキスト ──
  "common.empty": "(empty)",
  "common.back": "← Back",
  "common.search": "Search...",
  "common.clickToNavigate": "Click to navigate",

  // ── ラベル UI 追加 ──
  "labelUi.emptyHeading": "(empty heading)",
  "labelUi.goBack": "← Back",
  "labelUi.clickToChange": "{label} — Click to change",
  "labelUi.addLabel": "Add label",

  // ── リンクバッジ追加 ──
  "linkBadge.linkCount": "{count} links",

  // ── 設定モーダル追加 ──
  "settings.tab.general": "General",
  "settings.tab.aiSetup": "AI Setup",
  "settings.profile": "System Prompt",
  "settings.profileDefault": "Default (science)",
  "settings.profileLoading": "Loading profiles...",
  "settings.profileNone": "No profiles available",
  "settings.profileHelp": "Select the system prompt profile that defines how the AI behaves.",
  "settings.model": "AI Model",
  "settings.modelDefault": "Server default ({name})",
  "settings.modelDefaultLabel": "default",
  "settings.modelLoading": "Loading models...",
  "settings.modelNone": "No models registered",
  "settings.modelHelp": "Select the AI model to use. If not specified, the server default is used.",
  // ── 接続状態 ──
  "settings.health.title": "Connection Status",
  "settings.health.checking": "Checking...",
  "settings.health.unavailable": "Backend is not available. AI features require Docker or local development setup.",
  // ── モデル管理 ──
  "settings.models.title": "Registered Models",
  "settings.models.add": "Add model",
  "settings.models.loading": "Loading...",
  "settings.models.empty": "No models registered yet. Add a model to start using AI features.",
  "settings.models.addFirst": "Add your first model",
  "settings.models.edit": "Edit",
  "settings.models.editApiKey": "API Key (leave blank to keep current)",
  "settings.models.editApiKeyPlaceholder": "Enter new key to update",
  "settings.models.delete": "Delete",
  "settings.models.confirmDelete": "Delete?",
  // ── モデル追加フォーム ──
  "settings.addModel.title": "Add Model",
  "settings.addModel.provider": "Provider",
  "settings.addModel.apiKey": "API Key",
  "settings.addModel.apiKeyRequired": "Enter an API key first",
  "settings.addModel.fetchModels": "Fetch available models",
  "settings.addModel.fetching": "Fetching...",
  "settings.addModel.selectModel": "Select a model",
  "settings.addModel.customId": "Or enter model ID manually",
  "settings.addModel.customIdPlaceholder": "e.g. gpt-4o-mini",
  "settings.addModel.displayName": "Display name",
  "settings.addModel.addButton": "Add",
  "settings.addModel.adding": "Adding...",
  // ── Registry ──
  "settings.registry.title": "Crucible Registry URL",
  "settings.registry.placeholder": "http://localhost:8080",
  "settings.registry.help": "URL of the Crucible Registry for MCP tool management. Leave empty to use the server default.",
  // ── ツール ──
  "settings.tools.title": "Tools",
  "settings.tools.empty": "No tools registered",
  "settings.tools.loading": "Loading...",
  "settings.tools.enable": "Enable tool",
  "settings.tools.disable": "Disable tool",
  "settings.tools.help": "Toggle tools on/off for AI chat. Tools are managed via Crucible Registry.",

  // ── AI チャット追加 ──
  "aiChat.helpText": "Ask AI about this page, or select a block for focused questions.\nCmd+Enter to send",
  "aiChat.thinking": "Thinking...",
  "aiChat.sendHint": "Cmd+Enter to send",
  "aiChat.newChat": "+ New chat",
  "aiChat.noBackend": "AI features require running Graphium with Docker or local development setup. They are not available on GitHub Pages.",
  "aiChat.emptyChat": "(empty chat)",
  "aiChat.messageCount": "{count} messages",
  "aiChat.pageScope": "Page",
  "aiChat.insertToNote": "Insert into note",
  "aiChat.replaceInNote": "Replace in note",
  "aiChat.deriveAsNote": "Derive as note",

  // ── PROV パネル追加 ──
  "provPanel.noLabelsMessage": "Add labels to the editor, then run PROV generation",
  "provPanel.stepLegend": "Procedure",
  "provPanel.materialLegend": "Material",
  "provPanel.toolLegend": "Tool",
  "provPanel.resultLegend": "Results",
  "provPanel.attrLegend": "Attributes",
  "provPanel.graphStats": "{nodes} nodes · {relations} relations",
  "provPanel.expandView": "Expand view",

  // ── ナビゲーション追加 ──
  "nav.noteCount": "{filtered} / {total} notes",
  "nav.loadingNotes": "Loading notes...",
  "nav.noMatchingNotes": "No matching notes",
  "nav.noteColumn": "Note",
  "nav.outgoing": "Outgoing",
  "nav.incoming": "Incoming",
  "nav.labels": "Labels",
  "nav.modifiedDate": "Modified",
  "nav.createdDate": "Created",
  "nav.title": "Title",
  "nav.labelFilter": "Labels",
  "nav.clearFilter": "Clear filter",
  "nav.delete": "Delete",
  "nav.deleteSelected": "Delete {count} notes",
  "nav.selectAll": "Select all",
  "nav.deselectAll": "Deselect all",
  "nav.deleteConfirmTitle": "Delete notes",
  "nav.deleteConfirmMessage": "Are you sure you want to delete {count} note(s)? This action moves them to trash.",
  "nav.deleteConfirmOk": "Delete",
  "nav.deleteConfirmCancel": "Cancel",
  "nav.deleting": "Deleting...",

  // ── サイドピーク追加 ──
  "sidePeek.close": "Close side peek",
  "sidePeek.fullscreen": "Open in full screen",
  "sidePeek.loadError": "Failed to load",

  // ── インデックステーブル追加 ──
  "indexTable.enterTitleFirst": "Enter the note title in the first column before clicking",
  "indexTable.createNoteFailed": "Failed to create note: {error}",
  "indexTable.createNoteTitle": "Create note for {name}",
  "indexTable.enterTitleHint": "Enter the note title in the first column",

  // ── アセットブラウザ ──
  "asset.dataSection": "Data",
  "asset.type.image": "Images",
  "asset.type.video": "Videos",
  "asset.type.audio": "Audio",
  "asset.type.pdf": "PDFs",
  "asset.type.other": "Other Files",
  "asset.count": "{count} items",
  "asset.search": "Search media...",
  "asset.noMedia": "No media found",
  "asset.unused": "Not used in any note",
  "asset.deleteConfirmTitle": "Delete media",
  "asset.deleteConfirmMessage": "Delete \"{name}\"? This moves it to trash and removes it from all notes.",
  "asset.deleting": "Deleting...",
  "asset.usedInCount": "Used in {count} notes",
  "asset.legendMedia": "Media",
  "asset.legendNote": "Note",
  "asset.clickToNavigate": "Click node to open note",
  "asset.clickToRename": "Click to rename",
  "asset.sortDate": "Date",
  "asset.sortName": "Name",
  "asset.pickTitle": "Select {type}",
  "asset.slashGroup": "Existing media",
  "asset.slashImage": "Image",
  "asset.slashImageSub": "Upload new or insert existing image",
  "asset.slashVideo": "Video",
  "asset.slashVideoSub": "Upload new or insert existing video",
  "asset.slashAudio": "Audio",
  "asset.slashAudioSub": "Upload new or insert existing audio",
  "asset.slashPdf": "PDF",
  "asset.slashPdfSub": "Upload new or insert existing PDF",
  "asset.uploadNew": "Upload from file",
  "asset.uploading": "Uploading…",
  "asset.type.url": "URLs",
  "asset.urlRegisterTitle": "Register URL",
  "asset.urlFetch": "Fetch",
  "asset.urlTitle": "Title",
  "asset.urlDescription": "Description",
  "asset.urlDescriptionPlaceholder": "Add a description (optional)",
  "asset.urlRegister": "Register",
  "asset.urlRegistering": "Registering…",
  "asset.urlAdd": "Add URL",
  "asset.urlOpen": "Open in new tab",
  "asset.urlDomain": "Domain",
  "asset.urlExistingMatch": "This URL is already registered. Click to reuse:",
  "asset.urlStyleBookmark": "Bookmark",
  "asset.urlStyleBookmarkSub": "Display as a card with preview",
  "asset.urlStyleLink": "Link",
  "asset.urlStyleLinkSub": "Paste as inline text",

  // ── ラベルギャラリー ──
  "label.section": "Labels",
  "label.search": "Search blocks...",
  "label.noBlocks": "No labeled blocks found",
  "label.noteColumn": "Note",
  "label.previewColumn": "Content",
  "label.sortNote": "Note",
  "label.noteCount": "Notes",
  "label.noteCountValue": "{count}",
  "label.networkTitle": "Notes using \"{name}\"",
  "label.legendLabel": "Label value",
  "label.legendNote": "Note",

  // ── PDF エクスポート ──
  "pdf.export": "PDF",
  "pdf.exporting": "Exporting...",

  // ── PROV-JSON-LD エクスポート ──
  "prov.export": "PROV-JSON-LD",
  "prov.exportDisabled": "No provenance data to export",
};
