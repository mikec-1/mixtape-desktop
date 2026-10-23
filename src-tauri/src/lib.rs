use tauri::{webview::PageLoadEvent, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

mod account;
mod discord;
mod local;
mod offline;

/// Lets the mini player float over other apps' full-screen spaces (a Chrome video, say). macOS only
/// shows a regular app's windows there if they're non-activating panels, so the window is turned
/// into one: an NSPanel subclass that can still take key (for its buttons), joins every space as a
/// full-screen auxiliary, and stays put when Sleeve isn't frontmost. It's always on top
/// (store.ts toggleMini).
#[tauri::command]
fn float_mini(window: tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
        use objc2::{sel, ClassType};
        use objc2_app_kit::{NSPanel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
        let Ok(ptr) = window.ns_window() else { return };
        let class = AnyClass::get(c"SleeveMiniPanel").unwrap_or_else(|| {
            extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
                Bool::YES
            }
            let mut panel = ClassBuilder::new(c"SleeveMiniPanel", NSPanel::class()).unwrap();
            panel.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
            panel.register()
        });
        objc2::ffi::object_setClass(ptr.cast(), class);
        let ns = &*ptr.cast::<NSWindow>();
        ns.setStyleMask(ns.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        ns.setCollectionBehavior(ns.collectionBehavior() | NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
        ns.setHidesOnDeactivate(false);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Settings → Startup. Opened at login it starts hidden; main.tsx shows it unless you chose otherwise.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--login"])))
        .invoke_handler(tauri::generate_handler![float_mini, local::scan_music, local::allow_music, local::local_lyrics, offline::downloads_dir, offline::save_download, offline::delete_downloads, offline::downloads_size, account::oauth_start, account::oauth_wait, discord::discord_set, discord::discord_clear])
        .setup(|app| {
            // Built here rather than from config alone so downloads (Settings → Export) save to Downloads;
            // WKWebView cancels them without a handler.
            let main = WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_download(|_, _| true)
                .visible(!std::env::args().any(|a| a == "--login"));
            // Apple's own buttons, centred in the 76px rail card that sits 8px in (App.tsx RAIL): the
            // three span ~62pt on macOS 26. Set on the webview, not the window (trafficLightPosition in
            // the config): only the webview's view redraws, so only its inset survives resizes.
            #[cfg(target_os = "macos")]
            let main = main.traffic_light_position(tauri::LogicalPosition::new(15.0, 18.0));
            main.build()?;
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
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Clicking the Dock icon brings back a window that's hidden (in the tray, or opened at login).
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
