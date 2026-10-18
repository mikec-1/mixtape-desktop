use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // YouTube's BotGuard only issues real integrity tokens on www.youtube.com, so PO tokens are
            // minted in a hidden window there; robots.txt is the lightest page on that origin.
            WebviewWindowBuilder::new(app, "potoken", WebviewUrl::External("https://www.youtube.com/robots.txt".parse()?))
                .visible(false)
                .on_page_load(|webview, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        let _ = webview.eval(include_str!("potoken.js"));
                    }
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The hidden window would otherwise keep the app alive after the main one closes.
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
