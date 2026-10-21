use std::sync::Mutex;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);

fn truncate_str(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        None => s,
        Some((idx, _)) => &s[..idx],
    }
}

fn client_id() -> Option<String> {
    if let Ok(id) = std::env::var("DISCORD_CLIENT_ID") {
        if !id.trim().is_empty() {
            return Some(id.trim().to_string());
        }
    }
    for path in [".env", "../.env"] {
        if let Ok(content) = std::fs::read_to_string(path) {
            for line in content.lines() {
                let trimmed = line.trim();
                for prefix in ["DISCORD_CLIENT_ID=", "VITE_DISCORD_CLIENT_ID="] {
                    if let Some(rest) = trimmed.strip_prefix(prefix) {
                        let val = rest.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn get_or_connect() -> Result<std::sync::MutexGuard<'static, Option<DiscordIpcClient>>, ()> {
    let mut guard = CLIENT.lock().map_err(|_| ())?;
    if guard.is_none() {
        let Some(id) = client_id() else { return Err(()); };
        let mut client = DiscordIpcClient::new(&id);
        if client.connect().is_ok() {
            *guard = Some(client);
        } else {
            return Err(());
        }
    }
    Ok(guard)
}

#[tauri::command]
pub fn discord_set(
    title: String,
    artist: String,
    art: Option<String>,
    start: Option<i64>,
    end: Option<i64>,
) {
    if let Ok(mut guard) = get_or_connect() {
        if let Some(client) = guard.as_mut() {
            let display_details = if artist.is_empty() {
                format!("{title} on Sleeve")
            } else {
                format!("{title} by {artist} on Sleeve")
            };
            let details_safe = truncate_str(&display_details, 128);

            let display_state = if artist.is_empty() {
                "on Sleeve".to_string()
            } else {
                format!("by {artist}")
            };
            let state_safe = truncate_str(&display_state, 128);

            let mut act = activity::Activity::new();
            act = act.activity_type(activity::ActivityType::Listening);
            act = act.status_display_type(activity::StatusDisplayType::Details);
            act = act.details(details_safe);
            act = act.state(state_safe);
            let mut assets = activity::Assets::new();
            if let Some(ref image) = art {
                if !image.is_empty() {
                    assets = assets.large_image(image);
                    assets = assets.large_text(truncate_str(&title, 128));
                }
            }
            act = act.assets(assets);

            let mut timestamps = activity::Timestamps::new();
            if let Some(s) = start {
                let s_ms = if s < 10_000_000_000 { s * 1000 } else { s };
                timestamps = timestamps.start(s_ms);
            }
            if let Some(e) = end {
                let e_ms = if e < 10_000_000_000 { e * 1000 } else { e };
                timestamps = timestamps.end(e_ms);
            }
            if start.is_some() || end.is_some() {
                act = act.timestamps(timestamps);
            }

            if client.set_activity(act).is_err() {
                // If the connection dropped (e.g. Discord restarted), clear client so next call reconnects
                *guard = None;
            }
        }
    }
}

#[tauri::command]
pub fn discord_clear() {
    if let Ok(mut guard) = CLIENT.lock() {
        if let Some(client) = guard.as_mut() {
            let _ = client.clear_activity();
        }
    }
}
