; Graphium NSIS インストーラフック
;
; sidecar (node.exe) が実行中だと、インストーラがファイルを上書きできず
; "Error opening file for writing: ...\sidecar\node.exe" で失敗する。
; Windows では親プロセス (Graphium.exe) を終了しても子プロセスは死なず、
; sidecar 側の watchdog（2 秒間隔ポーリング）ともレースになるため、
; ファイルコピー直前にインストール先配下から起動された node.exe だけを
; 確実に終了させる。パスで絞るので無関係な node.exe には触らない。
;
; 手動インストール（インストーラの再実行）と自動更新（/UPDATE 付き起動）の
; どちらの経路でもこのフックが呼ばれる。

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping Graphium sidecar processes..."
  nsExec::Exec `powershell -NoProfile -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\sidecar\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  ; プロセス終了後、OS がファイルハンドルを解放するまで少し待つ
  Sleep 1000
!macroend
