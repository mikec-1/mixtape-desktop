//! Offline downloads: songs' streams, already encrypted by the page (offline.ts), kept in the app's data
//! folder and read back through the asset protocol. This side only writes, deletes and measures files.

use std::fs;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};

/// The folder downloads live in. Lets the webview read it: at launch, before anything plays from it.
#[tauri::command]
pub fn downloads_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let dir = dir(&app)?;
    app.asset_protocol_scope().allow_directory(&dir, false).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Saves a download: the bytes are the request's body (no JSON in between), its name the x-name header.
#[tauri::command]
pub fn save_download<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(), String> {
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).and_then(safe).ok_or("bad name")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("no bytes".into()) };
    let path = dir(&app)?.join(name);
    // Through a temporary name, so a song cut off mid-write is never taken for a whole one.
    let tmp = path.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_downloads<R: Runtime>(app: AppHandle<R>, names: Vec<String>) -> Result<(), String> {
    let dir = dir(&app)?;
    for name in names.iter().filter_map(|n| safe(n)) {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(())
}

/// How much room downloads take, in bytes.
#[tauri::command]
pub fn downloads_size<R: Runtime>(app: AppHandle<R>) -> Result<u64, String> {
    Ok(fs::read_dir(dir(&app)?).map_err(|e| e.to_string())?.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
}

fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A song's id as a file name: YouTube's are letters, digits, - and _, and nothing else gets through,
/// so a name can't climb out of the folder.
fn safe(name: &str) -> Option<&str> {
    (!name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::safe;

    #[test]
    fn names_stay_in_the_folder() {
        assert_eq!(safe("dQw4w9WgXcQ"), Some("dQw4w9WgXcQ"));
        for bad in ["", "../x", "a/b", "a\\b", "x.bin", "file:/etc/passwd", &"a".repeat(65)] {
            assert_eq!(safe(bad), None, "{bad}");
        }
    }
}
