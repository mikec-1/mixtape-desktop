//! Signing in with Google or Apple from the app: the browser does the signing in, then sends you back to
//! http://127.0.0.1:<port>/callback, where this is listening, with a code for account.ts to exchange.
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// The ports Sleeve's redirect URLs are registered for (docs/accounts.md), tried in turn. Spotify (spotify.ts)
/// asks for its own one port.
const PORTS: [u16; 3] = [53682, 53683, 53684];
static LISTENER: Mutex<Option<TcpListener>> = Mutex::new(None);
/// Starting again gives up on a wait still going (a sign-in left half done in the browser).
static ROUND: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn oauth_start(port: Option<u16>) -> Result<u16, String> {
    // A wait still going gives up first and lets go of its port within 100 ms, so trying again can have it.
    ROUND.fetch_add(1, Ordering::SeqCst);
    let ports = port.map_or(PORTS.to_vec(), |p| vec![p]);
    let bind = || ports.iter().find_map(|p| TcpListener::bind(("127.0.0.1", *p)).ok());
    let l = bind().or_else(|| (std::thread::sleep(Duration::from_millis(250)), bind()).1).ok_or("Every sign-in port is in use")?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    *LISTENER.lock().unwrap() = Some(l);
    Ok(port)
}

/// Waits up to five minutes for the browser to come back, answers it with a page that says to go back
/// to Sleeve, and returns the query string it brought (code and state, or error).
#[tauri::command]
pub async fn oauth_wait() -> Result<String, String> {
    let l = LISTENER.lock().unwrap().take().ok_or("Sign-in wasn't started")?;
    let round = ROUND.load(Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || wait(&l, Duration::from_secs(300), || ROUND.load(Ordering::SeqCst) != round))
        .await
        .map_err(|e| e.to_string())?
}

fn wait(l: &TcpListener, timeout: Duration, cancelled: impl Fn() -> bool) -> Result<String, String> {
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let end = Instant::now() + timeout;
    while Instant::now() < end && !cancelled() {
        let Ok((mut stream, _)) = l.accept() else {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        // "GET /callback?code=…&state=… HTTP/1.1"; anything else (a favicon) gets a 404 and we wait on.
        let path = line.split_whitespace().nth(1).unwrap_or("");
        let Some(rest) = path.strip_prefix("/callback") else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        };
        let query = rest.strip_prefix('?').unwrap_or("").to_string();
        let failed = query.split('&').any(|p| p.starts_with("error="));
        let page = format!(
            "<!doctype html><meta charset=utf-8><title>Sleeve</title><body style=\"font:600 20px/1.4 -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#222\"><p>{}</p>",
            if failed { "Signing in didn’t finish. Go back to Sleeve to try again." } else { "You’re signed in. You can close this tab and go back to Sleeve." }
        );
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len());
        return Ok(query);
    }
    Err(if cancelled() { "Sign-in was started again" } else { "Sign-in timed out" }.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpStream;

    fn get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn hands_back_the_callback_query() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || (get(port, "/favicon.ico"), get(port, "/callback?code=abc-123&state=xyz")));
        assert_eq!(wait(&l, Duration::from_secs(5), || false).unwrap(), "code=abc-123&state=xyz");
        let (favicon, callback) = browser.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(callback.starts_with("HTTP/1.1 200") && callback.contains("You’re signed in"));
    }

    #[test]
    fn says_so_when_it_failed_or_nobody_came() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || get(port, "/callback?error=access_denied&error_description=No"));
        assert_eq!(wait(&l, Duration::from_secs(5), || false).unwrap(), "error=access_denied&error_description=No");
        assert!(browser.join().unwrap().contains("didn’t finish"));
        assert_eq!(wait(&l, Duration::from_millis(300), || false).unwrap_err(), "Sign-in timed out");
        assert_eq!(wait(&l, Duration::from_secs(5), || true).unwrap_err(), "Sign-in was started again");
    }
}
