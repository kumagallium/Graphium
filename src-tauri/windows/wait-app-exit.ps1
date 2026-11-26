# Graphium インストーラ用: 本体が終わりきるまで待ち、残ったものを表示する
#
# NSIS テンプレートの CheckIfAppIsRunning は、Restart Manager で
# 「$INSTDIR\Graphium.exe を開いているプロセス」を数え、1 つでも閉じられないと
# "Failed to kill Graphium" で中断する。hooks.nsh の taskkill の直後は、
# 本体がまだ終了処理の途中で一覧に残ることがある（終了中のプロセスは
# TerminateProcess も失敗する）。
#
# ここではテンプレートと同じ Restart Manager の一覧で判定し、
#   1. 一覧が空になるまで最大 $TimeoutSec 秒待つ（Graphium 自身は待つ間も止め直す）
#   2. それでも残ったら、名前・PID・種類をインストーラのログ欄へ出す
# Graphium 以外（ウイルス対策ソフトなど）は止めない。インストールの成否は
# テンプレート側の判定に任せ、このスクリプトは常に exit 0 で抜ける。

param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [int]$TimeoutSec = 15
)

$ErrorActionPreference = 'Stop'

try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class GraphiumRestartManager {
  [StructLayout(LayoutKind.Sequential)]
  struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public int ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);

  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint pSessionHandle);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
    uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);

  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo,
    [In, Out] RM_PROCESS_INFO[] rgAffectedApps, out uint lpdwRebootReasons);

  public sealed class Holder {
    public int Pid;
    public string Name;
    public int AppType;
  }

  // 一覧の取得に失敗したら null（呼び出し側は「分からない」として扱う）
  public static List<Holder> List(string path, out uint rebootReasons) {
    rebootReasons = 0;
    uint handle;
    var key = new StringBuilder(64);
    if (RmStartSession(out handle, 0, key) != 0) return null;
    try {
      if (RmRegisterResources(handle, 1, new[] { path }, 0, IntPtr.Zero, 0, null) != 0) return null;
      uint needed = 0, count = 0;
      int rc = RmGetList(handle, out needed, ref count, null, out rebootReasons);
      var result = new List<Holder>();
      if (rc == 0) return result;
      if (rc != 234) return null; // ERROR_MORE_DATA 以外は失敗
      var infos = new RM_PROCESS_INFO[needed];
      count = needed;
      if (RmGetList(handle, out needed, ref count, infos, out rebootReasons) != 0) return null;
      for (int i = 0; i < count; i++) {
        result.Add(new Holder {
          Pid = infos[i].Process.dwProcessId,
          Name = infos[i].strAppName,
          AppType = infos[i].ApplicationType,
        });
      }
      return result;
    } finally {
      RmEndSession(handle);
    }
  }
}
'@

  $exe = Join-Path $InstallDir 'Graphium.exe'
  if (-not (Test-Path -LiteralPath $exe)) {
    Write-Output "Graphium.exe not installed yet: nothing to wait for"
    exit 0
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $started = Get-Date
  $reasons = [uint32]0
  while ($true) {
    $holders = [GraphiumRestartManager]::List($exe, [ref]$reasons)
    if ($null -eq $holders) {
      Write-Output "Could not query processes using Graphium.exe (Restart Manager failed)"
      exit 0
    }
    if ($holders.Count -eq 0) {
      $waited = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
      Write-Output "Graphium.exe is free (waited ${waited}s)"
      exit 0
    }
    if ((Get-Date) -ge $deadline) { break }
    # 待つ間も Graphium 自身だけは止め直す（終了中なら失敗するが、それは無視して待つ）
    foreach ($h in $holders) {
      $p = Get-Process -Id $h.Pid -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'Graphium') {
        Stop-Process -Id $h.Pid -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 500
  }

  # 待っても残った。原因を調べられるよう、開いているプロセスを全部出す
  Write-Output "Still in use after ${TimeoutSec}s. Processes using Graphium.exe:"
  foreach ($h in $holders) {
    $path = ''
    try { $path = (Get-Process -Id $h.Pid -ErrorAction Stop).Path } catch { $path = '(path not readable)' }
    Write-Output ("  - {0} (PID {1}, type {2}) {3}" -f $h.Name, $h.Pid, $h.AppType, $path)
  }
  # 1=権限が足りない（管理者として動いている等） 2=別のセッション 4=重要なプロセス
  Write-Output "Reboot reasons: $reasons (1=permission denied, 2=other session, 4=critical process)"
} catch {
  Write-Output "wait-app-exit failed: $($_.Exception.Message)"
}
exit 0
