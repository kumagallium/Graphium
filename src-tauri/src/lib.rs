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

// --- ファイルシステムコマンド ---

/// ノートの保存先ディレクトリを取得（~/Documents/Graphium/notes/）
fn notes_dir() -> Result<PathBuf, String> {
    let dir = dirs::document_dir()
        .ok_or("ドキュメントフォルダが見つかりません")?
        .join("Graphium")
        .join("notes");
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// メディアの保存先ディレクトリを取得（~/Documents/Graphium/media/）
fn media_dir() -> Result<PathBuf, String> {
    let dir = dirs::document_dir()
        .ok_or("ドキュメントフォルダが見つかりません")?
        .join("Graphium")
        .join("media");
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// Wiki ドキュメントの保存先ディレクトリを取得（~/Documents/Graphium/wiki/）
fn wiki_dir() -> Result<PathBuf, String> {
    let dir = dirs::document_dir()
        .ok_or("ドキュメントフォルダが見つかりません")?
        .join("Graphium")
        .join("wiki");
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// Skill ドキュメントの保存先ディレクトリを取得（~/Documents/Graphium/skills/）
fn skill_dir() -> Result<PathBuf, String> {
    let dir = dirs::document_dir()
        .ok_or("ドキュメントフォルダが見つかりません")?
        .join("Graphium")
        .join("skills");
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
}

/// アプリデータの保存先ディレクトリを取得（~/Documents/Graphium/appdata/）
fn appdata_dir() -> Result<PathBuf, String> {
    let dir = dirs::document_dir()
        .ok_or("ドキュメントフォルダが見つかりません")?
        .join("Graphium")
        .join("appdata");
    fs::create_dir_all(&dir).map_err(|e| format!("ディレクトリ作成失敗: {e}"))?;
    Ok(dir)
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
