// Graphium デスクトップアプリのコアライブラリ

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

// UI の拡大縮小（WebView 本来のページズーム。倍率・記憶・コマンドは ui_zoom.rs）
mod meeting_audio;
mod meeting_transcribe;
mod model_download;
mod embedding_models;
mod ocr_engine;
mod ocr_models;
#[cfg(target_os = "macos")]
mod ocr_vision;
mod ui_zoom;

// --- sidecar ログファイル ---
//
// sidecar の stdout/stderr は従来 Tauri の event でしか拾えず、DevTools を開かないと
// 障害解析ができなかった。Apple Developer 公証で配布範囲を広げる前に、ファイルベースの
// 永続ログを残す。
//
// レイアウト（macOS）: `~/Library/Logs/Graphium/sidecar.log`
//   それ以外: `dirs::data_local_dir()/com.graphium.app/logs/sidecar.log`
// 単純なローテーション: 5 MB を超えたら sidecar.log.1 にリネームして新規作成。
// 直近 2 世代だけ保持し、ディスクが膨らみ続けるのを防ぐ。

const SIDECAR_LOG_FILE: &str = "sidecar.log";
const SIDECAR_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn sidecar_log_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()?;
        let dir = home.join("Library").join("Logs").join("Graphium");
        Some(dir)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let base = dirs::data_local_dir()?;
        Some(base.join(APP_IDENTIFIER).join("logs"))
    }
}

fn sidecar_log_path() -> Option<PathBuf> {
    sidecar_log_dir().map(|d| d.join(SIDECAR_LOG_FILE))
}

fn rotate_sidecar_log_if_needed(path: &PathBuf) {
    let Ok(meta) = fs::metadata(path) else { return };
    if meta.len() < SIDECAR_LOG_MAX_BYTES {
        return;
    }
    let rotated = path.with_extension("log.1");
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(path, &rotated);
}

fn open_sidecar_log_file() -> Option<std::fs::File> {
    let dir = sidecar_log_dir()?;
    if let Err(e) = fs::create_dir_all(&dir) {
        eprintln!("[sidecar-log] ディレクトリ作成失敗 {}: {e}", dir.display());
        return None;
    }
    let path = dir.join(SIDECAR_LOG_FILE);
    rotate_sidecar_log_if_needed(&path);
    match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => Some(f),
        Err(e) => {
            eprintln!("[sidecar-log] ファイル open 失敗 {}: {e}", path.display());
            None
        }
    }
}

/// ログファイルに 1 行書く。失敗しても黙って捨てる（診断専用なので main 経路を壊さない）。
fn append_sidecar_log(file: &Mutex<Option<std::fs::File>>, prefix: &str, line: &str) {
    if let Ok(mut guard) = file.lock() {
        if let Some(f) = guard.as_mut() {
            let ts = humantime::format_rfc3339(std::time::SystemTime::now()).to_string();
            let _ = writeln!(f, "[{ts}] {prefix}{line}");
            let _ = f.flush();
        }
    }
}

mod heartbeat;

/// 終了処理の状態。フロントから shutdown_ack が来ると true、
/// 次の CloseRequested ではそのまま閉じる（無限ループ防止）
static SHUTDOWN_ACK: AtomicBool = AtomicBool::new(false);

// --- ネイティブ sidecar（Tauri Shell プラグインを介さない node 起動経路） ---
//
// Windows での Tauri Shell の挙動（spawn は成功するが stdout/stderr が
// renderer まで届かず close も飛ばない）を回避するため、Rust 側から
// 直接 node プロセスを起動して、stdout/stderr/exit を Tauri event で
// renderer に流す。
//
// AppState には現在の子プロセスの PID だけ保持する。Child 自体は
// stdout/stderr/wait を扱うスレッドへ move する（Child は Clone できないので、
// kill するときは PID を taskkill / kill -TERM で叩く）。
#[derive(Default)]
struct NativeSidecarState(Mutex<Option<u32>>);

// Windows: sidecar を本体プロセスの Job Object に入れ、本体終了時に OS が
// 確実に道連れ終了させる。
//
// Windows では親プロセスが死んでも子プロセスは終了しない。自動更新・強制終了・
// クラッシュで本体だけが先に消えると node.exe が孤児化し、
//   (1) インストーラが sidecar\node.exe を上書きできず
//       "Error opening file for writing" で失敗する（実行中 exe はロックされる）
//   (2) port を握ったままの古い sidecar を新バージョンが誤って再利用する
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 付きの Job に子を割り当てておくと、
// 本体終了で Job ハンドルが閉じた瞬間に OS が中の子プロセスを kill する。
// JS 側 watchdog（2 秒間隔ポーリング）より速く確実な、多層防御の 1 層目。
#[cfg(windows)]
mod sidecar_job {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // Job ハンドルは本体プロセスの生存中ずっと開いたままにする（閉じた瞬間に
    // 中の子が kill されるため、意図的に解放しない）。HANDLE は Send でない
    // 生ポインタなので usize で保持する。
    static JOB: OnceLock<usize> = OnceLock::new();

    fn create_kill_on_close_job() -> usize {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return 0;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                // kill 保証を設定できなかった Job は使わない
                CloseHandle(job);
                return 0;
            }
            job as usize
        }
    }

    /// spawn 直後の子プロセスを Job に割り当てる。失敗しても致命ではない
    /// （watchdog と NSIS フックが後段の防御として残る）。
    pub fn assign(child: &std::process::Child) -> bool {
        let job = *JOB.get_or_init(create_kill_on_close_job);
        if job == 0 {
            return false;
        }
        use std::os::windows::io::AsRawHandle;
        unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) != 0 }
    }
}

/// sidecar に渡す CORS_ORIGINS。debug ビルドだけ dev の vite（5174）を足す。release は
/// WebView の 3 オリジンだけを明示して渡す。空文字にはしない: sidecar は空の CORS_ORIGINS を
/// 「未指定」とみなして既定の http://localhost:5174 に戻すので、空だと 5174 が許可されたままになる。
fn sidecar_cors_origins() -> &'static str {
    if cfg!(debug_assertions) {
        "http://localhost:5174,tauri://localhost,http://tauri.localhost,https://tauri.localhost"
    } else {
        "tauri://localhost,http://tauri.localhost,https://tauri.localhost"
    }
}

/// この起動の間だけ有効なローカル API の合言葉（メモリにだけ持つ。ファイルには書かない）。
/// uuid v4 を 2 つつないだ 64 文字の 16 進。プロセスの間は同じ値を返す。
fn api_token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| {
        format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        )
    })
}

/// アプリ自身の窓（main と別ウィンドウ viewer）だけ合言葉を渡す。
/// capabilities の ACL はアプリ自前のコマンドには効かないので、ラベルを見て断る。
fn check_app_window_label(label: &str) -> Result<(), String> {
    if label == MAIN_LABEL || label == VIEWER_LABEL {
        Ok(())
    } else {
        Err("このウィンドウからは実行できません".to_string())
    }
}

/// ローカル API（sidecar）の合言葉を返す。画面は API への fetch に X-Graphium-Token として付ける。
/// async にしてあるのは、同期のコマンドがメインスレッドで実行されるため。起動直後のメインスレッドは
/// 窓の準備で塞がっていて、画面の最初の API 呼び出しがその間ずっと待たされる。
#[tauri::command]
async fn get_api_token(window: tauri::WebviewWindow) -> Result<String, String> {
    check_app_window_label(window.label())?;
    Ok(api_token().to_string())
}

/// 子プロセスを Rust 側で起動する。
/// 戻り値は spawn できた PID。renderer 側はその後 `sidecar-log` /
/// `sidecar-closed` イベントをリッスンしてバックエンドの状態を追う。
#[tauri::command]
fn start_native_sidecar(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeSidecarState>,
    data_dir: String,
    port: Option<u16>,
) -> Result<u32, String> {
    require_main_window(&window)?;
    let port = port.unwrap_or(3001);

    let emit_log = |app: &tauri::AppHandle, line: String| {
        let _ = app.emit("sidecar-log", line);
    };

    emit_log(&app, "[native] start_native_sidecar called".to_string());

    // 既存の子プロセスが残っていたら先に kill しておく。
    {
        let mut guard = state.0.lock().unwrap();
        if let Some(old_pid) = guard.take() {
            emit_log(&app, format!("[native] killing previous sidecar pid={old_pid}"));
            let _ = kill_pid_sync(old_pid);
        }
    }

    // node 実行ファイルを resolve。fetch-node.mjs が
    //   - Windows: src-tauri/sidecar/node.exe
    //   - macOS / Linux: src-tauri/sidecar/node
    // を配置している前提。tauri.conf.json の resources に "sidecar/node*"
    // を入れているので、bundle に同梱されている。
    let node_filename = if cfg!(windows) { "sidecar/node.exe" } else { "sidecar/node" };
    let node_path = app
        .path()
        .resolve(node_filename, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve {node_filename} failed: {e}"))?;
    let server_script = app
        .path()
        .resolve("sidecar/server.mjs", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve sidecar/server.mjs failed: {e}"))?;

    emit_log(
        &app,
        format!(
            "[native] node={} server={} dataDir={} port={}",
            node_path.display(),
            server_script.display(),
            data_dir,
            port
        ),
    );

    if !node_path.exists() {
        return Err(format!("node binary not found at {}", node_path.display()));
    }
    if !server_script.exists() {
        return Err(format!("server.mjs not found at {}", server_script.display()));
    }

    let mut cmd = Command::new(&node_path);
    cmd.arg(&server_script)
        .env("PORT", port.to_string())
        // 開発用オリジン（vite の 5174）は debug ビルドだけ許す。release で渡すと、利用者が
        // 別プロジェクトの dev サーバーを 5174 で動かしているとき、そのページのスクリプトが
        // 127.0.0.1 の API 応答を読めてしまう。Tauri の WebView 3 オリジンは sidecar 側で常に足される
        .env("CORS_ORIGINS", sidecar_cors_origins())
        .env("DATA_DIR", &data_dir)
        // 起動ごとの合言葉（get_api_token と同じ値）を渡す。親プロセスの環境の
        // GRAPHIUM_AUTH_TOKEN は継がせず、アプリ自身が作った値で上書きする。
        // 値はログ・イベントに出さない。画面は get_api_token で受け取り X-Graphium-Token に付ける。
        // GRAPHIUM_DESKTOP=1 は、<img> / pdf.js がヘッダーを付けられない画像・PDF の中継と、
        // 未認証の health の最小応答（pid）をデスクトップ版だけ開けるための印。
        // bind は 127.0.0.1 固定で足りるので GRAPHIUM_BIND_HOST / GRAPHIUM_ALLOWED_HOSTS は
        // 継がせない（継ぐと待ち受け先・許可ホストが変わる）
        .env("GRAPHIUM_AUTH_TOKEN", api_token())
        .env("GRAPHIUM_DESKTOP", "1")
        .env_remove("GRAPHIUM_BIND_HOST")
        .env_remove("GRAPHIUM_ALLOWED_HOSTS")
        // macOS の Keychain 経由で API キーを扱うよう sidecar に明示する。
        // 旧形式（models.json に平文）が残っていれば sidecar 側で Keychain へ移行する。
        .env("GRAPHIUM_USE_KEYCHAIN", if cfg!(target_os = "macos") { "1" } else { "0" })
        // sidecar の親 = この Tauri アプリ本体の PID。sidecar 側の watchdog が
        // この PID を監視し、本体が消えたら（Cmd+Q / 強制終了 / クラッシュ /
        // 自動更新のどの経路でも）自決する。port 3001 を握ったまま孤児化すると、
        // 次回起動で新バージョンのアプリが古い sidecar を再利用してしまい、後から
        // 追加した API ルートが 404 になる（v0.15.0 で /api/translate が踏んだ
        // 事故）。その根本対策。
        .env("GRAPHIUM_PARENT_PID", std::process::id().to_string())
        // アプリのバージョン。sidecar は /api/health でこれを返す（設定の表示・診断用）。
        // 「自動更新前の古い自分」かどうかは、フロントが起動ごとの合言葉を知っているかで
        // 見分ける（合言葉は起動ごとに変わるので、別の起動の sidecar は必ず入れ替える）。
        .env("GRAPHIUM_APP_VERSION", app.package_info().version.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // Windows 子プロセスにコンソールウィンドウを出さない。
        // CREATE_NO_WINDOW = 0x08000000
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();

    emit_log(&app, format!("[native] spawned pid={pid}"));

    // Windows: 本体終了時に sidecar が確実に道連れになるよう Job Object へ入れる
    // （詳細は sidecar_job モジュールのコメント参照）
    #[cfg(windows)]
    {
        let assigned = sidecar_job::assign(&child);
        emit_log(&app, format!("[native] job object assigned={assigned}"));
    }

    // ファイルへの永続ログを開く。失敗しても sidecar 自体は起動させる。
    let log_file: std::sync::Arc<Mutex<Option<std::fs::File>>> =
        std::sync::Arc::new(Mutex::new(open_sidecar_log_file()));
    if let Some(path) = sidecar_log_path() {
        emit_log(&app, format!("[native] sidecar log file: {}", path.display()));
    }
    append_sidecar_log(
        &log_file,
        "[meta] ",
        &format!(
            "spawned pid={pid} node={} server={} dataDir={} port={}",
            node_path.display(),
            server_script.display(),
            data_dir,
            port
        ),
    );

    // stdout を行単位で emit + ファイルへ append
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let log_clone = log_file.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_clone.emit("sidecar-log", format!("[stdout] {line}"));
                append_sidecar_log(&log_clone, "[stdout] ", &line);
            }
        });
    }
    // stderr も同様
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let log_clone = log_file.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_clone.emit("sidecar-log", format!("[stderr] {line}"));
                append_sidecar_log(&log_clone, "[stderr] ", &line);
            }
        });
    }

    // wait を別スレッドで監視。終了したら sidecar-closed を emit。
    {
        let app_clone = app.clone();
        let log_clone = log_file.clone();
        thread::spawn(move || match child.wait() {
            Ok(status) => {
                let code = status.code();
                let msg = format!("exit code={code:?} success={}", status.success());
                let _ = app_clone.emit("sidecar-closed", msg.clone());
                append_sidecar_log(&log_clone, "[meta] ", &msg);
            }
            Err(e) => {
                let msg = format!("wait failed: {e}");
                let _ = app_clone.emit("sidecar-closed", msg.clone());
                append_sidecar_log(&log_clone, "[meta] ", &msg);
            }
        });
    }

    // PID だけ保持する（kill 用）
    {
        let mut guard = state.0.lock().unwrap();
        *guard = Some(pid);
    }

    Ok(pid)
}

/// ネイティブ sidecar を停止する。PID を控えていれば taskkill / kill する。
#[tauri::command]
fn stop_native_sidecar(state: tauri::State<'_, NativeSidecarState>) -> Result<(), String> {
    let pid = {
        let mut guard = state.0.lock().unwrap();
        guard.take()
    };
    if let Some(pid) = pid {
        let _ = kill_pid_sync(pid);
    }
    Ok(())
}

// --- 起動スプラッシュ ---
//
// アプリのバンドルは 6 MB を超え、WebView がそれをパースし終えるまで #root は
// 空のままになる。main ウィンドウをそのまま出すと、その 1〜3 秒がただの白い
// 画面として見える。main は tauri.conf で visible=false にしておき、代わりに
// 軽い静的ページ（public/splash.html）を先に見せて、フロントの初回描画が
// 済んだ時点で入れ替える。sidecar の起動（実測 約 1 秒）は待たない。待っても
// AI を使わない利用者の起動が遅くなるだけで、起動待ちはサイドバー側で示す。

const SPLASH_LABEL: &str = "splash";
const MAIN_LABEL: &str = "main";

/// main を見せたか。3 つの経路すべてがここを見る。フォールバックのスレッドは
/// 正常起動でも必ず起きるので、これで弾かないと "timeout" のログが毎回出て、
/// 本当にフロントが合図を送れなかったケースと見分けが付かなくなる。
static MAIN_REVEALED: AtomicBool = AtomicBool::new(false);

/// setup に入った時刻。スプラッシュが何 ms 出ていたかを残すためだけに使う。
/// v0.45.1 の 20 秒はこれが無かったせいで実機の目視でしか気づけなかった。
static BOOT_AT: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// スプラッシュを閉じてメインウィンドウを見せる。
///
/// 何度呼ばれても害はない（show / close は冪等）。フロントの `app_ready`、
/// 起動タイムアウト、スプラッシュを手で閉じられた場合の 3 経路から呼ばれる。
///
/// `via` はどの経路で呼ばれたかを stderr に残すためだけのもの。正常時は必ず
/// `app_ready` で、`timeout` が出ていたらフロントが合図を送れていない
/// （v0.45.1 の rAF 凍結がまさにこれで、切り分けに実機の目視が要った）。
fn reveal_main(app: &tauri::AppHandle, via: &str) {
    if MAIN_REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }
    let ms = BOOT_AT.get().map_or(0, |t| t.elapsed().as_millis());
    eprintln!("[splash] revealing main window via {via} ({ms}ms after boot)");
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        let _ = splash.close();
    }
}

/// フロントエンドの初回描画が終わった合図（src/main.tsx から呼ぶ）。
#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    // ページの読み直しで倍率が戻る WebView があっても、見せる前にもう一度揃える
    ui_zoom::reapply(&app);
    reveal_main(&app, "app_ready");
}

/// 別ウィンドウ（ノートを 1 つ出すウィンドウ）のラベル。1 枚だけ持つ
const VIEWER_LABEL: &str = "viewer";

/// 別ウィンドウに出す行き先 ID の長さの上限（src/lib/viewer-window.ts の MAX_ID_LENGTH と同じ）
const VIEWER_ID_MAX_LEN: usize = 512;

/// 行き先 ID として受け取ってよいか。空・長すぎ・制御文字に加えて、パスの区切りと `..` を弾く
/// （ID は別ウィンドウでノートのファイル名になる。ノートのフォルダの外を指させない）
fn is_valid_viewer_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= VIEWER_ID_MAX_LEN
        && !id.chars().any(|c| c.is_control() || c == '/' || c == '\\')
        && !id.contains("..")
}

/// 別ウィンドウのページが読み込み前に受け取る行き先（`window.__GRAPHIUM_VIEWER__`）の代入文。
/// ID は JSON の文字列として埋めるので、引用符や改行が入っていても式を壊さない
fn viewer_init_script(id: &str) -> String {
    let target = serde_json::json!({ "kind": "note", "id": id });
    format!("window.__GRAPHIUM_VIEWER__ = {target};")
}

/// ノートを別ウィンドウで開く。すでに開いていれば中身を差し替えて
/// 手前に出す。ページ側は src/features/viewer-window/ViewerWindow.tsx。
///
/// async にしているのは、同期コマンドの中でウィンドウを作ると Windows で固まるため。
/// 位置と大きさは window-state プラグインがラベルごとに覚える（2 枚目の画面に置いたら次もそこ）。
#[tauri::command]
async fn open_viewer_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !is_valid_viewer_id(&id) {
        return Err("invalid viewer id".into());
    }
    if let Some(viewer) = app.get_webview_window(VIEWER_LABEL) {
        // 閉じる待ちの最中に開き直された。閉じるのをやめる（遅れて届く返事では閉じない）
        VIEWER_CLOSE_PENDING.store(0, Ordering::SeqCst);
        app.emit_to(
            VIEWER_LABEL,
            "viewer-set-target",
            serde_json::json!({ "kind": "note", "id": id }),
        )
        .map_err(|e| e.to_string())?;
        let _ = viewer.unminimize();
        let _ = viewer.show();
        let _ = viewer.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        VIEWER_LABEL,
        tauri::WebviewUrl::App("app/index.html".into()),
    )
    .title("Graphium")
    .inner_size(760.0, 900.0)
    .min_inner_size(360.0, 400.0)
    .initialization_script(viewer_init_script(&id))
    .build()
    .map(|viewer| {
        // 新しいウィンドウ。前のウィンドウの閉じる待ちは引き継がない
        VIEWER_CLOSE_PENDING.store(0, Ordering::SeqCst);
        // 閉じる前に、未保存の編集を書き出させる（メインの終了と同じ流儀）。一旦止めてページへ
        // 知らせ、viewer_close_ack を受けて閉じる。返事が無くても VIEWER_CLOSE_FAILSAFE_SECS で閉じる
        let handle = viewer.clone();
        viewer.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let seq = VIEWER_CLOSE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
                VIEWER_CLOSE_PENDING.store(seq, Ordering::SeqCst);
                let _ = handle
                    .app_handle()
                    .emit_to(VIEWER_LABEL, "viewer-close-requested", ());
                let failsafe = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(
                        VIEWER_CLOSE_FAILSAFE_SECS,
                    ));
                    // この閉じる要求がまだ待ちのままなら閉じる（返事が来た・開き直したなら何もしない）
                    if VIEWER_CLOSE_PENDING
                        .compare_exchange(seq, 0, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                    {
                        let _ = failsafe.destroy();
                    }
                });
            }
        });
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 別ウィンドウの閉じる待ちの番号（0 = 待っていない）。フェイルセーフが、後から開き直した
/// ウィンドウを閉じないようにする
static VIEWER_CLOSE_PENDING: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static VIEWER_CLOSE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// 別ウィンドウの書き出しを待つ上限（src/lib/flush-on-exit.ts の EXIT_FLUSH_TIMEOUT_MS より長く）
const VIEWER_CLOSE_FAILSAFE_SECS: u64 = 7;

/// 別ウィンドウが未保存の編集を書き出し終えた。閉じる
#[tauri::command]
fn viewer_close_ack(app: tauri::AppHandle) {
    // 閉じる待ちでなければ何もしない（待ちの最中に開き直された）
    if VIEWER_CLOSE_PENDING.swap(0, Ordering::SeqCst) == 0 {
        return;
    }
    if let Some(viewer) = app.get_webview_window(VIEWER_LABEL) {
        let _ = viewer.destroy();
    }
}

/// 別ウィンドウの「メインのウィンドウで開く」。メインへ行き先を送り、手前に出す
#[tauri::command]
fn viewer_open_in_main(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !is_valid_viewer_id(&id) {
        return Err("invalid viewer id".into());
    }
    app.emit_to(MAIN_LABEL, "viewer-open-in-main", id)
        .map_err(|e| e.to_string())?;
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    Ok(())
}

/// 閉じる要求からフロントの shutdown_ack を待つ上限（秒）。
/// フロントは ACK の前に録音中の会議録音の保存（最大 5 秒）、未保存の編集の書き出し（最大 5 秒）、
/// sidecar の停止（最大 2 秒）を順に待つので、その合計（12 秒）より長くする
/// （src/lib/flush-on-exit.ts）。短いと書き出しの途中で落ちる
const CLOSE_FAILSAFE_SECS: u64 = 15;

/// MCP 向けのハートビートを開始する（root が変わったら呼び直す）。
/// `<root>/appdata/app-heartbeat.json` を 30 秒ごとに原子的に書く（heartbeat.rs）
#[tauri::command]
fn start_app_heartbeat(app: tauri::AppHandle, root: String) -> Result<(), String> {
    if root.trim().is_empty() {
        return Err("root が空です".into());
    }
    heartbeat::start(PathBuf::from(root), app.package_info().version.to_string())
}

/// フロントエンドから呼ぶ「未保存の書き出しと sidecar の後始末が終わったので終了してよい」通知
#[tauri::command]
fn shutdown_ack(app: tauri::AppHandle) {
    SHUTDOWN_ACK.store(true, Ordering::SeqCst);
    // MCP が「起動中」と誤判定しないよう、終了前にハートビートを消す
    heartbeat::stop_and_remove();
    app.exit(0);
}

/// 指定 PID のコマンドラインを取得する。取得できなければ None。
/// macOS/Linux: `ps -p <pid> -o command=` の 1 行。
/// Windows: PowerShell の CIM 経由で CommandLine を引く。
fn process_command_line(pid: u32) -> Option<String> {
    #[cfg(unix)]
    let output = std::process::Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    #[cfg(windows)]
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\").CommandLine"
            ),
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

/// 対象 PID が Graphium sidecar プロセスか判定する。
///
/// sidecar は必ず `node <...>/sidecar/server.mjs` として起動される
/// (start_native_sidecar / fetch-node.mjs 参照)。消えた worktree の
/// 幽霊 sidecar も同じ形で起動しているため、この判定で回収できる。
/// kill 対象をこの形のプロセスに限定し、webview から任意 PID を落とせる
/// 状態を塞ぐ。
fn is_graphium_sidecar_process(pid: u32) -> bool {
    match process_command_line(pid) {
        Some(cmd) => {
            let lower = cmd.to_lowercase();
            // node ランタイム上で server.mjs（sidecar のエントリ）を動かしている
            // プロセスに限定する。パス区切りは OS 差を吸収するため両方を許容。
            let is_node = lower.contains("node");
            let is_sidecar_entry =
                lower.contains("sidecar/server.mjs") || lower.contains("sidecar\\server.mjs");
            is_node && is_sidecar_entry
        }
        None => false,
    }
}

/// Graphium sidecar プロセスにシグナルを送って終了させる（同期の実処理）。
/// port 3001 に居座る "他人 sidecar"（消えた worktree の幽霊など）を回収するために使う。
/// Unix: SIGTERM、Windows: taskkill /F /PID
///
/// **セキュリティ**: 任意 PID を落とせないよう、対象が Graphium sidecar
/// (`node .../sidecar/server.mjs`) である場合のみ実行する。それ以外は Err を返す。
///
/// `is_graphium_sidecar_process`（`ps` を起動）と `kill` の外部プロセス実行を含むため、
/// Tauri command から直接呼ぶとメインスレッドを塞ぐ。command 経由は下の async
/// `kill_pid` が `spawn_blocking` で逃がす。Rust 内部（start/stop_native_sidecar）
/// からは同期のままこの関数を直接呼ぶ。
fn kill_pid_sync(pid: u32) -> Result<(), String> {
    if !is_graphium_sidecar_process(pid) {
        return Err(format!(
            "refusing to kill pid={pid}: not a Graphium sidecar process"
        ));
    }

    #[cfg(unix)]
    let mut command = {
        let mut c = std::process::Command::new("/bin/kill");
        c.args(["-TERM", &pid.to_string()]);
        c
    };
    #[cfg(windows)]
    let mut command = {
        let mut c = std::process::Command::new("taskkill");
        c.args(["/F", "/PID", &pid.to_string()]);
        c
    };

    let output = command
        .output()
        .map_err(|e| format!("kill spawn failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "kill exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

/// Graphium sidecar プロセスを kill する Tauri command。
/// 内部で `ps`（コマンドライン確認）と `kill` を外部プロセスとして実行するため、
/// 同期 command のままだと Tauri のメインスレッドを塞ぎ、起動直後に並行する他の
/// invoke（例: list_note_files）を待たせて「読み込み中」ハングの一因になりうる。
/// `spawn_blocking` で専用スレッドへ逃がし、メインスレッドを空けておく。
#[tauri::command]
async fn kill_pid(pid: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || kill_pid_sync(pid))
        .await
        .map_err(|e| format!("kill task join failed: {e}"))?
}

// --- アプリ設定（Graphium ルート配下のパス解決用） ---

/// アプリ識別子（Tauri の bundle identifier と一致させる）
const APP_IDENTIFIER: &str = "com.graphium.app";
/// アプリ設定ファイル名
const CONFIG_FILE_NAME: &str = "config.json";

/// アプリ設定。Obsidian 式に、Graphium ルート配下の場所だけをここに持つ。
/// ルート以外の設定（AI モデル等）は従来どおり localStorage 側で管理する。
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    /// ユーザーが明示的に指定した Graphium ルート。未指定なら既定値を使う。
    #[serde(skip_serializing_if = "Option::is_none")]
    graphium_root: Option<String>,
}

/// Graphium ルートの現在値と既定値をまとめて返すための構造体
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphiumRootInfo {
    /// いま実際に使われているルートの絶対パス
    pub current: String,
    /// 設定未指定時の既定パス（~/Documents/Graphium/）
    pub default_root: String,
    /// ユーザーがカスタムルートを設定しているか
    pub is_custom: bool,
}

/// アプリ設定ディレクトリ（`~/Library/Application Support/com.graphium.app/` 等）
fn app_config_dir() -> Result<PathBuf, String> {
    let dir = dirs::config_dir()
        .ok_or("設定ディレクトリが見つかりません")?
        .join(APP_IDENTIFIER);
    fs::create_dir_all(&dir).map_err(|e| format!("設定ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// 設定ファイルのパス
fn config_file_path() -> Result<PathBuf, String> {
    Ok(app_config_dir()?.join(CONFIG_FILE_NAME))
}

/// 設定ファイルを読み込む（存在しなければデフォルト）
fn read_app_config() -> Result<AppConfig, String> {
    let path = config_file_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("設定読み取り失敗: {e}"))?;
    if content.trim().is_empty() {
        return Ok(AppConfig::default());
    }
    serde_json::from_str(&content).map_err(|e| format!("設定パース失敗: {e}"))
}

/// 設定ファイルを書き込む
fn write_app_config(config: &AppConfig) -> Result<(), String> {
    let path = config_file_path()?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("設定シリアライズ失敗: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("設定書き込み失敗: {e}"))
}

/// 既定の Graphium ルート（`~/Documents/Graphium/`）
fn default_graphium_root() -> Result<PathBuf, String> {
    Ok(dirs::document_dir()
        .ok_or("ドキュメントフォルダが見つかりません")?
        .join("Graphium"))
}

/// 現在の Graphium ルート（設定 > 既定）
fn graphium_root() -> Result<PathBuf, String> {
    let config = read_app_config()?;
    match config.graphium_root {
        Some(p) if !p.trim().is_empty() => Ok(PathBuf::from(p)),
        _ => default_graphium_root(),
    }
}

/// 削除・外部で開く・保存先の変更のような影響の大きいコマンドは、メインウィンドウからだけ受ける。
/// 別ウィンドウ（viewer）が読むのは共有ノートなど外から来た内容を含み、capabilities の ACL は
/// アプリ自前のコマンドには効かないため、ここで呼び出し元のラベルを見る。
fn require_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    check_main_label(window.label())
}

/// ラベルが main のときだけ通す（require_main_window の判定本体。単体テスト用に分けている）。
fn check_main_label(label: &str) -> Result<(), String> {
    if label == MAIN_LABEL {
        Ok(())
    } else {
        Err("このウィンドウからは実行できません".to_string())
    }
}

// --- パスの 1 要素に使う id・名前の検査 ---
//
// 素材 id・ノート id などは `dir.join(format!("{id}.json"))` のようにパスへ組み込まれる。
// `Path::join` は絶対パス（Windows では UNC `\\host\share` も）を渡すと基準を置き換え、
// `..` は基準の外へ出るので、ノートの本文に紛れた `file-media://../../x` や細工した
// @メンションのリンク先がそのまま任意のパスを指せてしまう。パスを組み立てる前に必ず通す。
// 実際に生成される id（UUID・ハイフン・下線・`<id>.<拡張子>`）はすべて通る。

/// id・ファイル名として使えるか。空・区切り文字（`/` `\`）・`..`・先頭の `.`・NUL と
/// 制御文字を断る。`:` は Windows でだけ断る（ドライブ指定・代替データストリーム）。
/// macOS / Linux では `:` 入りの名前は 1 要素のままで外へ出ないうえ、既存のデータに
/// `wiki:<uuid>.json` のような名前が残っていることがあり、断ると開くことも消すこともできなくなる。
/// Windows では `:` は代替データストリームの指定になり、"wiki:<id>.json" という名前のファイルにはならない
/// ので、断っても既存のデータは壊れない。
pub(crate) fn validate_id_component(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.contains(['/', '\\'])
        || (cfg!(windows) && id.contains(':'))
        || id.contains("..")
        || id.starts_with('.')
        || id.chars().any(|c| c.is_control())
    {
        return Err(format!("不正な id: {}", id.escape_debug()));
    }
    Ok(())
}

/// `base/<id><suffix>` を組み立てる。id を検査したうえで、できたパスが base 直下の
/// 1 要素であること（base の外へ出ない・絶対パスで置き換わらない）も確かめる。
fn join_id_component(base: &Path, id: &str, suffix: &str) -> Result<PathBuf, String> {
    validate_id_component(id)?;
    join_single_component(base, &format!("{id}{suffix}"))
}

/// `base/<name>` を組み立てる。name は base 直下の通常の 1 要素でなければならない
/// （絶対パス・ドライブ指定・UNC・`..`・区切り文字入りは断る）。
fn join_single_component(base: &Path, name: &str) -> Result<PathBuf, String> {
    let mut comps = Path::new(name).components();
    let single_normal =
        matches!(comps.next(), Some(std::path::Component::Normal(_))) && comps.next().is_none();
    let path = base.join(name);
    if !single_normal || path.parent() != Some(base) {
        return Err(format!("不正なパス要素: {}", name.escape_debug()));
    }
    Ok(path)
}

// --- ファイルシステムコマンド ---

fn ensure_subdir(name: &str) -> Result<PathBuf, String> {
    let dir = graphium_root()?.join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// ノートの保存先ディレクトリ（`<root>/notes/`）
fn notes_dir() -> Result<PathBuf, String> {
    ensure_subdir("notes")
}

/// メディアの保存先ディレクトリ（`<root>/media/`）
fn media_dir() -> Result<PathBuf, String> {
    ensure_subdir("media")
}

/// Wiki ドキュメントの保存先ディレクトリ（`<root>/wiki/`）
fn wiki_dir() -> Result<PathBuf, String> {
    ensure_subdir("wiki")
}

/// Skill ドキュメントの保存先ディレクトリ（`<root>/skills/`）
fn skill_dir() -> Result<PathBuf, String> {
    ensure_subdir("skills")
}

/// アプリデータの保存先ディレクトリ（`<root>/appdata/`）
fn appdata_dir() -> Result<PathBuf, String> {
    ensure_subdir("appdata")
}

/// 現在の Graphium ルートと既定値を返す（UI の表示用）
#[tauri::command]
fn get_graphium_root() -> Result<GraphiumRootInfo, String> {
    let config = read_app_config()?;
    let default = default_graphium_root()?;
    let (current, is_custom) = match &config.graphium_root {
        Some(p) if !p.trim().is_empty() => (PathBuf::from(p), true),
        _ => (default.clone(), false),
    };
    Ok(GraphiumRootInfo {
        current: current.to_string_lossy().to_string(),
        default_root: default.to_string_lossy().to_string(),
        is_custom,
    })
}

/// Graphium ルートを設定する。
/// `path` が `None` または空文字列ならカスタム設定をクリア（既定に戻る）。
/// 実在しないディレクトリが指定された場合は作成を試みる。
#[tauri::command]
fn set_graphium_root(window: tauri::WebviewWindow, path: Option<String>) -> Result<GraphiumRootInfo, String> {
    require_main_window(&window)?;
    let mut config = read_app_config()?;
    match path {
        Some(p) if !p.trim().is_empty() => {
            let trimmed = p.trim().to_string();
            fs::create_dir_all(&trimmed)
                .map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
            config.graphium_root = Some(trimmed);
        }
        _ => {
            config.graphium_root = None;
        }
    }
    write_app_config(&config)?;
    // 新しい保存先に旧形式（拡張子なし）メディアがあれば拡張子を付与する
    migrate_media_extensions();
    get_graphium_root()
}

// --- 旧 Drive レイアウトの検知・移行（v0.4 で OAuth 撤去） ---
//
// 旧レイアウト: ルート / wiki/ / skills/ 直下に `*.graphium.json`
// 新レイアウト: notes/ / wiki/ / skills/ 直下に `*.json`
//
// ユーザーが Drive Desktop で同期していた `Graphium/` フォルダを保存先に指定した場合、
// 既存ノートを取りこぼさないため一回限りの移行を提供する。

/// 旧 Drive レイアウトの検知結果
#[derive(Serialize, Deserialize, Default)]
pub struct LegacyDriveScan {
    pub note_count: usize,
    pub wiki_count: usize,
    pub skill_count: usize,
}

impl LegacyDriveScan {
    fn total(&self) -> usize {
        self.note_count + self.wiki_count + self.skill_count
    }
}

fn count_legacy_files(dir: &PathBuf) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.ends_with(".graphium.json") || name.ends_with(".provnote.json") {
                count += 1;
            }
        }
    }
    count
}

/// 旧 Drive レイアウトのノートが Graphium ルート直下にあるか調べる
#[tauri::command]
fn detect_legacy_drive_layout() -> Result<LegacyDriveScan, String> {
    let root = graphium_root()?;
    let mut scan = LegacyDriveScan::default();
    if root.exists() {
        scan.note_count = count_legacy_files(&root);
    }
    let wiki = root.join("wiki");
    if wiki.exists() {
        scan.wiki_count = count_legacy_files(&wiki);
    }
    let skills = root.join("skills");
    if skills.exists() {
        scan.skill_count = count_legacy_files(&skills);
    }
    Ok(scan)
}

fn migrate_legacy_dir(src: &PathBuf, dst: &PathBuf) -> Result<usize, String> {
    if !src.exists() {
        return Ok(0);
    }
    fs::create_dir_all(dst).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    let entries = fs::read_dir(src).map_err(|e| format!("ディレクトリ読み取り失敗: {e}"))?;
    let mut moved = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // `xxx.graphium.json` / `xxx.provnote.json` → `xxx.json`
        let new_name = if let Some(stem) = name.strip_suffix(".graphium.json") {
            format!("{stem}.json")
        } else if let Some(stem) = name.strip_suffix(".provnote.json") {
            format!("{stem}.json")
        } else {
            continue;
        };
        let target = dst.join(&new_name);
        if target.exists() {
            // 衝突回避: 既存ファイルがある場合はスキップ（手動解決を促す）
            continue;
        }
        fs::rename(&path, &target).map_err(|e| format!("ファイル移動失敗 ({name}): {e}"))?;
        moved += 1;
    }
    Ok(moved)
}

/// 旧 Drive レイアウトを新レイアウトへ移行する
/// - ルート直下の `*.graphium.json` → `notes/*.json`
/// - `wiki/*.graphium.json` → `wiki/*.json`（同じディレクトリ内、拡張子のみ変更）
/// - `skills/*.graphium.json` → `skills/*.json`
#[tauri::command]
fn migrate_legacy_drive_layout() -> Result<LegacyDriveScan, String> {
    let root = graphium_root()?;
    let wiki = root.join("wiki");
    let skills = root.join("skills");
    // 移す順は notes → wiki → skills のまま（途中で失敗したらそこで止まる）
    let note_count = migrate_legacy_dir(&root, &root.join("notes"))?;
    let wiki_count = migrate_legacy_dir(&wiki, &wiki)?;
    let skill_count = migrate_legacy_dir(&skills, &skills)?;
    let moved = LegacyDriveScan { note_count, wiki_count, skill_count };
    if moved.total() > 0 {
        // インデックスを再構築させる
        let _ = fs::remove_file(appdata_dir()?.join("note-index.json"));
    }
    Ok(moved)
}

/// ファイル情報
#[derive(Serialize, Deserialize)]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub modified_time: String,
    pub created_time: String,
}

/// メディアファイル情報
#[derive(Serialize, Deserialize)]
pub struct MediaFileInfo {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub created_time: String,
}

/// ノートファイル一覧を取得
#[tauri::command]
fn list_note_files() -> Result<Vec<FileInfo>, String> {
    let dir = notes_dir()?;
    let mut files = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("ディレクトリ読み取り失敗: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("エントリ読み取り失敗: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let id = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let metadata =
                fs::metadata(&path).map_err(|e| format!("メタデータ取得失敗: {e}"))?;
            let modified = metadata
                .modified()
                .map_err(|e| format!("更新日時取得失敗: {e}"))?;
            let created = metadata.created().unwrap_or(modified);

            files.push(FileInfo {
                id,
                name,
                modified_time: humantime::format_rfc3339(modified).to_string(),
                created_time: humantime::format_rfc3339(created).to_string(),
            });
        }
    }

    // 更新日時の降順でソート
    files.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(files)
}

/// ノートファイルを読み込み（JSON 文字列を返す）
#[tauri::command]
fn read_note_file(file_id: String) -> Result<String, String> {
    let path = join_id_component(&notes_dir()?, &file_id, ".json")?;
    fs::read_to_string(&path).map_err(|e| format!("ファイル読み取り失敗: {e}"))
}

/// ノートファイルを書き込み
#[tauri::command]
fn write_note_file(file_id: String, content: String) -> Result<(), String> {
    let path = join_id_component(&notes_dir()?, &file_id, ".json")?;
    fs::write(&path, content).map_err(|e| format!("ファイル書き込み失敗: {e}"))
}

/// ノートファイルを完全削除（OS のゴミ箱へ送る）
///
/// アプリ内ゴミ箱から「完全削除」が押されたときに呼ばれる。
/// `trash` クレートで OS のゴミ箱に送るので、ユーザーは Finder から復元できる。
/// trash クレートが失敗した場合はフォールバックで通常削除する。
#[tauri::command]
fn delete_note_file(window: tauri::WebviewWindow, file_id: String) -> Result<(), String> {
    require_main_window(&window)?;
    let path = join_id_component(&notes_dir()?, &file_id, ".json")?;
    if path.exists() {
        if let Err(e) = trash::delete(&path) {
            // OS のゴミ箱送りに失敗しても、最後の手段として削除する
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&path).map_err(|e| format!("ファイル削除失敗: {e}"))?;
        }
    }
    Ok(())
}

// --- Wiki ファイル操作（notes と同じロジック、ディレクトリだけ wiki_dir() を使う） ---

/// Wiki ファイル一覧を取得
#[tauri::command]
fn list_wiki_files() -> Result<Vec<FileInfo>, String> {
    let dir = wiki_dir()?;
    let mut files = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("ディレクトリ読み取り失敗: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("エントリ読み取り失敗: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let id = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let metadata =
                fs::metadata(&path).map_err(|e| format!("メタデータ取得失敗: {e}"))?;
            let modified = metadata
                .modified()
                .map_err(|e| format!("更新日時取得失敗: {e}"))?;
            let created = metadata.created().unwrap_or(modified);

            files.push(FileInfo {
                id,
                name,
                modified_time: humantime::format_rfc3339(modified).to_string(),
                created_time: humantime::format_rfc3339(created).to_string(),
            });
        }
    }

    files.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(files)
}

/// Wiki ファイルを読み込み
#[tauri::command]
fn read_wiki_file(file_id: String) -> Result<String, String> {
    let path = join_id_component(&wiki_dir()?, &file_id, ".json")?;
    fs::read_to_string(&path).map_err(|e| format!("Wiki 読み取り失敗: {e}"))
}

/// Wiki ファイルを書き込み
#[tauri::command]
fn write_wiki_file(file_id: String, content: String) -> Result<(), String> {
    let path = join_id_component(&wiki_dir()?, &file_id, ".json")?;
    fs::write(&path, content).map_err(|e| format!("Wiki 書き込み失敗: {e}"))
}

/// Wiki ファイルを完全削除（OS のゴミ箱へ送る）
#[tauri::command]
fn delete_wiki_file(window: tauri::WebviewWindow, file_id: String) -> Result<(), String> {
    require_main_window(&window)?;
    let path = join_id_component(&wiki_dir()?, &file_id, ".json")?;
    if path.exists() {
        if let Err(e) = trash::delete(&path) {
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&path).map_err(|e| format!("Wiki 削除失敗: {e}"))?;
        }
    }
    Ok(())
}

// --- Skill ファイル操作（notes と同じロジック、ディレクトリだけ skill_dir() を使う） ---

/// Skill ファイル一覧を取得
#[tauri::command]
fn list_skill_files() -> Result<Vec<FileInfo>, String> {
    let dir = skill_dir()?;
    let mut files = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("ディレクトリ読み取り失敗: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("エントリ読み取り失敗: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let id = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let metadata =
                fs::metadata(&path).map_err(|e| format!("メタデータ取得失敗: {e}"))?;
            let modified = metadata
                .modified()
                .map_err(|e| format!("更新日時取得失敗: {e}"))?;
            let created = metadata.created().unwrap_or(modified);

            files.push(FileInfo {
                id,
                name,
                modified_time: humantime::format_rfc3339(modified).to_string(),
                created_time: humantime::format_rfc3339(created).to_string(),
            });
        }
    }

    files.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(files)
}

/// Skill ファイルを読み込み
#[tauri::command]
fn read_skill_file(file_id: String) -> Result<String, String> {
    let path = join_id_component(&skill_dir()?, &file_id, ".json")?;
    fs::read_to_string(&path).map_err(|e| format!("Skill 読み取り失敗: {e}"))
}

/// Skill ファイルを書き込み
#[tauri::command]
fn write_skill_file(file_id: String, content: String) -> Result<(), String> {
    let path = join_id_component(&skill_dir()?, &file_id, ".json")?;
    fs::write(&path, content).map_err(|e| format!("Skill 書き込み失敗: {e}"))
}

/// Skill ファイルを完全削除（OS のゴミ箱へ送る）
#[tauri::command]
fn delete_skill_file(window: tauri::WebviewWindow, file_id: String) -> Result<(), String> {
    require_main_window(&window)?;
    let path = join_id_component(&skill_dir()?, &file_id, ".json")?;
    if path.exists() {
        if let Err(e) = trash::delete(&path) {
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&path).map_err(|e| format!("Skill 削除失敗: {e}"))?;
        }
    }
    Ok(())
}

// --- メディア本体の拡張子付き保存（脱ロックイン） ---
//
// v0.19 以降、メディア本体は `{id}.{ext}` 形式（拡張子付き）で保存する。
// Graphium をやめても media/ フォルダの画像や PDF がそのまま開けるようにするため。
// 旧形式 `{id}`（拡張子なし）は find_media_data_file が引き続き解決し、
// 起動時の migrate_media_extensions が meta.json の情報から一括リネームする。

/// 本体ファイルに使えない拡張子。
/// "txt" は Reader 原文（save_media_text の `{id}.txt`）専用のため、
/// 本体に使うと find_media_data_file の除外規則と衝突して読めなくなる。
const RESERVED_MEDIA_EXTS: &[&str] = &["txt"];

/// MIME タイプから代表的な拡張子を引く（ファイル名に拡張子がないときの補完）
fn ext_from_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/heic" => Some("heic"),
        "image/bmp" => Some("bmp"),
        "image/tiff" => Some("tiff"),
        "application/pdf" => Some("pdf"),
        "video/mp4" => Some("mp4"),
        "video/quicktime" => Some("mov"),
        "video/webm" => Some("webm"),
        "audio/mpeg" => Some("mp3"),
        "audio/wav" | "audio/x-wav" => Some("wav"),
        "audio/mp4" => Some("m4a"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some("pptx")
        }
        "application/msword" => Some("doc"),
        "application/vnd.ms-excel" => Some("xls"),
        _ => None,
    }
}

/// ファイル名と MIME タイプから保存に使う拡張子を決める。
/// ファイル名の拡張子を優先し、なければ MIME から補完する。
/// 英数字 1〜8 文字のみ許可（パス・予約名の混入防止）。決められなければ None（拡張子なし保存）。
fn media_ext(name: &str, mime: &str) -> Option<String> {
    let sanitize = |e: &str| -> Option<String> {
        let e = e.to_ascii_lowercase();
        if e.is_empty() || e.len() > 8 || !e.chars().all(|c| c.is_ascii_alphanumeric()) {
            return None;
        }
        if RESERVED_MEDIA_EXTS.contains(&e.as_str()) {
            return None;
        }
        Some(e)
    };
    std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .and_then(sanitize)
        .or_else(|| ext_from_mime(mime).and_then(sanitize))
}

/// メディア本体のパスを解決する。新形式 `{id}.{ext}` を優先し、旧形式 `{id}` にフォールバック。
/// `.meta.json`（メタデータ）・`.txt`（Reader 原文）・`.transcript.json`（文字起こし）・`.cleanup.json`（清書）・`.summary.json`（要約）は本体ではないので除外する。
fn find_media_data_file(dir: &std::path::Path, file_id: &str) -> Option<PathBuf> {
    // 区切り文字・`..`・絶対パス・UNC を含む id は探しに行かない（旧形式の `dir.join(file_id)` が
    // 絶対パスで基準を置き換え、media の外のファイルや UNC パスを開いてしまうため）
    if validate_id_component(file_id).is_err() {
        return None;
    }
    let prefix = format!("{file_id}.");
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.ends_with(".meta.json")
                || name.ends_with(".txt")
                || name.ends_with(".transcript.json")
                || name.ends_with(".cleanup.json")
                || name.ends_with(".summary.json")
                || name.ends_with(".tmp")
            {
                continue;
            }
            if name.starts_with(&prefix) {
                return Some(entry.path());
            }
        }
    }
    // 旧形式（拡張子なし）
    let legacy = dir.join(file_id);
    if legacy.is_file() {
        return Some(legacy);
    }
    None
}

/// 旧形式（拡張子なし）のメディア本体に拡張子を付与する一括マイグレーション。
/// meta.json の name / mimeType から拡張子を決め、決められないものはそのまま残す
/// （find_media_data_file の旧形式フォールバックで読み続けられる）。
/// rename は同一ディレクトリ内なので原子的。個別の失敗はログだけ出して続行する。
fn migrate_media_extensions_in(dir: &std::path::Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(id) = name.strip_suffix(".meta.json") else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        let legacy = dir.join(id);
        if !legacy.is_file() {
            continue; // 本体なし、または既にリネーム済み
        }
        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let file_name = meta["name"].as_str().unwrap_or_default();
        let mime = meta["mimeType"].as_str().unwrap_or_default();
        let Some(ext) = media_ext(file_name, mime) else {
            continue;
        };
        let target = dir.join(format!("{id}.{ext}"));
        if target.exists() {
            continue; // 衝突ガード（中断からの再実行など）
        }
        if let Err(e) = fs::rename(&legacy, &target) {
            eprintln!("メディア拡張子マイグレーション失敗 {id}: {e}");
        }
    }
}

/// 現在の Graphium ルートに対してメディア拡張子マイグレーションを実行する。
/// 起動時と保存先変更時に呼ぶ。失敗しても致命的ではない（次回起動で再試行される）。
fn migrate_media_extensions() {
    let Ok(dir) = media_dir() else {
        return;
    };
    migrate_media_extensions_in(&dir);
}

/// メディアファイルを保存（Base64 エンコードされたデータを受け取る）。
/// 数 MB になりうるデコード・書き込みを同期 command でメインスレッドに載せると、
/// 並行する他の invoke やイベント配送を待たせる（kill_pid と同じ理由）。
/// `spawn_blocking` で専用スレッドへ逃がす。
#[tauri::command]
async fn save_media_file(
    file_id: String,
    name: String,
    mime_type: String,
    data: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_media_file_sync(file_id, name, mime_type, data)
    })
    .await
    .map_err(|e| format!("メディア保存タスク失敗: {e}"))?
}

fn save_media_file_sync(
    file_id: String,
    name: String,
    mime_type: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine;
    // パスに組み込む前に id を検査する（`../` や絶対パスで media の外へ書かせない）
    validate_id_component(&file_id)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 デコード失敗: {e}"))?;

    let dir = media_dir()?;

    // メタデータを JSON で保存
    let meta = serde_json::json!({
        "id": file_id,
        "name": name,
        "mimeType": mime_type,
        "createdTime": humantime::format_rfc3339(std::time::SystemTime::now()).to_string(),
    });
    let meta_path = join_id_component(&dir, &file_id, ".meta.json")?;
    fs::write(
        &meta_path,
        serde_json::to_string(&meta).unwrap(),
    )
    .map_err(|e| format!("メタデータ書き込み失敗: {e}"))?;

    // バイナリデータを拡張子付きで保存（Finder 等でそのまま開けるようにする）
    let filename = match media_ext(&name, &mime_type) {
        Some(ext) => format!("{file_id}.{ext}"),
        None => file_id.clone(),
    };
    let data_path = join_id_component(&dir, &filename, "")?;
    // 同じ id の既存本体が別名で残っていれば削除（再アップロードで拡張子が変わるケース）
    if let Some(existing) = find_media_data_file(&dir, &file_id) {
        if existing != data_path {
            let _ = fs::remove_file(&existing);
        }
    }
    fs::write(&data_path, bytes).map_err(|e| format!("メディア書き込み失敗: {e}"))
}

/// メディアファイルを読み込み（Base64 エンコードして返す）。
/// 数 MB の読み込み + エンコードをメインスレッドから逃がす（save_media_file と同旨）。
#[tauri::command]
async fn read_media_file(file_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let dir = media_dir()?;
        let path = find_media_data_file(&dir, &file_id)
            .ok_or_else(|| format!("メディアが見つかりません: {file_id}"))?;
        let bytes = fs::read(&path).map_err(|e| format!("メディア読み取り失敗: {e}"))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
    })
    .await
    .map_err(|e| format!("メディア読み取りタスク失敗: {e}"))?
}

/// 「アプリで開く」で OS に渡さない拡張子（小文字・ドット無し）。実行ファイル・スクリプト・
/// ショートカット・インストーラー・アプリ束など、開いただけでコードが動きうるもの。
/// コピーには Mark-of-the-Web / quarantine が付かないので、警告なしで動いてしまう。
const BLOCKED_OPEN_EXTS: &[&str] = &[
    // Windows の実行・スクリプト・ショートカット
    "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp", "mst", "ps1", "ps1xml", "ps2", "psc1",
    "psc2", "vbs", "vbe", "vb", "js", "jse", "wsf", "wsh", "ws", "wsc", "hta", "cpl", "lnk", "url",
    "jar", "jnlp", "reg", "inf", "scf", "msc", "gadget", "application", "appref-ms", "dll", "sys",
    "ocx", "sct", "shb", "shs", "job", "ade", "adp", "bas", "mde", "chm",
    // macOS
    "app", "command", "terminal", "tool", "workflow", "action", "pkg", "mpkg", "dmg", "iso",
    "osx", "scpt", "scptd", "webloc", "prefpane", "saver", "plugin", "kext", "wflow",
    // Linux・Unix のシェルやスクリプト
    "sh", "bash", "zsh", "fish", "csh", "ksh", "py", "pyw", "pyc", "rb", "pl", "pm", "php",
    "desktop", "appimage", "run", "bin", "elf", "out",
    // 開くだけで接続・設定変更・インストール・アドイン読み込みが起きるもの
    "rdp", "settingcontent-ms", "library-ms", "search-ms", "searchconnector-ms", "appx", "msix",
    "appxbundle", "msixbundle", "appinstaller", "xll", "xla", "xlam", "diagcab", "psm1", "psd1",
    "mobileconfig", "inetloc", "fileloc", "xbap", "slk", "iqy",
    // マクロ入り Office（開くとマクロの有効化を促される）
    "docm", "xlsm", "pptm", "dotm", "xltm", "potm", "ppam", "ppsm", "sldm",
];

/// 「アプリで開く」を断るときの Err の先頭。TS 側（open-in-app.ts）がこの文字列で
/// 「この種類は開けません」の画面文言へ振り分ける。
const BLOCKED_OPEN_ERR_PREFIX: &str = "blocked-executable-type";

/// 開こうとするファイルの拡張子が BLOCKED_OPEN_EXTS に当たるか（大文字小文字を区別しない）。
/// Windows は名前の末尾の `.` と空白を無視して開くので、落としてから見る。
fn blocked_open_ext(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let name = name.trim_end_matches(['.', ' ']);
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    BLOCKED_OPEN_EXTS.contains(&ext.as_str()).then_some(ext)
}

fn check_openable_ext(path: &Path) -> Result<(), String> {
    match blocked_open_ext(path) {
        Some(ext) => Err(format!("{BLOCKED_OPEN_ERR_PREFIX}:{ext}")),
        None => Ok(()),
    }
}

/// 「アプリで開く」用のファイル名を組み立てる。素材の表示名からパス区切りや
/// Windows で使えない文字を除き、本体の拡張子が付いていなければ足す。
/// 名前が空になったら素材 id を使う。
fn opened_copy_file_name(name: &str, file_id: &str, data_ext: Option<&str>) -> String {
    // 表示名にパスが混ざっていても最後の要素だけを使う（`../` で外に出さない）
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    // Windows は末尾の . と空白を落とすので、こちらで揃えておく
    while cleaned.ends_with('.') || cleaned.ends_with(' ') {
        cleaned.pop();
    }
    // 長すぎる名前はアプリ側で開けないことがあるので、文字単位で切る
    if cleaned.chars().count() > 120 {
        cleaned = cleaned.chars().take(120).collect();
    }
    if cleaned.is_empty() || cleaned == ".." || cleaned == "." {
        cleaned = file_id.to_string();
    }
    if let Some(ext) = data_ext {
        let has_ext = Path::new(&cleaned)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case(ext));
        if !has_ext {
            cleaned = format!("{cleaned}.{ext}");
        }
    }
    cleaned
}

/// 開いたコピーの横に置く「コピーした時点の中身の SHA-256」。
/// コピーが外のアプリで編集されたか（コピーのハッシュ ≠ これ）と、原本が後から
/// 変わったか（原本のハッシュ ≠ これ）を区別するために使う。
const OPENED_BASE_FILE: &str = ".graphium-base";

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// `appdata/opened/{id}` を返す。id はディレクトリ名に使うので、パス区切りを含むものは弾く
fn opened_dir(file_id: &str) -> Result<PathBuf, String> {
    validate_id_component(file_id).map_err(|_| format!("不正なメディア id: {}", file_id.escape_debug()))?;
    Ok(ensure_subdir("appdata")?.join("opened").join(file_id))
}

/// 開いたコピーの本体を探す。外のアプリが同じフォルダに置く作業ファイル
/// （Word の `~$名前.docx`、`.` で始まる隠しファイル、`.tmp`）は除き、
/// 残りのうち最後に更新されたものを返す。
fn find_opened_copy(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with("~$") || name.to_ascii_lowercase().ends_with(".tmp") {
            continue;
        }
        let modified = entry.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().is_none_or(|(t, _)| modified > *t) {
            best = Some((modified, path));
        }
    }
    best.map(|(_, p)| p)
}

/// 読み取り専用を外す（前の版の「アプリで開く」は読み取り専用のコピーを置いていた）
fn make_writable(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

/// 素材の本体 `src` を `out_dir/{表示名}` にコピーし、そのパスを返す。
///
/// - コピーがまだ無い → 置いて、そのときの中身のハッシュを覚える
/// - コピーが外で編集されている → **触らない**（取り込むか捨てるかは利用者が決める）
/// - コピーは手つかずで原本だけ変わった → 新しい原本で置き直す
fn write_opened_copy(src: &Path, out_dir: &Path, name: &str, file_id: &str) -> Result<PathBuf, String> {
    let data_ext = src.extension().and_then(|e| e.to_str()).map(str::to_string);
    fs::create_dir_all(out_dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    let bytes = fs::read(src).map_err(|e| format!("メディア読み取り失敗: {e}"))?;
    let src_hash = sha256_hex(&bytes);
    let base_path = out_dir.join(OPENED_BASE_FILE);

    if let Some(existing) = find_opened_copy(out_dir) {
        check_openable_ext(&existing)?;
        make_writable(&existing);
        let base = fs::read_to_string(&base_path).unwrap_or_default();
        let copy = fs::read(&existing).map_err(|e| format!("コピー読み取り失敗: {e}"))?;
        let copy_hash = sha256_hex(&copy);
        if copy_hash == src_hash {
            // 同じ中身（アプリで開いたままでも開き直せる。Windows は開いている間
            // ファイルを掴むので、書き直そうとすると失敗する）
            fs::write(&base_path, &src_hash).map_err(|e| format!("基準の記録失敗: {e}"))?;
            return Ok(existing);
        }
        if !base.is_empty() && copy_hash != base {
            // 外で編集された未取り込みの変更がある。上書きすると消えるので残す
            return Ok(existing);
        }
        // 手つかずのコピーが古い（原本が変わった）→ 置き直す
        fs::write(&existing, &bytes).map_err(|e| format!("コピー書き込み失敗: {e}"))?;
        fs::write(&base_path, &src_hash).map_err(|e| format!("基準の記録失敗: {e}"))?;
        return Ok(existing);
    }

    let dest = out_dir.join(opened_copy_file_name(name, file_id, data_ext.as_deref()));
    // 表示名の拡張子がコピーの名前になりうる（本体に拡張子が無い旧形式）ので、置く前に確かめる
    check_openable_ext(&dest)?;
    fs::write(&dest, &bytes).map_err(|e| format!("コピー書き込み失敗: {e}"))?;
    fs::write(&base_path, &src_hash).map_err(|e| format!("基準の記録失敗: {e}"))?;
    Ok(dest)
}

/// 素材を OS の既定のアプリ（Word / Excel / PowerPoint など）で開く。
///
/// 原本（`<root>/media/{id}.{ext}`）をそのまま渡すと、外のアプリでの保存が原本を
/// 書き換え、ノートや知識が引用している中身が黙って変わってしまう。そこで
/// `<root>/appdata/opened/{id}/{表示名}` に**編集できるコピー**を置いて開く。
/// 表示名で置くのは、アプリのタイトルバーに `{id}.docx` ではなく元の名前を出すため。
/// コピーへの変更は list_changed_opened_copies で見つけ、利用者が選んだときだけ
/// 原本に反映する（上書き or 新しい版）。
#[tauri::command]
async fn open_media_in_app(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    file_id: String,
    name: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    let copy_path = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let out_dir = opened_dir(&file_id)?;
        let src = find_media_data_file(&media_dir()?, &file_id)
            .ok_or_else(|| format!("メディアが見つかりません: {file_id}"))?;
        // 実ファイルの拡張子が実行ファイル・スクリプト・ショートカットなら、コピーも作らず開かない
        // （MIME と名前の食い違いで「ドキュメント」扱いにされた素材を OS に実行させない）
        check_openable_ext(&src)?;
        write_opened_copy(&src, &out_dir, &name, &file_id)
    })
    .await
    .map_err(|e| format!("コピー作成タスク失敗: {e}"))??;

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(copy_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("アプリで開けませんでした: {e}"))
}

/// 外のアプリで編集された（まだ取り込んでいない）コピー
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedOpenedCopy {
    file_id: String,
    /// コピーのファイル名（アプリで保存したときの名前）
    file_name: String,
}

/// `opened` 配下で、コピーした時点から中身が変わったものを集める
fn collect_changed_opened_copies(opened_root: &Path, media: &Path) -> Vec<ChangedOpenedCopy> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(opened_root) else { return out };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let file_id = entry.file_name().to_string_lossy().to_string();
        // 原本が無い（素材を消した）コピーは対象外
        if find_media_data_file(media, &file_id).is_none() {
            continue;
        }
        let Some(copy) = find_opened_copy(&dir) else { continue };
        let Ok(base) = fs::read_to_string(dir.join(OPENED_BASE_FILE)) else { continue };
        let Ok(bytes) = fs::read(&copy) else { continue };
        if sha256_hex(&bytes) != base.trim() {
            out.push(ChangedOpenedCopy {
                file_id,
                file_name: copy.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            });
        }
    }
    out.sort_by(|a, b| a.file_id.cmp(&b.file_id));
    out
}

#[tauri::command]
async fn list_changed_opened_copies() -> Result<Vec<ChangedOpenedCopy>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<ChangedOpenedCopy>, String> {
        let root = ensure_subdir("appdata")?.join("opened");
        Ok(collect_changed_opened_copies(&root, &media_dir()?))
    })
    .await
    .map_err(|e| format!("コピーの確認タスク失敗: {e}"))?
}

/// 編集されたコピーの中身を Base64 で返す（新しい版として登録するため）
#[tauri::command]
async fn read_opened_copy(file_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use base64::Engine;
        let copy = find_opened_copy(&opened_dir(&file_id)?).ok_or("開いたコピーが見つかりません")?;
        let bytes = fs::read(&copy).map_err(|e| format!("コピー読み取り失敗: {e}"))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
    })
    .await
    .map_err(|e| format!("コピー読み取りタスク失敗: {e}"))?
}

/// コピーの中身で原本を上書きする（どこからも引用されていない素材だけに使う）。
/// 新しい中身の SHA-256（`sha256:<hex>`、素材の contentHash と同じ形）を返す。
fn adopt_opened_copy_sync(opened: &Path, media: &Path, file_id: &str) -> Result<String, String> {
    let copy = find_opened_copy(opened).ok_or("開いたコピーが見つかりません")?;
    let original = find_media_data_file(media, file_id).ok_or_else(|| format!("メディアが見つかりません: {file_id}"))?;
    let bytes = fs::read(&copy).map_err(|e| format!("コピー読み取り失敗: {e}"))?;
    let hash = sha256_hex(&bytes);
    // 書きかけで止まっても原本が壊れないよう、一時ファイルに書いてから置き換える
    let tmp = original.with_extension("adopt.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("原本の書き込み失敗: {e}"))?;
    fs::rename(&tmp, &original).map_err(|e| format!("原本の置き換え失敗: {e}"))?;
    fs::write(opened.join(OPENED_BASE_FILE), &hash).map_err(|e| format!("基準の記録失敗: {e}"))?;
    Ok(format!("sha256:{hash}"))
}

#[tauri::command]
async fn adopt_opened_copy(file_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || adopt_opened_copy_sync(&opened_dir(&file_id)?, &media_dir()?, &file_id))
        .await
        .map_err(|e| format!("原本の上書きタスク失敗: {e}"))?
}

/// 新しい版を登録したあと、コピーをその版のものとして付け替える。
/// 以後の編集は新しい版に対する変更として扱われる（途中の版を増やさない）。
fn rebase_opened_copy_sync(from: &Path, to: &Path) -> Result<(), String> {
    let copy = find_opened_copy(from).ok_or("開いたコピーが見つかりません")?;
    let bytes = fs::read(&copy).map_err(|e| format!("コピー読み取り失敗: {e}"))?;
    if to.exists() {
        fs::remove_dir_all(to).map_err(|e| format!("古いコピーの削除失敗: {e}"))?;
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    }
    fs::rename(from, to).map_err(|e| format!("コピーの付け替え失敗: {e}"))?;
    fs::write(to.join(OPENED_BASE_FILE), sha256_hex(&bytes)).map_err(|e| format!("基準の記録失敗: {e}"))
}

#[tauri::command]
async fn rebase_opened_copy(from_file_id: String, to_file_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rebase_opened_copy_sync(&opened_dir(&from_file_id)?, &opened_dir(&to_file_id)?))
        .await
        .map_err(|e| format!("コピーの付け替えタスク失敗: {e}"))?
}

/// 外での変更を捨てる（コピーごと消す。次に開くと原本から置き直す）
#[tauri::command]
async fn discard_opened_copy(file_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let dir = opened_dir(&file_id)?;
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("コピーの削除失敗（アプリで開いたままなら閉じてください）: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("コピーの削除タスク失敗: {e}"))?
}

/// サムネイルのキャッシュの世代。作り方を変えたら上げる — ファイル名が変わるので、
/// 前の作り方で焼いたキャッシュ（元ファイルより新しいので fresh 判定を通ってしまう）を読まない。
/// v2: 透過画像を PNG で残す（v1 は JPEG 化で透明部分が黒になっていた）
const THUMB_CACHE_VERSION: u32 = 2;

/// 画像を長辺 edge px に縮めてエンコードする。
///
/// 透明な画素がある画像は PNG で透過を残し、それ以外は JPEG にする。JPEG は透過を
/// 持てず、RGB へ落とすと透明部分は画素に入っている色（多くは黒）がそのまま出る。
/// 黒い文字の透過 PNG（スライドや文書から取り出した図）だと一覧で真っ黒に見えていた。
/// 原寸表示は透過のまま描かれるので、サムネイルもそれに揃える。
fn encode_thumbnail(img: &image::DynamicImage, edge: u32) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    // thumbnail() は近傍法の高速縮小。サムネイル用途では十分で、resize より桁違いに速い
    let small = img.thumbnail(edge, edge);
    let mut out = Vec::new();
    // アルファチャンネルを持っていても全面不透明なら JPEG で足りる（写真の PNG 等）
    let translucent = small
        .color()
        .has_alpha()
        .then(|| small.to_rgba8())
        .filter(|rgba| rgba.pixels().any(|p| p.0[3] < 255));
    if let Some(rgba) = translucent {
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
            .map_err(|e| format!("サムネイル生成失敗: {e}"))?;
    } else {
        let rgb = small.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82)
            .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("サムネイル生成失敗: {e}"))?;
    }
    Ok(out)
}

/// 素材のサムネイル（長辺 max_edge px。透過があれば PNG、無ければ JPEG）を Base64 で返す。
///
/// ピッカーやギャラリーが原寸を read_media_file で受け取ると、数 MB の Base64 を
/// 1 枚ごとに往復して WebView のメモリが数百 MB 膨らみ、本体の CPU も食う
/// （2026-09-04 の実測: 60 枚で Rust +10 秒・WebView +700MB）。縮小はこちらで行い、
/// 結果は <media>/.thumbs/<id>-<edge>-v<世代> に置いて次回はそれを返す
/// （中身が PNG か JPEG かは先頭のバイトで分かるので、拡張子は付けない）。
/// 元ファイルより古いキャッシュは作り直す。画像として読めないものは Err
/// （呼び出し側は原寸にフォールバックする）。
#[tauri::command]
async fn read_media_thumbnail(file_id: String, max_edge: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let edge = max_edge.clamp(32, 1024);
        let dir = media_dir()?;
        let src = find_media_data_file(&dir, &file_id)
            .ok_or_else(|| format!("メディアが見つかりません: {file_id}"))?;
        let thumbs = dir.join(".thumbs");
        fs::create_dir_all(&thumbs).map_err(|e| format!("サムネイル用ディレクトリ作成失敗: {e}"))?;
        let cache = thumbs.join(format!("{file_id}-{edge}-v{THUMB_CACHE_VERSION}"));
        let fresh = match (fs::metadata(&cache), fs::metadata(&src)) {
            (Ok(c), Ok(s)) => match (c.modified(), s.modified()) {
                (Ok(cm), Ok(sm)) => cm >= sm,
                _ => true,
            },
            _ => false,
        };
        if fresh {
            let bytes = fs::read(&cache).map_err(|e| format!("サムネイル読み取り失敗: {e}"))?;
            return Ok(base64::engine::general_purpose::STANDARD.encode(&bytes));
        }
        let img = image::open(&src).map_err(|e| format!("画像として読めません: {e}"))?;
        let out = encode_thumbnail(&img, edge)?;
        // キャッシュ書き込みの失敗は致命ではない（次回また作る）
        if let Err(e) = fs::write(&cache, &out) {
            eprintln!("サムネイルのキャッシュ書き込み失敗: {e}");
        }
        // v1 のキャッシュ（<id>-<edge>.jpg）はもう読まないので片付ける
        let _ = fs::remove_file(thumbs.join(format!("{file_id}-{edge}.jpg")));
        Ok(base64::engine::general_purpose::STANDARD.encode(&out))
    })
    .await
    .map_err(|e| format!("サムネイル生成タスク失敗: {e}"))?
}

/// URL の Reader 原文などのプレーンテキストを保存（B-persist）。
/// バイナリメディア（save_media_file）とは別に <media_dir>/<id>.txt に置く。
#[tauri::command]
fn save_media_text(file_id: String, text: String) -> Result<(), String> {
    let path = join_id_component(&media_dir()?, &file_id, ".txt")?;
    fs::write(&path, text).map_err(|e| format!("原文テキスト書き込み失敗: {e}"))
}

/// 保存済みの原文テキストを読み込み（存在しなければ None）。
#[tauri::command]
fn read_media_text(file_id: String) -> Result<Option<String>, String> {
    let path = join_id_component(&media_dir()?, &file_id, ".txt")?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("原文テキスト読み取り失敗: {e}"))
}

/// 保存済みの原文テキストを削除（存在しなければ何もしない）。
/// URL ブックマークの削除に追随してプレビュー画像キャッシュを消すのに使う。
/// ここだけ ID を検証するのは、削除は取り違えると復元できないため
/// （sidecar 側 safeId と同じ規則: 区切り文字・NUL・先頭ドットを拒否）。
#[tauri::command]
fn delete_media_text(file_id: String) -> Result<(), String> {
    let path = join_id_component(&media_dir()?, &file_id, ".txt")
        .map_err(|_| "不正なファイル ID".to_string())?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| format!("原文テキスト削除失敗: {e}"))
}

/// メディアファイル一覧を取得。
/// 素材数に比例して .meta.json を読むため、メインスレッドから逃がす。
#[tauri::command]
async fn list_media_files_cmd() -> Result<Vec<MediaFileInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_media_files_sync)
        .await
        .map_err(|e| format!("メディア一覧タスク失敗: {e}"))?
}

fn list_media_files_sync() -> Result<Vec<MediaFileInfo>, String> {
    let dir = media_dir()?;
    let mut files = Vec::new();

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("ディレクトリ読み取り失敗: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("エントリ読み取り失敗: {e}"))?;
        let path = entry.path();
        // .meta.json ファイルからメタデータを読み取る
        if path.to_string_lossy().ends_with(".meta.json") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("メタデータ読み取り失敗: {e}"))?;
            let meta: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| format!("メタデータパース失敗: {e}"))?;
            files.push(MediaFileInfo {
                id: meta["id"].as_str().unwrap_or_default().to_string(),
                name: meta["name"].as_str().unwrap_or_default().to_string(),
                mime_type: meta["mimeType"].as_str().unwrap_or_default().to_string(),
                created_time: meta["createdTime"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            });
        }
    }

    Ok(files)
}

/// メディアファイルを完全削除（OS のゴミ箱へ送る）
#[tauri::command]
fn delete_media_file(window: tauri::WebviewWindow, file_id: String) -> Result<(), String> {
    require_main_window(&window)?;
    validate_id_component(&file_id)?;
    let dir = media_dir()?;
    // 新形式（拡張子付き）・旧形式（拡張子なし）どちらでも解決して削除
    if let Some(data_path) = find_media_data_file(&dir, &file_id) {
        if let Err(e) = trash::delete(&data_path) {
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&data_path).map_err(|e| format!("メディア削除失敗: {e}"))?;
        }
    }
    // サムネイルのキャッシュも道連れにする（残しても害は無いが、消した素材の名残になる）
    if let Ok(entries) = fs::read_dir(dir.join(".thumbs")) {
        let prefix = format!("{file_id}-");
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    // 付随ファイル（会議の文字起こし・清書・要約の JSON と、OCR・文字起こしの平文）も道連れにする
    for suffix in ["transcript.json", "cleanup.json", "summary.json", "txt", "transcript.json.tmp", "cleanup.json.tmp", "summary.json.tmp", "txt.tmp"] {
        // 書き込み途中の残骸（write_atomic のドット始まりの tmp）も消す
        let side = dir.join(format!("{file_id}.{suffix}"));
        let _ = fs::remove_file(dir.join(format!(".{file_id}.{suffix}")));
        if side.exists() {
            let _ = fs::remove_file(&side);
        }
    }
    let meta_path = dir.join(format!("{file_id}.meta.json"));
    if meta_path.exists() {
        if let Err(e) = trash::delete(&meta_path) {
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&meta_path).map_err(|e| format!("メタデータ削除失敗: {e}"))?;
        }
    }
    Ok(())
}

/// メディアファイルをリネーム
#[tauri::command]
fn rename_media_file(file_id: String, new_name: String) -> Result<(), String> {
    let meta_path = join_id_component(&media_dir()?, &file_id, ".meta.json")?;
    if !meta_path.exists() {
        return Err(format!("メディアが見つかりません: {file_id}"));
    }
    let content = fs::read_to_string(&meta_path)
        .map_err(|e| format!("メタデータ読み取り失敗: {e}"))?;
    let mut meta: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("メタデータパース失敗: {e}"))?;
    meta["name"] = serde_json::Value::String(new_name);
    fs::write(
        &meta_path,
        serde_json::to_string(&meta).unwrap(),
    )
    .map_err(|e| format!("メタデータ書き込み失敗: {e}"))
}

/// appData のキー → ファイル名。`%` → `%25`、`:` → `%3A`（この順。単射）。
/// Windows では `a:b.json` が代替データストリームになり、コピーで抜け落ちるため。
/// TS 側（src/server/app-data-file-name.ts）と同じ規則
fn app_data_file_name(key: &str) -> String {
    format!("{}.json", key.replace('%', "%25").replace(':', "%3A"))
}

/// ファイル名（拡張子なし）→ キー。`app_data_file_name` の逆変換
fn app_data_key_from_file_name(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    let mut rest = stem;
    while let Some(c) = rest.chars().next() {
        if rest.starts_with("%3A") {
            out.push(':');
            rest = &rest[3..];
        } else if rest.starts_with("%25") {
            out.push('%');
            rest = &rest[3..];
        } else {
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// read / write の appData キーがパスの外へ出ないかの検査。旧来のキーは `:` を含みうる
/// （`app_data_file_name` が `%3A` に直す）ので、`validate_id_component` より `:` だけ緩い。
fn validate_app_data_path_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.contains(['/', '\\'])
        || key.contains("..")
        || key.starts_with('.')
        || key.chars().any(|c| c.is_control())
    {
        return Err(format!("不正な appData キー: {}", key.escape_debug()));
    }
    Ok(())
}

/// dir から appData を読む。新しい名前が無ければ、`:` か `%` を含むキーに限り旧来の名前
/// `<key>.json` を読み、見つかれば新しい名前へ書き写す（旧ファイルは消さない）
fn read_app_data_in(dir: &std::path::Path, key: &str) -> Result<Option<String>, String> {
    validate_app_data_path_key(key)?;
    let path = join_single_component(dir, &app_data_file_name(key))?;
    if path.exists() {
        let content =
            fs::read_to_string(&path).map_err(|e| format!("アプリデータ読み取り失敗: {e}"))?;
        return Ok(Some(content));
    }
    if !(key.contains(':') || key.contains('%')) {
        return Ok(None);
    }
    // 旧名は `:` を含みうるが、区切り文字・`..`・ドライブ指定でパスの外へ出る形は読まない
    let Ok(legacy) = join_single_component(dir, &format!("{key}.json")) else {
        return Ok(None);
    };
    // Windows では ADS として読める。無ければ（他 OS で `:` が使えない等）エラーでも None
    let content = match fs::read_to_string(&legacy) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    fs::write(&path, &content).map_err(|e| format!("アプリデータ移行失敗: {e}"))?;
    Ok(Some(content))
}

/// appData の一時ファイル名を重ねないための通し番号
static APP_DATA_TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// dir へ appData を書く（常に新しい名前）。
/// 同じ場所の一時ファイルに書いてから置き換える。直接上書きすると、書いている間は空のファイルが
/// 見え、別プロセス（MCP）が索引を読めなくなる。一時ファイルは `.json` で終わらないので一覧に出ない
fn write_app_data_in(dir: &std::path::Path, key: &str, data: &str) -> Result<(), String> {
    validate_app_data_path_key(key)?;
    let file_name = app_data_file_name(key);
    let path = join_single_component(dir, &file_name)?;
    let seq = APP_DATA_TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = join_single_component(
        dir,
        &format!("{file_name}.tmp-{}-{seq}", std::process::id()),
    )?;
    if let Err(e) = fs::write(&tmp, data).and_then(|_| fs::rename(&tmp, &path)) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("アプリデータ書き込み失敗: {e}"));
    }
    Ok(())
}

/// アプリデータを読み込み
#[tauri::command]
fn read_app_data(key: String) -> Result<Option<String>, String> {
    read_app_data_in(&appdata_dir()?, &key)
}

/// アプリデータを書き込み
#[tauri::command]
fn write_app_data(key: String, data: String) -> Result<(), String> {
    write_app_data_in(&appdata_dir()?, &key, &data)
}

/// appData の一覧・削除 API に渡すキー／prefix の検証。
/// TS 側（src/lib/storage/app-data-key.ts）と同じ規則: ^[A-Za-z0-9_-]{1,200}$
fn validate_app_data_key(key: &str) -> Result<(), String> {
    let ok = !key.is_empty()
        && key.len() <= 200
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(format!("不正な appData キー: {key}"))
    }
}

/// dir 直下の `<prefix>*.json` のキー（拡張子なし）を返す。.json 以外とディレクトリは無視
fn list_app_data_keys_in(dir: &std::path::Path, prefix: &str) -> Result<Vec<String>, String> {
    validate_app_data_key(prefix)?;
    let mut keys = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(keys),
        Err(e) => return Err(format!("アプリデータ一覧取得失敗: {e}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("アプリデータ一覧取得失敗: {e}"))?;
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(stem) = name.strip_suffix(".json") {
            let key = app_data_key_from_file_name(stem);
            if key.starts_with(prefix) && validate_app_data_key(&key).is_ok() {
                keys.push(key);
            }
        }
    }
    Ok(keys)
}

/// dir 直下の `<key>.json` を実際に削除する（OS のゴミ箱へは送らない）。無ければ成功
fn delete_app_data_in(dir: &std::path::Path, key: &str) -> Result<(), String> {
    validate_app_data_key(key)?;
    let mut names = vec![app_data_file_name(key)];
    // `:` を含むキーは旧来の名前も消す（現状の規則では到達しないが、規則が緩んでも残さない）
    if key.contains(':') {
        names.push(format!("{key}.json"));
    }
    for name in names {
        match fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("アプリデータ削除失敗: {e}")),
        }
    }
    Ok(())
}

/// prefix で始まるアプリデータのキー一覧（拡張子なし）
#[tauri::command]
fn list_app_data_keys(prefix: String) -> Result<Vec<String>, String> {
    list_app_data_keys_in(&appdata_dir()?, &prefix)
}

/// アプリデータを削除
#[tauri::command]
fn delete_app_data(key: String) -> Result<(), String> {
    delete_app_data_in(&appdata_dir()?, &key)
}

/// メディアファイルのパスを取得（convertFileSrc 用）
#[tauri::command]
fn get_media_path(file_id: String) -> Result<String, String> {
    let dir = media_dir()?;
    let path = find_media_data_file(&dir, &file_id)
        .ok_or_else(|| format!("メディアが見つかりません: {file_id}"))?;
    Ok(path.to_string_lossy().to_string())
}

// --- Team-shared storage（Phase 1b: Local folder Provider のバックエンド） ---
//
// 設計: docs/internal/team-shared-storage-design.md §4 Storage Provider 拡張
// レイアウト:
//   <shared-root>/
//     <type>/<id>.json                  — SharedEntry + body_base64 を 1 ファイルに格納
//     _meta/tombstones/<id>.json        — 削除マーカー（status="unshared" の entry のみ、body なし）
//   <blob-root>/
//     <hh>/<full-hash>                  — content-addressed blob（hh = hash の先頭 2 hex chars）
//
// パストラバーサル防御:
//   - entry_type は固定の許可リストにのみマッチ
//   - id は uuidv7 形式の正規表現でバリデート
//   - hash は "sha256:<64 hex>" 形式のみ許可
//   - すべてのコマンドで root は呼び出し側から渡され、上記の構造のみ触る

// TS 側 TYPE_TO_FOLDER（src/lib/storage/shared/local-folder.ts）と揃えること。
// Knowledge（wiki）は "knowledge" 1 フォルダに集約（内部分類は entry の extra.wikiKind）。
const SHARED_ENTRY_TYPES: &[&str] = &[
    "notes",
    "references",
    "data-manifests",
    "templates",
    "knowledge",
    "reports",
    "comments",
    "proposals",
];

fn validate_entry_type(t: &str) -> Result<(), String> {
    if SHARED_ENTRY_TYPES.contains(&t) {
        Ok(())
    } else {
        Err(format!("無効な entry type: {t}"))
    }
}

/// uuidv7 形式（version=7、variant=10xx）のチェック。
fn validate_id(id: &str) -> Result<(), String> {
    if id.len() != 36 {
        return Err(format!("無効な id 長さ: {id}"))
    }
    let bytes = id.as_bytes();
    // ハイフン位置: 8, 13, 18, 23
    for (i, b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *b != b'-' {
                    return Err(format!("無効な id 形式: {id}"));
                }
            }
            _ => {
                let c = *b as char;
                if !c.is_ascii_hexdigit() {
                    return Err(format!("無効な id 形式: {id}"));
                }
            }
        }
    }
    // version nibble (位置 14) = '7'
    if bytes[14] != b'7' {
        return Err(format!("uuidv7 ではない id: {id}"));
    }
    // variant nibble (位置 19) ∈ {8,9,a,b}
    let v = bytes[19] as char;
    if !matches!(v, '8' | '9' | 'a' | 'b' | 'A' | 'B') {
        return Err(format!("無効な variant: {id}"));
    }
    Ok(())
}

// ── Mobile capture inbox (受信箱) ─────────────────────────────────────
// モバイルで撮影したメディアを同期フォルダ(iCloud/Dropbox/Syncthing 等)の
// <inbox-root>/Inbox/ に置き、デスクトップが列挙 → 読み込み → 取り込み後に
// 既定で削除(inbox_discard)、keep-archive 設定時は <inbox-root>/Inbox/_imported/
// へ退避(inbox_mark_imported)する。認証・dedup・provenance はアプリ層
// (TS)に委ね、ここは素朴な FS 操作に徹する(shared_* と同じ方針)。

const INBOX_SUBDIR: &str = "Inbox";
const INBOX_IMPORTED_SUBDIR: &str = "_imported";

/// inbox_read で読む 1 ファイルの上限。スマホ撮影の動画・音声が通る大きさにしつつ、
/// 数 GB のファイルで base64 化と IPC がメモリを使い果たすのを防ぐ。
const INBOX_MAX_READ_BYTES: u64 = 1400 * 1024 * 1024;

/// inbox 内のファイルパスを安全に解決する(パストラバーサル防止)。
/// Inbox 直下のファイルのみ許可し、区切り文字や親参照を含む name は拒否する。
fn inbox_file_path(root: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains(['/', '\\', '\0'])
        // ':' は Windows のドライブ指定だけが危険。macOS では Finder の「/」が ':' で来る
        || (cfg!(windows) && name.contains(':'))
        || name.contains("..")
        || name.chars().any(|c| c.is_control())
    {
        return Err(format!("Invalid inbox file name: {name}"));
    }
    // Inbox 直下の 1 要素であることも確かめる（Windows のドライブ付き相対パス対策）
    join_single_component(&PathBuf::from(root).join(INBOX_SUBDIR), name)
}

/// 受信箱の 1 アイテム。TS 側 `CaptureRef` と 1:1 対応する（camelCase で送る）。
/// 受信箱 UI が件数だけでなくサイズ・日時も出すため、名前だけでなくメタも返す。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    /// Inbox/ 直下のファイル名（パス区切りを含まない）。
    pub name: String,
    /// バイトサイズ。
    pub bytes: u64,
    /// 最終更新日時(RFC3339)。取得できない FS では None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

/// <inbox-root>/Inbox/ 直下の未取り込みファイルを列挙する。
/// サブディレクトリ(_imported 等)と隠しファイル(. 始まり)は除外。
#[tauri::command]
fn inbox_list(root: String) -> Result<Vec<InboxItem>, String> {
    // 多層防御: 空/空白の root を早期に弾く（shared_* と同じ非空ガード）。
    validate_root(&root)?;
    let base = PathBuf::from(&root).join(INBOX_SUBDIR);
    if !base.exists() {
        return Ok(vec![]);
    }
    // Inbox 自体が別の場所へのリンクなのは正当な構成（NAS・外付けへ置く）として許す。
    // 拒否するのは、その中に置かれたファイル単位のリンク（下の file_type 判定）
    let mut out: Vec<InboxItem> = Vec::new();
    for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        // _imported/ 等のサブフォルダと、シンボリックリンクは対象外(素のメディアファイルのみ拾う)。
        // DirEntry::file_type はリンクを辿らない（readdir の d_type。追加の往復も増えない）ので、
        // 同期相手が置いた `photo.png -> ~/.ssh/id_rsa` のようなリンクが素材として取り込まれない
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        // .DS_Store 等の隠しファイルは無視
        if name.starts_with('.') {
            continue;
        }
        // メタが取れないファイル(権限・競合削除)は列挙自体を落とさず既定値に倒す。
        let meta = fs::metadata(&path).ok();
        let bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_at = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| humantime::format_rfc3339(t).to_string());
        out.push(InboxItem {
            name: name.to_string(),
            bytes,
            modified_at,
        });
    }
    // 新しいものが上（受信箱は「最近届いたもの」から見る）。日時不明は末尾に沈める。
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

/// <inbox-root>/Inbox/<name> を読み、base64 で返す(shared_blob_read と同じ転送方式)。
#[tauri::command]
fn inbox_read(root: String, name: String) -> Result<String, String> {
    // 多層防御: 空/空白の root を早期に弾く（shared_* と同じ非空ガード）。
    validate_root(&root)?;
    let path = inbox_file_path(&root, &name)?;
    // リンクは読まない（inbox_list が外したものを、名前を直接渡されて読まない）
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !meta.file_type().is_file() {
        return Err(format!("Not a regular inbox file: {name}"));
    }
    // 巨大なファイルを丸ごとメモリに載せて base64 にし、IPC で運ぶとアプリが固まる。
    // 超えたら読まずに断る（呼び出し側はその 1 件だけ失敗として飛ばし、ファイルは Inbox に残る）
    if meta.len() > INBOX_MAX_READ_BYTES {
        // 先頭の印は TS 側（InboxView）が文言へ振り分ける
        return Err(format!(
            "inbox-file-too-large: {} bytes, limit {INBOX_MAX_READ_BYTES}: {name}",
            meta.len()
        ));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 取り込み済みファイルを <inbox-root>/Inbox/_imported/<name> へ退避する。
/// 冪等な重複排除は TS 側の sourceHash(sha256)で担保するため、ここでは単純に move する。
/// 「処理済みの控えを残す」設定のときだけ使う — 既定の後処理は inbox_discard(削除)。
#[tauri::command]
fn inbox_mark_imported(root: String, name: String) -> Result<(), String> {
    // 多層防御: 空/空白の root を早期に弾く（shared_* と同じ非空ガード）。
    validate_root(&root)?;
    let src = inbox_file_path(&root, &name)?;
    // リンクは移さない（リンク先でなくリンク自体が動くだけだが、取り込み対象外のものは触らない）
    if !fs::symlink_metadata(&src).map(|m| m.file_type().is_file()).unwrap_or(false) {
        return Err(format!("Not a regular inbox file: {name}"));
    }
    let imported_dir = PathBuf::from(&root)
        .join(INBOX_SUBDIR)
        .join(INBOX_IMPORTED_SUBDIR);
    fs::create_dir_all(&imported_dir).map_err(|e| e.to_string())?;
    let dst = imported_dir.join(&name);
    // rename が跨device 等で失敗する場合に備え copy + remove にフォールバック
    if fs::rename(&src, &dst).is_err() {
        fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        fs::remove_file(&src).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 取り込み済みファイルを <inbox-root>/Inbox/ から削除する（既定の後処理）。
/// 取り込み成功時点で中身はデスクトップ vault に着地済みなので、消えるのは冗長コピー
/// のみ（同期フォルダ = クラウドに撮影物の控えが溜まり続けない）。二重取込防止は
/// TS 側の checksum dedup と「Inbox から消えること」自体が担う。
#[tauri::command]
fn inbox_discard(root: String, name: String) -> Result<(), String> {
    // 多層防御: 空/空白の root を早期に弾く（shared_* と同じ非空ガード）。
    validate_root(&root)?;
    // inbox_file_path が区切り文字・親参照を拒否するので、消せるのは Inbox/ 直下のみ。
    let path = inbox_file_path(&root, &name)?;
    fs::remove_file(&path).map_err(|e| e.to_string())
}

// --- ネイティブフォルダ走査（webkitdirectory の NAS 越し低速化を回避） ---
//
// `<input webkitdirectory>` は選択したフォルダ配下の全ファイルに対して
// WebKit がエイリアス判定（getattrlist）を行うため、NAS 越しのフォルダでは
// 数千ファイルで数分かかるほど極端に遅くなる。ここでは Rust 側で
// fs::read_dir を直接叩いて回避する。
//
// 当初は各エントリに対し symlink_metadata（lstat）も呼んでいたが、NAS 越しでは
// これがエントリ 1 件ごとの追加往復になり、実測で走査時間の 9 割を占めていた
// （2,000〜3,000 件で readdir だけなら 12〜32 秒、lstat も呼ぶと 103〜192 秒）。
// DirEntry::file_type() は readdir が返す d_type をそのまま使う（macOS は
// DT_UNKNOWN のときだけ 1 回 fstatat にフォールバック、Windows は
// FindNextFileW の結果を保持済みで追加往復なし）ため、種別判定は
// file_type() だけで行い、エントリごとの追加 stat 呼び出しは一切しない。

/// scan_directory の走査上限件数（取り込み対象の拡張子に当たったファイルだけを数える）。
///
/// 以前は 50,000 件で、しかも形式を問わず全ファイルを数えていたため、`.git` の中身や
/// 装置のログが混ざった過去データのフォルダでは、取り込めるファイルが僅かでも上限に
/// 届いてしまっていた。いまは件数表示と停止ボタンがあり「固まって見える」心配は
/// 無いので、上限は日常の上限ではなく安全柵（パス一覧と許可リストがメモリを
/// 食い潰さないための頭打ち）として置く。
const SCAN_MAX_FILES: usize = 500_000;

/// 許可リストに溜めるパスの上限。フォルダを選び直しても前回分をすぐには
/// 捨てられない（取り込みが裏で続いている）ので、上限いっぱいの走査を 1 回分は
/// 追加で残せる大きさにしつつ、際限なく増えないようここで頭を打つ。
const SCAN_ALLOWLIST_MAX: usize = SCAN_MAX_FILES * 2;

/// 対象外の内訳（拡張子 → 件数）に持つ種類の上限。ランダムな拡張子が大量に並ぶ
/// フォルダでも表が膨らまないよう、超えた分は OTHER_EXT_KEY にまとめる。
/// 画面に出すのは上位 3 種だけなので、64 あれば表示に影響しない。
const SCAN_SKIPPED_EXT_KINDS_MAX: usize = 64;

/// 拡張子が無いファイルの内訳キー。TS 側 run-intake.ts の extOf と同じ表記。
const NO_EXT_KEY: &str = "(none)";

/// SCAN_SKIPPED_EXT_KINDS_MAX を超えた種類をまとめる内訳キー。
const OTHER_EXT_KEY: &str = "(other)";

/// intake-scan-progress を emit する最短間隔。数万件規模の走査で毎エントリ emit すると
/// IPC 自体がボトルネックになるため間引く。
const SCAN_PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// scan_directory の結果 1 件。TS 側と 1:1 対応する（camelCase で送る。
/// 既存の InboxItem と同じ流儀）。
///
/// size は持たない: 走査時点のサイズを実際に使っているのは
/// importMarkdownFiles の tooLargeToHash 判定（TS 側）だけで、その直後に必ず
/// getFile() で実体を読むため走査側で持つ意味が薄い。種別判定は file_type() だけで
/// 済むのに対し、サイズ取得には結局 1 件ごとの stat が要り、せっかく無くした
/// NAS 往復を復活させてしまう。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    /// 絶対パス。read_scanned_file にはこの値をそのまま渡す。
    pub path: String,
    /// root からの相対パス。区切りは OS に依らず "/" に統一する。
    pub relative_path: String,
    /// ファイル名（パスの最後の要素）。
    pub name: String,
}

/// scan_directory の戻り値。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    /// SCAN_MAX_FILES に達して途中で打ち切った場合 true。
    pub truncated: bool,
    /// 対象外の拡張子だったため載せなかったファイルの内訳（".log" → 件数）。
    /// 隠しファイル・隠しフォルダの中身は数えない（降りていないので数えられない）。
    pub skipped_by_ext: HashMap<String, usize>,
    /// cancel_scan で中止された場合 true。true のとき files は空で、
    /// 許可リストへの追加も行わない。
    pub cancelled: bool,
}

/// intake-scan-progress イベントの payload。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgressPayload {
    /// どの走査の進捗かを識別する ID（TS 側が走査ごとに crypto.randomUUID() で生成）。
    /// IntakeReceptacle は NoteListView・AssetGalleryView の空状態・IntakeModal の
    /// 3 か所に同時にマウントされうる（モーダルはオーバーレイ）ため、これが無いと
    /// 並行して走っている走査の件数が互いの受け皿に混ざってしまう。
    scan_id: String,
    found: usize,
    /// 対象外の拡張子だったため読み飛ばしたファイルの数。ログだけが大量に並ぶ
    /// フォルダでは found も folders も動かないので、これで進んでいることを伝える。
    skipped: usize,
    /// 見つけた（キューに積んだ）フォルダの数。ファイルが 1 件も無い深い
    /// ツリー（NAS のバックアップ等）でも進捗が動いて見えるように、found とは
    /// 別に持つ。
    folders: usize,
}

/// scan_directory の中止フラグを走査 ID ごとに持つ表。
///
/// 以前はプロセス全体で 1 つの AtomicBool だった。IntakeReceptacle は
/// NoteListView・AssetGalleryView の空状態・IntakeModal の 3 か所に同時に
/// マウントされうる（モーダルはオーバーレイなので下の受け皿と同時に存在する）ため、
/// 単一フラグでは片方の「停止」がもう片方の走査も巻き込んで止め、逆に片方の
/// 停止直後にもう片方が走査を始めると開始時の初期化で停止要求が消えてしまう。
/// 走査 ID ごとに独立したフラグを持つことでこれを避ける。
///
/// scan_directory（begin）と cancel_scan（cancel）は別々の invoke で、どちらが
/// 先に Rust 側へ届くかの保証が無い。cancel が begin より先に届く場合に備えて、
/// cancel は該当エントリが無ければ「true で」新規登録し、begin は既存エントリが
/// あればそれをそのまま使う（＝先着の中止要求を失わない）。
#[derive(Default)]
struct ScanCancelState(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// ScanCancelState の表に残せる走査 ID の上限。
///
/// 走査が正常に終われば scan_directory_sync が必ず end() を呼んで表から
/// 取り除くが、scan_directory が一度も呼ばれないまま cancel_scan だけが届いた
/// 場合（begin より cancel が先着したケースの取りこぼし対策）は孤児エントリが
/// 残る。1 プロセスで同時に開いていられる受け皿は高々数個（NoteListView /
/// AssetGalleryView / IntakeModal）なので、64 あれば通常運用で頭を打つことは
/// ない。上限に達したら、進行中でない（フラグが true = 既に中止された）
/// エントリから間引く。進行中（false のまま）のエントリを消すと、実際に
/// 動いている走査の中止判定ができなくなってしまうため残す。
const SCAN_CANCEL_TABLE_MAX: usize = 64;

impl ScanCancelState {
    /// 走査 id を開始する。表に既にエントリがあればそのフラグをそのまま返す
    /// （begin より先に cancel(id) が届いていた場合、その中止要求を活かすため）。
    /// 無ければ false で新規登録する。
    fn begin(&self, id: &str) -> Arc<AtomicBool> {
        let mut guard = self.0.lock().unwrap();
        if let Some(flag) = guard.get(id) {
            return flag.clone();
        }
        Self::evict_if_full(&mut guard);
        let flag = Arc::new(AtomicBool::new(false));
        guard.insert(id.to_string(), flag.clone());
        flag
    }

    /// 走査 id に中止を要求する。表にエントリがあれば true にする。無ければ
    /// true で新規登録する（scan_directory より cancel_scan が先に届いた場合、
    /// 後から呼ばれる begin(id) がこのエントリをそのまま使い、中止済み状態から
    /// 走査が始まる）。
    fn cancel(&self, id: &str) {
        let mut guard = self.0.lock().unwrap();
        if let Some(flag) = guard.get(id) {
            flag.store(true, Ordering::Relaxed);
        } else {
            Self::evict_if_full(&mut guard);
            guard.insert(id.to_string(), Arc::new(AtomicBool::new(true)));
        }
    }

    /// 走査 id の終了を表から取り除く。
    fn end(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }

    /// 表のエントリ数が上限に達していたら、中止済み（true）のエントリを
    /// 間引いて空きを作る。呼び出し側はロックを取得済みであること。
    fn evict_if_full(guard: &mut HashMap<String, Arc<AtomicBool>>) {
        if guard.len() < SCAN_CANCEL_TABLE_MAX {
            return;
        }
        guard.retain(|_, flag| !flag.load(Ordering::Relaxed));
    }
}

/// スコープを抜けるとき（正常終了・`?` による早期リターンのどちらでも）に
/// 一度だけクロージャを実行するガード。scan_directory_sync の全ての終了経路で
/// ScanCancelState::end を漏らさず呼ぶために使う（Rust に try/finally が無いため）。
struct DeferEnd<F: FnMut()>(F);

impl<F: FnMut()> Drop for DeferEnd<F> {
    fn drop(&mut self) {
        (self.0)();
    }
}

/// walk_intake_directory の途中経過。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ScanProgress {
    found: usize,
    folders: usize,
    skipped: usize,
}

/// walk_intake_directory が拾うファイルの条件。
#[derive(Debug, Default)]
struct ScanFilter {
    /// 取り込み対象の拡張子（小文字・ドット無し。例: "md", "png"）。
    /// None なら拡張子で絞らない（テストと NAS ベンチ用）。
    ///
    /// 表の実体は TS 側（classify.ts の INTAKE_EXTENSIONS）にあり、scan_directory の
    /// 引数で受け取る。Rust に同じ表を持つと、対応形式を増やしたときに片方だけ
    /// 更新され、ネイティブ走査だけが黙ってファイルを落とす事故になるため。
    extensions: Option<HashSet<String>>,
}

impl ScanFilter {
    fn with_extensions(extensions: &[String]) -> Self {
        Self {
            extensions: Some(
                extensions
                    .iter()
                    .map(|e| e.trim_start_matches('.').to_lowercase())
                    .filter(|e| !e.is_empty())
                    .collect(),
            ),
        }
    }

    /// ファイル名の拡張子（小文字・ドット無し）。先頭のドットは拡張子とみなさない。
    fn extension_of(name: &str) -> Option<String> {
        match name.rfind('.') {
            Some(i) if i > 0 && i + 1 < name.len() => Some(name[i + 1..].to_lowercase()),
            _ => None,
        }
    }

    fn accepts(&self, name: &str) -> bool {
        match &self.extensions {
            None => true,
            Some(set) => Self::extension_of(name).is_some_and(|ext| set.contains(&ext)),
        }
    }
}

/// 隠しファイル・隠しフォルダか（.git / .obsidian / .DS_Store 等）。
/// TS 側 classify.ts の isHiddenPath と同じ規則（名前がドットで始まる）。
fn is_hidden_name(name: &std::ffi::OsStr) -> bool {
    name.as_encoded_bytes().first() == Some(&b'.')
}

/// walk_intake_directory の結果。
#[derive(Debug)]
struct WalkOutcome {
    files: Vec<ScannedFile>,
    truncated: bool,
    skipped_by_ext: HashMap<String, usize>,
    /// cancel が立って途中で打ち切った場合 true。true のとき files は空。
    cancelled: bool,
}

/// root 配下を再帰的に走査してファイル一覧を集める（同期・純粋関数。Tauri に依存しない
/// のでユニットテストしやすい）。ディレクトリは対象外、シンボリックリンクは辿らない。
/// 読めないディレクトリ・読めないエントリは読み飛ばし、全体は失敗させない。
///
/// 幅優先（VecDeque）で辿る。深さ優先だと read_dir の列挙順（ファイルシステム依存で
/// 並び順の保証がない）に従って 1 つのサブフォルダへ潜り込むため、そこだけで
/// max_files を使い切ると同じ階層に並んだ他のフォルダが 1 件も拾われないまま終わる。
/// 幅優先なら浅い階層から均等に埋まるので、深いサブツリーが兄弟フォルダを飢えさせる
/// ことはない。ただし 1 つのフォルダが直下に max_files を超える数のファイルを持つ
/// 場合は、そのフォルダの途中で打ち切られ、同じ階層の後続フォルダは拾われない
/// （幅優先が保証するのは「兄弟フォルダ間」の公平性であり、1 フォルダ内の公平性までは
/// 保証しない）。
///
/// root は呼び出し側で canonicalize 済みであることを前提とする（シンボリックリンク
/// 解決後の絶対パスに揃えるのは呼び出し側の責務。この関数自身はエントリごとの
/// canonicalize/stat を一切行わない）。
///
/// 隠しファイルは拾わず、隠しフォルダ（.git 等）には降りない。filter に合わない
/// 拡張子のファイルは files にも許可リストにも載せず、skipped_by_ext に件数だけ残す。
/// max_files は filter を通ったファイルだけを数える。
fn walk_intake_directory(
    root: &Path,
    filter: &ScanFilter,
    max_files: usize,
    cancel: &AtomicBool,
    progress_interval: Duration,
    mut on_progress: impl FnMut(ScanProgress),
) -> WalkOutcome {
    let mut files: Vec<ScannedFile> = Vec::new();
    let mut folders: usize = 0;
    let mut skipped: usize = 0;
    let mut skipped_by_ext: HashMap<String, usize> = HashMap::new();
    let mut truncated = false;
    let mut queue: VecDeque<PathBuf> = VecDeque::from([root.to_path_buf()]);
    // 前回 on_progress を呼んでからの経過時間をここで測る。
    let mut last_progress = Instant::now();

    // エントリを 1 件処理するたびに（ファイルかフォルダかに関係なく）呼ぶ。
    // ファイル追加の直後だけに限定すると、NAS の深いバックアップツリーのように
    // フォルダばかりが続きファイルが 1 件も見つからない区間で on_progress が
    // 一度も呼ばれず、画面が固まって見えてしまう。
    macro_rules! maybe_report_progress {
        () => {
            if last_progress.elapsed() >= progress_interval {
                on_progress(ScanProgress {
                    found: files.len(),
                    folders,
                    skipped,
                });
                last_progress = Instant::now();
            }
        };
    }

    'walk: while let Some(dir) = queue.pop_front() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            // 権限エラー等で読めないディレクトリは読み飛ばす（全体を失敗させない）。
            Err(_) => continue,
        };
        for entry in entries {
            // 中止要求はエントリごとに確認する。数万件規模の走査でも
            // 「押してからすぐ止まる」体感にするため。
            if cancel.load(Ordering::Relaxed) {
                return WalkOutcome {
                    files: Vec::new(),
                    truncated: false,
                    skipped_by_ext: HashMap::new(),
                    cancelled: true,
                };
            }
            let Ok(entry) = entry else { continue };
            // file_type() は readdir の d_type を使う（macOS は DT_UNKNOWN のときだけ
            // 1 回 fstatat にフォールバック、Windows は FindNextFileW の結果を保持済み）。
            // symlink_metadata / metadata は一切呼ばない — NAS 越しではこれがエントリごとの
            // 追加往復になり、走査時間の大半を占めていた（モジュール冒頭コメント参照）。
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if is_hidden_name(&entry.file_name()) {
                // 隠しフォルダには降りず、隠しファイルも拾わない。.git の中身だけで
                // 数万件になることがあり、中まで辿るのは NAS 越しでは丸ごと無駄な往復になる。
                maybe_report_progress!();
                continue;
            }
            let path = entry.path();
            if file_type.is_symlink() {
                // シンボリックリンクはループの恐れがあるため対象外にする（辿らない）。
                maybe_report_progress!();
                continue;
            }
            if file_type.is_dir() {
                queue.push_back(path);
                folders += 1;
                maybe_report_progress!();
                continue;
            }
            if !file_type.is_file() {
                // FIFO・ソケット等は対象外。
                maybe_report_progress!();
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !filter.accepts(&name) {
                // 対象外の拡張子は許可リストにも載せない（読める範囲を取り込み対象に限る）。
                skipped += 1;
                let key = match ScanFilter::extension_of(&name) {
                    Some(ext) => format!(".{ext}"),
                    None => NO_EXT_KEY.to_string(),
                };
                let key = if skipped_by_ext.contains_key(&key)
                    || skipped_by_ext.len() < SCAN_SKIPPED_EXT_KINDS_MAX
                {
                    key
                } else {
                    OTHER_EXT_KEY.to_string()
                };
                *skipped_by_ext.entry(key).or_insert(0) += 1;
                maybe_report_progress!();
                continue;
            }
            if files.len() >= max_files {
                truncated = true;
                break 'walk;
            }
            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            files.push(ScannedFile {
                path: path.to_string_lossy().to_string(),
                relative_path,
                name,
            });

            maybe_report_progress!();
        }
    }

    WalkOutcome {
        files,
        truncated,
        skipped_by_ext,
        cancelled: false,
    }
}

/// 走査の root のどの階層にもドット始まりの名前が無いこと。取り込みの利用者が選ぶのは
/// 普通のフォルダで、隠しフォルダ配下（設定・鍵・トークンの置き場）は対象にしない。
fn check_scan_root_not_hidden(root: &Path) -> Result<(), String> {
    let hidden = root.components().any(|c| match c {
        std::path::Component::Normal(n) => n.to_str().is_some_and(|s| s.starts_with('.')),
        _ => false,
    });
    if hidden {
        Err(format!(
            "隠しフォルダの中は取り込みの対象にできません: {}",
            root.display()
        ))
    } else {
        Ok(())
    }
}

/// 走査の root が、~/Library の中の機密を置く場所（鍵・メール・設定など）でないこと。
/// ホーム直下・ドライブ直下・クラウド同期フォルダ（~/Library/CloudStorage・
/// ~/Library/Mobile Documents）は利用者が普通に選ぶ作業フォルダなので断らない。
fn check_scan_root_not_too_broad(root: &Path) -> Result<(), String> {
    check_scan_root_not_too_broad_with(root, home_dir_canonical().as_deref())
}

/// ~/Library 直下で、取り込みの対象にしない機密フォルダ
const SENSITIVE_LIBRARY_DIRS: &[&str] = &[
    "Keychains",
    "Application Support",
    "Preferences",
    "Mail",
    "Messages",
    "Safari",
    "Cookies",
    "Accounts",
    "Containers",
    "Group Containers",
];

/// ホーム直下の AppData で、取り込みの対象にしない場所（Windows の設定・トークンの置き場）
const SENSITIVE_APPDATA_DIRS: &[&str] = &["Roaming", "Local", "LocalLow"];

/// root が <home>/AppData（とその Roaming・Local・LocalLow）の中か。
/// パスの成分で見るので cfg で分けない。Windows の名前は大文字小文字を区別しないので無視して比べる。
fn is_sensitive_appdata(root: &Path, home: &Path) -> bool {
    let Ok(rel) = root.strip_prefix(home) else {
        return false;
    };
    let mut comps = rel.components().filter_map(|c| match c {
        std::path::Component::Normal(n) => n.to_str(),
        _ => None,
    });
    match comps.next() {
        Some(first) if first.eq_ignore_ascii_case("AppData") => match comps.next() {
            // AppData 自体は配下の 3 か所をすべて含むので断る
            None => true,
            Some(second) => SENSITIVE_APPDATA_DIRS
                .iter()
                .any(|d| second.eq_ignore_ascii_case(d)),
        },
        _ => false,
    }
}

fn check_scan_root_not_too_broad_with(root: &Path, home: Option<&Path>) -> Result<(), String> {
    let sensitive = home.is_some_and(|h| {
        let lib = h.join("Library");
        SENSITIVE_LIBRARY_DIRS.iter().any(|d| root.starts_with(lib.join(d)))
            || is_sensitive_appdata(root, h)
    });
    if sensitive {
        Err(format!("このフォルダは取り込みの対象にできません: {}", root.display()))
    } else {
        Ok(())
    }
}

fn home_dir_canonical() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .and_then(|p| p.canonicalize().ok())
}

/// walk_intake_directory を Tauri 層につなぐ同期本体。canonicalize・進捗 emit・
/// 許可リスト更新を担う。
fn scan_directory_sync(
    root: String,
    scan_id: String,
    extensions: Vec<String>,
    app: &tauri::AppHandle,
) -> Result<ScanResult, String> {
    // 走査 ID ごとの中止フラグを canonicalize より前に登録する。
    // IntakeReceptacle はフォルダ選択直後に「停止」ボタンを表示するため、
    // canonicalize（NAS 越しだと実測 25〜226ms かかる）の最中に押された停止を
    // 取りこぼさないようにするため。begin は先着の中止要求（cancel_scan が
    // scan_directory より先に届いた場合）を引き継ぐ。
    let cancel_state = app.state::<ScanCancelState>();
    let cancel_flag = cancel_state.begin(&scan_id);

    // この関数のどの終了経路（canonicalize 失敗による早期リターンを含む）でも
    // end(scan_id) を漏らさず呼ぶ。さもないと表にエントリが残り続ける。
    let app_for_end = app.clone();
    let scan_id_for_end = scan_id.clone();
    let _end_guard = DeferEnd(move || {
        app_for_end.state::<ScanCancelState>().end(&scan_id_for_end);
    });

    // canonicalize してシンボリックリンク解決後の絶対パスに揃える。呼ぶのは
    // 走査の最初の 1 回だけ（walk_intake_directory 内ではエントリごとの
    // stat/canonicalize を一切行わない）。許可リスト（read_scanned_file 側）の
    // 照合基準もこの絶対パスに合わせる。
    let root_canonical = PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| format!("フォルダを開けません: {e}"))?;
    // 隠しフォルダ（~/.ssh・~/.config/gh など）の中は走査も許可リストへの登録もしない。
    // 呼び出し側が root と拡張子を自由に渡せるため、これが無いと設定・鍵のフォルダを
    // 「取り込み対象」として読み出せてしまう
    check_scan_root_not_hidden(&PathBuf::from(&root))?;
    check_scan_root_not_hidden(&root_canonical)?;
    check_scan_root_not_too_broad(&root_canonical)?;

    let app_for_progress = app.clone();
    let scan_id_for_progress = scan_id.clone();
    let filter = ScanFilter::with_extensions(&extensions);
    let outcome = walk_intake_directory(
        &root_canonical,
        &filter,
        SCAN_MAX_FILES,
        &cancel_flag,
        SCAN_PROGRESS_INTERVAL,
        move |progress| {
            let _ = app_for_progress.emit(
                "intake-scan-progress",
                ScanProgressPayload {
                    scan_id: scan_id_for_progress.clone(),
                    found: progress.found,
                    folders: progress.folders,
                    skipped: progress.skipped,
                },
            );
        },
    );

    if outcome.cancelled {
        return Ok(ScanResult {
            files: Vec::new(),
            truncated: false,
            skipped_by_ext: HashMap::new(),
            cancelled: true,
        });
    }

    // 今回の走査結果を許可リストに足す。入れ替えではなく追加なのは、
    // 走査のあと実際にファイルを読むのは取り込みループが 1 件ずつ進んだときで、
    // 取り込みはモーダルを閉じても裏で走り続けるため（set_background_work_active）。
    // その最中に別のフォルダを選び直した時点で前回分を捨てると、まだ読んでいない
    // ファイルが軒並み「許可されていないパス」で失敗する。
    // 際限なく溜めないよう、上限を超えたら一度空にしてから入れ直す。
    let allowed: HashSet<PathBuf> = outcome.files.iter().map(|f| PathBuf::from(&f.path)).collect();
    let state = app.state::<ScanAllowlistState>();
    let mut guard = state.0.lock().unwrap();
    if guard.len() + allowed.len() > SCAN_ALLOWLIST_MAX {
        guard.clear();
    }
    guard.extend(allowed);
    drop(guard);

    Ok(ScanResult {
        files: outcome.files,
        truncated: outcome.truncated,
        skipped_by_ext: outcome.skipped_by_ext,
        cancelled: false,
    })
}

/// read_scanned_file が読み込みを許可する絶対パスの集合。
///
/// 「フォルダを走査して選ばせる」機能上、read 側が任意パスを受け付けると
/// 実質的な任意ファイル読み込み口になってしまう。scan_directory が実際に
/// 見つけたパスだけを許可リストに載せ、read_scanned_file はそこに載っている
/// パスしか読まない。新しい scan_directory が呼ばれても前回分は残す（追加）。
/// 取り込みは走査のあと 1 件ずつ遅延読み込みしながら裏で進むので、
/// フォルダを選び直した時点で前回分を捨てると未読ファイルが読めなくなる。
/// 溜まりすぎを防ぐため SCAN_ALLOWLIST_MAX で頭を打つ（超えたら一度空にする。
/// 上限級のフォルダを立て続けに選び直すと、そこで前回分の未読が読めなくなるが、
/// 取り込みが裏で走っている最中に何度も選び直す前提までは面倒を見ない）。
#[derive(Default)]
struct ScanAllowlistState(Mutex<HashSet<PathBuf>>);

/// 任意フォルダを再帰列挙する（webkitdirectory 代替）。
/// NAS 越しだと I/O 待ちが支配的で数秒〜数十秒かかりうるため、save_media_file 等と
/// 同様に spawn_blocking でメインスレッドから逃がす。
#[tauri::command]
async fn scan_directory(
    app: tauri::AppHandle,
    root: String,
    scan_id: String,
    extensions: Vec<String>,
) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_sync(root, scan_id, extensions, &app)
    })
        .await
        .map_err(|e| format!("フォルダ走査タスク失敗: {e}"))?
}

/// scan_directory の走査を中止する。ここでは該当 scan_id の中止フラグを
/// 立てるだけで、実際の打ち切りは walk_intake_directory 側がエントリごとに
/// 確認して行う。
#[tauri::command]
fn cancel_scan(app: tauri::AppHandle, scan_id: String) {
    let state = app.state::<ScanCancelState>();
    state.cancel(&scan_id);
}

/// path が許可リスト guard に完全一致で含まれるかどうか。read_scanned_file から
/// 切り出したもの（単体テストで境界条件を直接検証するため）。
fn is_path_allowlisted(guard: &HashSet<PathBuf>, path: &Path) -> bool {
    guard.contains(path)
}

/// 許可リストにあるパスをシンボリックリンクを辿らずに開く。
///
/// scan_directory が許可リストに積んだのは走査時点の絶対パスだが、その後
/// ファイルシステム側で最後の要素がシンボリックリンクへ差し替えられるレース
/// （TOCTOU）が原理上あり得る。Unix では open(2) に O_NOFOLLOW を付け、最後の
/// 要素がリンクなら ELOOP で失敗させることでこれを防ぐ。Windows には同等の
/// フラグが無いが、こちらは許可リストとの完全一致照合（canonicalize しない）が
/// 主たる防御線になる: 許可リストの実体は scan_directory が実際に見つけた
/// 通常ファイルの絶対パスそのものなので、'..' を含む細工パスはもちろん、
/// 一致しない文字列はそもそも許可リストに乗らない。
#[cfg(unix)]
fn open_allowlisted_file(path: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(not(unix))]
fn open_allowlisted_file(path: &Path) -> std::io::Result<fs::File> {
    fs::File::open(path)
}

/// scan_directory が登録した許可リストに載っているパスのみ読み込んで返す。
/// 登録外のパス・`..` を含む相対解決などで許可リストの実体と一致しないパスは拒否する。
///
/// 照合は canonicalize せず、渡された文字列をそのまま許可リストと完全一致で比べる
/// （scan_directory 側も走査開始の 1 回しか canonicalize しない方針に合わせた）。
/// canonicalize → read という 2 段階を踏むと、その間にファイルシステム側で対象が
/// 差し替えられる競合の窓が生まれる上、NAS 越しでは canonicalize（realpath）自体が
/// 実測 1 ファイルあたり 25〜226ms かかり、大量ファイルの取り込みで無視できない
/// オーバーヘッドになっていた。
///
/// 中身は Base64 ではなく `tauri::ipc::Response` の生バイトで返す。
/// read_media_file は Base64 を返す既存流儀だが、あちらが扱うのは自前の
/// メディアフォルダの中身なのに対し、こちらはユーザーが選んだフォルダを
/// 丸ごと列挙した結果を読む。数百 MB の動画が混ざる確率が段違いに高く、
/// Base64 だと Rust 側で元データ＋約 1.33 倍の文字列、WebView 側でも
/// デコード前後のコピーが同時に乗る（サムネイル 60 枚で WebView が
/// +700MB になった実測が read_media_file 側のコメントに残っている）。
/// 生バイトならその往復が丸ごと消える。
#[tauri::command]
async fn read_scanned_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let candidate = PathBuf::from(&path);
        let allowed = {
            let state = app.state::<ScanAllowlistState>();
            let guard = state.0.lock().unwrap();
            is_path_allowlisted(&guard, &candidate)
        };
        if !allowed {
            return Err(
                "許可されていないパスです（先に scan_directory で走査してください）"
                    .to_string(),
            );
        }
        let mut file = open_allowlisted_file(&candidate)
            .map_err(|e| format!("ファイルを開けません: {e}"))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("ファイル読み取り失敗: {e}"))?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| format!("ファイル読み取りタスク失敗: {e}"))?
}

/// "sha256:<64 hex>" のチェック。
fn validate_hash(hash: &str) -> Result<(), String> {
    let prefix = "sha256:";
    if !hash.starts_with(prefix) {
        return Err(format!("hash は sha256: で始まる必要があります: {hash}"));
    }
    let hex_part = &hash[prefix.len()..];
    if hex_part.len() != 64 {
        return Err(format!("hash の hex 長さが不正: {hash}"));
    }
    if !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("hash に hex 以外の文字: {hash}"));
    }
    Ok(())
}

/// shared root が空文字でないことだけチェック（実体のディレクトリ作成は書き込み側のコマンドで行う）。
fn validate_root(root: &str) -> Result<PathBuf, String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("shared root が未指定".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

/// shared root に到達できることを確かめる（NAS 未マウント・パス違いの切り分け）。
/// 読み取り系コマンドは root の下にフォルダを作らないので、root 自体が無いときは
/// 「空」ではなく「到達できない」と返す。黙って空の Library を見せると、共有が
/// 消えたのかマウントが外れたのか利用者に区別が付かない。
fn require_root_reachable(root: &str) -> Result<PathBuf, String> {
    let root_path = validate_root(root)?;
    match fs::metadata(&root_path) {
        Ok(m) if m.is_dir() => Ok(root_path),
        Ok(_) => Err(format!(
            "共有フォルダがフォルダではありません: {}",
            root_path.display()
        )),
        Err(e) => Err(format!(
            "共有フォルダに到達できません（マウントされているか・パスが同じか確認してください）: {} ({e})",
            root_path.display()
        )),
    }
}

/// ディレクトリを作る。失敗したらどこで何が拒否されたかが分かる文言にする。
/// NAS では「読めるが書けない」メンバーが普通にいるので、権限エラーはその旨を添える。
fn create_dir_for_write(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!(
                "ディレクトリ作成失敗（この共有フォルダへの書き込み権限がありません。読むだけなら設定は不要です）: {} ({e})",
                dir.display()
            )
        } else {
            format!("ディレクトリ作成失敗: {} ({e})", dir.display())
        }
    })
}

/// 書き込み・削除の対象がシンボリックリンクなら断る。共有フォルダは同期ツールや他人が
/// 書ける場所なので、`<hh>/<hash>` や `<id>.json` に置かれたリンクを辿ると、共有フォルダの
/// 外（まだ無いファイルを含む）へ書いてしまう。存在しないパスは問題なし。
fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => Err(format!(
            "シンボリックリンクには書き込めません: {}",
            path.display()
        )),
        _ => Ok(()),
    }
}

/// 書き込み先のフォルダ（`<root>/notes` や `<blob-root>/<hh>`）が、正規化したうえで共有フォルダの
/// 配下にあることを確かめる。フォルダ自体が外へのリンクに差し替えられた場合を断る。
/// root 自身がリンク（`~/Shared -> /Volumes/NAS/...`）なのは正当なので、root も正規化して比べる。
///
/// canonicalize は NAS 越しだと 1 回 25〜226ms かかり、書き込み・削除のたびに 2〜4 回走る。
/// そのため (root, dir) が「通った」結果だけを 30 秒覚えて使い回す。断った結果は覚えない。
fn ensure_dir_within_root(root: &str, dir: &Path) -> Result<(), String> {
    if dir_check_cache_hit(root, dir) {
        // 当たりでも dir 自体が symlink に差し替わっていないかだけは毎回 1 回確かめる
        // （symlink_metadata は canonicalize と違い NAS 越しでも軽い）。差し替わっていたら捨てて通常検査へ
        match fs::symlink_metadata(dir) {
            Ok(m) if !m.file_type().is_symlink() && m.is_dir() => return Ok(()),
            _ => dir_check_cache_forget(root, dir),
        }
    }
    ensure_dir_within_root_uncached(root, dir)?;
    dir_check_cache_store(root, dir);
    Ok(())
}

/// ensure_dir_within_root の検査結果（通ったものだけ）を覚えておく時間
const DIR_CHECK_CACHE_TTL: Duration = Duration::from_secs(30);
/// 覚える件数の上限（超えたら期限切れを捨て、それでも多ければ全部捨てる）
const DIR_CHECK_CACHE_MAX: usize = 512;

fn dir_check_cache() -> &'static Mutex<HashMap<(String, PathBuf), Instant>> {
    static CACHE: std::sync::OnceLock<Mutex<HashMap<(String, PathBuf), Instant>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn dir_check_cache_hit(root: &str, dir: &Path) -> bool {
    let guard = dir_check_cache().lock().unwrap();
    guard
        .get(&(root.to_string(), dir.to_path_buf()))
        .is_some_and(|t| t.elapsed() < DIR_CHECK_CACHE_TTL)
}

fn dir_check_cache_forget(root: &str, dir: &Path) {
    dir_check_cache()
        .lock()
        .unwrap()
        .remove(&(root.to_string(), dir.to_path_buf()));
}

fn dir_check_cache_store(root: &str, dir: &Path) {
    let mut guard = dir_check_cache().lock().unwrap();
    if guard.len() >= DIR_CHECK_CACHE_MAX {
        guard.retain(|_, t| t.elapsed() < DIR_CHECK_CACHE_TTL);
        if guard.len() >= DIR_CHECK_CACHE_MAX {
            guard.clear();
        }
    }
    guard.insert((root.to_string(), dir.to_path_buf()), Instant::now());
}

fn ensure_dir_within_root_uncached(root: &str, dir: &Path) -> Result<(), String> {
    let root_c = validate_root(root)?
        .canonicalize()
        .map_err(|e| format!("共有フォルダを開けません: {e}"))?;
    let dir_c = dir
        .canonicalize()
        .map_err(|e| format!("フォルダを開けません: {} ({e})", dir.display()))?;
    if dir_c.starts_with(&root_c) {
        Ok(())
    } else {
        Err(format!("共有フォルダの外には書き込めません: {}", dir.display()))
    }
}

/// `<root>/<entry_type>/` のパスを返す（読み取り用。作らない）。
/// 読むだけのメンバーは共有フォルダに書けないのが普通なので、読む経路で
/// `create_dir_all` を呼ぶと、まだ誰も共有していない種類のフォルダで
/// Permission denied になり Library 全体が開けなくなる。
fn shared_type_dir_ro(root: &str, entry_type: &str) -> Result<PathBuf, String> {
    validate_entry_type(entry_type)?;
    let root_path = require_root_reachable(root)?;
    Ok(root_path.join(entry_type))
}

/// `<root>/<entry_type>/` のパスを返し、必要なら作成する（書き込み用）。
fn shared_type_dir(root: &str, entry_type: &str) -> Result<PathBuf, String> {
    let dir = shared_type_dir_ro(root, entry_type)?;
    create_dir_for_write(&dir)?;
    Ok(dir)
}

/// `<root>/_meta/tombstones/` のパスを返し、必要なら作成する。
fn shared_tombstone_dir(root: &str) -> Result<PathBuf, String> {
    let root_path = require_root_reachable(root)?;
    // _meta が外へのリンクなら、リンク先にフォルダを作る前に断る
    let meta_dir = root_path.join("_meta");
    reject_symlink(&meta_dir)?;
    let dir = meta_dir.join("tombstones");
    create_dir_for_write(&dir)?;
    Ok(dir)
}

/// `<blob-root>/<hh>/` のパスを返す（読み取り用。作らない）。
fn shared_blob_dir_ro(root: &str, hash: &str) -> Result<PathBuf, String> {
    validate_hash(hash)?;
    let root_path = require_root_reachable(root)?;
    let hex_part = &hash["sha256:".len()..];
    let prefix = &hex_part[..2];
    Ok(root_path.join(prefix))
}

/// 共有フォルダの中に自動で持つ置き場の名前（`<共有フォルダ>/_blobs`）。TS 側の
/// `SHARED_BLOBS_DIR_NAME`（src/lib/storage/shared/config.ts）と揃える。
const SHARED_BLOBS_DIR_NAME: &str = "_blobs";

/// 置き場が「共有フォルダの中の `_blobs`」で、まだ無いときだけ作る（書き込み用）。
/// 親（共有フォルダ）が見えていることが条件 — マウントが外れているときに、手元のディスクへ
/// 置き場を作ってしまわないため。利用者が選んだ別の場所の置き場はこれまでどおり作らない
/// （名前が `_blobs` でなければ何もしない）。
fn ensure_inside_blob_root(root: &str) -> Result<(), String> {
    let path = validate_root(root)?;
    if path.exists() {
        return Ok(());
    }
    if path.file_name().and_then(|n| n.to_str()) != Some(SHARED_BLOBS_DIR_NAME) {
        return Ok(());
    }
    match path.parent() {
        Some(parent) if parent.is_dir() => {
            fs::create_dir(&path).map_err(|e| format!("置き場の作成に失敗: {} ({e})", path.display()))
        }
        _ => Ok(()),
    }
}

/// `<blob-root>/<hh>/` のパスを返し、必要なら作成する（書き込み用）。
fn shared_blob_dir(root: &str, hash: &str) -> Result<PathBuf, String> {
    ensure_inside_blob_root(root)?;
    let dir = shared_blob_dir_ro(root, hash)?;
    create_dir_for_write(&dir)?;
    Ok(dir)
}

/// 指定 entry_type の全エントリ JSON 文字列を返す（list 用）。
/// メタデータ単体ではなく `{entry, body_base64}` をそのまま返し、TS 側で必要な部分だけ使う。
#[tauri::command]
fn shared_list(root: String, entry_type: String) -> Result<Vec<String>, String> {
    let dir = shared_type_dir_ro(&root, &entry_type)?;
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out), // ディレクトリが空 / 未作成は空リスト
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("エントリ読み取り失敗: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // ファイル名（拡張子除く）が uuidv7 形式でなければスキップ（誤って混入したファイル対策）
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if validate_id(stem).is_err() {
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|e| format!("ファイル読み取り失敗: {e}"))?;
        // 中身の entry.id がファイル名（stem）と違うものは、別の entry を装ったファイルなので返さない。
        // 壊れた JSON も一覧に出さない（TS 側でも読めずに捨てられるもの）
        let id_matches = serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|v| v.get("entry")?.get("id")?.as_str().map(|s| s == stem))
            .unwrap_or(false);
        if !id_matches {
            continue;
        }
        out.push(content);
    }
    Ok(out)
}

#[tauri::command]
fn shared_read(root: String, entry_type: String, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = shared_type_dir_ro(&root, &entry_type)?;
    let path = dir.join(format!("{id}.json"));
    fs::read_to_string(&path).map_err(|e| format!("ファイル読み取り失敗: {e}"))
}

/// 既存ファイルの author email を読み取って caller_email と比較する。
/// 既存ファイルがなければ何もしない（最初の Share）。
/// 一致しなければエラー — author-owned 強制の Rust 側 defense in depth。
fn assert_existing_author(
    path: &PathBuf,
    caller_email: &Option<String>,
) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("既存ファイル読み取り失敗: {e}"))?;
    // JSON を完全パースせず、author.email だけ抜き出す（serde_json::Value で十分）
    let v: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("既存ファイル JSON パース失敗: {e}"))?;
    let existing_email = v
        .get("entry")
        .and_then(|e| e.get("author"))
        .and_then(|a| a.get("email"))
        .and_then(|s| s.as_str())
        .unwrap_or("");
    let caller = caller_email.as_deref().unwrap_or("");
    if existing_email != caller {
        return Err(format!(
            "Read-only: shared entry author is {existing_email}, not {caller}. Fork it instead."
        ));
    }
    Ok(())
}

/// 「読んだ版のあとに先に更新されていた」ときのエラーの接頭辞。後ろに今の版の hash が付く
/// （ファイルが無くなっていたときは空）。TS 側の SHARED_CONFLICT_PREFIX と揃える
const SHARED_CONFLICT_PREFIX: &str = "SHARED_CONFLICT";

/// この端末の中で、版の確認と書き込みの間に別の書き込みを割り込ませないための鍵。
/// 別の端末との競合は防げない（同期フォルダにはファイルの鍵が無い）
static SHARED_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// expected_hash が指定されていれば、今の版の hash と同じかを確かめる
fn assert_expected_hash(path: &Path, expected_hash: &Option<String>) -> Result<(), String> {
    let Some(expected) = expected_hash else { return Ok(()) };
    let current = fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("entry")?.get("hash")?.as_str().map(str::to_string))
        .unwrap_or_default();
    if &current != expected {
        return Err(format!("{SHARED_CONFLICT_PREFIX}:{current}"));
    }
    Ok(())
}

/// 共有の本体を、一時ファイルに書いてから rename で置き換える。
/// 途中で落ちても元のファイルは壊れず、読み手に書きかけの状態を見せない
fn write_shared_entry_file(path: &Path, content: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("ファイル書き込み失敗: {e}")
    })
}

#[tauri::command]
fn shared_write(
    root: String,
    entry_type: String,
    id: String,
    content: String,
    author_email: Option<String>,
    expected_hash: Option<String>,
) -> Result<(), String> {
    validate_id(&id)?;
    let dir = shared_type_dir(&root, &entry_type)?;
    ensure_dir_within_root(&root, &dir)?;
    let path = dir.join(format!("{id}.json"));
    reject_symlink(&path)?;
    let _guard = SHARED_WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    assert_existing_author(&path, &author_email)?;
    assert_expected_hash(&path, &expected_hash)?;
    write_shared_entry_file(&path, &content)
}

/// 本体ファイルを削除し、tombstone JSON を `_meta/tombstones/<id>.json` に書き込む。
/// 完全削除はせず、tombstone を残すことで誤共有のリカバリ履歴を保つ（v1 設計）。
#[tauri::command]
fn shared_delete(
    root: String,
    entry_type: String,
    id: String,
    tombstone_content: String,
    author_email: Option<String>,
) -> Result<(), String> {
    validate_id(&id)?;
    let body_dir = shared_type_dir(&root, &entry_type)?;
    ensure_dir_within_root(&root, &body_dir)?;
    let body_path = body_dir.join(format!("{id}.json"));
    reject_symlink(&body_path)?;
    assert_existing_author(&body_path, &author_email)?;
    if body_path.exists() {
        fs::remove_file(&body_path).map_err(|e| format!("本体ファイル削除失敗: {e}"))?;
    }
    let tomb_dir = shared_tombstone_dir(&root)?;
    ensure_dir_within_root(&root, &tomb_dir)?;
    let tomb_path = tomb_dir.join(format!("{id}.json"));
    reject_symlink(&tomb_path)?;
    fs::write(&tomb_path, tombstone_content)
        .map_err(|e| format!("tombstone 書き込み失敗: {e}"))?;
    // 共有をやめたら「読める写し」も消す。写しの掃除に失敗しても共有の削除は成功のまま
    if READABLE_ENTRY_TYPES.contains(&entry_type.as_str()) {
        let _ = readable_remove_all(&root, &entry_type, &id);
    }
    Ok(())
}

// ── 読める写し（<root>/readable/<entry_type>/）────────────────────────────
//
// 共有フォルダの中身（`<root>/notes/<id>.json`）は Graphium が無いと読めない。共有フォルダごとの
// スイッチが入っているとき、共有のたびに `<題>_<id12>.md` と `<題>_<id12>.prov.jsonld` を
// 同じ共有フォルダの中に置く。その id の写しは常に 1 組（題が変われば古い名前は消す）。
// ファイル名は Rust が決める（TS からは題と id だけを渡し、パスは渡さない）。

/// 写しを置く entry type（ノートだけ）。
const READABLE_ENTRY_TYPES: &[&str] = &["notes"];
/// 共有フォルダの中の写しの置き場の名前。
const READABLE_DIR_NAME: &str = "readable";
/// 写しのファイル名の題の部分の上限（UTF-8 バイト数）。
const READABLE_TITLE_MAX_BYTES: usize = 150;

/// 題をファイル名に使える形にする。
/// - パス区切り・Windows で使えない文字・制御文字は "_" に
/// - 双方向制御文字・ゼロ幅文字・見えない文字・異体字選択子・タグ文字・BOM は取り除く（見た目で名前を偽装されないように）
/// - 空白の連続は 1 つに、前後の空白・先頭のドット・末尾のドットと空白は取り除く
/// - UTF-8 で 150 バイト以内に、文字の境目で切る。空になったら "untitled"
fn sanitize_readable_title(title: &str) -> String {
    let mut out = String::new();
    let mut prev_space = false;
    for c in title.chars() {
        let c = match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{206F}'
            | '\u{061C}'
            | '\u{00AD}'
            | '\u{180E}'
            | '\u{115F}'
            | '\u{1160}'
            | '\u{3164}'
            | '\u{FE00}'..='\u{FE0F}'
            | '\u{FEFF}'
            | '\u{E0000}'..='\u{E007F}'
            | '\u{E0100}'..='\u{E01EF}' => continue,
            c => c,
        };
        if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    let trimmed = out
        .trim_start_matches(|c: char| c == '.' || c.is_whitespace())
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    let mut end = trimmed.len().min(READABLE_TITLE_MAX_BYTES);
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    let cut = trimmed[..end].trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if cut.is_empty() {
        "untitled".to_string()
    } else {
        cut.to_string()
    }
}

/// 共有 id（uuidv7）の末尾 12 桁。validate_id を通った id が前提（ASCII 36 文字）。
fn readable_id12(id: &str) -> &str {
    &id[id.len().saturating_sub(12)..]
}

/// 写しの置き場の中で、この id の写しを指す名前の末尾（`_<id12>.md` / `_<id12>.prov.jsonld`）。
fn readable_suffixes(id12: &str) -> [String; 2] {
    [format!("_{id12}.md"), format!("_{id12}.prov.jsonld")]
}

/// 写しの置き場 `<root>/readable/<entry_type>/` を返す（作らない）。
fn readable_dir_ro(root: &str, entry_type: &str) -> Result<PathBuf, String> {
    if !READABLE_ENTRY_TYPES.contains(&entry_type) {
        return Err(format!("読める写しに対応しない entry type: {entry_type}"));
    }
    let root_path = require_root_reachable(root)?;
    Ok(root_path.join(READABLE_DIR_NAME).join(entry_type))
}

/// md の前付けにこの共有 id が書かれているか（この id の写しかどうかの確認）。
/// 前付けは TS が `graphium_shared_id: "<id>"` と JSON 引用で書く。通常ファイルだけ読む。
fn readable_md_is_owned(path: &Path, id: &str) -> bool {
    use std::io::{BufRead, BufReader, Read};
    let Ok(f) = fs::File::open(path) else { return false };
    let want = format!("graphium_shared_id: \"{id}\"");
    // 前付けは先頭の数行。1 行が極端に長くても読み込みは 1 MiB までに抑える
    BufReader::new(f.take(1 << 20))
        .lines()
        .take(12)
        .map_while(Result::ok)
        .any(|l| l == want)
}

/// 同じファイルを指しているか。大文字小文字・Unicode 正規化を区別しない FS（APFS・NTFS・SMB）で、
/// 名前の文字列は違っても実体が同じ、というときに使う。
fn readable_same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let n = |p: &Path| p.file_name().map(|s| s.to_string_lossy().to_lowercase());
        n(a).is_some() && n(a) == n(b)
    }
}

/// 写しを書く。一時ファイルに書いてから rename で置く。
/// - 置き場に置かれたハードリンクを通して外のファイルを書き換えない（rename はリンク自体を置き換える）
/// - FIFO などの特殊ファイルを開いて固まらない
/// - 読み手に書きかけの状態を見せない
fn write_readable_file(path: &Path, content: &str) -> Result<(), String> {
    reject_symlink(path)?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    let fail = |e: &dyn std::fmt::Display| format!("写しの書き込み失敗: {} ({e})", path.display());
    // 前回の取り残しがあれば消す（無ければ何もしない）
    let _ = fs::remove_file(&tmp);
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| fail(&e))?;
    if let Err(e) = f.write_all(content.as_bytes()) {
        drop(f);
        let _ = fs::remove_file(&tmp);
        return Err(fail(&e));
    }
    drop(f);
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(fail(&e));
    }
    Ok(())
}

/// 置き場を 1 回だけ read_dir して、この id の写しのうち `keep` に無い名前を消す。
/// - NAS では 1 件ごとの stat が遅いので、read_dir の名前と file_type で判断する。フォルダは辿らない
/// - `keep` と実体が同じ名前（大文字小文字だけ違う題など）は消さない
/// - 名前の末尾 12 桁が同じだけの別の共有の写しを消さないよう、md は前付けの共有 id を確かめる。
///   prov は同じ名前の md がこの id のものであるときだけ消す
fn readable_cleanup(dir: &Path, id: &str, keep: &[String]) -> Result<(), String> {
    let suffixes = readable_suffixes(readable_id12(id));
    let entries = fs::read_dir(dir).map_err(|e| format!("写しの置き場を読めません: {e}"))?;
    // (名前, 通常ファイルか)
    let mut stale: Vec<(String, PathBuf, bool)> = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !suffixes.iter().any(|s| name.ends_with(s.as_str())) {
            continue;
        }
        let path = entry.path();
        if keep.iter().any(|k| k == name || readable_same_file(&dir.join(k), &path)) {
            continue;
        }
        stale.push((name.to_string(), path, ft.is_file()));
    }
    // この id のものと確かめられた md の名前の土台（小文字）。置いたばかりの md も含める
    let mut owned_bases: Vec<String> = keep
        .iter()
        .filter_map(|k| k.strip_suffix(".md"))
        .map(|b| b.to_lowercase())
        .collect();
    for (name, path, regular) in &stale {
        if let Some(base) = name.strip_suffix(".md") {
            // リンク・特殊ファイルは誰かの写しではない。読まずに片付け対象にする
            if !*regular || readable_md_is_owned(path, id) {
                owned_bases.push(base.to_lowercase());
            }
        }
    }
    let mut first_err: Option<String> = None;
    for (name, path, _) in &stale {
        let base = name
            .strip_suffix(".md")
            .or_else(|| name.strip_suffix(".prov.jsonld"))
            .unwrap_or(name)
            .to_lowercase();
        if !owned_bases.contains(&base) {
            continue;
        }
        if let Err(e) = fs::remove_file(path) {
            first_err.get_or_insert(format!("古い写しの削除失敗: {name} ({e})"));
        }
    }
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// この id の写しを全部消す。置き場が無ければ何も作らず Ok。
fn readable_remove_all(root: &str, entry_type: &str, id: &str) -> Result<(), String> {
    let dir = readable_dir_ro(root, entry_type)?;
    let parent = dir.parent().map(Path::to_path_buf).unwrap_or_default();
    reject_symlink(&parent)?;
    reject_symlink(&dir)?;
    if !dir.is_dir() {
        return Ok(());
    }
    ensure_dir_within_root(root, &dir)?;
    readable_cleanup(&dir, id, &[])
}

/// 共有したノートの「読める写し」を置く・置き直す・消す。
/// - markdown が Some: 写しを置く（prov が Some なら来歴も）。共有エントリが無ければ断る
/// - markdown が None: この id の写しを全部消す（取り残しの掃除。エントリが無くても進む）
#[tauri::command]
fn shared_readable_sync(
    root: String,
    entry_type: String,
    id: String,
    title: String,
    markdown: Option<String>,
    prov: Option<String>,
    author_email: Option<String>,
) -> Result<(), String> {
    validate_id(&id)?;
    if !READABLE_ENTRY_TYPES.contains(&entry_type.as_str()) {
        return Err(format!("読める写しに対応しない entry type: {entry_type}"));
    }
    let id12 = readable_id12(&id);
    // 元になる共有エントリ（共有されていないものの写しは作らない）
    let entry_path = shared_type_dir_ro(&root, &entry_type)?.join(format!("{id}.json"));
    let Some(markdown) = markdown else {
        // 消すだけ: 置き場が無ければ（写しを一度も作っていない大半の共有）エントリを読まずに終える。
        // あるときは、エントリが実在するなら作者が一致すること。無ければそのまま掃除へ
        let dir = readable_dir_ro(&root, &entry_type)?;
        if fs::symlink_metadata(&dir).is_err() {
            return Ok(());
        }
        assert_existing_author(&entry_path, &author_email)?;
        return readable_remove_all(&root, &entry_type, &id);
    };
    if !entry_path.exists() {
        return Err("共有されていないノートの写しは置けません".to_string());
    }
    assert_existing_author(&entry_path, &author_email)?;

    let dir = readable_dir_ro(&root, &entry_type)?;
    let parent = dir.parent().map(Path::to_path_buf).unwrap_or_default();
    reject_symlink(&parent)?;
    create_dir_for_write(&parent)?;
    reject_symlink(&dir)?;
    create_dir_for_write(&dir)?;
    ensure_dir_within_root(&root, &dir)?;

    let base = format!("{}_{id12}", sanitize_readable_title(&title));
    let md_name = format!("{base}.md");
    let md_path = dir.join(&md_name);
    // 末尾 12 桁が同じだけの別の共有の写しを上書きしない
    if fs::symlink_metadata(&md_path).map(|m| m.is_file()).unwrap_or(false)
        && !readable_md_is_owned(&md_path, &id)
    {
        return Err(format!("別の共有の写しと名前が重なるため置けません: {md_name}"));
    }
    let mut keep = vec![md_name.clone()];
    write_readable_file(&md_path, &markdown)?;
    if let Some(prov) = prov {
        let prov_name = format!("{base}.prov.jsonld");
        if let Err(e) = write_readable_file(&dir.join(&prov_name), &prov) {
            // 途中で失敗しても古い写しを取り残さない（掃除は最善努力。元の失敗を返す）
            let _ = readable_cleanup(&dir, &id, &keep);
            return Err(e);
        }
        keep.push(prov_name);
    }
    readable_cleanup(&dir, &id, &keep)
}

/// Blob を hash で読み出す（base64 で返す）。
#[tauri::command]
fn shared_blob_read(root: String, hash: String) -> Result<String, String> {
    use base64::Engine;
    let dir = shared_blob_dir_ro(&root, &hash)?;
    let hex_part = &hash["sha256:".len()..];
    let path = dir.join(hex_part);
    let bytes = fs::read(&path).map_err(|e| format!("blob 読み取り失敗: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Blob を hash 名で書き込む。content_base64 は呼び出し側で base64 化したバイト列。
/// 既に同じ hash のファイルがあれば書き込みをスキップする（content-addressed の特性）。
#[tauri::command]
fn shared_blob_write(
    root: String,
    hash: String,
    content_base64: String,
) -> Result<(), String> {
    use base64::Engine;
    let dir = shared_blob_dir(&root, &hash)?;
    ensure_dir_within_root(&root, &dir)?;
    let hex_part = &hash["sha256:".len()..];
    let path = dir.join(hex_part);
    // 置かれたリンク（まだ無い先を指すものを含む）を辿って外へ書かない。exists() はリンク先を
    // 見るので、宙に浮いたリンクは「無い」になって fs::write がリンク先を新規作成してしまう
    reject_symlink(&path)?;
    if path.exists() {
        return Ok(()); // dedup
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("base64 デコード失敗: {e}"))?;
    // create_new（O_EXCL）は最後の要素がリンクなら辿らず失敗する。確認から書き込みの間の差し替えも断つ
    use std::io::Write;
    match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => f.write_all(&bytes).map_err(|e| format!("blob 書き込み失敗: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()), // 並行して同じ blob が置かれた（dedup）
        Err(e) => Err(format!("blob 書き込み失敗: {e}")),
    }
}

#[tauri::command]
fn shared_blob_exists(root: String, hash: String) -> Result<bool, String> {
    let dir = shared_blob_dir_ro(&root, &hash)?;
    let hex_part = &hash["sha256:".len()..];
    Ok(dir.join(hex_part).exists())
}

/// shared root ディレクトリが存在してアクセスできるか。
/// 引用ブロックの表示時に「エントリが無い（missing）」と「共有ストレージに
/// 到達できない（offline）」を区別するために使う。shared_list は未作成
/// ディレクトリを空リスト扱いにするため、この判別には使えない。
#[tauri::command]
fn shared_root_exists(root: String) -> bool {
    fs::metadata(&root).map(|m| m.is_dir()).unwrap_or(false)
}

// ── 共有フォルダの到達性診断 ─────────────────────────────────────────────
//
// NAS の共有は、macOS ではスリープ復帰・再起動・Wi-Fi 切り替えで静かにマウントが外れ、
// Windows ではネットワークドライブが「切断」状態で残る。どちらも Finder / エクスプローラーで
// その場所を一度開けば繋がり直すが、利用者から見ると「NAS は見えているのに Graphium だけ
// 読めない」になる。ここでは
//   1. 繋がっている間に「どのサーバーの共有か」（smb://… / \\host\share）を控え、
//   2. 到達できないときに、その控えで OS に再接続を頼み、
//   3. 別名でマウントされている（/Volumes/Kumagai-1 等）なら候補として示す
// の 3 つを Rust 側で持つ。TS からは文字列のパスだけを渡す。

/// 共有フォルダの到達性診断の結果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SharedRootDiagnosis {
    /// root がディレクトリとして見えているか
    pub reachable: bool,
    /// 到達できないときの、同じ中身がありそうな別パス（存在を確認済みのものだけ）
    pub alternatives: Vec<String>,
}

/// `mount` の 1 行（`<from> on <mountpoint> (<fstype>, ...)`）を分解する。
/// 返り値は (from, mountpoint, fstype)。形が違う行は None。
#[cfg(any(target_os = "macos", test))]
fn parse_mount_line(line: &str) -> Option<(String, String, String)> {
    let (from, rest) = line.split_once(" on ")?;
    let (mountpoint, paren) = rest.rsplit_once(" (")?;
    let fstype = paren.trim_end_matches(')').split(',').next()?.trim();
    Some((from.to_string(), mountpoint.to_string(), fstype.to_string()))
}

/// macOS の `mount` 出力から、root を含むネットワークボリュームの接続先 URL を求める。
/// smbfs の `//user@host/share` は `smb://user@host/share`、nfs の `host:/export` は
/// `nfs://host/export` に直す。最も深いマウントポイントを採る（/ も一致するので）。
#[cfg(any(target_os = "macos", test))]
fn remote_from_mount_output(output: &str, root: &Path) -> Option<String> {
    let mut best: Option<(usize, String)> = None;
    for line in output.lines() {
        let Some((from, mountpoint, fstype)) = parse_mount_line(line) else {
            continue;
        };
        let mp = Path::new(&mountpoint);
        if !root.starts_with(mp) {
            continue;
        }
        let url = match fstype.as_str() {
            "smbfs" | "cifs" => from
                .strip_prefix("//")
                .map(|s| format!("smb://{s}")),
            "nfs" => from
                .split_once(":/")
                .map(|(host, path)| format!("nfs://{host}/{path}")),
            "afpfs" => from.strip_prefix("afp://").map(|_| from.clone()),
            _ => None,
        };
        let Some(url) = url else { continue };
        let depth = mountpoint.len();
        if best.as_ref().is_none_or(|(d, _)| depth > *d) {
            best = Some((depth, url));
        }
    }
    best.map(|(_, url)| url)
}

/// Windows の `net use` 出力から、ドライブ文字に対応する UNC（`\\host\share`）を拾う。
/// 列見出しは OS の言語で変わるので、「そのドライブ文字を含む行の `\\` で始まる語」だけを見る。
#[cfg(any(target_os = "windows", test))]
fn unc_from_net_use_output(output: &str, drive: &str) -> Option<String> {
    let drive_upper = drive.to_ascii_uppercase();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if !tokens.iter().any(|t| t.eq_ignore_ascii_case(&drive_upper)) {
            continue;
        }
        if let Some(unc) = tokens.iter().find(|t| t.starts_with("\\\\")) {
            return Some(unc_share_root(unc));
        }
    }
    None
}

/// `\\host\share\deeper\path` → `\\host\share`（再接続に要るのは共有の根だけ）。
#[cfg(any(target_os = "windows", test))]
fn unc_share_root(unc: &str) -> String {
    let body = unc.trim_start_matches('\\');
    let parts: Vec<&str> = body.split('\\').filter(|s| !s.is_empty()).take(2).collect();
    format!("\\\\{}", parts.join("\\"))
}

/// root を含むネットワーク共有の接続先（macOS: `smb://…` 等 / Windows: `\\host\share`）。
/// ローカルディスク上のフォルダや、判別できないときは None。到達できている間にしか
/// 分からない情報なので、TS 側は成功時に呼んで控えておく。
#[tauri::command]
fn shared_root_remote(root: String) -> Option<String> {
    let root_path = PathBuf::from(root.trim());
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("/sbin/mount").output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        return remote_from_mount_output(&text, &root_path);
    }
    #[cfg(target_os = "windows")]
    {
        let s = root_path.to_string_lossy();
        if s.starts_with("\\\\") {
            return Some(unc_share_root(&s));
        }
        let drive = s.get(..2)?;
        if !drive.ends_with(':') {
            return None;
        }
        let out = Command::new("net").args(["use", drive]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        return unc_from_net_use_output(&text, drive);
    }
    #[allow(unreachable_code)]
    None
}

/// macOS: `/Volumes/<name>/<rest>` が無いとき、`/Volumes/<name>-1/<rest>` 等を探す。
/// 古いマウントポイントの残骸があると Finder が別名でマウントするのが典型。
fn alternatives_by_sibling_volume(root: &Path, volumes_dir: &Path) -> Vec<String> {
    let Ok(rel) = root.strip_prefix(volumes_dir) else {
        return Vec::new();
    };
    let mut comps = rel.components();
    let Some(name) = comps.next().map(|c| c.as_os_str().to_string_lossy().to_string()) else {
        return Vec::new();
    };
    let rest: PathBuf = comps.collect();
    let Ok(entries) = fs::read_dir(volumes_dir) else {
        return Vec::new();
    };
    let mut found: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let vol = e.file_name().to_string_lossy().to_string();
            if vol == name {
                return None;
            }
            // Kumagai-1 / Kumagai 2 / Kumagai (1) のような派生名だけを見る
            let tail = vol.strip_prefix(&name)?;
            if !tail.starts_with(['-', ' ', '_', '(']) {
                return None;
            }
            let candidate = volumes_dir.join(&vol).join(&rest);
            fs::metadata(&candidate).ok()?.is_dir().then(|| candidate.to_string_lossy().to_string())
        })
        .collect();
    found.sort();
    found
}

/// Windows: `X:\rest` が無いとき、控えてある UNC で `\\host\share\rest` を試す。
/// UNC はドライブ文字の割り当てが消えていても、ネットワークが繋がれば届く。
fn alternatives_by_unc(root: &Path, remote: &str) -> Vec<String> {
    let s = root.to_string_lossy();
    if s.starts_with("\\\\") || !remote.starts_with("\\\\") {
        return Vec::new();
    }
    let Some(rest) = s.get(2..) else { return Vec::new() };
    let candidate = format!("{}{}", remote.trim_end_matches('\\'), rest);
    if fs::metadata(&candidate).map(|m| m.is_dir()).unwrap_or(false) {
        vec![candidate]
    } else {
        Vec::new()
    }
}

/// 共有フォルダに到達できるかと、できないときの代替パス候補。
#[tauri::command]
fn shared_root_diagnose(root: String, remote: Option<String>) -> SharedRootDiagnosis {
    let root_path = PathBuf::from(root.trim());
    if fs::metadata(&root_path).map(|m| m.is_dir()).unwrap_or(false) {
        return SharedRootDiagnosis {
            reachable: true,
            alternatives: Vec::new(),
        };
    }
    let mut alternatives = Vec::new();
    if cfg!(target_os = "macos") {
        alternatives.extend(alternatives_by_sibling_volume(&root_path, Path::new("/Volumes")));
    }
    if cfg!(target_os = "windows") {
        if let Some(remote) = remote.as_deref() {
            alternatives.extend(alternatives_by_unc(&root_path, remote));
        }
    }
    SharedRootDiagnosis {
        reachable: false,
        alternatives,
    }
}

/// 控えてある接続先を OS に渡して再接続を頼む。
/// macOS は `open smb://…`（Finder がキーチェーンの資格情報でマウントする）、
/// Windows は `explorer.exe \\host\share`（切断されたドライブが繋がり直す／資格情報を聞く）。
/// 受け付けるのはネットワーク共有の形だけ。任意の URL やパスを開く口にはしない。
#[tauri::command]
fn shared_root_reconnect(remote: String) -> Result<(), String> {
    let remote = remote.trim().to_string();
    let is_url = ["smb://", "afp://", "nfs://", "cifs://"]
        .iter()
        .any(|p| remote.starts_with(p));
    let is_unc = remote.starts_with("\\\\") && !remote.contains(['/', '"', '\n', '\r']);
    if !(is_url || is_unc) {
        return Err(format!("再接続先の形が不正です: {remote}"));
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("/usr/bin/open").arg(&remote).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe").arg(&remote).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status: std::io::Result<std::process::ExitStatus> = Err(std::io::Error::other(
        "この OS では再接続を自動化していません",
    ));
    match status {
        // explorer.exe は常に 1 を返すので、終了コードでは判定しない（起動できたかだけ見る）
        Ok(_) => Ok(()),
        Err(e) => Err(format!("再接続の呼び出しに失敗しました: {e}")),
    }
}

/// Blob を hash 指定で削除する（GC 用）。
/// 呼び出し側で「他の active manifest が参照していない」ことを確認した hash のみを渡すこと。
/// 存在しない blob を渡しても No-op で成功する（idempotent）。
#[tauri::command]
fn shared_blob_delete(root: String, hash: String) -> Result<(), String> {
    // 消すだけなので入れ物は作らない（無ければ no-op）
    let dir = shared_blob_dir_ro(&root, &hash)?;
    let hex_part = &hash["sha256:".len()..];
    let path = dir.join(hex_part);
    if path.exists() {
        // 入れ物フォルダが外へのリンクに差し替えられていても外のファイルは消さない
        reject_symlink(&path)?;
        ensure_dir_within_root(&root, &dir)?;
        fs::remove_file(&path).map_err(|e| format!("blob 削除失敗: {e}"))?;
    }
    Ok(())
}

/// WebView の内容をネイティブの印刷パネルに送る。
///
/// macOS の WKWebView は JS の `window.print()` を黙って捨てるため、印刷パネルは
/// Rust から開くしかない（wry の print が `printOperationWithPrintInfo` を呼ぶ）。
/// Windows の WebView2 は `window.print()` を解釈するので、そちらは JS に戻す。
///
/// パネルを閉じたことはフロントに伝わらない（wry が完了セレクタを渡していない）。
/// 呼び出し側は「パネルを開いた」までで完了扱いにすること。
#[tauri::command]
fn print_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return window.print().map_err(|e| format!("印刷パネルを開けません: {e}"));

    #[cfg(not(target_os = "macos"))]
    return window
        .eval("window.print()")
        .map_err(|e| format!("印刷パネルを開けません: {e}"));
}

/// 取り込みなど長い処理の間、ウィンドウが隠れても WebView を止めさせない（macOS）。
///
/// WKWebView はウィンドウが別のスペースや他のアプリの裏に隠れると「見えていない」と
/// 判定し、WebContent プロセスをバックグラウンド優先度に落とす（1 件の処理に数十秒
/// かかるようになる）。約 10 分後にはプロセスごと一時停止させるので、処理は表示し直す
/// まで止まる。WebView の中で回っている取り込みや OCR のループがまるごと巻き込まれる。
///
/// `active` の間は覆い隠しの判定（`_windowOcclusionDetectionEnabled`）を切って、隠れて
/// いても「見えている」扱いのままにする。設定しただけでは次に覆い隠しが変わるまで判定
/// がやり直されないので、occlusion の変更通知を投げてその場でやり直させる。あわせて
/// App Nap の対象から外す（アイドルスリープは妨げない）。
///
/// 常時オンにしないのは、隠れている間もアニメーションやタイマーが全速で回り続けて
/// 電池を食うため。呼び出し側（`src/lib/background-work.ts`）が参照カウントで持つ。
/// 最小化されたウィンドウは覆い隠しとは別扱いで、これでは止められない。
/// macOS 以外では何もしない。
#[tauri::command]
fn set_background_work_active(window: tauri::WebviewWindow, active: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return window
        .with_webview(move |webview| {
            // with_webview の中身はメインスレッドで走る
            macos_background_work::apply(webview.inner(), webview.ns_window(), active);
        })
        .map_err(|e| format!("WebView の状態を切り替えられません: {e}"));

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, active);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos_background_work {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol, ProtocolObject};
    use objc2::{msg_send, sel};
    use objc2_foundation::{ns_string, NSActivityOptions, NSNotificationCenter, NSProcessInfo};
    use std::cell::RefCell;
    use std::ffi::c_void;

    thread_local! {
        // App Nap を外している間の activity。メインスレッドからしか触らない
        static ACTIVITY: RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>> =
            const { RefCell::new(None) };
    }

    /// `webview` は WKWebView、`ns_window` はそれを載せた NSWindow。メインスレッドで呼ぶこと。
    pub fn apply(webview: *mut c_void, ns_window: *mut c_void, active: bool) {
        if webview.is_null() {
            return;
        }
        // SAFETY: wry が渡す生きた WKWebView / NSWindow で、メインスレッドから触っている
        unsafe {
            let view = &*(webview as *const AnyObject);
            let setter = sel!(_setWindowOcclusionDetectionEnabled:);
            // 非公開 API なので、将来の macOS で消えていたら何もしない（遅くなるだけ）
            let responds: bool = msg_send![view, respondsToSelector: setter];
            if responds {
                let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: !active];
                if !ns_window.is_null() {
                    let window = &*(ns_window as *const AnyObject);
                    NSNotificationCenter::defaultCenter().postNotificationName_object(
                        ns_string!("NSWindowDidChangeOcclusionStateNotification"),
                        Some(window),
                    );
                }
            }
        }

        ACTIVITY.with(|slot| {
            let mut slot = slot.borrow_mut();
            let info = NSProcessInfo::processInfo();
            if active {
                if slot.is_none() {
                    *slot = Some(info.beginActivityWithOptions_reason(
                        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
                        ns_string!("Graphium background work"),
                    ));
                }
            } else if let Some(activity) = slot.take() {
                // SAFETY: beginActivityWithOptions_reason が返した activity をそのまま返す
                unsafe { info.endActivity(&activity) };
            }
        });
    }
}

/// 実行中の `.app` バンドルのパスを返す（macOS）。
/// `cargo run` のようにバンドル化されていない起動では解決できないので Err を返す。
#[cfg(target_os = "macos")]
fn current_bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("実行ファイルのパス取得に失敗: {e}"))?;
    // <Bundle>.app/Contents/MacOS/<exe> なので 3 つ上が .app
    let bundle = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .ok_or("バンドルのパスを解決できません")?;
    if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err("バンドルとして起動していません".to_string());
    }
    Ok(bundle.to_path_buf())
}

/// アプリを launchd 経由で起動し直す（macOS 専用）。
///
/// Tauri の `relaunch()` は今のプロセスから新しいバイナリを spawn する。平常時は
/// それで足りるが、アップデータが `.app` を丸ごと置き換えた直後だけ事情が変わる。
/// macOS の TCC は子プロセスに親の責任プロセス（responsible process）を継がせる
/// ので、置き換え済みで解決できなくなったバンドルの identity を背負ったまま起動し、
/// 書類フォルダが `Operation not permitted` で弾かれる。ユーザーから見ると
/// 「更新した直後だけノートが開けない、一度閉じて開き直すと直る」という形で出る。
///
/// `open` に任せると launchd が責任プロセスになり、置き換え後のバンドルの署名で
/// 評価し直される。ただし `open` は起動中のアプリを前面に出すだけなので、今の
/// プロセスが消えるのを待ってから叩く必要がある。待ちは別プロセスに任せる。
///
/// 終了は `app.exit(0)` ではなくウィンドウを閉じて既存の終了経路に乗せる。
/// sidecar の後始末はフロントが `app-close-requested` を受けてから `shutdown_ack`
/// を返すまでの間に走るので、そこを飛ばすと sidecar が残ってポートを掴んだままになる。
#[tauri::command]
fn relaunch_via_launchd(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bundle = current_bundle_path()?;
        // パスにスペースや引用符が入っていても壊れないようシングルクォートで包む
        let quoted = format!("'{}'", bundle.to_string_lossy().replace('\'', r"'\''"));
        let pid = std::process::id();
        // 自分が消えるまで最大 10 秒待ってから open する。待ち切っても open は
        // 投げる（前面に出るだけで害はない）。
        let script = format!(
            "for _ in $(seq 1 100); do kill -0 {pid} 2>/dev/null || break; sleep 0.1; done; \
             /usr/bin/open -a {quoted}"
        );
        Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("再起動コマンドの起動に失敗: {e}"))?;

        // 既存の終了経路（CloseRequested → sidecar 停止 → shutdown_ack）に乗せる。
        // ウィンドウが取れないときだけ直接落とす。
        if let Some(window) = app.get_webview_window("main") {
            window
                .close()
                .map_err(|e| format!("ウィンドウを閉じられません: {e}"))?;
        } else {
            app.exit(0);
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("launchd 経由の再起動は macOS 専用です".to_string())
    }
}

/// フロント側で生成したファイル（PDF / PROV-JSON-LD / Markdown / zip）を
/// ネイティブの保存ダイアログ経由でディスクに保存する。
///
/// **セキュリティ**: 旧 `save_bytes_to_path` は JS から渡された任意パスへ
/// 無条件書き込みしていた。本コマンドは保存先ダイアログを Rust 側で開き、
/// ユーザーが明示的に選んだパスにのみ書き込む。JS からは保存先を一切
/// 指定できない（ファイル名の初期候補のみ渡せる）。
///
/// 戻り値:
///   - `Ok(true)`  保存した
///   - `Ok(false)` ユーザーがダイアログをキャンセルした
///   - `Err(..)`   書き込み等に失敗した
#[tauri::command]
async fn save_bytes_with_dialog(
    app: tauri::AppHandle,
    suggested_name: String,
    content_base64: String,
) -> Result<bool, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("base64 デコード失敗: {e}"))?;

    // ファイル名初期候補から拡張子を割り出し、ダイアログのフィルタに使う。
    let ext = std::path::Path::new(&suggested_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());

    let mut builder = app.dialog().file().set_file_name(&suggested_name);
    if let Some(ext) = &ext {
        builder = builder.add_filter(ext.to_uppercase(), &[ext.as_str()]);
    }

    // save_file はノンブロッキング（コールバック）。ダイアログはメイン
    // スレッドで回る必要があるため、blocking_save_file をここで直接呼ぶと
    // async ランタイム上でデッドロックしうる。std の mpsc チャネルで結果を
    // 受け取る。この async タスクはワーカースレッドで走るため、recv で
    // 待ってもダイアログのメインスレッドはブロックしない。
    let (tx, rx) = std::sync::mpsc::channel();
    builder.save_file(move |path| {
        let _ = tx.send(path);
    });
    let selected = rx
        .recv()
        .map_err(|e| format!("保存ダイアログの結果取得に失敗: {e}"))?;

    let Some(file_path) = selected else {
        // ユーザーがキャンセル
        return Ok(false);
    };
    let target = file_path
        .into_path()
        .map_err(|e| format!("保存先パスの解決に失敗: {e}"))?;

    fs::write(&target, bytes).map_err(|e| format!("ファイル書き込み失敗: {e}"))?;
    Ok(true)
}

// --- データの置き場（リンクした素材） ---
//
// 利用者が登録した置き場（組織の同期フォルダなど）の中のファイルを、写さず・中身も読まずに
// 「場所の控え」だけで指すための部品。置き場の絶対パスは Rust 側だけが持ち、画面側は
// 「置き場の id と、その中での相対パス」しか渡せない。中身を読むコマンドは足さない
// （持つのは metadata・OS のアプリで開く・場所を表示する、だけ）。

/// 置き場の直下に置く目印（別の端末・別の人が同じフォルダを登録しても同じ id になるように）
const PLACE_MARKER_FILE: &str = ".graphium-place.json";
/// 置き場の名前の最大文字数
const PLACE_NAME_MAX_CHARS: usize = 80;
/// 相対パスの最大バイト数
const PLACE_REL_PATH_MAX_BYTES: usize = 4096;
/// place_stat_many が一度に受ける最大件数
const PLACE_STAT_MAX_ITEMS: usize = 2000;
/// place_pick_files が一度に受ける最大件数
const PLACE_PICK_MAX_FILES: usize = 500;
/// 選んだファイルを調べる処理が、この時間 1 件も進まなければ打ち切る（止まった共有フォルダ向け）
const PLACE_PICK_STALL_TIMEOUT: Duration = Duration::from_secs(10);
/// 選んだ件数が多すぎるときのエラーの接頭辞（画面が案内に置き換える）。
/// 形は `PLACE_PICK_TOO_MANY:<上限>`
const PLACE_PICK_TOO_MANY_PREFIX: &str = "PLACE_PICK_TOO_MANY";
/// 台帳のファイル名（app_config_dir 直下。端末ごと。データフォルダには置かない）
const PLACE_LEDGER_FILE: &str = "places.json";
/// 目印のファイルを読む最大バイト数
const PLACE_MARKER_MAX_BYTES: u64 = 64 * 1024;
/// 置き場の root に届くかの確認を待つ時間（止まった共有・NAS で全体を止めない）
const PLACE_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// place_open が開いてよい種類（小文字）。ここに無いものは、実行ファイル・スクリプト・
/// 設定を変えるファイルを含めて開かない（止める一覧ではなく許す一覧）。
const PLACE_OPENABLE_EXTS: &[&str] = &[
    "pdf", "txt", "md", "csv", "tsv", "rtf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "png",
    "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "mp3", "wav", "m4a", "flac", "ogg",
    "mp4", "mov", "m4v", "webm",
];

/// place_open が種類を理由に断るときの Err の先頭。画面側がこの文字列で文言を振り分ける。
/// 形は `PLACE_OPEN_NOT_ALLOWED:<拡張子か空>`
const PLACE_OPEN_NOT_ALLOWED_PREFIX: &str = "PLACE_OPEN_NOT_ALLOWED";

/// ファイル名の拡張子（末尾の `.` と空白を落としたあとの、小文字。無ければ空）
fn place_name_ext(path: &Path) -> String {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return String::new() };
    let name = name.trim_end_matches(['.', ' ']);
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// 開いてよいか。許可リストに無い（拡張子なしを含む）・名前の末尾が `.` や空白（Windows は
/// 落として別のファイルを開く）なら断る。
/// 実行ビットは見ない: SMB の共有や exFAT では、ふつうのファイルがすべて `-rwx------` に
/// 見える。許可リストの種類は、実行ビットが立っていても OS が表示用のアプリで開き、
/// 実行にはならない（実行になる種類はそもそもリストに入れない）。
fn check_place_openable(path: &Path) -> Result<(), String> {
    let ext = place_name_ext(path);
    let raw_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let trailing = raw_name.ends_with(['.', ' ']);
    if trailing || !PLACE_OPENABLE_EXTS.contains(&ext.as_str()) {
        return Err(format!("{PLACE_OPEN_NOT_ALLOWED_PREFIX}:{ext}"));
    }
    Ok(())
}

/// Windows の canonicalize が付ける `\\?\` を外す（`\\?\C:\x` → `C:\x`、
/// `\\?\UNC\s\sh\x` → `\\s\sh\x`）。文字列だけの変換なので、どの OS でも試せる。
#[cfg_attr(not(windows), allow(dead_code))]
fn strip_verbatim_prefix(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    }
}

/// OS へ渡すパスの形にする（Windows のみ `\\?\` を外す。unix はそのまま）
fn place_os_path(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(strip_verbatim_prefix(&p.to_string_lossy()))
    }
    #[cfg(not(windows))]
    {
        p
    }
}

/// 台帳の root（登録時の canonicalize 結果）と、いま canonicalize した結果が同じか。
/// Windows の `\\?\` の有無で食い違わないよう、同じ形にそろえて比べる。
fn same_place_root(ledger_root: &str, now: &Path) -> bool {
    strip_verbatim_prefix(ledger_root) == strip_verbatim_prefix(&now.to_string_lossy())
}

/// 別スレッドで f を走らせ、結果を受け取る口を返す（呼び出し側が recv_timeout で待つ）
#[cfg(test)]
fn spawn_probe<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> std::sync::mpsc::Receiver<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx
}

/// 別スレッドで f を走らせ、timeout で打ち切る（時間切れは None。スレッドは放置する）
#[cfg(test)]
fn run_with_timeout<T: Send + 'static>(
    timeout: Duration,
    f: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    spawn_probe(f).recv_timeout(timeout).ok()
}

/// 置き場として登録してよいフォルダか。根・ホーム・Graphium のデータフォルダ・アプリの設定
/// フォルダ、その中、またはそれらを含む親フォルダは断る（引数は canonicalize 済みの想定）。
fn check_place_root_allowed(
    picked: &Path,
    home: Option<&Path>,
    data_dir: Option<&Path>,
    config_dir: Option<&Path>,
) -> Result<(), String> {
    if picked.parent().is_none() {
        return Err("ドライブやルートそのものは置き場にできません".to_string());
    }
    if let Some(h) = home {
        // ホームそのもの・ホームを含む親（/Users など）
        if h.starts_with(picked) {
            return Err("ホームフォルダ（とその親）は広すぎるため置き場にできません".to_string());
        }
    }
    for (dir, label) in [(data_dir, "Graphium のデータフォルダ"), (config_dir, "アプリの設定フォルダ")] {
        if let Some(d) = dir {
            if picked.starts_with(d) || d.starts_with(picked) {
                return Err(format!("{label}（とその中・親）は置き場にできません"));
            }
        }
    }
    Ok(())
}

/// 台帳の 1 件。root は canonicalize 済みの絶対パス
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Place {
    id: String,
    name: String,
    root: String,
}

/// 画面へ返す置き場の情報
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaceInfo {
    id: String,
    name: String,
    root: String,
    reachable: bool,
    /// 目印のファイルがあり、ほかの端末と同じ id を使えている
    shared: bool,
}

/// 選ばれた 1 ファイル（place_id が None = どの置き場の中でもない）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedFile {
    place_id: Option<String>,
    rel_path: Option<String>,
    name: String,
    size: u64,
    mtime_ms: i64,
}

/// place_pick_files の戻り値。failed は届かなかった・ファイルでなかった件数
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedFiles {
    files: Vec<PickedFile>,
    failed: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkRef {
    place_id: String,
    rel_path: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkStat {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mtime_ms: Option<i64>,
}

impl LinkStat {
    fn state_only(state: &'static str) -> Self {
        Self { state, size: None, mtime_ms: None }
    }
}

/// 台帳のメモリ上の写し。None は「まだ読んでいない」（起動後の最初の利用で読む）
/// 置き場の root に届くかの確認（1 件ぶん）の結果置き場。完了すると Some(届いたか) になる
type PlaceProbeSlot = Arc<(Mutex<Option<bool>>, std::sync::Condvar)>;

/// 進行中の「root に届くか」の確認。置き場の id ごとに同時に走るのは 1 本だけで、
/// 進行中なら新しく立てずにその結果を待つ（止まった置き場に対してスレッドが増えない）。
#[derive(Clone, Default)]
struct PlaceProbes(Arc<Mutex<HashMap<String, PlaceProbeSlot>>>);

impl PlaceProbes {
    /// key の確認を始める（進行中ならそれを返す）。f は別スレッドで 1 回だけ走る
    fn start(&self, key: &str, f: impl FnOnce() -> bool + Send + 'static) -> PlaceProbeSlot {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(slot) = map.get(key) {
            return slot.clone();
        }
        let slot: PlaceProbeSlot = Arc::new((Mutex::new(None), std::sync::Condvar::new()));
        map.insert(key.to_string(), slot.clone());
        drop(map);
        let (inflight, slot2, key) = (self.0.clone(), slot.clone(), key.to_string());
        thread::spawn(move || {
            let ok = f();
            {
                let mut r = slot2.0.lock().unwrap_or_else(|e| e.into_inner());
                *r = Some(ok);
            }
            slot2.1.notify_all();
            let mut map = inflight.lock().unwrap_or_else(|e| e.into_inner());
            if map.get(&key).is_some_and(|s| Arc::ptr_eq(s, &slot2)) {
                map.remove(&key);
            }
        });
        slot
    }

    /// 確認の結果を timeout まで待つ（時間切れは false）
    fn wait(slot: &PlaceProbeSlot, timeout: Duration) -> bool {
        let guard = slot.0.lock().unwrap_or_else(|e| e.into_inner());
        let (guard, _) = slot
            .1
            .wait_timeout_while(guard, timeout, |r| r.is_none())
            .unwrap_or_else(|e| e.into_inner());
        guard.unwrap_or(false)
    }
}

/// root に届くか（metadata が取れるか）。止まった共有ではここで長く待たされうる
fn fs_root_reachable(root: &str) -> bool {
    fs::metadata(root).is_ok()
}

/// 置き場ごとに「root に届くか」を確かめる（全体で timeout まで。確認は置き場ごとに 1 本）。
/// 時間切れ・届かない置き場は false
fn probe_places<'a>(
    probes: &PlaceProbes,
    places: impl IntoIterator<Item = &'a Place>,
    timeout: Duration,
    probe: impl Fn(&str) -> bool + Clone + Send + 'static,
) -> HashMap<String, bool> {
    let deadline = Instant::now() + timeout;
    let slots: Vec<(String, PlaceProbeSlot)> = places
        .into_iter()
        .map(|p| {
            let (f, root) = (probe.clone(), p.root.clone());
            (p.id.clone(), probes.start(&p.id, move || f(&root)))
        })
        .collect();
    slots
        .into_iter()
        .map(|(id, slot)| {
            let left = deadline.saturating_duration_since(Instant::now());
            (id, PlaceProbes::wait(&slot, left))
        })
        .collect()
}

#[derive(Default)]
struct PlaceState(Arc<Mutex<Option<Vec<Place>>>>, PlaceProbes);

/// 相対パスの解決結果
#[derive(Debug)]
struct ResolvedPlaceFile {
    /// canonicalize した実体のパス（OS へ渡す用。root の配下と確認済み。リンクの名前は残らない）
    path: PathBuf,
    size: u64,
    mtime_ms: i64,
}

/// 相対パスの解決に失敗した理由
#[derive(Debug, PartialEq)]
enum PlaceResolveError {
    /// 相対パスの形が不正
    Invalid(String),
    /// 置き場（root）に届かない
    Unreachable,
    /// ファイルが無い・シンボリックリンク・ファイルでない・root の外へ出る
    Missing,
    /// 台帳に無い置き場
    Unregistered,
}

impl PlaceResolveError {
    fn message(&self) -> String {
        match self {
            Self::Invalid(m) => format!("不正な相対パス: {m}"),
            Self::Unreachable => "データの置き場に届きません".to_string(),
            Self::Missing => "ファイルが見つかりません".to_string(),
            Self::Unregistered => "データの置き場が登録されていません".to_string(),
        }
    }

    fn state(&self) -> &'static str {
        match self {
            Self::Invalid(_) | Self::Missing => "missing",
            Self::Unreachable => "unreachable",
            Self::Unregistered => "unregistered",
        }
    }
}

/// 相対パス（`/` 区切り）の形を検査する。空・長すぎ・絶対パス・空要素・`.` / `..`・
/// `\`・NUL・制御文字を断る。Windows では `:` を含む要素（ドライブ指定・代替データストリーム）も断る。
fn validate_place_rel_path(rel: &str) -> Result<(), PlaceResolveError> {
    let bad = |m: &str| Err(PlaceResolveError::Invalid(m.to_string()));
    if rel.is_empty() {
        return bad("空");
    }
    if rel.len() > PLACE_REL_PATH_MAX_BYTES {
        return bad("長すぎる");
    }
    if rel.starts_with('/') {
        return bad("絶対パス");
    }
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return bad("空・. ・.. の要素");
        }
        if part.contains('\\') || part.chars().any(|c| c.is_control()) {
            return bad("使えない文字");
        }
        if cfg!(windows) && part.contains(':') {
            return bad("使えない文字");
        }
    }
    Ok(())
}

/// ファイルの更新日時（エポックからのミリ秒）。取れなければ 0
fn metadata_mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 置き場の root と相対パスから、ファイルを解決する（守りの中心）。
/// - root の metadata が取れなければ「届かない」
/// - 連結先が無い・シンボリックリンク・ファイルでないなら「見つからない」（リンクはたどらない）
/// - 連結先を canonicalize し、root の配下でなければ断る（途中のフォルダが外へのリンクの場合）
/// - 返す path は canonicalize した実体（root 自身が登録時のままかは resolve_in_places で見る）
///
/// ファイルの中身は読まない（metadata だけ）。
#[cfg(test)]
fn resolve_place_file(root: &Path, rel_path: &str) -> Result<ResolvedPlaceFile, PlaceResolveError> {
    validate_place_rel_path(rel_path)?;
    let canon_root = fs::canonicalize(root).map_err(|_| PlaceResolveError::Unreachable)?;
    resolve_in_root(root, &canon_root, rel_path)
}

/// resolve_place_file の本体。root の canonicalize 結果（canon_root）は呼び出し側が
/// 置き場ごとに 1 回だけ求めて渡す（NAS では 1 回が数十〜数百ミリ秒かかる）。
fn resolve_in_root(
    root: &Path,
    canon_root: &Path,
    rel_path: &str,
) -> Result<ResolvedPlaceFile, PlaceResolveError> {
    validate_place_rel_path(rel_path)?;
    let joined = rel_path.split('/').fold(root.to_path_buf(), |p, c| p.join(c));
    let meta = match fs::symlink_metadata(&joined) {
        Ok(m) => m,
        Err(e) => {
            return Err(match e.kind() {
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => {
                    PlaceResolveError::Missing
                }
                _ => PlaceResolveError::Unreachable,
            })
        }
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(PlaceResolveError::Missing);
    }
    let canon_file = fs::canonicalize(&joined).map_err(|_| PlaceResolveError::Missing)?;
    if !canon_file.starts_with(canon_root) {
        return Err(PlaceResolveError::Missing);
    }
    // 種類の判定・OS へ渡すのは、ここで検査した実体（連結しただけの名前は差し替えられうる）
    let real = fs::metadata(&canon_file).map_err(|_| PlaceResolveError::Missing)?;
    if !real.is_file() {
        return Err(PlaceResolveError::Missing);
    }
    Ok(ResolvedPlaceFile {
        path: place_os_path(canon_file),
        size: real.len(),
        mtime_ms: metadata_mtime_ms(&real),
    })
}

/// 解決した実体のパスを OS へ渡す直前にもう一度確かめる。リンクでない通常ファイルで、
/// canonicalize した結果がそのパス自身（同じ実体）でなければ「見つからない」。
/// 解決から OS が開くまでのごく短いすき間の差し替えは、これでも完全には防げず残る
/// （確認と OS の open は別の操作のため）。開いてよい種類を絞ってあるので、
/// 差し替えられても実行にはならない。
fn recheck_place_target(path: &Path) -> Result<(), PlaceResolveError> {
    let meta = fs::symlink_metadata(path).map_err(|_| PlaceResolveError::Missing)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(PlaceResolveError::Missing);
    }
    let canon = fs::canonicalize(path).map_err(|_| PlaceResolveError::Missing)?;
    if strip_verbatim_prefix(&canon.to_string_lossy()) != strip_verbatim_prefix(&path.to_string_lossy())
    {
        return Err(PlaceResolveError::Missing);
    }
    Ok(())
}

/// 置き場の名前を整える。制御文字を除き、前後の空白を落とす。空は不可。
/// 80 文字を超えるとき、truncate なら切り詰め、そうでなければエラー。
fn normalize_place_name(raw: &str, truncate: bool) -> Result<String, String> {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return Err("名前が空です".to_string());
    }
    if trimmed.chars().count() > PLACE_NAME_MAX_CHARS {
        if !truncate {
            return Err(format!("名前は {PLACE_NAME_MAX_CHARS} 文字までです"));
        }
        return Ok(trimmed.chars().take(PLACE_NAME_MAX_CHARS).collect::<String>().trim().to_string());
    }
    Ok(trimmed.to_string())
}

/// 台帳の JSON を読む。壊れていれば空として扱う（ファイルは書き換えない）
fn parse_places(text: &str) -> Vec<Place> {
    serde_json::from_str::<Vec<Place>>(text).unwrap_or_default()
}

/// 台帳を読む。無い・壊れている・読めないときは空
fn load_places(path: &Path) -> Vec<Place> {
    fs::read_to_string(path).map(|t| parse_places(&t)).unwrap_or_default()
}

/// 台帳を書く（一時ファイル → rename）
fn save_places(path: &Path, places: &[Place]) -> Result<(), String> {
    let parent = path.parent().ok_or("台帳の保存先が不正です")?;
    fs::create_dir_all(parent).map_err(|e| format!("台帳フォルダの作成に失敗: {e}"))?;
    let json = serde_json::to_string_pretty(places).map_err(|e| format!("台帳の書き出しに失敗: {e}"))?;
    let tmp = parent.join(format!("{PLACE_LEDGER_FILE}.{}.tmp", uuid::Uuid::new_v4().simple()));
    fs::write(&tmp, json).map_err(|e| format!("台帳の書き込みに失敗: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("台帳の保存に失敗: {e}")
    })
}

fn place_ledger_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("設定フォルダが見つかりません: {e}"))?;
    Ok(dir.join(PLACE_LEDGER_FILE))
}

fn lock_places(
    inner: &Mutex<Option<Vec<Place>>>,
) -> std::sync::MutexGuard<'_, Option<Vec<Place>>> {
    inner.lock().unwrap_or_else(|e| e.into_inner())
}

/// 台帳（メモリ上の写し。最初の利用で読む）を見る
fn read_places<T>(
    inner: &Mutex<Option<Vec<Place>>>,
    ledger: &Path,
    f: impl FnOnce(&[Place]) -> T,
) -> T {
    let mut guard = lock_places(inner);
    let places = guard.get_or_insert_with(|| load_places(ledger));
    f(places)
}

/// 台帳を変更する。f は (戻り値, 変更したか) を返す。変更したときだけ保存し、
/// 保存に成功したときだけメモリへ反映する（壊れた台帳は、ここで初めて上書きされる）
fn mutate_places<T>(
    inner: &Mutex<Option<Vec<Place>>>,
    ledger: &Path,
    f: impl FnOnce(&mut Vec<Place>) -> Result<(T, bool), String>,
) -> Result<T, String> {
    let mut guard = lock_places(inner);
    let current = guard.get_or_insert_with(|| load_places(ledger));
    let mut next = current.clone();
    let (out, changed) = f(&mut next)?;
    if changed {
        save_places(ledger, &next)?;
        *current = next;
    }
    Ok(out)
}

/// 目印の読み取り結果
#[derive(Debug, PartialEq)]
enum PlaceMarker {
    /// 無い（シンボリックリンクで触らないときも含む場合は Invalid）
    Absent,
    /// 有るが使えない（壊れている・id が UUID でない・シンボリックリンク）。上書きしない
    Invalid,
    Valid { id: String, name: Option<String> },
}

/// 目印を読み取り専用で開く。unix は O_NOFOLLOW でリンクへの差し替えを断り、
/// O_NONBLOCK で、確認のあとに FIFO へ差し替えられても書き手を待って止まらないようにする
fn open_place_marker(path: &Path) -> std::io::Result<fs::File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
    }
    #[cfg(not(unix))]
    {
        fs::File::open(path)
    }
}

fn read_place_marker(root: &Path) -> PlaceMarker {
    let path = root.join(PLACE_MARKER_FILE);
    let meta = match fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return PlaceMarker::Absent,
        Err(_) => return PlaceMarker::Invalid,
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return PlaceMarker::Invalid;
    }
    // 検査のあとに巨大なものへ差し替えられても読みすぎないよう、上限＋1 バイトで打ち切る
    let Ok(file) = open_place_marker(&path) else { return PlaceMarker::Invalid };
    // 開いたあとの実体も通常ファイルか（FIFO・デバイスなどは読まない）
    if !file.metadata().is_ok_and(|m| m.is_file()) {
        return PlaceMarker::Invalid;
    }
    let mut buf = Vec::new();
    if file.take(PLACE_MARKER_MAX_BYTES + 1).read_to_end(&mut buf).is_err()
        || buf.len() as u64 > PLACE_MARKER_MAX_BYTES
    {
        return PlaceMarker::Invalid;
    }
    let Ok(text) = String::from_utf8(buf) else { return PlaceMarker::Invalid };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return PlaceMarker::Invalid;
    };
    let Some(id) = v.get("id").and_then(|x| x.as_str()) else { return PlaceMarker::Invalid };
    let Ok(parsed) = uuid::Uuid::parse_str(id) else { return PlaceMarker::Invalid };
    let name = v.get("name").and_then(|x| x.as_str()).map(str::to_string);
    PlaceMarker::Valid { id: parsed.hyphenated().to_string(), name }
}

/// 目印を作る（create_new。既にあれば・書けなければ false。シンボリックリンクには触らない）
fn write_place_marker(root: &Path, id: &str, name: &str) -> bool {
    let path = root.join(PLACE_MARKER_FILE);
    if matches!(fs::symlink_metadata(&path), Ok(m) if m.file_type().is_symlink()) {
        return false;
    }
    let body = serde_json::json!({ "id": id, "name": name }).to_string();
    let Ok(mut f) = fs::OpenOptions::new().write(true).create_new(true).open(&path) else {
        return false;
    };
    f.write_all(body.as_bytes()).is_ok()
}

/// 登録する置き場（canonicalize 済みの root）の id・名前・shared を決める。
/// - 目印に使える id があれば、それを使う。ただし別の root で台帳にあれば端末だけの新しい id
/// - 目印が無ければ新しい uuid を作り、目印を書く（書けたときだけ shared）
/// - 目印はあるが使えない（id が UUID でない等）ときは上書きせず、端末だけの id
fn prepare_place(canon_root: &Path, existing: &[Place]) -> (Place, bool) {
    let folder_name = canon_root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| canon_root.to_string_lossy().to_string());
    let root = canon_root.to_string_lossy().to_string();
    let default_name = |marker_name: Option<&str>| {
        marker_name
            .and_then(|n| normalize_place_name(n, true).ok())
            .or_else(|| normalize_place_name(&folder_name, true).ok())
            .unwrap_or_else(|| "データの置き場".to_string())
    };
    match read_place_marker(canon_root) {
        PlaceMarker::Valid { id, name } => {
            let name = default_name(name.as_deref());
            if existing.iter().any(|p| p.id == id) {
                let id = uuid::Uuid::new_v4().hyphenated().to_string();
                (Place { id, name, root }, false)
            } else {
                (Place { id, name, root }, true)
            }
        }
        PlaceMarker::Invalid => {
            let id = uuid::Uuid::new_v4().hyphenated().to_string();
            (Place { id, name: default_name(None), root }, false)
        }
        PlaceMarker::Absent => {
            let id = uuid::Uuid::new_v4().hyphenated().to_string();
            let name = default_name(None);
            let shared = write_place_marker(canon_root, &id, &name);
            (Place { id, name, root }, shared)
        }
    }
}

fn place_info(p: &Place) -> PlaceInfo {
    place_info_with(p, fs_root_reachable(&p.root))
}

/// root に届くか（reachable）は確認済みの値を受ける。届かない置き場の目印は読みに行かない
fn place_info_with(p: &Place, reachable: bool) -> PlaceInfo {
    let root = Path::new(&p.root);
    let shared = reachable
        && matches!(read_place_marker(root), PlaceMarker::Valid { id, .. } if id == p.id);
    PlaceInfo {
        id: p.id.clone(),
        name: p.name.clone(),
        root: p.root.clone(),
        reachable,
        shared,
    }
}

/// 台帳の置き場の中から、canonicalize 済みのファイルを含むもの（複数なら一番深いもの）を探す。
/// 返すのは (置き場の id, `/` 区切りの相対パス)
#[cfg(test)]
fn locate_in_places(places: &[Place], canon_file: &Path) -> Option<(String, String)> {
    locate_in_places_cached(places, canon_file, &mut HashMap::new())
}

/// locate_in_places の本体。roots に置き場の root の canonicalize 結果を覚え、
/// 続けて何件も調べるときに置き場ごとの確認を 1 回で済ませる
fn locate_in_places_cached(
    places: &[Place],
    canon_file: &Path,
    roots: &mut HashMap<String, Option<PathBuf>>,
) -> Option<(String, String)> {
    let mut best: Option<(usize, &Place, PathBuf)> = None;
    // 台帳の root は canonicalize 済みの値なので、まず文字列（パスの要素）の接頭辞だけで
    // 候補を絞る。無関係な（止まっているかもしれない）置き場の root には触らない
    let file_plain = strip_verbatim_prefix(&canon_file.to_string_lossy());
    for p in places {
        if !Path::new(&file_plain).starts_with(strip_verbatim_prefix(&p.root)) {
            continue;
        }
        let cached = roots
            .entry(p.id.clone())
            .or_insert_with(|| fs::canonicalize(&p.root).ok());
        let Some(root) = cached.as_ref() else { continue };
        let Ok(rest) = canon_file.strip_prefix(root) else { continue };
        if rest.as_os_str().is_empty() {
            continue;
        }
        let depth = root.components().count();
        if best.as_ref().is_none_or(|(d, _, _)| depth > *d) {
            best = Some((depth, p, rest.to_path_buf()));
        }
    }
    let (_, place, rest) = best?;
    let parts: Option<Vec<&str>> = rest
        .components()
        .map(|c| match c {
            std::path::Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();
    Some((place.id.clone(), parts?.join("/")))
}

/// 置き場の root の canonicalize 結果を求める。登録時の結果と違えば（リンクなどへ
/// 差し替えられていれば）「届かない」。置き場ごとに 1 回だけ呼ぶ。
fn canonical_place_root(place: &Place) -> Result<PathBuf, PlaceResolveError> {
    match fs::canonicalize(&place.root) {
        Ok(now) if same_place_root(&place.root, &now) => Ok(now),
        _ => Err(PlaceResolveError::Unreachable),
    }
}

/// 置き場 id と相対パスからファイルを解決する（台帳に無ければ「未登録」）
fn resolve_in_places(
    places: &[Place],
    place_id: &str,
    rel_path: &str,
) -> Result<ResolvedPlaceFile, PlaceResolveError> {
    let place = places
        .iter()
        .find(|p| p.id == place_id)
        .ok_or(PlaceResolveError::Unregistered)?;
    let canon_root = canonical_place_root(place)?;
    resolve_in_root(Path::new(&place.root), &canon_root, rel_path)
}

/// resolve_in_places の前に、置き場の root へ届くかを時間切れつきで確かめる。
/// 時間切れ・届かないときは「届かない」（解決のファイル操作へ進まない）
fn resolve_in_places_probed(
    places: &[Place],
    probes: &PlaceProbes,
    place_id: &str,
    rel_path: &str,
    timeout: Duration,
    probe: impl Fn(&str) -> bool + Clone + Send + 'static,
) -> Result<ResolvedPlaceFile, PlaceResolveError> {
    let place = places
        .iter()
        .find(|p| p.id == place_id)
        .ok_or(PlaceResolveError::Unregistered)?;
    if !probe_places(probes, [place], timeout, probe).get(place_id).copied().unwrap_or(false) {
        return Err(PlaceResolveError::Unreachable);
    }
    resolve_in_places(places, place_id, rel_path)
}

#[cfg(test)]
fn stat_in_places(places: &[Place], item: &LinkRef) -> LinkStat {
    match resolve_in_places(places, &item.place_id, &item.rel_path) {
        Ok(r) => LinkStat { state: "ok", size: Some(r.size), mtime_ms: Some(r.mtime_ms) },
        Err(e) => LinkStat::state_only(e.state()),
    }
}

/// OS のフォルダ選択を開き、選ばれたパスを返す（キャンセルは None）。
/// save_bytes_with_dialog と同じく、コールバック＋mpsc で受ける（blocking_* は使わない）。
fn pick_folder_with_dialog(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let selected = rx.recv().map_err(|e| format!("選択ダイアログの結果取得に失敗: {e}"))?;
    match selected {
        None => Ok(None),
        Some(p) => p.into_path().map(Some).map_err(|e| format!("パスの解決に失敗: {e}")),
    }
}

/// OS のファイル選択を複数選択で開き、選ばれたパスを返す（キャンセルは None）。
fn pick_paths_with_dialog(app: &tauri::AppHandle) -> Result<Option<Vec<PathBuf>>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_files(move |p| {
        let _ = tx.send(p);
    });
    let selected = rx.recv().map_err(|e| format!("選択ダイアログの結果取得に失敗: {e}"))?;
    let Some(paths) = selected else { return Ok(None) };
    let paths = paths
        .into_iter()
        .map(|p| p.into_path().map_err(|e| format!("パスの解決に失敗: {e}")))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(if paths.is_empty() { None } else { Some(paths) })
}

/// 選ばれた 1 つのパスを、置き場の id と相対パスに直す。中身は読まない。
/// シンボリックリンクを選ばれても、実体で置き場を判定する
fn picked_file_from_path(
    places: &[Place],
    picked: &Path,
    roots: &mut HashMap<String, Option<PathBuf>>,
) -> Result<PickedFile, String> {
    let canon = fs::canonicalize(picked).map_err(|e| format!("ファイルに届きません: {e}"))?;
    let meta = fs::metadata(&canon).map_err(|e| format!("ファイル情報を取得できません: {e}"))?;
    if !meta.is_file() {
        return Err("ファイルではありません".to_string());
    }
    let found = locate_in_places_cached(places, &canon, roots);
    // あとで状態を確かめられない名前（改行や \ を含むなど）は、リンクしても「見つからない」のままになる
    if let Some((_, rel)) = &found {
        validate_place_rel_path(rel).map_err(|_| "扱えないファイル名です".to_string())?;
    }
    let name = canon
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(PickedFile {
        place_id: found.as_ref().map(|(id, _)| id.clone()),
        rel_path: found.map(|(_, rel)| rel),
        name,
        size: meta.len(),
        mtime_ms: metadata_mtime_ms(&meta),
    })
}

/// 選ばれたパスをまとめて直す。1 件届かなくても残りは返し、届かなかった件数を数える。
/// 上限を超えたらファイルに触る前に断る。stall の間 1 件も進まなければ打ち切り、残りは届かなかった扱い
fn picked_files_from_paths(
    places: &[Place],
    paths: &[PathBuf],
    stall: Duration,
    pick: impl Fn(&[Place], &Path, &mut HashMap<String, Option<PathBuf>>) -> Result<PickedFile, String>
        + Send
        + 'static,
) -> Result<PickedFiles, String> {
    if paths.len() > PLACE_PICK_MAX_FILES {
        return Err(format!("{PLACE_PICK_TOO_MANY_PREFIX}:{PLACE_PICK_MAX_FILES}"));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let (worker_places, worker_paths) = (places.to_vec(), paths.to_vec());
    // 止まった共有フォルダの I/O は中断できないので別スレッドで調べる。受け手が去れば次の送信で終わる
    thread::spawn(move || {
        let mut roots = HashMap::new();
        for path in &worker_paths {
            if tx.send(pick(&worker_places, path, &mut roots)).is_err() {
                break;
            }
        }
    });
    let mut files = Vec::with_capacity(paths.len());
    let mut done = 0usize;
    while done < paths.len() {
        let Ok(result) = rx.recv_timeout(stall) else { break };
        done += 1;
        if let Ok(file) = result {
            files.push(file);
        }
    }
    let failed = (paths.len() - files.len()) as u32;
    Ok(PickedFiles { files, failed })
}

/// 一覧用。root に届いた置き場だけ目印を読む（時間切れ・届かない置き場は
/// reachable: false・shared: false。全体で timeout 程度で戻る）
fn place_infos(
    places: &[Place],
    probes: &PlaceProbes,
    timeout: Duration,
    probe: impl Fn(&str) -> bool + Clone + Send + 'static,
) -> Vec<PlaceInfo> {
    let reach = probe_places(probes, places, timeout, probe);
    places
        .iter()
        .map(|p| place_info_with(p, reach.get(&p.id).copied().unwrap_or(false)))
        .collect()
}

#[tauri::command]
async fn place_list(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
) -> Result<Vec<PlaceInfo>, String> {
    require_main_window(&window)?;
    let ledger = place_ledger_path(&app)?;
    let inner = state.0.clone();
    let probes = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let places = read_places(&inner, &ledger, |p| p.to_vec());
        place_infos(&places, &probes, PLACE_PROBE_TIMEOUT, fs_root_reachable)
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))
}

#[tauri::command]
async fn place_register(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
) -> Result<Option<PlaceInfo>, String> {
    require_main_window(&window)?;
    let ledger = place_ledger_path(&app)?;
    let inner = state.0.clone();
    let data_dir = graphium_root().ok();
    let config_dir = app.path().app_config_dir().ok();
    let Some(picked) = pick_folder_with_dialog(&app)? else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<PlaceInfo>, String> {
        let canon = fs::canonicalize(&picked).map_err(|e| format!("フォルダに届きません: {e}"))?;
        if !canon.is_dir() {
            return Err("フォルダを選んでください".to_string());
        }
        let canon_or_raw = |p: PathBuf| fs::canonicalize(&p).unwrap_or(p);
        check_place_root_allowed(
            &canon,
            home_dir_canonical().as_deref(),
            data_dir.map(canon_or_raw).as_deref(),
            config_dir.map(canon_or_raw).as_deref(),
        )?;
        let root = canon.to_string_lossy().to_string();
        // 目印の読み書き（ファイル I/O）は台帳の Mutex の外で行う
        let snapshot = read_places(&inner, &ledger, |p| p.to_vec());
        if let Some(found) = snapshot.iter().find(|p| p.root == root) {
            return Ok(Some(place_info(found)));
        }
        let (prepared, _shared) = prepare_place(&canon, &snapshot);
        // Mutex を取り直したあとに、二重登録・id の重なりをもう一度確かめる
        let place = mutate_places(&inner, &ledger, |places| {
            if let Some(found) = places.iter().find(|p| p.root == root) {
                return Ok((found.clone(), false));
            }
            let mut place = prepared;
            if places.iter().any(|p| p.id == place.id) {
                place.id = uuid::Uuid::new_v4().hyphenated().to_string();
            }
            places.push(place.clone());
            Ok((place, true))
        })?;
        Ok(Some(place_info(&place)))
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

#[tauri::command]
async fn place_rename(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
    id: String,
    name: String,
) -> Result<PlaceInfo, String> {
    require_main_window(&window)?;
    let name = normalize_place_name(&name, false)?;
    let ledger = place_ledger_path(&app)?;
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let place = mutate_places(&inner, &ledger, |places| {
            let p = places
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| PlaceResolveError::Unregistered.message())?;
            p.name = name;
            Ok((p.clone(), true))
        })?;
        Ok(place_info(&place))
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

/// 台帳から外すだけ。目印もファイルも消さない
#[tauri::command]
async fn place_remove(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
    id: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    let ledger = place_ledger_path(&app)?;
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        mutate_places(&inner, &ledger, |places| {
            let before = places.len();
            places.retain(|p| p.id != id);
            Ok(((), places.len() != before))
        })
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

#[tauri::command]
async fn place_pick_files(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
) -> Result<Option<PickedFiles>, String> {
    require_main_window(&window)?;
    let ledger = place_ledger_path(&app)?;
    let inner = state.0.clone();
    let Some(picked) = pick_paths_with_dialog(&app)? else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<PickedFiles>, String> {
        // ファイルに触る間は台帳のロックを持たない
        let places = read_places(&inner, &ledger, |p| p.to_vec());
        picked_files_from_paths(&places, &picked, PLACE_PICK_STALL_TIMEOUT, picked_file_from_path).map(Some)
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

/// 件ごとの状態を同じ順で返す。置き場ごとに先に root へ届くかを確かめ（確認は置き場ごとに
/// 1 本・全体で timeout まで）、届かない・時間切れの置き場の件は個々を見ずに unreachable にする。
/// root の canonicalize と台帳の root との照合は置き場ごとに 1 回だけ行い、
/// ファイルごとには symlink_metadata と canonicalize だけを行う。
fn stat_many_in_places(
    places: &[Place],
    items: &[LinkRef],
    probes: &PlaceProbes,
    timeout: Duration,
    probe: impl Fn(&str) -> bool + Clone + Send + 'static,
) -> Vec<LinkStat> {
    let mut seen: HashSet<&str> = HashSet::new();
    let used: Vec<&Place> = items
        .iter()
        .filter(|it| seen.insert(it.place_id.as_str()))
        .filter_map(|it| places.iter().find(|p| p.id == it.place_id))
        .collect();
    let reachable = probe_places(probes, used.iter().copied(), timeout, probe);
    // 届いた置き場だけ、root を 1 回 canonicalize する
    let roots: HashMap<&str, Result<PathBuf, PlaceResolveError>> = used
        .iter()
        .filter(|p| reachable.get(&p.id).copied().unwrap_or(false))
        .map(|p| (p.id.as_str(), canonical_place_root(p)))
        .collect();
    items
        .iter()
        .map(|it| {
            let Some(place) = places.iter().find(|p| p.id == it.place_id) else {
                return LinkStat::state_only(PlaceResolveError::Unregistered.state());
            };
            let result = match roots.get(place.id.as_str()) {
                None => Err(PlaceResolveError::Unreachable),
                // 相対パスの形の不正は、root の状態より先に判定する（従来と同じ順）
                Some(Err(_)) => {
                    validate_place_rel_path(&it.rel_path).and(Err(PlaceResolveError::Unreachable))
                }
                Some(Ok(canon_root)) => {
                    resolve_in_root(Path::new(&place.root), canon_root, &it.rel_path)
                }
            };
            match result {
                Ok(r) => LinkStat { state: "ok", size: Some(r.size), mtime_ms: Some(r.mtime_ms) },
                Err(e) => LinkStat::state_only(e.state()),
            }
        })
        .collect()
}

/// 各件の状態を同じ順で返す。ファイルの中身は読まない（metadata だけ）
#[tauri::command]
async fn place_stat_many(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
    items: Vec<LinkRef>,
) -> Result<Vec<LinkStat>, String> {
    require_main_window(&window)?;
    if items.len() > PLACE_STAT_MAX_ITEMS {
        return Err(format!("一度に調べられるのは {PLACE_STAT_MAX_ITEMS} 件までです"));
    }
    let ledger = place_ledger_path(&app)?;
    let inner = state.0.clone();
    let probes = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let places = read_places(&inner, &ledger, |p| p.to_vec());
        stat_many_in_places(&places, &items, &probes, PLACE_PROBE_TIMEOUT, fs_root_reachable)
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))
}

/// 解決して、開く・表示する対象のパスを返す
async fn place_resolve_for_os(
    app: &tauri::AppHandle,
    state: &PlaceState,
    place_id: String,
    rel_path: String,
) -> Result<ResolvedPlaceFile, String> {
    let ledger = place_ledger_path(app)?;
    let inner = state.0.clone();
    let probes = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let places = read_places(&inner, &ledger, |p| p.to_vec());
        resolve_in_places_probed(
            &places,
            &probes,
            &place_id,
            &rel_path,
            PLACE_PROBE_TIMEOUT,
            fs_root_reachable,
        )
        .map_err(|e| e.message())
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

/// 置き場のファイルを、コピーを作らずそのまま OS のアプリで開く
#[tauri::command]
async fn place_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
    place_id: String,
    rel_path: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    let resolved = place_resolve_for_os(&app, &state, place_id, rel_path).await?;
    // 開いてよい種類の一覧にあるものだけ開く（実体のパスで判定。実行ビットは見ない）
    check_place_openable(&resolved.path)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_opener::OpenerExt;
        // OS へ渡す直前にもう一度確かめる（ごく短いすき間は残る。recheck_place_target 参照）
        recheck_place_target(&resolved.path).map_err(|e| e.message())?;
        app2.opener()
            .open_path(resolved.path.to_string_lossy().to_string(), None::<&str>)
            .map_err(|e| format!("アプリで開けませんでした: {e}"))
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

/// 置き場のファイルを、OS のファイラーで選択した状態で表示する
#[tauri::command]
async fn place_reveal(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PlaceState>,
    place_id: String,
    rel_path: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    // 種類は問わない（OS のファイル管理で場所を見せるだけ）。検査した実体のパスを使う
    let resolved = place_resolve_for_os(&app, &state, place_id, rel_path).await?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_opener::OpenerExt;
        // OS へ渡す直前にもう一度確かめる（ごく短いすき間は残る）
        recheck_place_target(&resolved.path).map_err(|e| e.message())?;
        app2.opener()
            .reveal_item_in_dir(&resolved.path)
            .map_err(|e| format!("場所を表示できませんでした: {e}"))
    })
    .await
    .map_err(|e| format!("タスク失敗: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            meeting_audio::meeting_rec_permission,
            meeting_audio::meeting_rec_open_screen_settings,
            meeting_audio::meeting_rec_start,
            meeting_audio::meeting_rec_stop,
            meeting_audio::meeting_rec_status,
            embedding_models::embedding_model_status,
            embedding_models::embedding_model_download,
            embedding_models::embedding_model_cancel,
            embedding_models::embedding_model_delete,
            embedding_models::embedding_embed,
            ocr_models::ocr_model_status,
            ocr_models::ocr_model_download,
            ocr_models::ocr_model_cancel,
            ocr_models::ocr_model_delete,
            ocr_models::ocr_recognize,
            meeting_transcribe::meeting_model_status,
            meeting_transcribe::meeting_model_download,
            meeting_transcribe::meeting_model_cancel,
            meeting_transcribe::meeting_model_delete,
            meeting_transcribe::meeting_transcribe_start,
            meeting_transcribe::meeting_transcribe_cancel,
            meeting_transcribe::meeting_transcribe_input_begin,
            meeting_transcribe::meeting_transcribe_input_append,
            meeting_transcribe::meeting_transcribe_input_finish,
            meeting_transcribe::meeting_transcribe_input_discard,
            meeting_transcribe::meeting_media_file_size,
            meeting_transcribe::save_media_transcript,
            meeting_transcribe::read_media_transcript,
            meeting_transcribe::save_media_sidecar,
            meeting_transcribe::read_media_sidecar,
            list_note_files,
            read_note_file,
            write_note_file,
            delete_note_file,
            list_wiki_files,
            read_wiki_file,
            write_wiki_file,
            delete_wiki_file,
            list_skill_files,
            read_skill_file,
            write_skill_file,
            delete_skill_file,
            save_media_file,
            read_media_file,
            open_media_in_app,
            list_changed_opened_copies,
            read_opened_copy,
            adopt_opened_copy,
            rebase_opened_copy,
            discard_opened_copy,
            read_media_thumbnail,
            save_media_text,
            read_media_text,
            delete_media_text,
            list_media_files_cmd,
            delete_media_file,
            rename_media_file,
            read_app_data,
            write_app_data,
            list_app_data_keys,
            delete_app_data,
            get_media_path,
            get_graphium_root,
            start_app_heartbeat,
            set_graphium_root,
            detect_legacy_drive_layout,
            migrate_legacy_drive_layout,
            shared_list,
            shared_read,
            shared_write,
            shared_delete,
            shared_readable_sync,
            shared_blob_read,
            shared_blob_write,
            shared_blob_exists,
            shared_blob_delete,
            shared_root_exists,
            shared_root_remote,
            shared_root_diagnose,
            shared_root_reconnect,
            inbox_list,
            inbox_read,
            inbox_mark_imported,
            inbox_discard,
            scan_directory,
            cancel_scan,
            read_scanned_file,
            app_ready,
            open_viewer_window,
            viewer_open_in_main,
            viewer_close_ack,
            shutdown_ack,
            kill_pid,
            get_api_token,
            save_bytes_with_dialog,
            place_list,
            place_register,
            place_rename,
            place_remove,
            place_pick_files,
            place_stat_many,
            place_open,
            place_reveal,
            print_webview,
            set_background_work_active,
            relaunch_via_launchd,
            start_native_sidecar,
            stop_native_sidecar,
            ui_zoom::get_ui_zoom,
            ui_zoom::set_ui_zoom,
            ui_zoom::step_ui_zoom,
        ])
        .manage(meeting_audio::MeetingRecState::default())
        .manage(meeting_transcribe::TranscribeState::default())
        .manage(embedding_models::EmbeddingState::default())
        .manage(ocr_models::OcrState::default())
        .manage(ui_zoom::ZoomState::default())
        .manage(NativeSidecarState::default())
        .manage(ScanAllowlistState::default())
        .manage(ScanCancelState::default())
        .manage(PlaceState::default())
        .setup(|app| {
            let _ = BOOT_AT.set(std::time::Instant::now());
            // ウィンドウのサイズ・位置を前回終了時の状態に復元する（デスクトップのみ）。
            // Windows の既定表示スケールは 150% なので、1920x1080 の実機でも Web 側から
            // 見える論理解像度は 1280x720 しかない。tauri.conf の初期サイズはそこに収まる
            // 値にしてあるが、広い画面のユーザーが毎回ウィンドウを広げ直す羽目にならない
            // よう、調整後のサイズを次回起動に引き継ぐ。
            #[cfg(desktop)]
            {
                use tauri_plugin_window_state::StateFlags;
                app.handle().plugin(
                    tauri_plugin_window_state::Builder::default()
                        // 既定は StateFlags::all() で、そこには VISIBLE が入る。
                        // 前回の表示状態まで復元されると、main が
                        // tauri.conf の visible=false を無視して起動直後に出て
                        // しまい、スプラッシュを出す意味が無くなる。表示の
                        // タイミングだけはこちらで持つ（reveal_main）。
                        .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
                        // スプラッシュは毎回中央に出す。位置を覚えると、main を
                        // 動かしたあとの起動でスプラッシュだけ前回の場所に出る。
                        .with_denylist(&[SPLASH_LABEL])
                        .build(),
                )?;
            }

            // フロントが app_ready を呼べないまま固まっても、非表示の main と
            // スプラッシュだけが残ってアプリが使えなくなることは避ける。
            //
            // ここが発火するのは異常時だけ ── のはずが、v0.45.1 ではフロントが
            // 非表示ウィンドウで requestAnimationFrame を待っており（非表示の
            // WebView は描画フレームを回さないので永久に発火しない）、この保険が
            // 毎起動の待ち時間そのものになっていた。保険が長いほど事故ったときの
            // 体感が悪くなるので、正常な起動に要る時間を少し超える程度に留める。
            {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(std::time::Duration::from_secs(8));
                    reveal_main(&handle, "timeout");
                });
            }

            // スプラッシュを手で閉じられたときも main を出す。非表示のまま
            // 残るとウィンドウの無いプロセスだけが生き続けることになる。
            if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
                let handle = app.handle().clone();
                splash.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        // reveal_main を呼ぶと close の最中に close を呼び返す
                        // ことになるので、main を出すところだけを直接やる。
                        if !MAIN_REVEALED.swap(true, Ordering::SeqCst) {
                            eprintln!("[splash] revealing main window via splash-closed");
                            if let Some(main) = handle.get_webview_window(MAIN_LABEL) {
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                        }
                    }
                });
            }

            // 旧形式（拡張子なし）メディアの拡張子付与マイグレーション。
            // フロントエンドのロード前に同期実行するので、読み込みとの競合はない。
            migrate_media_extensions();

            // 文字起こし用に渡された一時の wav（前回の取り消し漏れ・異常終了の残り）を消す
            meeting_transcribe::cleanup_input_tmp();

            // 記憶した拡大縮小の倍率を、main を見せる前に当てる。
            // 初回の描画から正しい幅になり、`innerWidth < 768` の判定などが
            // 100% の幅で誤判定しない。
            ui_zoom::restore_at_startup(app.handle());

            // メニューバー構築
            // ⌘⇧M (Quick Memo) はネイティブメニューのアクセラレータとして登録する。
            // 理由: WKWebView では Cmd 系ショートカットがメニューの key-equivalent 処理に
            // 先取りされ、JS の document keydown まで届かないことがある。ネイティブ項目に
            // すればキー配送に依存せず確実に発火し、メニューバーからも発見できる。
            let new_memo = MenuItemBuilder::with_id("new-memo", "New Memo")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?;

            // 拡大縮小もアクセラレータを付ける（メニューに表示され、macOS では
            // key-equivalent として確実に届く）。muda は '+' をキー名に書けないので、
            // 拡大は US 配列で「+」の位置にある '=' で指定する。JIS 配列の「+」（Shift + ';'）は
            // メニューでは拾えないため、フロントの keydown（src/lib/ui-zoom.ts）が受け持つ。
            // 両方が同じ押下で届いても ui_zoom 側が二重発火を捨てる。
            let zoom_in = MenuItemBuilder::with_id("zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;
            let zoom_out = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;

            // 印刷も ⌘P をアクセラレータに持たせる（⌘⇧M と同じ理由。フロントの keydown も
            // 同じキーを拾うが、印刷側が準備中の二度目を捨てる）
            let export_pdf = MenuItemBuilder::with_id("export-pdf", "Print / PDF")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .text("new-note", "New Note")
                .item(&new_memo)
                .separator()
                .item(&export_pdf)
                .text("export-prov", "Export PROV-JSON-LD")
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .text("toggle-graph", "Toggle Graph Panel")
                .text("toggle-chat", "Toggle AI Chat")
                .separator()
                .item(&zoom_in)
                .item(&zoom_out)
                .item(&zoom_reset)
                .build()?;

            let backend_menu = SubmenuBuilder::new(app, "Backend")
                .text("restart-backend", "Restart Backend")
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("about", "About Graphium")
                .text("release-notes", "Release Notes")
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&backend_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // メニューイベントハンドラ
            app.on_menu_event(move |app, event| {
                let window = app.get_webview_window("main").unwrap();
                let id = event.id().0.as_str();
                match id {
                    "new-note" | "new-memo" | "export-pdf" | "export-prov" | "toggle-graph"
                    | "toggle-chat" | "about" | "release-notes" | "restart-backend" => {
                        // フロントエンドにイベントを送信
                        let _ = window.emit("menu-action", id);
                    }
                    // 倍率は Rust が持つ（ui_zoom）。結果は ui-zoom-changed で届く
                    "zoom-in" => ui_zoom::step(app, 1, "menu"),
                    "zoom-out" => ui_zoom::step(app, -1, "menu"),
                    "zoom-reset" => ui_zoom::step(app, 0, "menu"),
                    _ => {}
                }
            });

            // 閉じるイベント制御: 一旦 prevent_close してフロントに通知し、
            // 未保存の編集の書き出しと sidecar 停止の後に shutdown_ack を受けて exit する。
            // フロントが応答しなくても CLOSE_FAILSAFE_SECS 秒のフェイルセーフで強制終了する。
            if let Some(main_window) = app.get_webview_window("main") {
                let window_handle = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if SHUTDOWN_ACK.load(Ordering::SeqCst) {
                            // ACK 済み → ハートビートを消してそのまま閉じる
                            heartbeat::stop_and_remove();
                            return;
                        }
                        api.prevent_close();
                        let _ = window_handle.emit("app-close-requested", ());

                        // フェイルセーフ: 時間内に ACK が来なければ強制終了
                        let app_handle = window_handle.app_handle().clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(CLOSE_FAILSAFE_SECS));
                            if !SHUTDOWN_ACK.load(Ordering::SeqCst) {
                                heartbeat::stop_and_remove();
                                app_handle.exit(0);
                            }
                        });
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // どの終了経路でもハートビートを残さない（失敗は握る）
            if let tauri::RunEvent::Exit = event {
                // 録音中なら止めて WAV を finalize・meta を書く（最大 3 秒）
                meeting_audio::stop_if_running(app);
                heartbeat::stop_and_remove();
            }
        });
}

// --- テスト ---

#[cfg(test)]
mod tests {
    use super::*;

    /// 別ウィンドウの行き先 ID: 空・長すぎ・制御文字入りは受け取らない
    #[test]
    fn viewer_id_validation() {
        assert!(is_valid_viewer_id("abc-123"));
        assert!(is_valid_viewer_id("wiki:abc"));
        assert!(!is_valid_viewer_id(""));
        assert!(!is_valid_viewer_id("a\nb"));
        // ノートのフォルダの外を指す形
        assert!(!is_valid_viewer_id("../../x"));
        assert!(!is_valid_viewer_id("a/b"));
        assert!(!is_valid_viewer_id("a\\b"));
        assert!(!is_valid_viewer_id("wiki:.."));
        assert!(!is_valid_viewer_id(&"a".repeat(VIEWER_ID_MAX_LEN + 1)));
    }

    /// 行き先はページの読み込み前のスクリプトに埋める。引用符や </script> が入った ID でも
    /// 代入文 1 つのままで、JSON として読み戻せること
    #[test]
    fn viewer_init_script_embeds_id_as_json() {
        let id = "a\"; alert(1); //</script>";
        let script = viewer_init_script(id);
        let json = script
            .strip_prefix("window.__GRAPHIUM_VIEWER__ = ")
            .and_then(|s| s.strip_suffix(';'))
            .expect("assignment shape");
        let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(parsed["kind"], "note");
        assert_eq!(parsed["id"], id);
    }

    /// tauri.conf.json の updater 設定が、プラグインの実際の型で読めること。
    /// 読めないとアプリが起動時に落ちる。requireSignedVersion は署名と版を結び付けて
    /// ダウングレード攻撃を防ぐ設定なので、うっかり外れないようここで固定する
    /// （CI の tauri-build.yml は版の無い署名を公開しないガードを持つ）。
    #[test]
    fn updater_config_parses_and_requires_signed_version() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(conf["plugins"]["updater"].clone()).unwrap();
        assert!(updater.require_signed_version);
        assert!(!updater.pubkey.is_empty());
        assert_eq!(updater.endpoints.len(), 2);
    }

    #[test]
    fn opened_copy_file_name_keeps_name_and_ext() {
        assert_eq!(opened_copy_file_name("報告書.docx", "m1", Some("docx")), "報告書.docx");
        // 表示名に拡張子が無ければ本体の拡張子を足す
        assert_eq!(opened_copy_file_name("報告書", "m1", Some("docx")), "報告書.docx");
        assert_eq!(opened_copy_file_name("Data.XLSX", "m1", Some("xlsx")), "Data.XLSX");
        // パス・使えない文字・末尾のドットは落とす
        assert_eq!(opened_copy_file_name("../../etc/a.pptx", "m1", Some("pptx")), "a.pptx");
        assert_eq!(opened_copy_file_name("a\\b:c?.docx", "m1", Some("docx")), "b_c_.docx");
        assert_eq!(opened_copy_file_name("memo. ", "m1", Some("docx")), "memo.docx");
        // 空・.. なら id を使う
        assert_eq!(opened_copy_file_name("", "m1", Some("docx")), "m1.docx");
        assert_eq!(opened_copy_file_name("..", "m1", None), "m1");
    }

    /// テスト用の作業フォルダ（テストごとに分ける）
    fn opened_test_root(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("graphium-opened-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("media")).unwrap();
        base
    }

    #[test]
    fn write_opened_copy_keeps_edits_and_refreshes_untouched_copies() {
        let base = opened_test_root("write");
        let src = base.join("media").join("m1.xlsx");
        fs::write(&src, b"v1").unwrap();
        let out = base.join("opened").join("m1");

        // 1 回目: 表示名で置く（編集できる）
        let dest = write_opened_copy(&src, &out, "発酵記録.xlsx", "m1").unwrap();
        assert_eq!(dest, out.join("発酵記録.xlsx"));
        assert_eq!(fs::read(&dest).unwrap(), b"v1");
        assert!(!fs::metadata(&dest).unwrap().permissions().readonly());

        // 手つかずのコピーは、原本が変わったら置き直す
        fs::write(&src, b"v2").unwrap();
        write_opened_copy(&src, &out, "発酵記録.xlsx", "m1").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"v2");

        // 外で編集されたコピーは、開き直しても上書きしない
        fs::write(&dest, b"edited").unwrap();
        assert_eq!(write_opened_copy(&src, &out, "発酵記録.xlsx", "m1").unwrap(), dest);
        assert_eq!(fs::read(&dest).unwrap(), b"edited");

        // 前の版が残した読み取り専用のコピーも、開くときに書けるようにする
        let mut perms = fs::metadata(&dest).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&dest, perms).unwrap();
        write_opened_copy(&src, &out, "発酵記録.xlsx", "m1").unwrap();
        assert!(!fs::metadata(&dest).unwrap().permissions().readonly());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn changed_copies_are_listed_then_adopted_or_rebased() {
        let base = opened_test_root("flow");
        let media = base.join("media");
        let opened = base.join("opened");
        fs::write(media.join("m1.docx"), b"v1").unwrap();
        fs::write(media.join("m2.docx"), b"other").unwrap();
        let copy1 = write_opened_copy(&media.join("m1.docx"), &opened.join("m1"), "計画.docx", "m1").unwrap();
        write_opened_copy(&media.join("m2.docx"), &opened.join("m2"), "メモ.docx", "m2").unwrap();

        // 何も編集していなければ一覧は空。Word の作業ファイルは無視する
        fs::write(opened.join("m1").join("~$計画.docx"), b"lock").unwrap();
        assert!(collect_changed_opened_copies(&opened, &media).is_empty());

        // 編集したものだけが出る
        fs::write(&copy1, b"v1 edited").unwrap();
        let changed = collect_changed_opened_copies(&opened, &media);
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].file_id, "m1");
        assert_eq!(changed[0].file_name, "計画.docx");

        // 上書きで取り込むと原本が変わり、一覧から消える
        let hash = adopt_opened_copy_sync(&opened.join("m1"), &media, "m1").unwrap();
        assert_eq!(fs::read(media.join("m1.docx")).unwrap(), b"v1 edited");
        assert_eq!(hash, format!("sha256:{}", sha256_hex(b"v1 edited")));
        assert!(collect_changed_opened_copies(&opened, &media).is_empty());

        // 新しい版として取り込んだら、コピーをその版へ付け替える
        fs::write(&copy1, b"v2 draft").unwrap();
        fs::write(media.join("m3.docx"), b"v2 draft").unwrap();
        rebase_opened_copy_sync(&opened.join("m1"), &opened.join("m3")).unwrap();
        assert!(!opened.join("m1").exists());
        assert_eq!(fs::read(opened.join("m3").join("計画.docx")).unwrap(), b"v2 draft");
        assert!(collect_changed_opened_copies(&opened, &media).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn app_data_key_validation() {
        assert!(validate_app_data_key("maint-run_1").is_ok());
        assert!(validate_app_data_key(&"a".repeat(200)).is_ok());
        assert!(validate_app_data_key("").is_err());
        assert!(validate_app_data_key(&"a".repeat(201)).is_err());
        for bad in ["a/b", "a\\b", "..", ".x", "snapshot:1", "a b", "あ"] {
            assert!(validate_app_data_key(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn app_data_list_filters_prefix_ext_and_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        fs::write(d.join("maint-run-a.json"), "{}").unwrap();
        fs::write(d.join("maint-run-b.json"), "{}").unwrap();
        fs::write(d.join("maint-copy-a.json"), "{}").unwrap();
        fs::write(d.join("maint-run-c.txt"), "x").unwrap();
        fs::write(d.join("maint-run-d.json.bak"), "x").unwrap();
        fs::create_dir(d.join("maint-run-dir.json")).unwrap();
        let mut keys = list_app_data_keys_in(d, "maint-run-").unwrap();
        keys.sort();
        assert_eq!(keys, vec!["maint-run-a", "maint-run-b"]);
        assert!(list_app_data_keys_in(d, "").is_err());
        assert!(list_app_data_keys_in(d, "../x").is_err());
        // ディレクトリが無ければ空
        assert!(list_app_data_keys_in(&d.join("none"), "a").unwrap().is_empty());
    }

    #[test]
    fn app_data_delete_removes_file_and_tolerates_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        fs::write(d.join("k1.json"), "{}").unwrap();
        fs::write(d.join("k2.json"), "{}").unwrap();
        delete_app_data_in(d, "k1").unwrap();
        assert!(!d.join("k1.json").exists());
        assert!(d.join("k2.json").exists());
        // 無くても成功
        delete_app_data_in(d, "k1").unwrap();
        // 不正なキーは拒否（ファイルは触らない）
        assert!(delete_app_data_in(d, "../k2").is_err());
        assert!(delete_app_data_in(d, "").is_err());
        assert!(d.join("k2.json").exists());
    }

    #[test]
    fn app_data_file_name_roundtrip() {
        assert_eq!(app_data_file_name("a:b%c"), "a%3Ab%25c.json");
        assert_eq!(app_data_key_from_file_name("a%3Ab%25c"), "a:b%c");
        // `%3A` という文字列そのものを含むキーも往復できる（単射）
        for k in ["plain", "snapshot:abc", "x%3Ay", "%25", "a%:b", "日本:語"] {
            let f = app_data_file_name(k);
            assert!(!f.contains(':'));
            assert_eq!(app_data_key_from_file_name(f.strip_suffix(".json").unwrap()), k);
        }
    }

    #[test]
    fn app_data_read_migrates_legacy_name_and_prefers_new() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        // Windows の ADS は再現できないので、`:` の代わりに `%` を含むキーで旧来名を再現する
        fs::write(d.join("a%b.json"), "legacy").unwrap();
        assert_eq!(read_app_data_in(d, "a%b").unwrap().as_deref(), Some("legacy"));
        // 新しい名前へ移行され、旧ファイルは残る
        assert_eq!(fs::read_to_string(d.join("a%25b.json")).unwrap(), "legacy");
        assert!(d.join("a%b.json").exists());
        // 新しい名前があればそちらが優先
        fs::write(d.join("a%25b.json"), "new").unwrap();
        assert_eq!(read_app_data_in(d, "a%b").unwrap().as_deref(), Some("new"));
        // どちらも無ければ None
        assert!(read_app_data_in(d, "zzz").unwrap().is_none());
    }

    #[test]
    fn app_data_write_replaces_the_file_and_leaves_no_temp_file() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        write_app_data_in(d, "note-index", "{\"v\":1}").unwrap();
        write_app_data_in(d, "note-index", "{\"v\":2}").unwrap();
        assert_eq!(read_app_data_in(d, "note-index").unwrap().as_deref(), Some("{\"v\":2}"));
        let names: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["note-index.json"]);
    }

    #[test]
    fn app_data_write_uses_encoded_name_and_list_decodes() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        write_app_data_in(d, "snapshot:abc", "{}").unwrap();
        assert!(d.join("snapshot%3Aabc.json").exists());
        assert_eq!(read_app_data_in(d, "snapshot:abc").unwrap().as_deref(), Some("{}"));
        // 一覧は逆変換を通る。変換後のキーが検証規則（`:` 不可）に通らないものは従来どおり除外
        fs::write(d.join("k-1.json"), "{}").unwrap();
        assert_eq!(list_app_data_keys_in(d, "k-").unwrap(), vec!["k-1"]);
        assert!(list_app_data_keys_in(d, "snapshot").unwrap().is_empty());
    }

    /// meta.json と本体（旧形式）のペアをテンポラリディレクトリに作る
    fn put_legacy_media(dir: &std::path::Path, id: &str, name: &str, mime: &str, bytes: &[u8]) {
        let meta = serde_json::json!({
            "id": id,
            "name": name,
            "mimeType": mime,
            "createdTime": "2026-01-01T00:00:00Z",
        });
        fs::write(
            dir.join(format!("{id}.meta.json")),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        fs::write(dir.join(id), bytes).unwrap();
    }

    #[test]
    fn blob_write_creates_blobs_dir_inside_a_visible_shared_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let shared = tmp.path().join("commons");
        fs::create_dir_all(&shared).unwrap();
        let blobs = shared.join("_blobs");
        let hash = format!("sha256:{}", "ab".repeat(32));
        shared_blob_dir(blobs.to_str().unwrap(), &hash).unwrap();
        assert!(blobs.join("ab").is_dir());
    }

    #[test]
    fn blob_write_does_not_create_blobs_dir_when_shared_folder_is_gone() {
        let tmp = tempfile::tempdir().unwrap();
        // 共有フォルダ（親）が無い = マウントが外れている。手元に置き場を作らない
        let blobs = tmp.path().join("unmounted").join("_blobs");
        let hash = format!("sha256:{}", "cd".repeat(32));
        assert!(shared_blob_dir(blobs.to_str().unwrap(), &hash).is_err());
        assert!(!blobs.exists());
    }

    #[test]
    fn blob_write_does_not_create_a_custom_blob_root() {
        let tmp = tempfile::tempdir().unwrap();
        // 利用者が選んだ別の名前の置き場は、これまでどおり作らない
        let custom = tmp.path().join("my-blobs");
        let hash = format!("sha256:{}", "ef".repeat(32));
        assert!(shared_blob_dir(custom.to_str().unwrap(), &hash).is_err());
        assert!(!custom.exists());
    }

    #[test]
    fn shared_list_does_not_create_type_dir() {
        // 読むだけの経路は共有フォルダに何も作らない（書けないメンバーでも開ける）
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let out = shared_list(root.clone(), "knowledge".into()).unwrap();
        assert!(out.is_empty());
        assert!(!tmp.path().join("knowledge").exists());
        // blob の存在確認も同じ
        let hash = format!("sha256:{}", "ab".repeat(32));
        assert!(!shared_blob_exists(root, hash).unwrap());
        assert!(!tmp.path().join("ab").exists());
    }

    #[test]
    fn shared_list_drops_files_whose_inner_id_differs_from_file_name() {
        // ファイル名（stem）と中身の entry.id が違うものは一覧に出さない
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let dir = tmp.path().join("knowledge");
        fs::create_dir_all(&dir).unwrap();
        let real = "0192a000-0000-7000-8000-000000000001";
        let other = "0192a000-0000-7000-8000-000000000002";
        let shadow = "0192a000-0000-7000-8000-000000000003";
        fs::write(dir.join(format!("{real}.json")), format!(r#"{{"entry":{{"id":"{real}"}}}}"#)).unwrap();
        // 別の entry の id を書いた影
        fs::write(dir.join(format!("{shadow}.json")), format!(r#"{{"entry":{{"id":"{other}"}}}}"#)).unwrap();
        // 壊れた JSON
        fs::write(dir.join("0192a000-0000-7000-8000-000000000004.json"), "not json").unwrap();
        let out = shared_list(root, "knowledge".into()).unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].contains(real));
    }

    #[test]
    fn mount_output_yields_smb_url_for_deepest_network_volume() {
        // macOS の mount 出力。/ も一致するが、ネットワーク FS でない行は無視し、
        // 最も深いマウントポイント（/Volumes/Kumagai）の smbfs を smb:// に直す
        let out = "\
/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
//kumagai@nas.local/Kumagai on /Volumes/Kumagai (smbfs, nodev, nosuid, mounted by kumagai)
nas.local:/export on /Volumes/export (nfs, nodev, nosuid)
";
        let root = Path::new("/Volumes/Kumagai/graphium_commons");
        assert_eq!(
            remote_from_mount_output(out, root).as_deref(),
            Some("smb://kumagai@nas.local/Kumagai")
        );
        let nfs_root = Path::new("/Volumes/export/graphium");
        assert_eq!(
            remote_from_mount_output(out, nfs_root).as_deref(),
            Some("nfs://nas.local/export")
        );
        // ローカルディスクのフォルダは None（再接続の対象ではない）
        assert_eq!(remote_from_mount_output(out, Path::new("/Users/k/Documents")), None);
    }

    #[test]
    fn net_use_output_yields_unc_share_root() {
        // Windows の net use 出力は列見出しが言語で変わるので、行の中の \\ だけを拾う
        let out = "\
Status       Local     Remote                    Network
-------------------------------------------------------------------------------
OK           Z:        \\\\nas\\Kumagai\\deeper        Microsoft Windows Network
";
        assert_eq!(unc_from_net_use_output(out, "z:").as_deref(), Some("\\\\nas\\Kumagai"));
        assert_eq!(unc_from_net_use_output(out, "Y:"), None);
        assert_eq!(unc_share_root("\\\\nas\\Kumagai\\graphium_commons"), "\\\\nas\\Kumagai");
    }

    #[test]
    fn diagnose_finds_sibling_volume_with_same_subfolder() {
        // /Volumes/Kumagai が外れて /Volumes/Kumagai-1 に同じ中身がある典型例
        let tmp = tempfile::tempdir().unwrap();
        let volumes = tmp.path();
        fs::create_dir_all(volumes.join("Kumagai-1").join("graphium_commons")).unwrap();
        fs::create_dir_all(volumes.join("Kumagai-2")).unwrap(); // 中身が無いので候補にしない
        fs::create_dir_all(volumes.join("Kumagaix").join("graphium_commons")).unwrap(); // 別名
        let root = volumes.join("Kumagai").join("graphium_commons");
        let alts = alternatives_by_sibling_volume(&root, volumes);
        assert_eq!(
            alts,
            vec![volumes.join("Kumagai-1").join("graphium_commons").to_string_lossy().to_string()]
        );
        // 到達できるときは候補を出さない
        let d = shared_root_diagnose(volumes.to_string_lossy().to_string(), None);
        assert!(d.reachable && d.alternatives.is_empty());
    }

    #[test]
    fn reconnect_rejects_anything_but_network_share_addresses() {
        // 任意の URL / パスを開く口にしない
        assert!(shared_root_reconnect("https://example.com".into()).is_err());
        assert!(shared_root_reconnect("/Users/k".into()).is_err());
        assert!(shared_root_reconnect("".into()).is_err());
        assert!(shared_root_reconnect("\\\\nas/share".into()).is_err());
    }

    #[test]
    fn shared_read_paths_reject_unreachable_root() {
        // NAS 未マウント・パス違いは「空」ではなく到達不能として返す
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("not-mounted").to_string_lossy().to_string();
        let err = shared_list(missing.clone(), "notes".into()).unwrap_err();
        assert!(err.contains("到達できません"), "{err}");
        let hash = format!("sha256:{}", "ab".repeat(32));
        let err = shared_blob_exists(missing, hash).unwrap_err();
        assert!(err.contains("到達できません"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn shared_readonly_root_can_list_but_write_explains_permission() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        // 先に誰かが notes/ だけ作った共有フォルダを、書けないメンバーが開く状況
        fs::create_dir_all(tmp.path().join("notes")).unwrap();
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o555)).unwrap();
        // root 所有者が root ユーザー（CI 等）だと chmod が効かないので、その場合は飛ばす
        if fs::create_dir(tmp.path().join("probe")).is_ok() {
            fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }
        assert!(shared_list(root.clone(), "notes".into()).unwrap().is_empty());
        assert!(shared_list(root.clone(), "templates".into()).unwrap().is_empty());
        let err = shared_write(
            root.clone(),
            "templates".into(),
            "0190e8c0-0000-7000-8000-000000000000".into(),
            "{}".into(),
            None,
            None,
        )
        .unwrap_err();
        assert!(err.contains("書き込み権限"), "{err}");
        assert!(err.contains("templates"), "{err}");
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn shared_entry_types_accepts_knowledge_and_rejects_legacy() {
        assert!(validate_entry_type("knowledge").is_ok());
        assert!(validate_entry_type("notes").is_ok());
        // TS 側から一度も書かれたことのない旧フォルダ名は許可しない
        assert!(validate_entry_type("concepts").is_err());
        assert!(validate_entry_type("atoms").is_err());
        // パストラバーサル防御
        assert!(validate_entry_type("../notes").is_err());
        assert!(validate_entry_type("").is_err());
    }

    #[test]
    fn media_ext_prefers_name_extension() {
        assert_eq!(media_ext("photo.JPG", "image/png"), Some("jpg".into()));
        assert_eq!(media_ext("archive.tar.gz", ""), Some("gz".into()));
    }

    #[test]
    fn media_ext_falls_back_to_mime() {
        assert_eq!(media_ext("pasted-image", "image/jpeg"), Some("jpg".into()));
        assert_eq!(media_ext("", "application/pdf"), Some("pdf".into()));
    }

    #[test]
    fn media_ext_rejects_reserved_and_invalid() {
        // "txt" は Reader 原文（{id}.txt）専用なので本体には使わない
        assert_eq!(media_ext("notes.txt", "text/plain"), None);
        // 不正な拡張子（非英数字・過長）は無視して MIME にフォールバック
        assert_eq!(media_ext("weird.pn g", "image/png"), Some("png".into()));
        assert_eq!(media_ext("noext", "application/unknown"), None);
    }

    #[test]
    fn find_media_data_file_resolves_new_and_legacy() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        // 旧形式（拡張子なし）
        fs::write(dir.join("legacy-id"), b"legacy").unwrap();
        assert_eq!(
            find_media_data_file(dir, "legacy-id"),
            Some(dir.join("legacy-id"))
        );

        // 新形式（拡張子付き）
        fs::write(dir.join("new-id.jpg"), b"new").unwrap();
        assert_eq!(
            find_media_data_file(dir, "new-id"),
            Some(dir.join("new-id.jpg"))
        );

        // meta.json / txt は本体として拾わない
        fs::write(dir.join("only-meta.meta.json"), b"{}").unwrap();
        fs::write(dir.join("only-meta.txt"), b"reader text").unwrap();
        assert_eq!(find_media_data_file(dir, "only-meta"), None);

        // 存在しない id / 空 id
        assert_eq!(find_media_data_file(dir, "missing"), None);
        assert_eq!(find_media_data_file(dir, ""), None);
    }

    #[test]
    fn migrate_renames_legacy_media_using_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        put_legacy_media(dir, "img-1", "photo.jpg", "image/jpeg", b"jpeg-bytes");
        put_legacy_media(dir, "doc-1", "report.docx", "application/msword", b"doc-bytes");
        // 拡張子を決められないもの（name 拡張子なし・MIME 不明）はそのまま残る
        put_legacy_media(dir, "unknown-1", "mystery", "application/x-unknown", b"???");
        // Reader 原文 .txt は無関係に維持される
        fs::write(dir.join("img-1.txt"), b"reader text").unwrap();

        migrate_media_extensions_in(dir);

        assert!(dir.join("img-1.jpg").is_file());
        assert!(!dir.join("img-1").exists());
        assert_eq!(fs::read(dir.join("img-1.jpg")).unwrap(), b"jpeg-bytes");
        // name の拡張子（docx）が MIME 推定より優先される
        assert!(dir.join("doc-1.docx").is_file());
        assert!(dir.join("unknown-1").is_file());
        assert!(dir.join("img-1.txt").is_file());

        // 再実行しても安全（冪等）
        migrate_media_extensions_in(dir);
        assert!(dir.join("img-1.jpg").is_file());
    }

    #[test]
    fn migrate_skips_when_target_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        put_legacy_media(dir, "dup-1", "a.png", "image/png", b"old");
        fs::write(dir.join("dup-1.png"), b"already-migrated").unwrap();

        migrate_media_extensions_in(dir);

        // 既存の新形式を上書きしない（衝突ガード）
        assert_eq!(fs::read(dir.join("dup-1.png")).unwrap(), b"already-migrated");
        assert!(dir.join("dup-1").is_file());
    }

    /// 透明地に黒い文字、という図（スライドや文書から取り出した PNG）を作る
    fn transparent_figure() -> image::DynamicImage {
        let mut img = image::RgbaImage::from_pixel(400, 200, image::Rgba([0, 0, 0, 0]));
        for x in 50..350 {
            for y in 90..110 {
                img.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
            }
        }
        image::DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn thumbnail_keeps_transparency_as_png() {
        let out = encode_thumbnail(&transparent_figure(), 320).unwrap();
        assert!(out.starts_with(b"\x89PNG"), "透過のある画像は PNG で返す");
        let decoded = image::load_from_memory(&out).unwrap().to_rgba8();
        assert_eq!(decoded.width(), 320);
        // 地の部分は透明のまま（JPEG 化で黒く塗られていない）
        assert_eq!(decoded.get_pixel(5, 5).0[3], 0);
        // 文字の部分は残っている
        assert_eq!(decoded.get_pixel(160, 80).0, [0, 0, 0, 255]);
    }

    #[test]
    fn thumbnail_of_opaque_image_is_jpeg() {
        // アルファチャンネルがあっても全面不透明なら JPEG（写真の PNG で容量を膨らませない）
        let opaque = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            400,
            200,
            image::Rgba([200, 180, 160, 255]),
        ));
        let out = encode_thumbnail(&opaque, 320).unwrap();
        assert!(out.starts_with(&[0xFF, 0xD8]), "不透明な画像は JPEG で返す");
        let rgb = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(64, 64, image::Rgb([1, 2, 3])));
        assert!(encode_thumbnail(&rgb, 320).unwrap().starts_with(&[0xFF, 0xD8]));
    }

    // --- walk_intake_directory / read_scanned_file 照合 ---

    /// walk_intake_directory 用のテンポラリディレクトリ。
    /// tempfile クレートは使わず std::env::temp_dir() 配下に一意な名前で作り、
    /// Drop で必ず削除する（symlink を含むツリーでも remove_dir_all で丸ごと消せる）。
    struct ScanTestDir {
        path: PathBuf,
    }

    impl ScanTestDir {
        fn new(label: &str) -> Self {
            let unique = format!(
                "graphium-scan-test-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for ScanTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn walk_intake_directory_counts_nested_files_and_uses_slash_relative_path() {
        let tmp = ScanTestDir::new("nested");
        let root = &tmp.path;
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("a/b/c.txt"), b"c").unwrap();
        fs::write(root.join("x.txt"), b"x").unwrap();

        let cancel = AtomicBool::new(false);
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 100, &cancel, Duration::from_secs(3600), |_| {});

        assert!(!outcome.truncated);
        assert!(!outcome.cancelled);
        assert_eq!(outcome.files.len(), 2);
        let mut relative: Vec<&str> = outcome
            .files
            .iter()
            .map(|f| f.relative_path.as_str())
            .collect();
        relative.sort();
        assert_eq!(relative, vec!["a/b/c.txt", "x.txt"]);
    }

    #[cfg(unix)]
    #[test]
    fn walk_intake_directory_unix_skips_symlinks_and_terminates_on_loop() {
        let tmp = ScanTestDir::new("symlink");
        let root = &tmp.path;
        fs::write(root.join("real.txt"), b"real").unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/inner.txt"), b"inner").unwrap();
        // 親（root）を指すシンボリックリンク。誤って辿るとループする。
        std::os::unix::fs::symlink(root, root.join("sub/loop-to-root")).unwrap();
        // ファイルを指すシンボリックリンクも対象外にする。
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("link-to-file")).unwrap();

        let cancel = AtomicBool::new(false);
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 1000, &cancel, Duration::from_secs(3600), |_| {});

        // ループを辿っていれば有限時間で戻ってこない。ここまで到達した時点で
        // 「有限時間で終わる」ことは確認できている。
        assert!(!outcome.truncated);
        assert!(!outcome.cancelled);
        let mut relative: Vec<&str> = outcome
            .files
            .iter()
            .map(|f| f.relative_path.as_str())
            .collect();
        relative.sort();
        // シンボリックリンク（ループ側・ファイル側とも）は含まれない。
        assert_eq!(relative, vec!["real.txt", "sub/inner.txt"]);
    }

    #[test]
    fn walk_intake_directory_truncates_at_max_files() {
        let tmp = ScanTestDir::new("truncate");
        let root = &tmp.path;
        for i in 0..5 {
            fs::write(root.join(format!("f{i}.txt")), b"x").unwrap();
        }

        let cancel = AtomicBool::new(false);
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 3, &cancel, Duration::from_secs(3600), |_| {});

        assert!(outcome.truncated);
        assert!(!outcome.cancelled);
        assert_eq!(outcome.files.len(), 3);
    }

    #[test]
    fn walk_intake_directory_is_breadth_first_so_shallow_sibling_survives_truncation() {
        let tmp = ScanTestDir::new("bfs");
        let root = &tmp.path;
        // heavy 配下は深い階層（heavy/sub）に大量のファイル、light は直下に少数のファイル。
        // 深さ優先だと heavy/sub だけで上限を使い切り、light が 1 件も拾われない。
        fs::create_dir_all(root.join("heavy/sub")).unwrap();
        for i in 0..10 {
            fs::write(root.join(format!("heavy/sub/f{i}.txt")), b"x").unwrap();
        }
        fs::create_dir_all(root.join("light")).unwrap();
        fs::write(root.join("light/g0.txt"), b"x").unwrap();
        fs::write(root.join("light/g1.txt"), b"x").unwrap();

        let cancel = AtomicBool::new(false);
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 5, &cancel, Duration::from_secs(3600), |_| {});

        assert!(outcome.truncated);
        assert_eq!(outcome.files.len(), 5);
        let light_count = outcome
            .files
            .iter()
            .filter(|f| f.relative_path.starts_with("light/"))
            .count();
        assert_eq!(
            light_count, 2,
            "幅優先なら浅い light/ は上限に達しても両方拾われるはず: {:?}",
            outcome.files
        );
    }

    #[test]
    fn walk_intake_directory_cancelled_from_start_returns_empty() {
        let tmp = ScanTestDir::new("cancel");
        let root = &tmp.path;
        fs::write(root.join("f.txt"), b"x").unwrap();

        let cancel = AtomicBool::new(true);
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 100, &cancel, Duration::from_secs(3600), |_| {});

        assert!(outcome.cancelled);
        assert!(outcome.files.is_empty());
    }

    // --- ScanCancelState（走査 ID ごとの中止フラグ表） ---

    #[test]
    fn scan_cancel_state_flags_are_independent_per_scan_id() {
        let state = ScanCancelState::default();
        let flag_a = state.begin("scan-a");
        let flag_b = state.begin("scan-b");

        state.cancel("scan-a");

        assert!(flag_a.load(Ordering::Relaxed), "cancel(A) は A のフラグを立てる");
        assert!(
            !flag_b.load(Ordering::Relaxed),
            "cancel(A) が B のフラグまで立ててはいけない（プロセス全体で 1 つの中止フラグだった旧実装の再発防止）"
        );
    }

    #[test]
    fn scan_cancel_state_cancel_before_begin_is_not_lost() {
        let state = ScanCancelState::default();

        // scan_directory と cancel_scan は別々の invoke で、どちらが先に
        // Rust 側へ届くかの保証が無い。cancel が begin より先に届いても
        // 中止要求を失ってはいけない。
        state.cancel("scan-early-cancel");
        let flag = state.begin("scan-early-cancel");

        assert!(
            flag.load(Ordering::Relaxed),
            "begin より先に cancel が届いていた場合、begin が返すフラグは中止済み（true）であるべき"
        );
    }

    #[test]
    fn scan_cancel_state_begin_after_end_starts_fresh() {
        let state = ScanCancelState::default();
        let first = state.begin("scan-reused-id");
        first.store(true, Ordering::Relaxed);
        state.end("scan-reused-id");

        let second = state.begin("scan-reused-id");

        assert!(
            !second.load(Ordering::Relaxed),
            "end() のあと同じ id で begin すると false から始まる（前の走査の中止状態を引きずらない）"
        );
    }

    #[test]
    fn scan_cancel_state_evicts_only_cancelled_entries_when_table_is_full() {
        let state = ScanCancelState::default();
        // 上限ちょうどまで埋める。前半は進行中（false）、後半は中止済み（true）。
        for i in 0..SCAN_CANCEL_TABLE_MAX {
            let flag = state.begin(&format!("scan-{i}"));
            if i >= SCAN_CANCEL_TABLE_MAX / 2 {
                flag.store(true, Ordering::Relaxed);
            }
        }

        // 表が上限に達した状態でさらに 1 件追加すると、間引きが走る。
        let new_flag = state.begin("scan-overflow");
        assert!(
            !new_flag.load(Ordering::Relaxed),
            "新規エントリは false で始まる"
        );

        let guard = state.0.lock().unwrap();
        assert!(
            guard.len() <= SCAN_CANCEL_TABLE_MAX + 1,
            "際限なく膨らんではいけない: {}",
            guard.len()
        );
        // 進行中だった前半のエントリは間引かれずに残っているはず。
        for i in 0..SCAN_CANCEL_TABLE_MAX / 2 {
            assert!(
                guard.contains_key(&format!("scan-{i}")),
                "進行中（false）のエントリを間引いてはいけない: scan-{i}"
            );
        }
    }

    #[test]
    fn scan_cancel_state_flag_cancels_running_walk() {
        let tmp = ScanTestDir::new("cancel-state-walk");
        let root = &tmp.path;
        fs::write(root.join("f.txt"), b"x").unwrap();

        let state = ScanCancelState::default();
        let flag = state.begin("scan-walk");
        state.cancel("scan-walk");

        let outcome = walk_intake_directory(root, &ScanFilter::default(), 100, &flag, Duration::from_secs(3600), |_| {});

        assert!(outcome.cancelled, "begin 後に cancel したフラグを渡すと走査は中止される");
        assert!(outcome.files.is_empty());
    }

    #[test]
    fn walk_intake_directory_zero_interval_reports_monotonic_progress() {
        let tmp = ScanTestDir::new("progress");
        let root = &tmp.path;
        for i in 0..5 {
            fs::write(root.join(format!("f{i}.txt")), b"x").unwrap();
        }

        let cancel = AtomicBool::new(false);
        let calls = std::cell::RefCell::new(Vec::new());
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 100, &cancel, Duration::ZERO, |p| {
            calls.borrow_mut().push((p.found, p.folders));
        });

        assert_eq!(outcome.files.len(), 5);
        let calls = calls.into_inner();
        assert_eq!(calls.len(), 5, "ZERO 間隔なら毎ファイルで呼ばれるはず: {calls:?}");
        for pair in calls.windows(2) {
            assert!(pair[0].0 < pair[1].0, "found は単調増加であるはず: {calls:?}");
        }
        assert_eq!(calls.last().unwrap().0, 5);
    }

    #[test]
    fn walk_intake_directory_zero_interval_reports_progress_for_folder_only_tree() {
        // ファイルを 1 件も含まない、入れ子のフォルダだけのツリー（NAS の深い
        // バックアップツリーのように、浅い階層がフォルダばかりでファイルが
        // 1 件も見つからない区間を模している）。
        //
        // 直す前の実装（on_progress をファイル追加の直後にしか呼ばない）では
        // ファイルが 1 件も追加されないため on_progress が一度も呼ばれず、
        // このテストは calls が空のまま失敗する。
        let tmp = ScanTestDir::new("folders-only");
        let root = &tmp.path;
        let mut dir = root.clone();
        for i in 0..30 {
            dir = dir.join(format!("d{i}"));
            fs::create_dir_all(&dir).unwrap();
        }

        let cancel = AtomicBool::new(false);
        let calls = std::cell::RefCell::new(Vec::new());
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 100, &cancel, Duration::ZERO, |p| {
            calls.borrow_mut().push((p.found, p.folders));
        });

        assert!(!outcome.truncated);
        assert!(!outcome.cancelled);
        assert_eq!(outcome.files.len(), 0, "ファイルは 1 件も無いツリーのはず");

        let calls = calls.into_inner();
        assert!(
            !calls.is_empty(),
            "ファイルが 1 件も無くても、フォルダを見つけるたびに on_progress が呼ばれるはず"
        );
        assert!(
            calls.iter().all(|&(found, _)| found == 0),
            "found はファイルが無いので 0 のまま増えないはず: {calls:?}"
        );
        for pair in calls.windows(2) {
            assert!(
                pair[0].1 < pair[1].1,
                "folders は単調増加であるはず: {calls:?}"
            );
        }
        assert_eq!(
            calls.last().unwrap().1,
            30,
            "30 個のネストしたフォルダを見つけているはず: {calls:?}"
        );
    }

    #[test]
    fn walk_intake_directory_filters_by_extension_and_counts_skipped() {
        let tmp = ScanTestDir::new("filter");
        let root = &tmp.path;
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::write(root.join("note.MD"), b"x").unwrap();
        fs::write(root.join("fig.png"), b"x").unwrap();
        fs::write(root.join("logs/run1.log"), b"x").unwrap();
        fs::write(root.join("logs/run2.log"), b"x").unwrap();
        fs::write(root.join("archive.zip"), b"x").unwrap();
        fs::write(root.join("Makefile"), b"x").unwrap();

        let filter = ScanFilter::with_extensions(&["md".into(), ".png".into()]);
        let cancel = AtomicBool::new(false);
        let outcome =
            walk_intake_directory(root, &filter, 100, &cancel, Duration::from_secs(3600), |_| {});

        let mut names: Vec<&str> = outcome.files.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["fig.png", "note.MD"], "拡張子は大文字小文字を区別しない");
        assert_eq!(outcome.skipped_by_ext.get(".log"), Some(&2));
        assert_eq!(outcome.skipped_by_ext.get(".zip"), Some(&1));
        assert_eq!(outcome.skipped_by_ext.get(NO_EXT_KEY), Some(&1));
    }

    #[test]
    fn walk_intake_directory_skips_hidden_entries_without_descending() {
        let tmp = ScanTestDir::new("hidden");
        let root = &tmp.path;
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::write(root.join(".git/objects/readme.md"), b"x").unwrap();
        fs::write(root.join(".DS_Store"), b"x").unwrap();
        fs::write(root.join(".hidden.md"), b"x").unwrap();
        fs::write(root.join("visible.md"), b"x").unwrap();

        let cancel = AtomicBool::new(false);
        let folders = std::cell::Cell::new(0);
        let outcome = walk_intake_directory(
            root,
            &ScanFilter::default(),
            100,
            &cancel,
            Duration::ZERO,
            |p| folders.set(p.folders),
        );

        let names: Vec<&str> = outcome.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["visible.md"]);
        assert_eq!(folders.get(), 0, "隠しフォルダはキューに積まない（降りない）");
        assert!(outcome.skipped_by_ext.is_empty(), "隠しファイルは対象外の内訳にも数えない");
    }

    #[test]
    fn walk_intake_directory_max_files_counts_only_accepted_files() {
        let tmp = ScanTestDir::new("max-accepted");
        let root = &tmp.path;
        for i in 0..10 {
            fs::write(root.join(format!("noise{i}.log")), b"x").unwrap();
        }
        for i in 0..3 {
            fs::write(root.join(format!("n{i}.md")), b"x").unwrap();
        }

        let filter = ScanFilter::with_extensions(&["md".into()]);
        let cancel = AtomicBool::new(false);
        let outcome =
            walk_intake_directory(root, &filter, 3, &cancel, Duration::from_secs(3600), |_| {});

        assert_eq!(outcome.files.len(), 3);
        assert!(!outcome.truncated, "対象外のログは上限の件数に入らない");
    }

    #[test]
    fn walk_intake_directory_folds_excess_skipped_kinds_into_other() {
        let tmp = ScanTestDir::new("kinds");
        let root = &tmp.path;
        let kinds = SCAN_SKIPPED_EXT_KINDS_MAX + 5;
        for i in 0..kinds {
            fs::write(root.join(format!("f.x{i}")), b"x").unwrap();
        }

        let filter = ScanFilter::with_extensions(&["md".into()]);
        let cancel = AtomicBool::new(false);
        let outcome =
            walk_intake_directory(root, &filter, 100, &cancel, Duration::from_secs(3600), |_| {});

        assert_eq!(outcome.skipped_by_ext.len(), SCAN_SKIPPED_EXT_KINDS_MAX + 1);
        let total: usize = outcome.skipped_by_ext.values().sum();
        assert_eq!(total, kinds, "まとめても件数の合計は変わらない");
        assert_eq!(outcome.skipped_by_ext.get(OTHER_EXT_KEY), Some(&5));
    }

    #[test]
    fn is_path_allowlisted_rejects_paths_outside_scan_result() {
        let tmp = ScanTestDir::new("allowlist");
        let root = &tmp.path;
        fs::write(root.join("ok.txt"), b"x").unwrap();
        fs::write(root.join("also-ok.txt"), b"x").unwrap();

        let cancel = AtomicBool::new(false);
        let outcome = walk_intake_directory(root, &ScanFilter::default(), 100, &cancel, Duration::from_secs(3600), |_| {});
        let allow: HashSet<PathBuf> = outcome
            .files
            .iter()
            .map(|f| PathBuf::from(&f.path))
            .collect();

        // 走査で見つかった実パスは許可される。
        assert!(is_path_allowlisted(&allow, &root.join("ok.txt")));
        // 走査結果に無いパスは拒否される（実在するかどうかに関わらず）。
        assert!(!is_path_allowlisted(&allow, &root.join("not-scanned.txt")));
        // '..' を含む細工パスは文字列として一致しないので拒否される。
        let traversal = PathBuf::from(format!("{}/../etc/passwd", root.display()));
        assert!(!is_path_allowlisted(&allow, &traversal));
    }

    /// 実 NAS での計測用ベンチ。GRAPHIUM_SCAN_BENCH_ROOT が未設定なら何もしない
    /// （CI では常にスキップされる）。手動実行:
    /// `GRAPHIUM_SCAN_BENCH_ROOT=/Volumes/nas/... cargo test walk_intake_directory_nas_bench -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn walk_intake_directory_nas_bench() {
        let Ok(root) = std::env::var("GRAPHIUM_SCAN_BENCH_ROOT") else {
            return;
        };
        let root_path = PathBuf::from(&root)
            .canonicalize()
            .expect("GRAPHIUM_SCAN_BENCH_ROOT を開けません");
        // C のベンチ（readdir+lstat / readdir のみ）と同じ件数で打ち切って比べられるように
        let max_files = std::env::var("GRAPHIUM_SCAN_BENCH_MAX")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(usize::MAX);
        let cancel = AtomicBool::new(false);
        let start = Instant::now();
        let outcome = walk_intake_directory(
            &root_path,
            &ScanFilter::default(),
            max_files,
            &cancel,
            Duration::from_millis(200),
            |p| println!("[bench] progress: found={} folders={}", p.found, p.folders),
        );
        println!(
            "[bench] {} files (truncated={}, cancelled={}) in {:?}",
            outcome.files.len(),
            outcome.truncated,
            outcome.cancelled,
            start.elapsed()
        );
    }

    // --- セキュリティ: id の検査・symlink・受信箱・開く拡張子 ---

    /// 実際に生成される形の id は通る（既存ユーザーのノート・素材を壊さない）
    #[test]
    fn validate_id_component_accepts_real_ids() {
        for id in [
            "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
            "note_1-a",
            "abc123XYZ",
            "m1.docx",
            "日本語のid",
            "a b",
        ] {
            assert!(validate_id_component(id).is_ok(), "{id} は通るはず");
        }
    }

    /// file-media:// や @メンションに仕込まれうる攻撃の入力は断る
    #[test]
    fn validate_id_component_rejects_attack_inputs() {
        for id in [
            "",
            "../../.ssh/id_rsa",
            "..",
            "a/b",
            "a\\b",
            "/Users/x/.ssh/id_rsa",
            "\\\\attacker.example\\share\\x.png",
            "C:\\Windows\\win.ini",
            ".hidden",
            "a\0b",
            "a\nb",
            "x..y",
        ] {
            assert!(validate_id_component(id).is_err(), "{id:?} は断るはず");
        }
    }

    /// `:` は Windows でだけ断る。macOS / Linux では既存のデータ（`wiki:<uuid>`）を開けるように通す
    #[test]
    fn validate_id_component_colon_is_windows_only() {
        for id in ["C:foo", "a:b", "wiki:3f2504e0-4f89-41d3-9a0c-0305e82c3301"] {
            assert_eq!(validate_id_component(id).is_err(), cfg!(windows), "{id:?}");
        }
        // 通しても 1 要素のまま base の下に収まる
        if !cfg!(windows) {
            let base = Path::new("/data/notes");
            let p = join_id_component(base, "wiki:abc", ".json").unwrap();
            assert_eq!(p.parent(), Some(base));
        }
    }

    #[test]
    fn join_id_component_stays_under_base() {
        let base = Path::new("/data/notes");
        let ok = join_id_component(base, "abc-1", ".json").unwrap();
        assert_eq!(ok, Path::new("/data/notes/abc-1.json"));
        assert!(join_id_component(base, "../../etc/passwd", ".json").is_err());
        assert!(join_id_component(base, "/etc/passwd", ".json").is_err());
        assert!(join_id_component(base, "a/b", "").is_err());
        // 名前だけを渡す経路（appData）も 1 要素に限る
        assert!(join_single_component(base, "../x.json").is_err());
        assert!(join_single_component(base, "/abs.json").is_err());
        assert!(join_single_component(base, "a%3Ab.json").is_ok());
    }

    /// 旧形式の救済（`dir.join(file_id)`）が media の外の絶対パス・相対パスを読まない
    #[test]
    fn find_media_data_file_ignores_paths_outside_media() {
        let tmp = tempfile::tempdir().unwrap();
        let media = tmp.path().join("media");
        fs::create_dir_all(&media).unwrap();
        let secret = tmp.path().join("secret.txt");
        fs::write(&secret, "secret").unwrap();
        assert!(find_media_data_file(&media, secret.to_str().unwrap()).is_none());
        assert!(find_media_data_file(&media, "../secret.txt").is_none());
        // 通常の素材（新形式・旧形式）はこれまでどおり解決する
        fs::write(media.join("m1.png"), b"x").unwrap();
        fs::write(media.join("legacy-id"), b"x").unwrap();
        assert!(find_media_data_file(&media, "m1").is_some());
        assert!(find_media_data_file(&media, "legacy-id").is_some());
    }

    #[test]
    fn save_media_file_rejects_traversal_id() {
        // media_dir() に触る前に id で断られる（読み書きはどこにも起きない）
        let r = save_media_file_sync("../../../x".into(), "a.plist".into(), "text/plain".into(), "QQ==".into());
        assert!(r.is_err());
        let r = save_media_file_sync("/tmp/x".into(), "a.bat".into(), "text/plain".into(), "QQ==".into());
        assert!(r.is_err());
    }

    #[test]
    fn app_data_keys_cannot_leave_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(write_app_data_in(tmp.path(), "../evil", "{}").is_err());
        assert!(read_app_data_in(tmp.path(), "../../etc/passwd").is_err());
        assert!(!tmp.path().parent().unwrap().join("evil.json").exists());
        // 旧来の `:` 入りキーと通常のキーはこれまでどおり
        write_app_data_in(tmp.path(), "settings:main", "{}").unwrap();
        assert_eq!(read_app_data_in(tmp.path(), "settings:main").unwrap().as_deref(), Some("{}"));
    }

    #[test]
    fn blocked_open_ext_covers_executables() {
        for n in [
            "a.exe", "a.BAT", "a.cmd", "a.scr", "a.ps1", "a.vbs", "a.js", "a.hta", "a.lnk", "a.url",
            "a.msi", "a.jar", "a.reg", "a.app", "a.command", "a.terminal", "a.workflow", "a.pkg",
            "a.sh", "a.py", "a.desktop", "a.AppImage", "a.rdp", "a.settingcontent-ms", "a.appx", "a.xll",
            "a.mobileconfig", "report.docx.bat", "a.bat.", "a.bat ",
        ] {
            assert!(blocked_open_ext(Path::new(n)).is_some(), "{n} は断るはず");
        }
        for n in ["a.docx", "a.xlsx", "a.pptx", "a.pdf", "a.txt", "noext", "a.bat.docx"] {
            assert!(blocked_open_ext(Path::new(n)).is_none(), "{n} は通るはず");
        }
    }

    /// MIME を偽って「ドキュメント」にした .bat 本体は、コピーも作られず開かれない
    #[test]
    fn write_opened_copy_refuses_executable_body() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("m1.bat");
        fs::write(&src, "echo pwned").unwrap();
        assert!(check_openable_ext(&src).unwrap_err().starts_with(BLOCKED_OPEN_ERR_PREFIX));
        // 本体に拡張子が無く、表示名で実行ファイルになる形
        let legacy = tmp.path().join("legacy");
        fs::write(&legacy, "x").unwrap();
        let out = tmp.path().join("opened").join("legacy");
        let err = write_opened_copy(&legacy, &out, "report.bat", "legacy").unwrap_err();
        assert!(err.starts_with(BLOCKED_OPEN_ERR_PREFIX));
        assert!(!out.join("report.bat").exists());
    }

    #[test]
    fn inbox_read_rejects_oversize_and_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_str().unwrap().to_string();
        let inbox = tmp.path().join(INBOX_SUBDIR);
        fs::create_dir_all(&inbox).unwrap();
        fs::write(inbox.join("ok.png"), b"abc").unwrap();
        assert!(inbox_read(root.clone(), "ok.png".into()).is_ok());
        // 上限超過は sparse ファイルで作る（実データは書かない）
        let big = inbox.join("big.mp4");
        let f = fs::File::create(&big).unwrap();
        f.set_len(INBOX_MAX_READ_BYTES + 1).unwrap();
        let err = inbox_read(root.clone(), "big.mp4".into()).unwrap_err();
        assert!(err.starts_with("inbox-file-too-large"));
        // 取り込みの一覧にもそのファイルは並ぶ（その 1 件だけ読めずに飛ばされる）
        let names: Vec<String> = inbox_list(root.clone()).unwrap().into_iter().map(|i| i.name).collect();
        assert!(names.contains(&"big.mp4".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn inbox_skips_symlinks() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_str().unwrap().to_string();
        let inbox = tmp.path().join(INBOX_SUBDIR);
        fs::create_dir_all(&inbox).unwrap();
        let secret = tmp.path().join("secret");
        fs::write(&secret, "secret").unwrap();
        std::os::unix::fs::symlink(&secret, inbox.join("photo.png")).unwrap();
        fs::write(inbox.join("real.png"), b"x").unwrap();
        let names: Vec<String> = inbox_list(root.clone()).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(names, vec!["real.png".to_string()]);
        assert!(inbox_read(root.clone(), "photo.png".into()).is_err());
        assert!(inbox_mark_imported(root, "photo.png".into()).is_err());
        assert!(secret.exists());
    }

    #[cfg(unix)]
    #[test]
    fn shared_blob_write_refuses_dangling_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("_blobs");
        fs::create_dir_all(&root).unwrap();
        let hex = "ab".to_string() + &"0".repeat(62);
        let hash = format!("sha256:{hex}");
        let hh = root.join("ab");
        fs::create_dir_all(&hh).unwrap();
        let target = tmp.path().join("LaunchAgents-x");
        std::os::unix::fs::symlink(&target, hh.join(&hex)).unwrap();
        let r = shared_blob_write(root.to_str().unwrap().to_string(), hash.clone(), "QQ==".into());
        assert!(r.is_err());
        assert!(!target.exists(), "リンク先に書かれてはいけない");
        // リンクでない通常の書き込みと dedup はこれまでどおり
        let hash2 = format!("sha256:cd{}", "0".repeat(62));
        shared_blob_write(root.to_str().unwrap().to_string(), hash2.clone(), "QQ==".into()).unwrap();
        shared_blob_write(root.to_str().unwrap().to_string(), hash2, "QQ==".into()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn shared_delete_and_blob_delete_refuse_symlinks() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("shared");
        fs::create_dir_all(root.join("notes")).unwrap();
        let id = "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70";
        let victim = tmp.path().join("victim.json");
        fs::write(&victim, b"keep").unwrap();
        // 本体がリンク
        std::os::unix::fs::symlink(&victim, root.join("notes").join(format!("{id}.json"))).unwrap();
        let r = shared_delete(root.to_str().unwrap().into(), "notes".into(), id.into(), "{}".into(), None);
        assert!(r.is_err());
        assert!(victim.exists());
        // _meta が外へのリンク: リンク先にフォルダを作らない
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        let root2 = tmp.path().join("shared2");
        fs::create_dir_all(&root2).unwrap();
        std::os::unix::fs::symlink(&outside, root2.join("_meta")).unwrap();
        let r = shared_delete(root2.to_str().unwrap().into(), "notes".into(), id.into(), "{}".into(), None);
        assert!(r.is_err());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        // blob: hh フォルダが外へのリンク
        let broot = tmp.path().join("_blobs");
        fs::create_dir_all(&broot).unwrap();
        let hex = "ab".to_string() + &"0".repeat(62);
        let ext = tmp.path().join("ext");
        fs::create_dir_all(&ext).unwrap();
        fs::write(ext.join(&hex), b"keep").unwrap();
        std::os::unix::fs::symlink(&ext, broot.join("ab")).unwrap();
        let r = shared_blob_delete(broot.to_str().unwrap().into(), format!("sha256:{hex}"));
        assert!(r.is_err());
        assert!(ext.join(&hex).exists());
        // blob: ファイル自体がリンク
        let broot2 = tmp.path().join("_blobs2");
        fs::create_dir_all(broot2.join("ab")).unwrap();
        std::os::unix::fs::symlink(&victim, broot2.join("ab").join(&hex)).unwrap();
        let r = shared_blob_delete(broot2.to_str().unwrap().into(), format!("sha256:{hex}"));
        assert!(r.is_err());
        assert!(victim.exists());
    }

    fn shared_entry_json(hash: &str) -> String {
        format!(r#"{{"entry":{{"hash":"{hash}","author":{{"email":"a@example.com"}}}},"body_base64":""}}"#)
    }

    #[test]
    fn shared_write_replaces_only_when_the_expected_version_is_current() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("shared");
        fs::create_dir_all(&root).unwrap();
        let root_s = root.to_str().unwrap().to_string();
        let id = "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70";
        let author = Some("a@example.com".to_string());
        let write = |content: String, expected: Option<&str>| {
            shared_write(root_s.clone(), "notes".into(), id.into(), content, author.clone(), expected.map(str::to_string))
        };
        write(shared_entry_json("sha256:one"), None).unwrap();
        write(shared_entry_json("sha256:two"), Some("sha256:one")).unwrap();
        // 読んだ版が古ければ書かず、今の版の hash を返す
        let err = write(shared_entry_json("sha256:three"), Some("sha256:one")).unwrap_err();
        assert_eq!(err, "SHARED_CONFLICT:sha256:two");
        let path = root.join("notes").join(format!("{id}.json"));
        assert_eq!(fs::read_to_string(&path).unwrap(), shared_entry_json("sha256:two"));
        // 一時ファイルを残さない
        let names: Vec<_> = fs::read_dir(root.join("notes")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn shared_write_reports_a_conflict_when_the_entry_is_gone() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("shared");
        fs::create_dir_all(&root).unwrap();
        let err = shared_write(
            root.to_str().unwrap().into(),
            "notes".into(),
            "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70".into(),
            shared_entry_json("sha256:one"),
            None,
            Some("sha256:old".into()),
        )
        .unwrap_err();
        assert_eq!(err, "SHARED_CONFLICT:");
    }

    #[cfg(unix)]
    #[test]
    fn shared_write_does_not_write_through_a_hardlink() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("shared");
        fs::create_dir_all(root.join("notes")).unwrap();
        let id = "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70";
        let outside = tmp.path().join("outside.json");
        fs::write(&outside, shared_entry_json("sha256:one")).unwrap();
        fs::hard_link(&outside, root.join("notes").join(format!("{id}.json"))).unwrap();
        shared_write(
            root.to_str().unwrap().into(),
            "notes".into(),
            id.into(),
            shared_entry_json("sha256:two"),
            Some("a@example.com".into()),
            None,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&outside).unwrap(), shared_entry_json("sha256:one"));
    }

    #[cfg(unix)]
    #[test]
    fn shared_write_refuses_symlinked_entry_and_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("shared");
        fs::create_dir_all(root.join("notes")).unwrap();
        let id = "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70";
        let target = tmp.path().join("victim.json");
        std::os::unix::fs::symlink(&target, root.join("notes").join(format!("{id}.json"))).unwrap();
        let r = shared_write(root.to_str().unwrap().into(), "notes".into(), id.into(), "{}".into(), None, None);
        assert!(r.is_err());
        assert!(!target.exists());
        // notes フォルダ自体が外へのリンクに差し替えられた場合
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        let root2 = tmp.path().join("shared2");
        fs::create_dir_all(&root2).unwrap();
        std::os::unix::fs::symlink(&outside, root2.join("notes")).unwrap();
        let r = shared_write(root2.to_str().unwrap().into(), "notes".into(), id.into(), "{}".into(), None, None);
        assert!(r.is_err());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        // 通常の共有は書ける
        let root3 = tmp.path().join("shared3");
        fs::create_dir_all(&root3).unwrap();
        shared_write(root3.to_str().unwrap().into(), "notes".into(), id.into(), "{}".into(), None, None).unwrap();
    }

    // ── 読める写し ──

    const RC_ID: &str = "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70";
    const RC_ID_OTHER: &str = "0190f3a2-7b1c-7e4d-9a55-aaaaaaaaaaaa";

    /// 共有エントリ（作者 a@x）を置いた共有フォルダを作る
    fn rc_setup(tmp: &Path, ids: &[&str]) -> String {
        let root = tmp.join("shared");
        fs::create_dir_all(root.join("notes")).unwrap();
        for id in ids {
            fs::write(
                root.join("notes").join(format!("{id}.json")),
                r#"{"entry":{"author":{"email":"a@x"}}}"#,
            )
            .unwrap();
        }
        root.to_str().unwrap().to_string()
    }

    fn rc_sync(root: &str, id: &str, title: &str, md: Option<&str>, prov: Option<&str>, email: &str) -> Result<(), String> {
        shared_readable_sync(
            root.into(),
            "notes".into(),
            id.into(),
            title.into(),
            md.map(String::from),
            prov.map(String::from),
            Some(email.into()),
        )
    }

    /// TS が書く前付け（共有 id 入り）の md
    fn rc_md(id: &str) -> String {
        format!("---\ntitle: \"t\"\ngraphium_shared_id: \"{id}\"\n---\n\nbody")
    }

    fn rc_names(root: &str) -> Vec<String> {
        let dir = Path::new(root).join("readable").join("notes");
        let mut v: Vec<String> = match fs::read_dir(dir) {
            Ok(r) => r.map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect(),
            Err(_) => vec![],
        };
        v.sort();
        v
    }

    #[test]
    fn shared_readable_sync_writes_pair() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        rc_sync(&root, RC_ID, "実験メモ", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        assert_eq!(
            rc_names(&root),
            vec!["実験メモ_3c2f1b8d6e70.md".to_string(), "実験メモ_3c2f1b8d6e70.prov.jsonld".to_string()]
        );
        let md = fs::read_to_string(Path::new(&root).join("readable/notes/実験メモ_3c2f1b8d6e70.md")).unwrap();
        assert_eq!(md, rc_md(RC_ID));
    }

    #[test]
    fn shared_readable_sync_rename_keeps_one_pair() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        rc_sync(&root, RC_ID, "旧題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID, "新題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        assert_eq!(
            rc_names(&root),
            vec!["新題_3c2f1b8d6e70.md".to_string(), "新題_3c2f1b8d6e70.prov.jsonld".to_string()]
        );
    }

    #[test]
    fn shared_readable_sync_without_prov_removes_prov() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), None, "a@x").unwrap();
        assert_eq!(rc_names(&root), vec!["題_3c2f1b8d6e70.md".to_string()]);
    }

    #[test]
    fn shared_readable_sync_remove_only_creates_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        rc_sync(&root, RC_ID, "", None, None, "a@x").unwrap();
        assert!(!Path::new(&root).join("readable").exists());
        // エントリが無くても掃除は進む（取り残し）
        let root2 = rc_setup(&tmp.path().join("two"), &[]);
        rc_sync(&root2, RC_ID, "", None, None, "a@x").unwrap();
        assert!(!Path::new(&root2).join("readable").exists());
        // 置いたあとに消すと空になる
        rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID, "", None, None, "a@x").unwrap();
        assert!(rc_names(&root).is_empty());
    }

    #[test]
    fn shared_readable_sync_refuses_missing_entry_and_other_author() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        // エントリが無いのに置こうとする
        assert!(rc_sync(&root, RC_ID_OTHER, "題", Some(&rc_md(RC_ID_OTHER)), None, "a@x").is_err());
        assert!(!Path::new(&root).join("readable").exists());
        // 作者が違う（置く・消す）
        assert!(rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), None, "b@x").is_err());
        assert!(!Path::new(&root).join("readable").exists());
        rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), None, "a@x").unwrap();
        assert!(rc_sync(&root, RC_ID, "", None, None, "b@x").is_err());
        assert_eq!(rc_names(&root).len(), 1);
    }

    #[test]
    fn shared_readable_sync_does_not_touch_other_id12() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID, RC_ID_OTHER]);
        rc_sync(&root, RC_ID_OTHER, "別", Some(&rc_md(RC_ID_OTHER)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID, "", None, None, "a@x").unwrap();
        assert_eq!(
            rc_names(&root),
            vec!["別_aaaaaaaaaaaa.md".to_string(), "別_aaaaaaaaaaaa.prov.jsonld".to_string()]
        );
    }

    #[cfg(unix)]
    #[test]
    fn shared_readable_sync_refuses_symlinks() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        // readable が外へのリンク
        let root = rc_setup(&tmp.path().join("a"), &[RC_ID]);
        std::os::unix::fs::symlink(&outside, Path::new(&root).join("readable")).unwrap();
        assert!(rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").is_err());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        // readable/notes が外へのリンク
        let root2 = rc_setup(&tmp.path().join("b"), &[RC_ID]);
        fs::create_dir_all(Path::new(&root2).join("readable")).unwrap();
        std::os::unix::fs::symlink(&outside, Path::new(&root2).join("readable/notes")).unwrap();
        assert!(rc_sync(&root2, RC_ID, "題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").is_err());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        // 対象ファイル自体がリンク（まだ無い先を指す）
        let root3 = rc_setup(&tmp.path().join("c"), &[RC_ID]);
        fs::create_dir_all(Path::new(&root3).join("readable/notes")).unwrap();
        let target = tmp.path().join("victim.md");
        std::os::unix::fs::symlink(&target, Path::new(&root3).join("readable/notes/題_3c2f1b8d6e70.md")).unwrap();
        assert!(rc_sync(&root3, RC_ID, "題", Some(&rc_md(RC_ID)), None, "a@x").is_err());
        assert!(!target.exists());
    }

    #[test]
    fn shared_delete_removes_readable_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID, RC_ID_OTHER]);
        rc_sync(&root, RC_ID, "題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID_OTHER, "別", Some(&rc_md(RC_ID_OTHER)), None, "a@x").unwrap();
        shared_delete(root.clone(), "notes".into(), RC_ID.into(), "{}".into(), Some("a@x".into())).unwrap();
        assert_eq!(rc_names(&root), vec!["別_aaaaaaaaaaaa.md".to_string()]);
    }

    // 末尾 12 桁だけ同じ別 id（共有 id 全体は別）
    const RC_ID_COLLIDE: &str = "0190ffff-0000-7000-8000-3c2f1b8d6e70";

    #[test]
    fn shared_readable_sync_case_only_rename_keeps_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        rc_sync(&root, RC_ID, "Memo", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root, RC_ID, "memo", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        // 大文字小文字を区別しない FS でも、区別する FS でも、ちょうど 1 組が残る
        let names = rc_names(&root);
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.iter().any(|n| n.to_lowercase() == "memo_3c2f1b8d6e70.md"));
        assert!(names.iter().any(|n| n.to_lowercase() == "memo_3c2f1b8d6e70.prov.jsonld"));
    }

    #[test]
    fn shared_readable_sync_does_not_touch_colliding_id12() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID, RC_ID_COLLIDE]);
        rc_sync(&root, RC_ID, "victim", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        // 別 id の再共有（別の題）は、他人の写しを消さない
        rc_sync(&root, RC_ID_COLLIDE, "mine", Some(&rc_md(RC_ID_COLLIDE)), Some("{}"), "a@x").unwrap();
        assert_eq!(rc_names(&root).len(), 4);
        // 同じ題でも上書きしない
        let r = rc_sync(&root, RC_ID_COLLIDE, "victim", Some(&rc_md(RC_ID_COLLIDE)), None, "a@x");
        assert!(r.is_err());
        let md = fs::read_to_string(Path::new(&root).join("readable/notes/victim_3c2f1b8d6e70.md")).unwrap();
        assert_eq!(md, rc_md(RC_ID));
        // 消すだけ（エントリが無い id でも）も他人の写しを消さない
        let tmp2 = tempfile::tempdir().unwrap();
        let root2 = rc_setup(tmp2.path(), &[RC_ID]);
        rc_sync(&root2, RC_ID, "victim", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        rc_sync(&root2, RC_ID_COLLIDE, "", None, None, "z@x").unwrap();
        assert_eq!(rc_names(&root2).len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn shared_readable_sync_does_not_write_through_hardlink_or_hang_on_fifo() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        let dir = Path::new(&root).join("readable/notes");
        fs::create_dir_all(&dir).unwrap();
        // ハードリンク: 外のファイルは書き換わらない
        let canon = tmp.path().join("canon.json");
        fs::write(&canon, format!("{}ORIG", rc_md(RC_ID))).unwrap();
        fs::hard_link(&canon, dir.join("T_3c2f1b8d6e70.md")).unwrap();
        rc_sync(&root, RC_ID, "T", Some(&rc_md(RC_ID)), None, "a@x").unwrap();
        assert_eq!(fs::read_to_string(&canon).unwrap(), format!("{}ORIG", rc_md(RC_ID)));
        assert_eq!(
            fs::read_to_string(dir.join("T_3c2f1b8d6e70.md")).unwrap(),
            rc_md(RC_ID)
        );
        // FIFO: 開いて待たされず、置き換わる
        let fifo = dir.join("U_3c2f1b8d6e70.md");
        let c = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        rc_sync(&root, RC_ID, "U", Some(&rc_md(RC_ID)), None, "a@x").unwrap();
        assert!(fs::symlink_metadata(&fifo).unwrap().is_file());
    }

    #[test]
    fn shared_readable_sync_prov_failure_still_cleans_old_pair() {
        let tmp = tempfile::tempdir().unwrap();
        let root = rc_setup(tmp.path(), &[RC_ID]);
        rc_sync(&root, RC_ID, "旧題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").unwrap();
        // 新しい prov の名前をフォルダで塞いで失敗させる
        fs::create_dir(Path::new(&root).join("readable/notes/新題_3c2f1b8d6e70.prov.jsonld")).unwrap();
        assert!(rc_sync(&root, RC_ID, "新題", Some(&rc_md(RC_ID)), Some("{}"), "a@x").is_err());
        let names = rc_names(&root);
        assert!(names.contains(&"新題_3c2f1b8d6e70.md".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("旧題")), "{names:?}");
    }

    #[test]
    fn sanitize_readable_title_drops_invisible_chars() {
        for c in ['\u{061C}', '\u{2060}', '\u{00AD}', '\u{180E}', '\u{3164}', '\u{206A}', '\u{E0041}', '\u{FE0F}'] {
            assert_eq!(sanitize_readable_title(&format!("a{c}b")), "ab", "{c:?}");
        }
    }

    #[test]
    fn sanitize_readable_title_cases() {
        assert_eq!(sanitize_readable_title("a/b\\c:d*e?f\"g<h>i|j"), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize_readable_title("a\nb\tc\u{0}d"), "a_b_c_d");
        assert_eq!(sanitize_readable_title("../../x"), "_.._x");
        assert_eq!(sanitize_readable_title("."), "untitled");
        assert_eq!(sanitize_readable_title(".."), "untitled");
        assert_eq!(sanitize_readable_title(""), "untitled");
        assert_eq!(sanitize_readable_title("   "), "untitled");
        assert_eq!(sanitize_readable_title("  a   b  "), "a b");
        assert_eq!(sanitize_readable_title(".hidden"), "hidden");
        assert_eq!(sanitize_readable_title("name. . "), "name");
        assert_eq!(sanitize_readable_title("a\u{202E}b\u{200B}c\u{FEFF}"), "abc");
        let long = "あ".repeat(100);
        let s = sanitize_readable_title(&long);
        assert!(s.len() <= 150);
        assert_eq!(s, "あ".repeat(50));
        // 切れ目の直前がドットなら取り除く
        let tricky = format!("{}.{}", "a".repeat(149), "bbb");
        assert_eq!(sanitize_readable_title(&tricky), "a".repeat(149));
    }

    #[test]
    fn scan_root_in_hidden_folder_is_refused() {
        assert!(check_scan_root_not_hidden(Path::new("/Users/x/.config/gh")).is_err());
        assert!(check_scan_root_not_hidden(Path::new("/Users/x/.ssh")).is_err());
        assert!(check_scan_root_not_hidden(Path::new("/Users/x/Documents/実験データ")).is_ok());
    }

    #[test]
    fn scan_root_too_broad_is_refused() {
        let home = Path::new("/Users/x");
        let t = |p: &str| check_scan_root_not_too_broad_with(Path::new(p), Some(home));
        assert!(t("/Users/x/Library/Application Support").is_err());
        assert!(t("/Users/x/Library/Keychains").is_err());
        // クラウド同期フォルダ・ホーム直下・ドライブ直下は通す
        assert!(t("/Users/x/Library/CloudStorage/Dropbox/work").is_ok());
        assert!(t("/Users/x/Library/Mobile Documents/com~apple~CloudDocs").is_ok());
        assert!(t("/Users/x").is_ok());
        assert!(t("/").is_ok());
        assert!(t("/Users/x/Documents/実験データ").is_ok());
        assert!(t("/Volumes/NAS/data").is_ok());
        // Windows の AppData（Roaming・Local・LocalLow）は root でも配下でも断る
        assert!(t("/Users/x/AppData").is_err());
        assert!(t("/Users/x/AppData/Roaming").is_err());
        assert!(t("/Users/x/AppData/Roaming/Code/User").is_err());
        assert!(t("/Users/x/AppData/Local/Google").is_err());
        assert!(t("/Users/x/appdata/locallow").is_err());
        // ホーム配下の普通の作業フォルダ・AppData と名前が似ただけのものは通す
        assert!(t("/Users/x/Documents").is_ok());
        assert!(t("/Users/x/Desktop").is_ok());
        assert!(t("/Users/x/Downloads").is_ok());
        assert!(t("/Users/x/Documents/AppData/Roaming").is_ok());
        assert!(t("/Users/x/AppDataBackup").is_ok());
    }

    #[test]
    fn blocked_open_exts_include_macro_office() {
        for n in ["a.docm", "a.XLSM", "a.pptm", "a.dotm", "a.xltm", "a.potm", "a.ppam", "a.ppsm", "a.sldm"] {
            assert!(blocked_open_ext(Path::new(n)).is_some(), "{n} は断るはず");
        }
        assert!(blocked_open_ext(Path::new("a.docx")).is_none());
    }

    #[test]
    fn ensure_dir_within_root_caches_only_passes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let r = root.to_str().unwrap();
        let dir = root.join("notes");
        assert!(ensure_dir_within_root(r, &dir).is_ok());
        // 通った結果は覚えている（消えても 30 秒は通る = canonicalize を呼ばない）
        assert!(dir_check_cache_hit(r, &dir));
        // 外を指す dir は断り、断った結果は覚えない
        assert!(ensure_dir_within_root(r, &outside).is_err());
        assert!(!dir_check_cache_hit(r, &outside));
        // キャッシュに当たっている dir を外向きの symlink に差し替えたら通らず、キャッシュも捨てる
        #[cfg(unix)]
        {
            assert!(dir_check_cache_hit(r, &dir));
            fs::remove_dir_all(&dir).unwrap();
            std::os::unix::fs::symlink(&outside, &dir).unwrap();
            assert!(dir_check_cache_hit(r, &dir));
            assert!(ensure_dir_within_root(r, &dir).is_err());
            assert!(!dir_check_cache_hit(r, &dir));
        }
    }

    #[cfg(unix)]
    #[test]
    fn ensure_dir_within_root_still_refuses_symlink_out() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("notes")).unwrap();
        let r = root.to_str().unwrap();
        assert!(ensure_dir_within_root(r, &root.join("notes")).is_err());
        assert!(!dir_check_cache_hit(r, &root.join("notes")));
    }

    #[test]
    fn get_api_token_is_64_hex_and_stable() {
        let a = api_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, api_token());
    }

    #[test]
    fn get_api_token_gate_allows_only_app_windows() {
        assert!(check_app_window_label(MAIN_LABEL).is_ok());
        assert!(check_app_window_label(VIEWER_LABEL).is_ok());
        assert!(check_app_window_label("other").is_err());
        assert!(check_app_window_label("").is_err());
    }

    #[test]
    fn main_label_gate_allows_only_main() {
        assert!(check_main_label(MAIN_LABEL).is_ok());
        assert!(check_main_label("viewer").is_err());
        assert!(check_main_label("").is_err());
    }

    #[test]
    fn inbox_file_path_refuses_drive_relative_and_traversal() {
        for n in ["../x", "a/b", "a\\b", "", "a\0b", "a..png"] {
            assert!(inbox_file_path("/r", n).is_err(), "{n:?} は断るはず");
        }
        // Windows ではドライブ付き相対パスを断る。それ以外では ':' 入りの名前は通る
        assert_eq!(inbox_file_path("/r", "C:x.png").is_err(), cfg!(windows));
        assert!(inbox_file_path("/r", "録音 10:23.m4a").is_ok() || cfg!(windows));
        assert!(inbox_file_path("/r", "photo 1.png").is_ok());
        assert!(inbox_file_path("/r", ".DS_Store").is_ok());
    }

    /// root 自体・Inbox 自体が symlink なのは正当な構成（NAS・外付け）として通す
    #[cfg(unix)]
    #[test]
    fn symlinked_root_and_inbox_dir_are_allowed() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        fs::create_dir_all(real.join(INBOX_SUBDIR)).unwrap();
        fs::write(real.join(INBOX_SUBDIR).join("a.png"), b"x").unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let root = link.to_str().unwrap().to_string();
        shared_write(root.clone(), "notes".into(), "00000000-0000-7000-8000-000000000001".into(), "{}".into(), None, None).unwrap();
        assert!(real.join("notes").join("00000000-0000-7000-8000-000000000001.json").exists());
        let items = inbox_list(root.clone()).unwrap();
        assert_eq!(items.len(), 1);
        // Inbox 自体がリンクでも通る
        let other = tmp.path().join("other");
        fs::create_dir_all(&other).unwrap();
        let inbox_target = tmp.path().join("inbox-real");
        fs::create_dir_all(&inbox_target).unwrap();
        fs::write(inbox_target.join("b.png"), b"x").unwrap();
        std::os::unix::fs::symlink(&inbox_target, other.join(INBOX_SUBDIR)).unwrap();
        assert_eq!(inbox_list(other.to_str().unwrap().to_string()).unwrap().len(), 1);
    }

    #[test]
    fn sidecar_cors_origins_matches_build_profile() {
        let v = sidecar_cors_origins();
        // どちらのビルドでも WebView の 3 オリジンは入り、空にはならない
        // （空文字だと sidecar は既定の http://localhost:5174 に戻す）
        assert!(!v.is_empty());
        for origin in ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] {
            assert!(v.split(',').any(|o| o == origin), "{origin} が無い");
        }
        assert_eq!(v.contains("http://localhost:5174"), cfg!(debug_assertions));
    }

    // --- データの置き場 ---

    fn place_fixture() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("a.txt"), b"hello").unwrap();
        fs::write(tmp.path().join("sub").join("日本語 と 空白.docx"), b"12345678").unwrap();
        tmp
    }

    #[test]
    fn place_rel_path_rejects_bad_shapes() {
        for bad in [
            "",
            "..",
            "../x",
            "a/../x",
            "a/./b",
            "/etc/passwd",
            "a//b",
            "a/",
            "a\\b",
            "a\0b",
            "a\nb",
        ] {
            assert!(
                matches!(validate_place_rel_path(bad), Err(PlaceResolveError::Invalid(_))),
                "{bad:?} を断るはず"
            );
        }
        assert!(validate_place_rel_path(&"a".repeat(PLACE_REL_PATH_MAX_BYTES + 1)).is_err());
        assert!(validate_place_rel_path("a/b.txt").is_ok());
        assert!(validate_place_rel_path("日本語 と 空白/x.docx").is_ok());
        // Windows のドライブ指定は ':' で断る（unix では通常の文字）
        assert_eq!(validate_place_rel_path("C:/x").is_err(), cfg!(windows));
    }

    #[test]
    fn place_resolve_ok_returns_size_and_mtime() {
        let tmp = place_fixture();
        let r = resolve_place_file(tmp.path(), "a.txt").unwrap();
        assert_eq!(r.size, 5);
        assert!(r.mtime_ms > 0);
        let r = resolve_place_file(tmp.path(), "sub/日本語 と 空白.docx").unwrap();
        assert_eq!(r.size, 8);
    }

    #[test]
    fn place_openable_allowlist() {
        let ok = |n: &str| check_place_openable(Path::new(n));
        assert!(ok("report.pdf").is_ok());
        assert!(ok("REPORT.PDF").is_ok());
        assert!(ok("a.Docx").is_ok());
        assert_eq!(ok("noext").unwrap_err(), "PLACE_OPEN_NOT_ALLOWED:");
        assert_eq!(ok("evil.dylib").unwrap_err(), "PLACE_OPEN_NOT_ALLOWED:dylib");
        assert_eq!(ok("run.command").unwrap_err(), "PLACE_OPEN_NOT_ALLOWED:command");
        assert!(ok("a.html").is_err());
        assert!(ok("macro.docm").is_err());
        // 末尾の空白・ドットは断る（Windows は落として別のファイルを開く）
        assert!(ok("x.PDF ").is_err());
        assert!(ok("x.pdf.").is_err());
        assert!(ok("x.pdf. .").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn place_openable_ignores_executable_bit() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = place_fixture();
        let f = tmp.path().join("data.csv");
        fs::write(&f, b"a,b").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
        let r = resolve_place_file(tmp.path(), "data.csv").unwrap();
        // SMB・exFAT ではふつうのファイルが全部 rwx に見える。許可リストの種類なら、
        // 実行ビットが立っていても開ける判定になる（許可リストに無い種類は従来どおり断る）
        assert!(check_place_openable(&r.path).is_ok());
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        let r = resolve_place_file(tmp.path(), "data.csv").unwrap();
        assert!(check_place_openable(&r.path).is_ok());
        let script = tmp.path().join("run.sh");
        fs::write(&script, b"#!/bin/sh").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let r = resolve_place_file(tmp.path(), "run.sh").unwrap();
        assert!(check_place_openable(&r.path).is_err());
    }

    #[test]
    fn place_strip_verbatim_prefix_forms() {
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\Users\a\b.pdf"), r"C:\Users\a\b.pdf");
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\x.pdf"),
            r"\\server\share\x.pdf"
        );
        assert_eq!(strip_verbatim_prefix("/home/a/b.pdf"), "/home/a/b.pdf");
        assert_eq!(strip_verbatim_prefix(r"C:\x"), r"C:\x");
        // 台帳の root と現在の canonicalize が、\\?\ の有無だけ違っても一致する
        assert!(same_place_root(r"C:\data", Path::new(r"\\?\C:\data")));
        assert!(!same_place_root(r"C:\data", Path::new(r"\\?\C:\other")));
    }

    #[test]
    fn place_run_with_timeout_helper() {
        assert_eq!(run_with_timeout(Duration::from_secs(2), || 7), Some(7));
        let t = Instant::now();
        let r = run_with_timeout(Duration::from_millis(100), || {
            thread::sleep(Duration::from_millis(1500));
            1
        });
        assert_eq!(r, None);
        assert!(t.elapsed() < Duration::from_millis(1000));
    }

    #[test]
    fn place_stat_many_marks_unreachable_roots() {
        let tmp = place_fixture();
        let places = vec![
            Place {
                id: "ok".into(),
                name: "n".into(),
                // 登録時と同じ canonicalize 済みの root（resolve_in_places の比較のため）
                root: fs::canonicalize(tmp.path()).unwrap().to_string_lossy().to_string(),
            },
            Place {
                id: "gone".into(),
                name: "n".into(),
                root: tmp.path().join("gone").to_string_lossy().to_string(),
            },
        ];
        let item = |id: &str| LinkRef { place_id: id.into(), rel_path: "a.txt".into() };
        let out = stat_many_in_places(
            &places,
            &[item("ok"), item("gone"), item("none")],
            &PlaceProbes::default(),
            PLACE_PROBE_TIMEOUT,
            fs_root_reachable,
        );
        assert_eq!(out[0].state, "ok");
        assert_eq!(out[1].state, "unreachable");
        assert_eq!(out[2].state, "unregistered");
    }

    /// 眠る確認関数と、走った回数を数える口
    fn sleeping_probe(ms: u64) -> (impl Fn(&str) -> bool + Clone + Send + 'static, Arc<std::sync::atomic::AtomicUsize>) {
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let c = count.clone();
        (
            move |_: &str| {
                c.fetch_add(1, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(ms));
                true
            },
            count,
        )
    }

    #[test]
    fn place_probe_runs_one_at_a_time_per_place() {
        let probes = PlaceProbes::default();
        let place = Place { id: "p".into(), name: "n".into(), root: "/x".into() };
        let (probe, count) = sleeping_probe(600);
        // 時間切れ（false）で戻っても、確認は走り続ける。続けて頼んでも新しく立てない
        let r1 = probe_places(&probes, [&place], Duration::from_millis(50), probe.clone());
        let r2 = probe_places(&probes, [&place], Duration::from_millis(50), probe.clone());
        assert_eq!(r1.get("p"), Some(&false));
        assert_eq!(r2.get("p"), Some(&false));
        // 進行中の確認の結果を待てば、同じ 1 本の結果が返る
        let r3 = probe_places(&probes, [&place], Duration::from_secs(3), probe.clone());
        assert_eq!(r3.get("p"), Some(&true));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        // 終わったあとは、また新しく立つ
        thread::sleep(Duration::from_millis(100));
        let r4 = probe_places(&probes, [&place], Duration::from_secs(3), probe);
        assert_eq!(r4.get("p"), Some(&true));
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn place_list_skips_marker_of_stalled_place() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let (ok_place, shared) = prepare_place(&root, &[]);
        assert!(shared);
        let stalled_dir = tempfile::tempdir().unwrap();
        let stalled_root = fs::canonicalize(stalled_dir.path()).unwrap();
        // 目印が読める置き場だが、確認が止まっている
        let (stalled, _) = prepare_place(&stalled_root, std::slice::from_ref(&ok_place));
        let stalled_root_s = stalled.root.clone();
        let probe = move |r: &str| {
            if r == stalled_root_s {
                thread::sleep(Duration::from_secs(2));
            }
            fs_root_reachable(r)
        };
        let places = vec![ok_place.clone(), stalled.clone()];
        let t = Instant::now();
        let out = place_infos(&places, &PlaceProbes::default(), Duration::from_millis(300), probe);
        assert!(t.elapsed() < Duration::from_millis(1500));
        assert!(out[0].reachable && out[0].shared);
        assert!(!out[1].reachable && !out[1].shared);
    }

    #[test]
    fn place_probed_resolve_times_out_as_unreachable() {
        let tmp = place_fixture();
        let places = vec![Place {
            id: "p".into(),
            name: "n".into(),
            root: fs::canonicalize(tmp.path()).unwrap().to_string_lossy().to_string(),
        }];
        let (slow, _) = sleeping_probe(1500);
        let err = resolve_in_places_probed(
            &places,
            &PlaceProbes::default(),
            "p",
            "a.txt",
            Duration::from_millis(100),
            slow,
        )
        .unwrap_err();
        assert_eq!(err, PlaceResolveError::Unreachable);
        let ok = resolve_in_places_probed(
            &places,
            &PlaceProbes::default(),
            "p",
            "a.txt",
            PLACE_PROBE_TIMEOUT,
            fs_root_reachable,
        );
        assert!(ok.is_ok());
    }

    #[test]
    fn place_pick_files_maps_each_path_and_counts_failures() {
        let tmp = place_fixture();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("out.txt");
        fs::write(&outside_file, "x").unwrap();
        let places = vec![Place { id: "p".into(), name: "n".into(), root: root.to_string_lossy().to_string() }];
        let paths = vec![
            root.join("a.txt"),
            outside_file,
            root.join("no-such-file.txt"),
            // フォルダはファイルとして扱わない
            root.clone(),
        ];
        let out = picked_files_from_paths(&places, &paths, PLACE_PICK_STALL_TIMEOUT, picked_file_from_path).unwrap();
        assert_eq!(out.failed, 2);
        assert_eq!(out.files.len(), 2);
        assert_eq!(out.files[0].place_id.as_deref(), Some("p"));
        assert_eq!(out.files[0].rel_path.as_deref(), Some("a.txt"));
        assert_eq!(out.files[1].place_id, None);
        assert_eq!(out.files[1].rel_path, None);
    }

    #[test]
    fn place_pick_files_refuses_too_many_before_touching_files() {
        let paths = vec![PathBuf::from("/nonexistent-zzz/a"); PLACE_PICK_MAX_FILES + 1];
        let err = picked_files_from_paths(&[], &paths, PLACE_PICK_STALL_TIMEOUT, |_, _, _| {
            panic!("ファイルに触らない")
        })
        .err()
        .unwrap();
        assert_eq!(err, format!("{PLACE_PICK_TOO_MANY_PREFIX}:{PLACE_PICK_MAX_FILES}"));
    }

    #[test]
    fn place_pick_files_gives_up_on_a_stalled_share_and_keeps_what_it_found() {
        let paths = vec![PathBuf::from("a"), PathBuf::from("stalled"), PathBuf::from("c")];
        let started = Instant::now();
        let out = picked_files_from_paths(&[], &paths, Duration::from_millis(100), |_, path, _| {
            if path == Path::new("stalled") {
                thread::sleep(Duration::from_secs(5));
            }
            Ok(PickedFile {
                place_id: None,
                rel_path: None,
                name: path.to_string_lossy().to_string(),
                size: 0,
                mtime_ms: 0,
            })
        })
        .unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(out.files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["a"]);
        assert_eq!(out.failed, 2);
    }

    #[cfg(unix)]
    #[test]
    fn place_pick_files_refuses_a_name_that_could_never_be_checked_later() {
        let tmp = place_fixture();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let bad = root.join("line\nbreak.txt");
        fs::write(&bad, "x").unwrap();
        let places = vec![Place { id: "p".into(), name: "n".into(), root: root.to_string_lossy().to_string() }];
        let out = picked_files_from_paths(&places, &[bad], PLACE_PICK_STALL_TIMEOUT, picked_file_from_path).unwrap();
        assert!(out.files.is_empty());
        assert_eq!(out.failed, 1);
    }

    #[cfg(unix)]
    #[test]
    fn place_pick_files_counts_a_link_to_outside_as_outside() {
        let tmp = place_fixture();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("secret.txt");
        fs::write(&target, "x").unwrap();
        let link = root.join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let places = vec![Place { id: "p".into(), name: "n".into(), root: root.to_string_lossy().to_string() }];
        let out = picked_files_from_paths(&places, &[link], PLACE_PICK_STALL_TIMEOUT, picked_file_from_path).unwrap();
        assert_eq!(out.files.len(), 1);
        assert_eq!(out.files[0].place_id, None);
        assert_eq!(out.files[0].rel_path, None);
    }

    #[test]
    fn place_locate_skips_unrelated_stalled_roots() {
        let tmp = place_fixture();
        let root = fs::canonicalize(tmp.path()).unwrap();
        // 接頭辞が合わない置き場の root は canonicalize しない（存在しない値でも影響しない）
        let places = vec![
            Place { id: "far".into(), name: "f".into(), root: "/nonexistent-zzz/share".into() },
            Place { id: "near".into(), name: "n".into(), root: root.to_string_lossy().to_string() },
        ];
        assert_eq!(
            locate_in_places(&places, &root.join("a.txt")),
            Some(("near".to_string(), "a.txt".to_string()))
        );
    }

    #[cfg(unix)]
    #[test]
    fn place_recheck_target_detects_swaps() {
        let tmp = place_fixture();
        let real = fs::canonicalize(tmp.path().join("a.txt")).unwrap();
        // 同じ実体なら通る
        assert!(recheck_place_target(&real).is_ok());
        // リンクに差し替えたら通らない
        let other = tmp.path().join("other.txt");
        fs::write(&other, b"x").unwrap();
        fs::remove_file(&real).unwrap();
        std::os::unix::fs::symlink(&other, &real).unwrap();
        assert_eq!(recheck_place_target(&real).unwrap_err(), PlaceResolveError::Missing);
        // 別のファイルに差し替えた（パスの途中がリンクで、実体が別の場所）ら通らない
        let via_link = tmp.path().join("inner");
        std::os::unix::fs::symlink(tmp.path().join("sub"), &via_link).unwrap();
        let swapped = via_link.join("日本語 と 空白.docx");
        assert_eq!(recheck_place_target(&swapped).unwrap_err(), PlaceResolveError::Missing);
        // フォルダ・無いものも通らない
        assert!(recheck_place_target(&tmp.path().join("sub")).is_err());
        assert!(recheck_place_target(&tmp.path().join("nope")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn place_marker_fifo_is_invalid_without_blocking() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let fifo = root.join(PLACE_MARKER_FILE);
        let made = Command::new("mkfifo").arg(&fifo).status().is_ok_and(|s| s.success());
        if !made {
            eprintln!("mkfifo を作れない環境のため飛ばす");
            return;
        }
        // 全体として止まらず Invalid になる
        let root2 = root.clone();
        let r = run_with_timeout(Duration::from_secs(3), move || read_place_marker(&root2));
        assert_eq!(r, Some(PlaceMarker::Invalid));
        // 確認のあとに差し替えられた場合に当たる開く経路も、止まらず開けて、通常ファイルではない
        let f = run_with_timeout(Duration::from_secs(3), move || open_place_marker(&fifo))
            .expect("open が止まった")
            .unwrap();
        assert!(!f.metadata().unwrap().is_file());
    }

    #[test]
    fn place_root_allowed_rejects_broad_and_internal() {
        let home = Path::new("/Users/alice");
        let data = Path::new("/Users/alice/Documents/Graphium");
        let cfg = Path::new("/Users/alice/Library/Application Support/com.graphium.app");
        let chk =
            |p: &str| check_place_root_allowed(Path::new(p), Some(home), Some(data), Some(cfg));
        assert!(chk("/").is_err());
        assert!(chk("/Users").is_err());
        assert!(chk("/Users/alice").is_err());
        assert!(chk("/Users/alice/Documents/Graphium").is_err());
        assert!(chk("/Users/alice/Documents/Graphium/notes").is_err());
        // データフォルダを含む親
        assert!(chk("/Users/alice/Documents").is_err());
        assert!(chk("/Users/alice/Library/Application Support/com.graphium.app").is_err());
        assert!(chk("/Users/alice/Library/Application Support/com.graphium.app/x").is_err());
        assert!(chk("/Users/alice/Library").is_err());
        assert!(chk("/Users/alice/Projects/shared").is_ok());
        assert!(chk("/Volumes/nas/team").is_ok());
        assert!(check_place_root_allowed(Path::new("/Users/alice/x"), None, None, None).is_ok());
    }

    #[test]
    fn place_marker_over_limit_is_invalid_and_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let id = "123e4567-e89b-42d3-a456-426614174000";
        let body = format!(r#"{{"id":"{id}","pad":"{}"}}"#, "x".repeat(64 * 1024));
        assert!(body.len() as u64 > PLACE_MARKER_MAX_BYTES);
        fs::write(root.join(PLACE_MARKER_FILE), &body).unwrap();
        assert_eq!(read_place_marker(&root), PlaceMarker::Invalid);
        let (place, shared) = prepare_place(&root, &[]);
        assert!(!shared);
        assert_ne!(place.id, id);
        assert_eq!(fs::read_to_string(root.join(PLACE_MARKER_FILE)).unwrap(), body);
    }

    #[cfg(unix)]
    #[test]
    fn place_resolve_returns_real_path_without_link_name() {
        let tmp = place_fixture();
        std::os::unix::fs::symlink(tmp.path().join("sub"), tmp.path().join("inner")).unwrap();
        let r = resolve_place_file(tmp.path(), "inner/日本語 と 空白.docx").unwrap();
        assert!(!r.path.to_string_lossy().contains("inner"));
        assert_eq!(
            r.path,
            fs::canonicalize(tmp.path().join("sub").join("日本語 と 空白.docx")).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn place_root_swapped_to_symlink_is_unreachable() {
        let tmp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(tmp.path()).unwrap();
        let root = base.join("place");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.txt"), b"hi").unwrap();
        let places = vec![Place {
            id: "p".into(),
            name: "n".into(),
            root: root.to_string_lossy().to_string(),
        }];
        assert!(resolve_in_places(&places, "p", "a.txt").is_ok());
        // root をリンクに差し替える（登録時の実体とは別物）
        let other = base.join("other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("a.txt"), b"evil").unwrap();
        fs::remove_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&other, &root).unwrap();
        assert_eq!(
            resolve_in_places(&places, "p", "a.txt").unwrap_err(),
            PlaceResolveError::Unreachable
        );
        let item = LinkRef { place_id: "p".into(), rel_path: "a.txt".into() };
        assert_eq!(stat_in_places(&places, &item).state, "unreachable");
    }

    #[test]
    fn place_resolve_missing_unreachable_and_directory() {
        let tmp = place_fixture();
        assert_eq!(
            resolve_place_file(tmp.path(), "nope.txt").unwrap_err(),
            PlaceResolveError::Missing
        );
        // ファイルの下をフォルダとして辿る
        assert_eq!(
            resolve_place_file(tmp.path(), "a.txt/x").unwrap_err(),
            PlaceResolveError::Missing
        );
        // フォルダを指した
        assert_eq!(resolve_place_file(tmp.path(), "sub").unwrap_err(), PlaceResolveError::Missing);
        // root が無い
        let gone = tmp.path().join("gone");
        assert_eq!(resolve_place_file(&gone, "a.txt").unwrap_err(), PlaceResolveError::Unreachable);
        // 状態への対応
        assert_eq!(PlaceResolveError::Unreachable.state(), "unreachable");
        assert_eq!(PlaceResolveError::Missing.state(), "missing");
        assert_eq!(PlaceResolveError::Unregistered.state(), "unregistered");
    }

    #[cfg(unix)]
    #[test]
    fn place_resolve_refuses_symlinks() {
        let tmp = place_fixture();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), b"x").unwrap();
        // 途中のフォルダが外を指す
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("escape")).unwrap();
        assert_eq!(
            resolve_place_file(tmp.path(), "escape/secret.txt").unwrap_err(),
            PlaceResolveError::Missing
        );
        // ファイル自体がリンク（置き場の内を指していても、たどらない）
        std::os::unix::fs::symlink(tmp.path().join("a.txt"), tmp.path().join("link.txt")).unwrap();
        assert_eq!(
            resolve_place_file(tmp.path(), "link.txt").unwrap_err(),
            PlaceResolveError::Missing
        );
        // 置き場の内を指すフォルダのリンク越しは通る
        std::os::unix::fs::symlink(tmp.path().join("sub"), tmp.path().join("inner")).unwrap();
        assert!(resolve_place_file(tmp.path(), "inner/日本語 と 空白.docx").is_ok());
    }

    #[test]
    fn place_stat_and_unregistered() {
        let tmp = place_fixture();
        // 台帳の root は登録時に canonicalize 済み。resolve_in_places が現在の実体と比べるので、
        // テストも canonicalize した root を使う（macOS の /var → /private/var など）
        let places = vec![Place {
            id: "p1".into(),
            name: "n".into(),
            root: fs::canonicalize(tmp.path()).unwrap().to_string_lossy().to_string(),
        }];
        let item = |id: &str, rel: &str| LinkRef { place_id: id.into(), rel_path: rel.into() };
        let ok = stat_in_places(&places, &item("p1", "a.txt"));
        assert_eq!(ok.state, "ok");
        assert_eq!(ok.size, Some(5));
        assert_eq!(stat_in_places(&places, &item("p1", "../a.txt")).state, "missing");
        assert_eq!(stat_in_places(&places, &item("p2", "a.txt")).state, "unregistered");
    }

    #[test]
    fn place_marker_created_when_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let (place, shared) = prepare_place(&root, &[]);
        assert!(shared);
        assert!(uuid::Uuid::parse_str(&place.id).is_ok());
        match read_place_marker(&root) {
            PlaceMarker::Valid { id, .. } => assert_eq!(id, place.id),
            other => panic!("目印が作られていない: {other:?}"),
        }
    }

    #[test]
    fn place_marker_existing_id_is_used() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let id = "123e4567-e89b-42d3-a456-426614174000";
        fs::write(root.join(PLACE_MARKER_FILE), format!(r#"{{"id":"{id}","name":"共有 置き場"}}"#))
            .unwrap();
        let (place, shared) = prepare_place(&root, &[]);
        assert!(shared);
        assert_eq!(place.id, id);
        assert_eq!(place.name, "共有 置き場");
    }

    #[test]
    fn place_marker_with_non_uuid_id_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let body = r#"{"id":"not-a-uuid","name":"x"}"#;
        fs::write(root.join(PLACE_MARKER_FILE), body).unwrap();
        let (place, shared) = prepare_place(&root, &[]);
        assert!(!shared);
        assert!(uuid::Uuid::parse_str(&place.id).is_ok());
        assert_eq!(fs::read_to_string(root.join(PLACE_MARKER_FILE)).unwrap(), body);
    }

    #[test]
    fn place_marker_id_registered_elsewhere_becomes_device_local() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let root_a = fs::canonicalize(a.path()).unwrap();
        let root_b = fs::canonicalize(b.path()).unwrap();
        let (first, shared_first) = prepare_place(&root_a, &[]);
        assert!(shared_first);
        // 同じ目印をもつ写しを別の場所に置いて登録する
        fs::copy(root_a.join(PLACE_MARKER_FILE), root_b.join(PLACE_MARKER_FILE)).unwrap();
        let (second, shared_second) = prepare_place(&root_b, std::slice::from_ref(&first));
        assert!(!shared_second);
        assert_ne!(second.id, first.id);
        // place_info でも shared にならない（目印の id と違う）
        assert!(!place_info(&second).shared);
        assert!(place_info(&first).shared);
    }

    #[test]
    fn place_name_normalization() {
        assert_eq!(normalize_place_name("  共有 \u{7}フォルダ ", false).unwrap(), "共有 フォルダ");
        assert!(normalize_place_name("   ", false).is_err());
        assert!(normalize_place_name("\u{7}", true).is_err());
        let long = "あ".repeat(PLACE_NAME_MAX_CHARS + 5);
        assert!(normalize_place_name(&long, false).is_err());
        assert_eq!(normalize_place_name(&long, true).unwrap().chars().count(), PLACE_NAME_MAX_CHARS);
    }

    #[test]
    fn place_ledger_roundtrip_and_corrupt_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("cfg").join(PLACE_LEDGER_FILE);
        let places = vec![Place { id: "i".into(), name: "名前".into(), root: "/r".into() }];
        save_places(&path, &places).unwrap();
        assert_eq!(load_places(&path), places);
        // 一時ファイルが残らない
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
        // 壊れた JSON は空。読んだだけではファイルを書き換えない
        fs::write(&path, "{broken").unwrap();
        assert!(load_places(&path).is_empty());
        assert!(parse_places("[1,2]").is_empty());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
        // 変更が成功したときに初めて上書きされる
        let inner = Mutex::new(None);
        mutate_places(&inner, &path, |p| {
            p.push(places[0].clone());
            Ok(((), true))
        })
        .unwrap();
        assert_eq!(load_places(&path), places);
    }

    #[test]
    fn place_locate_picks_deepest_root() {
        let tmp = place_fixture();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let places = vec![
            Place { id: "outer".into(), name: "o".into(), root: root.to_string_lossy().to_string() },
            Place {
                id: "inner".into(),
                name: "i".into(),
                root: root.join("sub").to_string_lossy().to_string(),
            },
        ];
        let file = root.join("sub").join("日本語 と 空白.docx");
        assert_eq!(
            locate_in_places(&places, &file),
            Some(("inner".to_string(), "日本語 と 空白.docx".to_string()))
        );
        let file = root.join("a.txt");
        assert_eq!(locate_in_places(&places, &file), Some(("outer".to_string(), "a.txt".to_string())));
        let other = tempfile::tempdir().unwrap();
        let other_file = fs::canonicalize(other.path()).unwrap().join("z");
        assert_eq!(locate_in_places(&places, &other_file), None);
    }
}
