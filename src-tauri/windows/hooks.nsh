; Graphium NSIS インストーラフック
;
; sidecar (node.exe) が実行中だと、インストーラがファイルを上書きできず
; "Error opening file for writing: ...\sidecar\node.exe" で失敗する。
; Windows では親プロセス (Graphium.exe) を終了しても子プロセスは死なない。
;
; さらに、このフック (NSIS_HOOK_PREINSTALL) はテンプレート標準の
; CheckIfAppIsRunning（本体の終了処理）より**前**に実行される。そのため
; node.exe だけを先に kill すると、まだ生きている本体アプリの
; ensureSidecar()（ヘルスチェック → 自動再起動）が sidecar を数秒で
; 再スポーンし、ファイルコピーと再びレースして負ける（v0.42.4 で実証）。
; 必ず「親をプロセスツリーごと」→「残った孤児」の順で止めること。
;
; 手動インストール（インストーラの再実行）と自動更新（/UPDATE 付き起動）の
; どちらの経路でもこのフックが呼ばれる。

; このファイルのあるフォルダ。マクロの中で ${__FILEDIR__} を使うと、挿入先
; （生成された installer.nsi）のフォルダになるので、読み込んだ時点で固定しておく
!define GRAPHIUM_HOOKS_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping Graphium processes..."
  ; 1. 本体をプロセスツリーごと終了（/T で子の node.exe も同時に死ぬ）。
  ;    インストーラ自身はイメージ名が異なるため巻き込まれない。
  nsExec::Exec 'taskkill /F /T /IM "Graphium.exe"'
  ; 2. 親が既にいない孤児 node.exe を掃除する（Job Object 導入前の旧ビルドが
  ;    残した孤児は 1. のツリー kill では拾えない）。インストール先配下の
  ;    パスで絞るので、無関係な node.exe には触らない。
  nsExec::Exec `powershell -NoProfile -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\sidecar\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  ; 3. 本体が終わりきるまで待つ。直後のテンプレートの CheckIfAppIsRunning は
  ;    Restart Manager で「Graphium.exe を開いているプロセス」を数え、終了処理の
  ;    途中で残っていると "Failed to kill Graphium" で中断する（v0.172 で、自動更新
  ;    のたびに・再起動しても毎回止まる利用者がいた）。同じ一覧が空になるまで最大
  ;    15 秒待ち、それでも残ったら、開いているプロセスをログ欄に出して原因を残す。
  InitPluginsDir
  File "/oname=$PLUGINSDIR\wait-app-exit.ps1" "${GRAPHIUM_HOOKS_DIR}\wait-app-exit.ps1"
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\wait-app-exit.ps1" -InstallDir "$INSTDIR"`
  Pop $0
  ; 4. OS がファイルハンドルを解放するまで少し待つ
  Sleep 1000
!macroend
