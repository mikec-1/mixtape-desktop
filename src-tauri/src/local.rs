//! Your own music: folders on this computer, read for their tags and played from disk through the asset
//! protocol (which serves ranges, so seeking works). The page keeps what a scan found; a scan re-reads
//! only files whose modified time changed, so after the first one it takes moments.

use lofty::config::ParseOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, Runtime};

const AUDIO: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "aif", "aiff", "ogg", "oga", "opus"];

/// A song file's tags. cover: where its album's artwork was saved, shared by the album's songs.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    path: String,
    mtime: u64,
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    track: u32,
    disc: u32,
    duration: f64,
    cover: Option<String>,
}

/// files: new or changed since the scan the page last kept (known); unchanged: the rest still there.
/// Anything known that's in neither is gone.
#[derive(Serialize, Debug)]
pub struct Scan {
    files: Vec<LocalFile>,
    unchanged: Vec<String>,
}

/// The song files under these folders, read for their tags on as many threads as there are cores.
/// known: what the page has, by path, with its modified time.
#[tauri::command]
pub async fn scan_music<R: Runtime>(app: AppHandle<R>, folders: Vec<String>, known: HashMap<String, u64>) -> Result<Scan, String> {
    let covers = covers_dir(&app)?;
    allow(&app, &folders);
    tauri::async_runtime::spawn_blocking(move || scan(&folders, &known, &covers))
        .await
        .map_err(|e| e.to_string())
}

/// Lets the webview read these folders and the saved covers: at launch, before anything plays from them.
#[tauri::command]
pub fn allow_music<R: Runtime>(app: AppHandle<R>, folders: Vec<String>) -> Result<(), String> {
    covers_dir(&app)?;
    allow(&app, &folders);
    Ok(())
}

/// A song file's own lyrics: what's embedded in its tags, and a .lrc file with the same name beside it.
#[derive(Serialize, Debug, Default)]
pub struct LocalLyrics {
    embedded: Option<String>,
    lrc: Option<String>,
}

/// A playlist file dropped on the window: the page gets its path, not its contents.
#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_lyrics(path: String) -> LocalLyrics {
    lyrics(Path::new(&path))
}

fn covers_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("covers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = app.asset_protocol_scope().allow_directory(&dir, false);
    Ok(dir)
}

fn allow<R: Runtime>(app: &AppHandle<R>, folders: &[String]) {
    for f in folders {
        if Path::new(f).is_dir() {
            let _ = app.asset_protocol_scope().allow_directory(f, true);
        } else {
            let _ = app.asset_protocol_scope().allow_file(f); // a song dropped on its own
        }
    }
}

fn scan(folders: &[String], known: &HashMap<String, u64>, covers: &Path) -> Scan {
    let mut found = Vec::new();
    for f in folders {
        let path = Path::new(f);
        if path.is_file() && is_audio(path) {
            found.push((f.clone(), mtime(path)));
        } else {
            walk(path, &mut found);
        }
    }
    found.sort();
    found.dedup(); // a folder inside another that's also added
    let (unchanged, changed): (Vec<_>, Vec<_>) = found.into_iter().partition(|(path, mtime)| known.get(path) == Some(mtime));
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(8);
    let files = std::thread::scope(|s| {
        let jobs: Vec<_> = changed
            .chunks(changed.len().div_ceil(threads).max(1))
            .map(|chunk| s.spawn(move || chunk.iter().filter_map(|(path, mtime)| read(path, *mtime, covers)).collect::<Vec<_>>()))
            .collect();
        jobs.into_iter().flat_map(|j| j.join().unwrap_or_default()).collect()
    });
    Scan { files, unchanged: unchanged.into_iter().map(|(p, _)| p).collect() }
}

/// Song files under dir, with their modified times (ms). Hidden folders and folder links are passed over,
/// so a link back up can't loop.
fn walk(dir: &Path, out: &mut Vec<(String, u64)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_dir() {
            walk(&path, out);
        } else if is_audio(&path) {
            out.push((path.to_string_lossy().into_owned(), mtime(&path)));
        }
    }
}

