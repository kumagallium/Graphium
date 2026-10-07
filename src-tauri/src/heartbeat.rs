// アプリ起動中を MCP に知らせるハートビート（`<root>/appdata/app-heartbeat.json`）。
// WebView のタイマーはウィンドウが隠れると止まるので、デスクトップ版は Rust 側のスレッドで書く。
// MCP は pid の生死と `at` の鮮度で「起動中」を判定し、書き換え系ツールを断る
// （仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §2）。
// tauri には依存しない（単体テストを軽くするため）。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

/// 書き込み間隔（秒）。MCP 側の鮮度判定（90 秒）より十分短くする
const INTERVAL_SECS: u64 = 30;
/// 停止フラグを見る間隔。終了時の join が長引かないように細かく刻む
const POLL_MILLIS: u64 = 200;

const FILE_NAME: &str = "app-heartbeat.json";

/// 動作中のハートビート 1 本分
struct Running {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    path: PathBuf,
}

static CURRENT: Mutex<Option<Running>> = Mutex::new(None);

/// `<root>/appdata/app-heartbeat.json`
pub fn heartbeat_path(root: &Path) -> PathBuf {
    root.join("appdata").join(FILE_NAME)
}

/// ISO 8601（UTC・秒精度）。例: 2026-10-07T01:02:03Z
pub fn iso_now() -> String {
    humantime::format_rfc3339_seconds(SystemTime::now()).to_string()
}

/// 中身の JSON を組む
pub fn build_payload(pid: u32, at: &str, started_at: &str, version: &str) -> String {
    serde_json::json!({
        "pid": pid,
        "via": "desktop",
        "at": at,
        "startedAt": started_at,
        "version": version,
    })
    .to_string()
}

/// 原子的に書く: 同じディレクトリに `app-heartbeat.json.tmp-<pid>` を書いて rename。
/// appdata が無ければ作る。失敗時は一時ファイルを消す
pub fn write_heartbeat_file(root: &Path, started_at: &str, version: &str) -> io::Result<()> {
    let path = heartbeat_path(root);
    let dir = path.parent().expect("heartbeat path has a parent");
    fs::create_dir_all(dir)?;
    let pid = std::process::id();
    let tmp = dir.join(format!("{FILE_NAME}.tmp-{pid}"));
    let body = build_payload(pid, &iso_now(), started_at, version);
    let result = fs::write(&tmp, body).and_then(|_| fs::rename(&tmp, &path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// ファイルを消す。無ければ何もしない。失敗は握ってログだけ
pub fn remove_heartbeat_file(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("[heartbeat] 削除に失敗: {} ({e})", path.display()),
    }
}

/// 今のハートビートを止めてファイルを消す（終了時・root 変更時）
pub fn stop_and_remove() {
    let prev = CURRENT.lock().ok().and_then(|mut g| g.take());
    if let Some(mut r) = prev {
        r.stop.store(true, Ordering::SeqCst);
        // 止めたあとに書き直されないよう、スレッドの終了を待ってから消す
        if let Some(h) = r.handle.take() {
            let _ = h.join();
        }
        remove_heartbeat_file(&r.path);
    }
}

/// 開始する。すでに動いていれば止めて（前の root のファイルは消して）新しい root で書き直す
pub fn start(root: PathBuf, version: String) -> Result<(), String> {
    stop_and_remove();
    let started_at = iso_now();
    // 最初の 1 回は呼び出しスレッドで書き、失敗を呼び出し元に返す
    write_heartbeat_file(&root, &started_at, &version)
        .map_err(|e| format!("ハートビートの書き込みに失敗: {e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_t = stop.clone();
    let root_t = root.clone();
    let handle = std::thread::spawn(move || {
        let mut waited = 0u64;
        loop {
            std::thread::sleep(Duration::from_millis(POLL_MILLIS));
            if stop_t.load(Ordering::SeqCst) {
                return;
            }
            waited += POLL_MILLIS;
            if waited < INTERVAL_SECS * 1000 {
                continue;
            }
            waited = 0;
            if let Err(e) = write_heartbeat_file(&root_t, &started_at, &version) {
                eprintln!("[heartbeat] 書き込みに失敗: {e}");
            }
        }
    });

    if let Ok(mut g) = CURRENT.lock() {
        *g = Some(Running {
            stop,
            handle: Some(handle),
            path: heartbeat_path(&root),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("graphium-hb-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn 書式は_pid_via_at_startedat_version() {
        let root = temp_root("fmt");
        write_heartbeat_file(&root, "2026-10-07T00:00:00Z", "1.2.3").unwrap();
        let text = fs::read_to_string(heartbeat_path(&root)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["pid"].as_u64().unwrap(), std::process::id() as u64);
        assert_eq!(v["via"], "desktop");
        assert_eq!(v["startedAt"], "2026-10-07T00:00:00Z");
        assert_eq!(v["version"], "1.2.3");
        let at = v["at"].as_str().unwrap();
        // 2026-10-07T01:02:03Z の形
        assert_eq!(at.len(), 20);
        assert!(at.ends_with('Z') && at.as_bytes()[10] == b'T');
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 書き込み後に一時ファイルが残らない() {
        let root = temp_root("atomic");
        write_heartbeat_file(&root, "x", "1").unwrap();
        write_heartbeat_file(&root, "x", "1").unwrap();
        let names: Vec<String> = fs::read_dir(root.join("appdata"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec![FILE_NAME.to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 削除でき_無くても失敗しない() {
        let root = temp_root("rm");
        write_heartbeat_file(&root, "x", "1").unwrap();
        let path = heartbeat_path(&root);
        remove_heartbeat_file(&path);
        assert!(!path.exists());
        remove_heartbeat_file(&path);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 開始から停止でファイルが消え_root_変更で前を消す() {
        let a = temp_root("start-a");
        let b = temp_root("start-b");
        start(a.clone(), "1".into()).unwrap();
        assert!(heartbeat_path(&a).exists());
        start(b.clone(), "1".into()).unwrap();
        assert!(!heartbeat_path(&a).exists());
        assert!(heartbeat_path(&b).exists());
        stop_and_remove();
        assert!(!heartbeat_path(&b).exists());
        let _ = fs::remove_dir_all(&a);
        let _ = fs::remove_dir_all(&b);
    }
}
