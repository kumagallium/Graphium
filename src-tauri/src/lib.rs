// Graphium デスクトップアプリのコアライブラリ

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

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

/// 子プロセスを Rust 側で起動する。
/// 戻り値は spawn できた PID。renderer 側はその後 `sidecar-log` /
/// `sidecar-closed` イベントをリッスンしてバックエンドの状態を追う。
#[tauri::command]
fn start_native_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, NativeSidecarState>,
    data_dir: String,
    port: Option<u16>,
) -> Result<u32, String> {
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
            let _ = kill_pid(old_pid);
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
        .env(
            "CORS_ORIGINS",
            "http://localhost:5174,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
        )
        .env("DATA_DIR", &data_dir)
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
        // アプリのバージョン。sidecar は /api/health でこれを返し、起動時に
        // フロントが自分（getVersion）と照合する。バージョンが食い違えば
        // 「自動更新前の古い自分」とみなして kill→再起動する。
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
        let _ = kill_pid(pid);
    }
    Ok(())
}

/// フロントエンドから呼ぶ「sidecar の後始末が終わったので終了してよい」通知
#[tauri::command]
fn shutdown_ack(app: tauri::AppHandle) {
    SHUTDOWN_ACK.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 任意 PID にシグナルを送って終了させる。
/// port 3001 に居座る "他人 sidecar"（消えた worktree の幽霊など）を回収するために使う。
/// Unix: SIGTERM、Windows: taskkill /F /PID
#[tauri::command]
fn kill_pid(pid: u32) -> Result<(), String> {
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
fn set_graphium_root(path: Option<String>) -> Result<GraphiumRootInfo, String> {
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
    let mut moved = LegacyDriveScan::default();
    moved.note_count = migrate_legacy_dir(&root, &root.join("notes"))?;
    let wiki = root.join("wiki");
    moved.wiki_count = migrate_legacy_dir(&wiki, &wiki)?;
    let skills = root.join("skills");
    moved.skill_count = migrate_legacy_dir(&skills, &skills)?;
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
    let path = notes_dir()?.join(format!("{file_id}.json"));
    fs::read_to_string(&path).map_err(|e| format!("ファイル読み取り失敗: {e}"))
}

/// ノートファイルを書き込み
#[tauri::command]
fn write_note_file(file_id: String, content: String) -> Result<(), String> {
    let path = notes_dir()?.join(format!("{file_id}.json"));
    fs::write(&path, content).map_err(|e| format!("ファイル書き込み失敗: {e}"))
}

/// ノートファイルを完全削除（OS のゴミ箱へ送る）
///
/// アプリ内ゴミ箱から「完全削除」が押されたときに呼ばれる。
/// `trash` クレートで OS のゴミ箱に送るので、ユーザーは Finder から復元できる。
/// trash クレートが失敗した場合はフォールバックで通常削除する。
#[tauri::command]
fn delete_note_file(file_id: String) -> Result<(), String> {
    let path = notes_dir()?.join(format!("{file_id}.json"));
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
    let path = wiki_dir()?.join(format!("{file_id}.json"));
    fs::read_to_string(&path).map_err(|e| format!("Wiki 読み取り失敗: {e}"))
}

/// Wiki ファイルを書き込み
#[tauri::command]
fn write_wiki_file(file_id: String, content: String) -> Result<(), String> {
    let path = wiki_dir()?.join(format!("{file_id}.json"));
    fs::write(&path, content).map_err(|e| format!("Wiki 書き込み失敗: {e}"))
}

/// Wiki ファイルを完全削除（OS のゴミ箱へ送る）
#[tauri::command]
fn delete_wiki_file(file_id: String) -> Result<(), String> {
    let path = wiki_dir()?.join(format!("{file_id}.json"));
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
    let path = skill_dir()?.join(format!("{file_id}.json"));
    fs::read_to_string(&path).map_err(|e| format!("Skill 読み取り失敗: {e}"))
}

/// Skill ファイルを書き込み
#[tauri::command]
fn write_skill_file(file_id: String, content: String) -> Result<(), String> {
    let path = skill_dir()?.join(format!("{file_id}.json"));
    fs::write(&path, content).map_err(|e| format!("Skill 書き込み失敗: {e}"))
}

/// Skill ファイルを完全削除（OS のゴミ箱へ送る）
#[tauri::command]
fn delete_skill_file(file_id: String) -> Result<(), String> {
    let path = skill_dir()?.join(format!("{file_id}.json"));
    if path.exists() {
        if let Err(e) = trash::delete(&path) {
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&path).map_err(|e| format!("Skill 削除失敗: {e}"))?;
        }
    }
    Ok(())
}

/// メディアファイルを保存（Base64 エンコードされたデータを受け取る）
#[tauri::command]
fn save_media_file(
    file_id: String,
    name: String,
    mime_type: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine;
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
    let meta_path = dir.join(format!("{file_id}.meta.json"));
    fs::write(
        &meta_path,
        serde_json::to_string(&meta).unwrap(),
    )
    .map_err(|e| format!("メタデータ書き込み失敗: {e}"))?;

    // バイナリデータを保存
    let data_path = dir.join(&file_id);
    fs::write(&data_path, bytes).map_err(|e| format!("メディア書き込み失敗: {e}"))
}

/// メディアファイルを読み込み（Base64 エンコードして返す）
#[tauri::command]
fn read_media_file(file_id: String) -> Result<String, String> {
    use base64::Engine;
    let path = media_dir()?.join(&file_id);
    let bytes = fs::read(&path).map_err(|e| format!("メディア読み取り失敗: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// URL の Reader 原文などのプレーンテキストを保存（B-persist）。
/// バイナリメディア（save_media_file）とは別に <media_dir>/<id>.txt に置く。
#[tauri::command]
fn save_media_text(file_id: String, text: String) -> Result<(), String> {
    let path = media_dir()?.join(format!("{file_id}.txt"));
    fs::write(&path, text).map_err(|e| format!("原文テキスト書き込み失敗: {e}"))
}

/// 保存済みの原文テキストを読み込み（存在しなければ None）。
#[tauri::command]
fn read_media_text(file_id: String) -> Result<Option<String>, String> {
    let path = media_dir()?.join(format!("{file_id}.txt"));
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("原文テキスト読み取り失敗: {e}"))
}

/// メディアファイル一覧を取得
#[tauri::command]
fn list_media_files_cmd() -> Result<Vec<MediaFileInfo>, String> {
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
fn delete_media_file(file_id: String) -> Result<(), String> {
    let dir = media_dir()?;
    let data_path = dir.join(&file_id);
    if data_path.exists() {
        if let Err(e) = trash::delete(&data_path) {
            eprintln!("trash::delete 失敗（フォールバックで unlink）: {e}");
            fs::remove_file(&data_path).map_err(|e| format!("メディア削除失敗: {e}"))?;
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
    let meta_path = media_dir()?.join(format!("{file_id}.meta.json"));
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

/// アプリデータを読み込み
#[tauri::command]
fn read_app_data(key: String) -> Result<Option<String>, String> {
    let path = appdata_dir()?.join(format!("{key}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("アプリデータ読み取り失敗: {e}"))?;
    Ok(Some(content))
}

/// アプリデータを書き込み
#[tauri::command]
fn write_app_data(key: String, data: String) -> Result<(), String> {
    let path = appdata_dir()?.join(format!("{key}.json"));
    fs::write(&path, data).map_err(|e| format!("アプリデータ書き込み失敗: {e}"))
}

/// メディアファイルのパスを取得（convertFileSrc 用）
#[tauri::command]
fn get_media_path(file_id: String) -> Result<String, String> {
    let path = media_dir()?.join(&file_id);
    if !path.exists() {
        return Err(format!("メディアが見つかりません: {file_id}"));
    }
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

const SHARED_ENTRY_TYPES: &[&str] = &[
    "notes",
    "references",
    "data-manifests",
    "templates",
    "concepts",
    "atoms",
    "reports",
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

/// shared root が空文字でないことだけチェック（実体のディレクトリ作成は各コマンド側で行う）。
fn validate_root(root: &str) -> Result<PathBuf, String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("shared root が未指定".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

/// `<root>/<entry_type>/` のパスを返し、必要なら作成する。
fn shared_type_dir(root: &str, entry_type: &str) -> Result<PathBuf, String> {
    validate_entry_type(entry_type)?;
    let root_path = validate_root(root)?;
    let dir = root_path.join(entry_type);
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// `<root>/_meta/tombstones/` のパスを返し、必要なら作成する。
fn shared_tombstone_dir(root: &str) -> Result<PathBuf, String> {
    let root_path = validate_root(root)?;
    let dir = root_path.join("_meta").join("tombstones");
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// `<blob-root>/<hh>/` のパスを返し、必要なら作成する。
fn shared_blob_dir(root: &str, hash: &str) -> Result<PathBuf, String> {
    validate_hash(hash)?;
    let root_path = validate_root(root)?;
    let hex_part = &hash["sha256:".len()..];
    let prefix = &hex_part[..2];
    let dir = root_path.join(prefix);
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// 指定 entry_type の全エントリ JSON 文字列を返す（list 用）。
/// メタデータ単体ではなく `{entry, body_base64}` をそのまま返し、TS 側で必要な部分だけ使う。
#[tauri::command]
fn shared_list(root: String, entry_type: String) -> Result<Vec<String>, String> {
    let dir = shared_type_dir(&root, &entry_type)?;
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
        out.push(content);
    }
    Ok(out)
}

#[tauri::command]
fn shared_read(root: String, entry_type: String, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = shared_type_dir(&root, &entry_type)?;
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

#[tauri::command]
fn shared_write(
    root: String,
    entry_type: String,
    id: String,
    content: String,
    author_email: Option<String>,
) -> Result<(), String> {
    validate_id(&id)?;
    let dir = shared_type_dir(&root, &entry_type)?;
    let path = dir.join(format!("{id}.json"));
    assert_existing_author(&path, &author_email)?;
    fs::write(&path, content).map_err(|e| format!("ファイル書き込み失敗: {e}"))
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
    let body_path = body_dir.join(format!("{id}.json"));
    assert_existing_author(&body_path, &author_email)?;
    if body_path.exists() {
        fs::remove_file(&body_path).map_err(|e| format!("本体ファイル削除失敗: {e}"))?;
    }
    let tomb_dir = shared_tombstone_dir(&root)?;
    let tomb_path = tomb_dir.join(format!("{id}.json"));
    fs::write(&tomb_path, tombstone_content)
        .map_err(|e| format!("tombstone 書き込み失敗: {e}"))?;
    Ok(())
}

/// Blob を hash で読み出す（base64 で返す）。
#[tauri::command]
fn shared_blob_read(root: String, hash: String) -> Result<String, String> {
    use base64::Engine;
    let dir = shared_blob_dir(&root, &hash)?;
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
    let hex_part = &hash["sha256:".len()..];
    let path = dir.join(hex_part);
    if path.exists() {
        return Ok(()); // dedup
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("base64 デコード失敗: {e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("blob 書き込み失敗: {e}"))
}

#[tauri::command]
fn shared_blob_exists(root: String, hash: String) -> Result<bool, String> {
    let dir = shared_blob_dir(&root, &hash)?;
    let hex_part = &hash["sha256:".len()..];
    Ok(dir.join(hex_part).exists())
}

/// Blob を hash 指定で削除する（GC 用）。
/// 呼び出し側で「他の active manifest が参照していない」ことを確認した hash のみを渡すこと。
/// 存在しない blob を渡しても No-op で成功する（idempotent）。
#[tauri::command]
fn shared_blob_delete(root: String, hash: String) -> Result<(), String> {
    let dir = shared_blob_dir(&root, &hash)?;
    let hex_part = &hash["sha256:".len()..];
    let path = dir.join(hex_part);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("blob 削除失敗: {e}"))?;
    }
    Ok(())
}

/// 任意のパスへバイナリ書き込み。base64 でエンコードされたバイト列を受け取る。
/// 呼び出し側で `dialog.save()` を使ってユーザーが選んだパスを取得してから渡すこと。
/// PDF などフロント側で生成したファイルを WKWebView の `<a download>` に頼らず保存するための入口。
#[tauri::command]
fn save_bytes_to_path(path: String, content_base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("base64 デコード失敗: {e}"))?;
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("親ディレクトリ作成失敗: {e}"))?;
        }
    }
    fs::write(&target, bytes).map_err(|e| format!("ファイル書き込み失敗: {e}"))
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
            save_media_text,
            read_media_text,
            list_media_files_cmd,
            delete_media_file,
            rename_media_file,
            read_app_data,
            write_app_data,
            get_media_path,
            get_graphium_root,
            set_graphium_root,
            detect_legacy_drive_layout,
            migrate_legacy_drive_layout,
            shared_list,
            shared_read,
            shared_write,
            shared_delete,
            shared_blob_read,
            shared_blob_write,
            shared_blob_exists,
            shared_blob_delete,
            shutdown_ack,
            kill_pid,
            save_bytes_to_path,
            start_native_sidecar,
            stop_native_sidecar,
        ])
        .manage(NativeSidecarState::default())
        .setup(|app| {
            // メニューバー構築
            // ⌘⇧M (Quick Memo) はネイティブメニューのアクセラレータとして登録する。
            // 理由: WKWebView では Cmd 系ショートカットがメニューの key-equivalent 処理に
            // 先取りされ、JS の document keydown まで届かないことがある。ネイティブ項目に
            // すればキー配送に依存せず確実に発火し、メニューバーからも発見できる。
            let new_memo = MenuItemBuilder::with_id("new-memo", "New Memo")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .text("new-note", "New Note")
                .item(&new_memo)
                .separator()
                .text("export-pdf", "Export as PDF")
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
                .text("zoom-in", "Zoom In")
                .text("zoom-out", "Zoom Out")
                .text("zoom-reset", "Actual Size")
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
                    "zoom-in" => {
                        let _ = window.eval("document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') + 0.1).toString()");
                    }
                    "zoom-out" => {
                        let _ = window.eval("document.body.style.zoom = (Math.max(0.5, parseFloat(document.body.style.zoom || '1') - 0.1)).toString()");
                    }
                    "zoom-reset" => {
                        let _ = window.eval("document.body.style.zoom = '1'");
                    }
                    _ => {}
                }
            });

            // 閉じるイベント制御: 一旦 prevent_close してフロントに通知し、
            // sidecar 停止後に shutdown_ack を受けて exit する。
            // フロントが応答しなくても 3 秒のフェイルセーフで強制終了する。
            if let Some(main_window) = app.get_webview_window("main") {
                let window_handle = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if SHUTDOWN_ACK.load(Ordering::SeqCst) {
                            // ACK 済み → そのまま閉じる
                            return;
                        }
                        api.prevent_close();
                        let _ = window_handle.emit("app-close-requested", ());

                        // フェイルセーフ: 3 秒以内に ACK が来なければ強制終了
                        let app_handle = window_handle.app_handle().clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(3));
                            if !SHUTDOWN_ACK.load(Ordering::SeqCst) {
                                app_handle.exit(0);
                            }
                        });
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
