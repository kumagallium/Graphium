// Graphium デスクトップアプリのコアライブラリ

use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("about", "About Graphium")
                .text("release-notes", "Release Notes")
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // メニューイベントハンドラ
            app.on_menu_event(move |app, event| {
                let window = app.get_webview_window("main").unwrap();
                let id = event.id().0.as_str();
                match id {
                    "new-note" | "export-pdf" | "export-prov"
                    | "toggle-graph" | "toggle-chat"
                    | "about" | "release-notes" => {
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
