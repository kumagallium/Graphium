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

!include LogicLib.nsh

; 他のソフトに掴まれた旧 Graphium.exe を退避した先（退避していなければ空）
Var GraphiumMovedExe

; ログ欄に出し、%TEMP%\graphium-installer.log にも残す（wait-app-exit.ps1 と同じファイル）
!macro GraphiumLog text
  DetailPrint "${text}"
  ClearErrors
  FileOpen $9 "$TEMP\graphium-installer.log" a
  ${IfNot} ${Errors}
    FileSeek $9 0 END
    FileWrite $9 "${text}$\r$\n"
    FileClose $9
  ${EndIf}
!macroend

; 退避したあとでインストールが失敗したら、Graphium.exe が無いまま終わらないよう戻す
Function .onInstFailed
  ${If} $GraphiumMovedExe != ""
  ${AndIfNot} ${FileExists} "$INSTDIR\Graphium.exe"
    Rename "$GraphiumMovedExe" "$INSTDIR\Graphium.exe"
    !insertmacro GraphiumLog "Install failed: restored the old Graphium.exe"
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  StrCpy $GraphiumMovedExe ""
  !insertmacro GraphiumLog "--- Graphium ${VERSION} installer (update mode: $UpdateMode)"
  ; 前回までに退避した旧 Graphium.exe を消す（まだ掴まれていれば残るが、害は無い）
  Delete "$INSTDIR\Graphium.exe.*.old"
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
  !insertmacro GraphiumLog "wait-app-exit.ps1 exit code: $0"
  ; 4. 掴んでいるのが Graphium 以外（ウイルス対策ソフトなど）だけなら、旧 Graphium.exe
  ;    の名前を変えて退ける。テンプレートの判定は $INSTDIR\Graphium.exe を見るので、
  ;    ファイルが無ければ先へ進み、新しい Graphium.exe が置かれる。v0.172.2 で、
  ;    McAfee Framework Host（権限不足で閉じられない）が掴んだまま毎回止まる利用者がいた。
  ;    名前の変更まで拒まれたら何もせず、テンプレートの判定に任せる（今までどおり中断）
  ${If} $0 == 2
    System::Call 'kernel32::GetTickCount() i .r1'
    StrCpy $GraphiumMovedExe "$INSTDIR\Graphium.exe.$1.old"
    ClearErrors
    Rename "$INSTDIR\Graphium.exe" "$GraphiumMovedExe"
    ${If} ${Errors}
      !insertmacro GraphiumLog "Could not move the old Graphium.exe aside (another program blocks renaming it)"
      StrCpy $GraphiumMovedExe ""
    ${Else}
      !insertmacro GraphiumLog "Moved the old Graphium.exe aside to $GraphiumMovedExe"
    ${EndIf}
  ${EndIf}
  ; 5. OS がファイルハンドルを解放するまで少し待つ
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 退避した旧 Graphium.exe を消す。まだ掴まれていて消せなければ、次の更新で消す
  ${If} $GraphiumMovedExe != ""
    Delete "$GraphiumMovedExe"
  ${EndIf}
  !insertmacro GraphiumLog "Install finished"
!macroend
