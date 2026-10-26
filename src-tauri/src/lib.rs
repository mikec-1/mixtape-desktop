use tauri::{webview::PageLoadEvent, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

mod account;
mod align;
mod discord;
mod local;
mod offline;

/// Lets the mini player and the menu bar player float over other apps' full-screen spaces (a Chrome
/// video, say). macOS only shows a regular app's windows there if they're non-activating panels, so
/// the window is turned into one: an NSPanel subclass that can still take key (for its buttons and
/// search), joins every space as a full-screen auxiliary, and stays put when Mixtape isn't frontmost.
/// Its own class is kept to put back before it closes (sink): WebKit unregisters its observers of the
/// window as the page goes, and under another class that throws, which aborts the app.
#[cfg(target_os = "macos")]
static FLOATED: std::sync::Mutex<Vec<(String, usize)>> = std::sync::Mutex::new(Vec::new());

#[tauri::command]
fn float(window: tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
        use objc2::{sel, ClassType};
        use objc2_app_kit::{NSPanel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
        let Ok(ptr) = window.ns_window() else { return };
        let mut floated = FLOATED.lock().unwrap();
        if floated.iter().any(|(label, _)| label == window.label()) {
            return; // already one (the page reloaded)
        }
        let class = AnyClass::get(c"MixtapeMiniPanel").unwrap_or_else(|| {
            extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
                Bool::YES
            }
            let mut panel = ClassBuilder::new(c"MixtapeMiniPanel", NSPanel::class()).unwrap();
            panel.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
            panel.register()
        });
        floated.push((window.label().into(), objc2::ffi::object_getClass(ptr.cast()) as usize));
        objc2::ffi::object_setClass(ptr.cast(), class);
        let ns = &*ptr.cast::<NSWindow>();
        ns.setStyleMask(ns.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        ns.setCollectionBehavior(ns.collectionBehavior() | NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
        ns.setHidesOnDeactivate(false);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Undoes float's class change, as the window closes or the app quits.
fn sink(window: &tauri::Window) {
    #[cfg(target_os = "macos")]
    {
        let mut floated = FLOATED.lock().unwrap();
        let Some(at) = floated.iter().position(|(label, _)| label == window.label()) else { return };
        let (_, own) = floated.remove(at);
        if let Ok(ptr) = window.ns_window() {
            unsafe { objc2::ffi::object_setClass(ptr.cast(), own as *const objc2::runtime::AnyClass) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Shows a right-click menu made in the page. Tauri's own popup keeps the page's resources locked until the
/// menu closes, so the menu-bar icon (startup.ts), which changes 30 times a second while a song plays, waited
/// on them forever on the main thread and froze the app. This lets go of them first.
#[tauri::command]
async fn popup(webview: tauri::Webview, window: tauri::Window, rid: tauri::ResourceId) -> tauri::Result<()> {
    let menu = webview.resources_table().get::<tauri::menu::Menu<tauri::Wry>>(rid)?;
    tauri::menu::ContextMenu::popup(&*menu, window)
}

/// One frame of the menu-bar icon's bars while a song plays (startup.ts draws them, up to 30 a second). Tauri's
/// set_icon re-encodes the picture and resets the icon's click area each time, which made the bars stutter and
/// lost clicks on the icon.
#[tauri::command]
async fn dance(app: tauri::AppHandle, id: String, frame: Vec<u8>) {
    #[cfg(target_os = "macos")]
    {
        use objc2::AnyThread;
        use objc2_app_kit::NSImage;
        let Some(tray) = app.tray_by_id(&id) else { return };
        let _ = tray.with_inner_tray_icon(move |t| {
            let (Some(item), Some(image)) = (t.ns_status_item(), NSImage::initWithData(NSImage::alloc(), &objc2_foundation::NSData::with_bytes(&frame))) else { return };
            image.setSize(objc2_foundation::NSSize::new(18.0, 18.0));
            image.setTemplate(true);
            if let Some(button) = objc2::MainThreadMarker::new().and_then(|m| item.button(m)) { button.setImage(Some(&image)) }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, id, frame);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Settings → Startup. Opened at login it starts hidden; main.tsx shows it unless you chose otherwise.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--login"])))
        // WebKit holds pages to 60 frames a second; let go of that so every window moves at 120 on ProMotion screens.
        .on_page_load(|webview, _| {
            #[cfg(target_os = "macos")]
            let _ = webview.with_webview(|w| unsafe {
                use objc2::{msg_send, runtime::AnyObject, sel};
                let view = &*(w.inner() as *const AnyObject);
                let config: &AnyObject = msg_send![view, configuration];
                let prefs: &AnyObject = msg_send![config, preferences];
                let set = sel!(_setPreferPageRenderingUpdatesNear60FPSEnabled:);
                if msg_send![prefs, respondsToSelector: set] { let _: () = msg_send![prefs, _setPreferPageRenderingUpdatesNear60FPSEnabled: false]; }
            });
            #[cfg(not(target_os = "macos"))]
            let _ = webview;
        })
        .invoke_handler(tauri::generate_handler![float, popup, dance, local::scan_music, local::allow_music, local::local_lyrics, local::read_text, offline::downloads_dir, offline::save_download, offline::delete_downloads, offline::downloads_size, account::oauth_start, account::oauth_wait, discord::discord_set, discord::discord_clear, align::align_words])
        .setup(|app| {
            // Built here rather than from config alone so downloads (Settings → Export) save to Downloads;
            // WKWebView cancels them without a handler.
            let main = WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_download(|_, _| true)
                .visible(!std::env::args().any(|a| a == "--login"));
            // Apple's own buttons, centred in the 76px rail card that sits 8px in (App.tsx RAIL), as far from its top as its side: the
            // three span ~62pt on macOS 26. Set on the webview, not the window (trafficLightPosition in
            // the config): only the webview's view redraws, so only its inset survives resizes.
            #[cfg(target_os = "macos")]
            let main = main.traffic_light_position(tauri::LogicalPosition::new(15.0, 24.0));
            // Files dropped on the window come to the page with their paths (App.tsx). Windows can't
            // have that and the page's own drag and drop together, so there it keeps the page's. It
            // draws its own title bar buttons too (App.tsx WindowButtons).
            #[cfg(windows)]
            let main = main.disable_drag_drop_handler().decorations(false);
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
            if let WindowEvent::CloseRequested { .. } = event {
                sink(window);
            }
            // The hidden window would otherwise keep the app alive after the main one closes.
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.webview_windows().values().for_each(|w| sink(&w.as_ref().window()));
            }
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