fn mtime(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

fn is_audio(path: &Path) -> bool {
    path.extension().is_some_and(|x| AUDIO.contains(&x.to_string_lossy().to_lowercase().as_str()))
}

fn read(path: &str, mtime: u64, covers: &Path) -> Option<LocalFile> {
    let file = Probe::open(path).ok()?.options(ParseOptions::new().read_cover_art(true)).read().ok()?;
    let tag = file.primary_tag().or_else(|| file.first_tag());
    let text = |f: fn(&Tag) -> Option<std::borrow::Cow<'_, str>>| tag.and_then(f).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let artist = text(|t| t.artist()).unwrap_or_default();
    let album = text(|t| t.album()).unwrap_or_default();
    let album_artist = tag.and_then(|t| t.get_string(ItemKey::AlbumArtist)).map(str::trim).unwrap_or_default().to_string();
    Some(LocalFile {
        title: text(|t| t.title()).unwrap_or_else(|| Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()),
        track: tag.and_then(|t| t.track()).unwrap_or(0),
        disc: tag.and_then(|t| t.disk()).unwrap_or(0),
        duration: file.properties().duration().as_secs_f64(),
        cover: tag.and_then(|t| cover(t, path, &album, if album_artist.is_empty() { &artist } else { &album_artist }, covers)),
        path: path.to_string(),
        mtime,
        artist,
        album,
        album_artist,
    })
}

/// Saves the tag's front cover (or its first picture) once per album, named by the album, and says where.
fn cover(tag: &Tag, path: &str, album: &str, by: &str, covers: &Path) -> Option<String> {
    let pics = tag.pictures();
    let pic = pics.iter().find(|p| p.pic_type() == PictureType::CoverFront).or(pics.first())?;
    let ext = pic.mime_type().and_then(|m| m.ext()).unwrap_or("jpg");
    let key = if album.is_empty() { path.to_string() } else { format!("{by}\u{0}{album}") };
    let out = covers.join(format!("{:016x}.{ext}", fnv(&key)));
    if !out.exists() {
        // Through a temporary name, so two songs of one album saving at once can't leave half a picture.
        let tmp = out.with_extension(format!("{ext}.{:x}", fnv(path)));
        fs::write(&tmp, pic.data()).ok()?;
        fs::rename(&tmp, &out).ok()?;
    }
    Some(out.to_string_lossy().into_owned())
}

/// FNV-1a: a cover's name stays the same across launches and Rust versions (DefaultHasher's needn't).
fn fnv(s: &str) -> u64 {
    s.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

fn lyrics(path: &Path) -> LocalLyrics {
    let embedded = Probe::open(path)
        .ok()
        .and_then(|p| p.options(ParseOptions::new().read_cover_art(false).read_properties(false)).read().ok())
        .and_then(|f| {
            f.tags().iter().find_map(|t| [ItemKey::Lyrics, ItemKey::UnsyncLyrics].into_iter().find_map(|k| t.get_string(k).map(str::to_string)))
        })
        .filter(|s| !s.trim().is_empty());
    let lrc = ["lrc", "LRC"].iter().find_map(|x| fs::read(path.with_extension(x)).ok()).map(|b| String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').to_string()).filter(|s| !s.trim().is_empty());
    LocalLyrics { embedded, lrc }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    // Real files, made by ffmpeg: tagged MP3 and FLAC with a cover and lyrics, an untagged WAV, a .lrc.
    fn library() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let music = dir.path().join("Music");
        fs::create_dir_all(music.join("Album A")).unwrap();
        fs::create_dir_all(music.join(".hidden")).unwrap();
        let cover = dir.path().join("cover.png");
        ff(&["-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1"], &cover);
        let tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=3"];
        let mp3 = music.join("Album A/01 First.mp3");
        let mut a = tone.to_vec();
        a.extend(["-i", cover.to_str().unwrap(), "-map", "0:a", "-map", "1:v", "-c:v", "png", "-id3v2_version", "3", "-metadata", "title=First Song", "-metadata", "artist=Ada Finch", "-metadata", "album=Album A", "-metadata", "track=1/2", "-metadata:s:v", "comment=Cover (front)", "-metadata", "lyrics=Plain words, line one"]);
        ff(&a, &mp3);
        let flac = music.join("Album A/02 Second.flac");
        let mut b = tone.to_vec();
        b.extend(["-i", cover.to_str().unwrap(), "-map", "0:a", "-map", "1:v", "-c:v", "png", "-disposition:v", "attached_pic", "-metadata", "title=Second Song", "-metadata", "artist=Ada Finch", "-metadata", "album=Album A", "-metadata", "tracknumber=2", "-metadata", "disc=1"]);
        ff(&b, &flac);
        ff(&tone, &music.join("Loose Tune.wav"));
        fs::write(music.join("Loose Tune.lrc"), "\u{feff}[00:01.00] Synced from the side\n").unwrap();
        ff(&tone, &music.join(".hidden/secret.mp3"));
        fs::write(music.join("notes.txt"), "not music").unwrap();
        (dir, music)
    }
    fn ff(args: &[&str], out: &Path) {
        let ok = Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).arg(out).status().unwrap().success();
        assert!(ok, "ffmpeg failed for {out:?}");
    }

    #[test]
    fn scans_tags_covers_and_lyrics() {
        let (dir, music) = library();
        let covers = dir.path().join("covers");
        fs::create_dir_all(&covers).unwrap();
        let s = scan(&[music.to_string_lossy().into_owned()], &HashMap::new(), &covers);
        let mut files = s.files;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(files.len(), 3, "{files:#?}"); // not the hidden folder's, not the .txt
        let (first, second, loose) = (&files[0], &files[1], &files[2]);
        assert_eq!((first.title.as_str(), first.artist.as_str(), first.album.as_str(), first.track), ("First Song", "Ada Finch", "Album A", 1));
        assert_eq!((second.title.as_str(), second.track, second.disc), ("Second Song", 2, 1));
        assert!((first.duration - 3.0).abs() < 0.2, "{}", first.duration);
        // One cover for the album, shared, saved once.
        assert!(first.cover.is_some() && first.cover == second.cover, "{:?} {:?}", first.cover, second.cover);
        assert_eq!(fs::read_dir(&covers).unwrap().count(), 1);
        assert!(fs::read(first.cover.as_ref().unwrap()).unwrap().starts_with(b"\x89PNG"));
        // No tags: the file's name, no cover.
        assert_eq!((loose.title.as_str(), loose.artist.as_str(), loose.cover.as_deref()), ("Loose Tune", "", None));
        // Embedded lyrics, and a .lrc beside (its byte-order mark gone).
        assert_eq!(lyrics(Path::new(&first.path)).embedded.as_deref(), Some("Plain words, line one"));
        let l = lyrics(Path::new(&loose.path));
        assert_eq!((l.embedded, l.lrc.as_deref()), (None, Some("[00:01.00] Synced from the side\n")));

        // A second scan reads only what changed.
        let known: HashMap<_, _> = files.iter().map(|f| (f.path.clone(), f.mtime)).collect();
        let again = scan(&[music.to_string_lossy().into_owned()], &known, &covers);
        assert!(again.files.is_empty() && again.unchanged.len() == 3);
        std::thread::sleep(std::time::Duration::from_millis(20));
        ff(&["-f", "lavfi", "-i", "sine=frequency=220:duration=2", "-metadata", "title=Renamed"], &music.join("Loose Tune.wav"));
        let third = scan(&[music.to_string_lossy().into_owned()], &known, &covers);
        assert_eq!(third.files.len(), 1);
        assert_eq!(third.unchanged.len(), 2);
    }

    #[test]
    fn cover_names_are_stable() {
        assert_eq!(fnv(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv("a"), 0xaf63_dc4c_8601_ec8c);
    }
}
