// 日本語翻訳辞書

export const ja: Record<string, string> = {
  // ── PROV-DM コアラベル表示名 ──
  "label.step": "手順",
  "label.used": "使用したもの",
  "label.attr": "属性",
  "label.result": "結果",
  "label.prevStep": "前手順",
  "label.step.bracketed": "[手順]",
  "label.used.bracketed": "[使用したもの]",
  "label.attr.bracketed": "[属性]",
  "label.result.bracketed": "[結果]",
  "label.prevStep.bracketed": "[前手順]",
  // フリーラベル例
  "label.free.purpose": "[目的]",
  "label.free.discussion": "[考察]",
  "label.free.question": "[疑問]",
  "label.free.evidence": "[証跡]",
  "label.free.background": "[背景]",
  "label.free.reference": "[参照]",
  "label.free.impression": "[感想]",

  // ── ステータス ──
  "status.planned": "予定",
  "status.inProgress": "実行中",
  "status.done": "完了",
  "status.skipped": "スキップ",

  // ── 実行者タイプ ──
  "executor.human": "手動",
  "executor.machine": "装置",
  "executor.ai": "AI",

  // ── リンクタイプ ──
  "linkType.derived_from": "派生元",
  "linkType.used": "使用",
  "linkType.generated": "生成",
  "linkType.reproduction_of": "再現",
  "linkType.informed_by": "前手順",
  "linkType.reference": "参照",

  // ── リンク作成者 ──
  "createdBy.human": "手動",
  "createdBy.ai": "AI",
  "createdBy.system": "自動",

  // ── UI 共通 ──
  "common.save": "保存",
  "common.saving": "保存中...",
  "common.unsaved": "未保存",
  "common.saved": "保存済み",
  "common.close": "閉じる",
  "common.delete": "削除",
  "common.add": "追加",
  "common.change": "変更",
  "common.cancel": "キャンセル",
  "common.settings": "設定",
  "common.signIn": "Google でサインイン",
  "common.signOut": "サインアウト",
  "common.loading": "読み込み中...",
  "common.table": "[テーブル]",
  "common.color": "色",

  // ── ログイン画面 ──
  "login.subtitle": "PROV-DM プロヴェナンス追跡付きブロックエディタ",
  "login.driveNote": "ノートは Google Drive の ProvNote フォルダに保存されます",

  // ── サイドバー ──
  "sidebar.newNote": "+ 新しいノート",
  "sidebar.provTemplate": "+ PROV テンプレート",
  "sidebar.refresh": "再読み込み",
  "sidebar.releaseNotes": "Release Notes",
  "sidebar.aiConnected": "AI 接続済み",
  "sidebar.aiNotConfigured": "AI 未設定",

  // ── エディタ ──
  "editor.titlePlaceholder": "ノートのタイトル",
  "editor.newNote": "新しいノート",
  "editor.derive": "🔗 新ページを派生",
  "editor.aiAssistant": "🤖 AI アシスタント",
  "editor.askAi": "選択範囲を AI に聞く",
  "editor.derivedNote": "派生ノート",

  // ── 右パネルタブ ──
  "panel.prov": "手順",
  "panel.generate": "生成",
  "panel.generateManual": "手動で再生成",

  // ── ラベル UI ──
  "labelUi.coreLabels": "コアラベル（PROV-DM）",
  "labelUi.freeLabels": "フリーラベル（例）",
  "labelUi.custom": "カスタム",
  "labelUi.removeLabel": "ラベルを外す",
  "labelUi.placeholder": "[ラベル名]",
  "labelUi.prevStepLink": "前手順リンク（wasInformedBy）",
  "labelUi.selectPrevStep": "前の手順を選択してリンク",
  "labelUi.selectHeading": "リンク先の見出しを選択",
  "labelUi.insertLabeledBlock": "{label} ラベル付きブロックを挿入",
  "labelUi.provLabel": "PROV ラベル",
  "labelUi.noLabel": "ラベルなし",

  // ── PROV インジケーター ──
  "provIndicator.outLinks": "→ 出力リンク",
  "provIndicator.inLinks": "← 入力リンク",
  "provIndicator.selectStep": "リンク先の [手順] を選択",
  "provIndicator.noHeadings": "見出しがありません",

  // ── リンクバッジ ──
  "linkBadge.outLinks": "→ 出力リンク",
  "linkBadge.inLinks": "← 入力リンク",
  "linkBadge.clickToNavigate": "クリックで移動",
  "linkBadge.deleteLink": "リンクを削除",

  // ── 設定モーダル ──
  "settings.title": "設定",
  "settings.language": "言語",
  "settings.agentUrl": "AI エージェント URL",
  "settings.envNote": "環境変数から設定されています。上書きする場合は新しい URL を入力してください。",
  "settings.placeholder": "https://your-agent-url.example.com",
  "settings.aiNotConfigured": "AI エージェントの接続先が設定されていません。サイドバーの「設定」から URL を入力してください。",

  // ── AI チャット ──
  "aiChat.title": "AI チャット",
  "aiChat.history": "チャット履歴",
  "aiChat.clearChat": "会話をクリア",
  "aiChat.quote": "引用",
  "aiChat.askQuestion": "以下の内容について質問があります。",
  "aiChat.placeholder": "質問を入力...",
  "aiChat.send": "送信",
  "aiChat.insertToScope": "スコープに挿入",
  "aiChat.deriveNote": "派生ノート",

  // ── PROV パネル ──
  "provPanel.noDoc": "PROV ドキュメントがまだ生成されていません",
  "provPanel.warnings": "警告",
  "provPanel.nodes": "ノード",
  "provPanel.relations": "関係",

  // ── ナビゲーション ──
  "nav.noteList": "すべてのノート",
  "nav.recentNotes": "最近のノート",
  "nav.showAll": "すべて表示",
  "nav.back": "戻る",
  "nav.noNotes": "ノートが見つかりません",
  "nav.search": "ノートを検索...",
  "nav.sortByModified": "更新日順",
  "nav.sortByCreated": "作成日順",
  "nav.sortByTitle": "タイトル順",
  "nav.sortByOutgoing": "リンク数順",

  // ── インデックステーブル ──
  "indexTable.sidePeek": "サイドピーク",
  "indexTable.openNote": "ノートを開く",
  "indexTable.linkedNote": "リンク済みノート",

  // ── 派生ノート ──
  "derive.creating": "派生ノートを作成中...",
  "derive.savingToDrive": "Google Drive に保存しています",
  "derive.sourceNote": "派生元ノート",

  // ── スラッシュメニュー ──
  "slashMenu.group": "PROV ラベル",

  // ── 追加 UI テキスト ──
  "common.empty": "(空)",
  "common.back": "← 戻る",
  "common.search": "検索...",
  "common.clickToNavigate": "クリックで移動",

  // ── ラベル UI 追加 ──
  "labelUi.emptyHeading": "(空の見出し)",
  "labelUi.goBack": "← 戻る",
  "labelUi.clickToChange": "{label} — クリックで変更",
  "labelUi.addLabel": "ラベルを付ける",

  // ── リンクバッジ追加 ──
  "linkBadge.linkCount": "{count} リンク",

  // ── 設定モーダル追加 ──
  "settings.agentHelp": "AI アシスタント機能を使うには crucible-agent を起動し、そのアドレスを入力してください。",
  "settings.apiKey": "API キー",
  "settings.apiKeyPlaceholder": "未設定（認証なし）",
  "settings.apiKeyEnvNote": "環境変数から設定されています。上書きする場合は新しいキーを入力してください。",
  "settings.apiKeyHelp": "crucible-agent の AGENT_API_KEY と同じ値を設定してください。未設定の場合は認証なしで接続します。",
  "settings.profile": "システムプロンプト",
  "settings.profileDefault": "デフォルト (science)",
  "settings.profileLoading": "プロファイルを読み込み中...",
  "settings.profileNone": "利用可能なプロファイルがありません",
  "settings.profileHelp": "AI の振る舞いを定義するシステムプロンプトのプロファイルを選択します。",
  "settings.model": "AI モデル",
  "settings.modelDefault": "サーバーデフォルト ({name})",
  "settings.modelDefaultLabel": "デフォルト",
  "settings.modelLoading": "モデルを読み込み中...",
  "settings.modelNone": "利用可能なモデルがありません",
  "settings.modelHelp": "使用する AI モデルを選択します。未指定の場合はサーバーのデフォルトモデルが使われます。",

  // ── AI チャット追加 ──
  "aiChat.helpText": "ブロックを選択して AI に質問できます。\nCmd+Enter で送信",
  "aiChat.thinking": "考え中...",
  "aiChat.sendHint": "Cmd+Enter で送信",
  "aiChat.newChat": "+ 新しいチャット",
  "aiChat.emptyChat": "(空のチャット)",
  "aiChat.messageCount": "{count} メッセージ",
  "aiChat.insertToNote": "ノートに反映",
  "aiChat.deriveAsNote": "別ノートとして派生",

  // ── PROV パネル追加 ──
  "provPanel.noLabelsMessage": "エディタにラベルを付けてから「PROV生成」を実行してください",
  "provPanel.stepLegend": "手順",
  "provPanel.usedLegend": "使用",
  "provPanel.resultLegend": "結果",
  "provPanel.attrLegend": "属性",
  "provPanel.graphStats": "{nodes} ノード · {relations} リレーション",
  "provPanel.expandView": "拡大表示",

  // ── ナビゲーション追加 ──
  "nav.noteCount": "{filtered} / {total} 件",
  "nav.loadingNotes": "ノートを読み込んでいます...",
  "nav.noMatchingNotes": "一致するノートがありません",
  "nav.noteColumn": "ノート",
  "nav.outgoing": "参照先",
  "nav.incoming": "被参照",
  "nav.labels": "ラベル",
  "nav.modifiedDate": "更新日",
  "nav.createdDate": "作成日",
  "nav.title": "タイトル",
  "nav.labelFilter": "ラベル",
  "nav.clearFilter": "フィルタをクリア",
  "nav.delete": "削除",
  "nav.deleteSelected": "{count} 件を削除",
  "nav.selectAll": "すべて選択",
  "nav.deselectAll": "選択解除",
  "nav.deleteConfirmTitle": "ノートの削除",
  "nav.deleteConfirmMessage": "{count} 件のノートを削除しますか？ゴミ箱に移動されます。",
  "nav.deleteConfirmOk": "削除",
  "nav.deleteConfirmCancel": "キャンセル",
  "nav.deleting": "削除中...",

  // ── サイドピーク追加 ──
  "sidePeek.close": "サイドピークを閉じる",
  "sidePeek.fullscreen": "フルスクリーンで開く",
  "sidePeek.loadError": "読み込みに失敗しました",

  // ── インデックステーブル追加 ──
  "indexTable.enterTitleFirst": "1列目にノートのタイトルを入力してからクリックしてください",
  "indexTable.createNoteFailed": "ノート作成に失敗しました: {error}",
  "indexTable.createNoteTitle": "{name} のノートを作成",
  "indexTable.enterTitleHint": "1列目にノートのタイトルを入力してください",

  // ── アセットブラウザ ──
  "asset.dataSection": "データ一覧",
  "asset.type.image": "画像",
  "asset.type.video": "動画",
  "asset.type.audio": "音声",
  "asset.type.pdf": "PDF",
  "asset.type.other": "その他",
  "asset.count": "{count} 件",
  "asset.search": "メディアを検索...",
  "asset.noMedia": "メディアが見つかりません",
  "asset.unused": "どのノートでも使用されていません",
  "asset.deleteConfirmTitle": "メディアの削除",
  "asset.deleteConfirmMessage": "「{name}」を削除しますか？ゴミ箱に移動され、すべてのノートから参照が消えます。",
  "asset.deleting": "削除中...",
  "asset.usedInCount": "{count} 件のノートで使用",
  "asset.legendMedia": "メディア",
  "asset.legendNote": "ノート",
  "asset.clickToNavigate": "ノードをクリックでノートを開く",
  "asset.clickToRename": "クリックで名前を変更",
  "asset.sortDate": "日付",
  "asset.sortName": "名前",
  "asset.pickTitle": "{type} を選択",
  "asset.slashGroup": "既存メディア",
  "asset.slashImage": "画像",
  "asset.slashImageSub": "新規アップロードまたは既存の画像から挿入",
  "asset.slashVideo": "動画",
  "asset.slashVideoSub": "新規アップロードまたは既存の動画から挿入",
  "asset.slashAudio": "音声",
  "asset.slashAudioSub": "新規アップロードまたは既存の音声から挿入",
  "asset.uploadNew": "ファイルからアップロード",

  // ── ラベルギャラリー ──
  "label.section": "ラベル",
  "label.search": "ブロックを検索...",
  "label.noBlocks": "ラベル付きブロックが見つかりません",
  "label.noteColumn": "ノート",
  "label.previewColumn": "内容",
  "label.sortNote": "ノート",
};
