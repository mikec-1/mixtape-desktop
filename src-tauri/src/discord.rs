use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

// Settings → Linked Accounts → Discord: "Listening to Mixtape", with the song, like Spotify's. The
// connection opens on first use and again after Discord restarts. The client id is baked in by build.rs.
static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);

// Discord refuses fields over 128 characters.
fn cut(s: &str) -> &str {
    s.char_indices().nth(128).map_or(s, |(i, _)| &s[..i])
}

#[tauri::command]
pub fn discord_set(title: String, artist: String, art: Option<String>, start: i64, end: Option<i64>) {
    let Some(id) = option_env!("DISCORD_CLIENT_ID") else { return };
    let mut client = CLIENT.lock().unwrap();
    if client.is_none() {
        let mut c = DiscordIpcClient::new(id);
        if c.connect().is_err() {
            return; // Discord isn't running
        }
        *client = Some(c);
    }
    let mut times = activity::Timestamps::new().start(start);
    if let Some(end) = end {
        times = times.end(end);
    }
    let mut assets = activity::Assets::new();
    if let Some(art) = &art {
        assets = assets.large_image(art).large_text(cut(&title));
    }
    let act = activity::Activity::new()
        .activity_type(activity::ActivityType::Listening)
        .details(cut(&title))
        .state(cut(&artist))
        .assets(assets)
        .timestamps(times);
    if client.as_mut().unwrap().set_activity(act).is_err() {
        *client = None;
    }
}

#[tauri::command]
pub fn discord_clear() {
    if let Some(c) = CLIENT.lock().unwrap().as_mut() {
        let _ = c.clear_activity();
    }
}
