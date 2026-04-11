// デスクトップエントリーポイント
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    graphium_lib::run()
}
