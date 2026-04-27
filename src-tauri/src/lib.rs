// Graphium デスクトップアプリのコアライブラリ

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// 終了処理の状態。フロントから shutdown_ack が来ると true、
/// 次の CloseRequested ではそのまま閉じる（無限ループ防止）
static SHUTDOWN_ACK: AtomicBool = AtomicBool::new(false);

/// フロントエンドから呼ぶ「sidecar の後始末が終わったので終了してよい」通知
#[tauri::command]
fn shutdown_ack(app: tauri::AppHandle) {
    SHUTDOWN_ACK.store(true, Ordering::SeqCst);
    app.exit(0);
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

/// ノートファイルを削除
#[tauri::command]
fn delete_note_file(file_id: String) -> Result<(), String> {
    let path = notes_dir()?.join(format!("{file_id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("ファイル削除失敗: {e}"))?;
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

/// Wiki ファイルを削除
#[tauri::command]
fn delete_wiki_file(file_id: String) -> Result<(), String> {
    let path = wiki_dir()?.join(format!("{file_id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Wiki 削除失敗: {e}"))?;
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

/// Skill ファイルを削除
#[tauri::command]
fn delete_skill_file(file_id: String) -> Result<(), String> {
    let path = skill_dir()?.join(format!("{file_id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Skill 削除失敗: {e}"))?;
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

/// メディアファイルを削除
#[tauri::command]
fn delete_media_file(file_id: String) -> Result<(), String> {
    let dir = media_dir()?;
    let data_path = dir.join(&file_id);
    if data_path.exists() {
        fs::remove_file(&data_path).map_err(|e| format!("メディア削除失敗: {e}"))?;
    }
    let meta_path = dir.join(format!("{file_id}.meta.json"));
    if meta_path.exists() {
        fs::remove_file(&meta_path)
            .map_err(|e| format!("メタデータ削除失敗: {e}"))?;
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
            shutdown_ack,
        ])
        .setup(|app| {
            // メニューバー構築
            let file_menu = SubmenuBuilder::new(app, "File")
                .text("new-note", "New Note")
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
                    "new-note" | "export-pdf" | "export-prov" | "toggle-graph"
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
