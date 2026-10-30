//! Signing in with Google or Apple from the app: the browser does the signing in, then sends you back to
//! http://127.0.0.1:<port>/callback, where this is listening, with a code for account.ts to exchange. The
//! browser waits there until the app knows how it went, then goes on to a page on mixtaped.tech saying so.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// The ports Mixtape's redirect URLs are registered for (docs/accounts.md), tried in turn. Spotify (spotify.ts)
/// asks for its own one port.
const PORTS: [u16; 3] = [53682, 53683, 53684];
static LISTENER: Mutex<Option<TcpListener>> = Mutex::new(None);
/// The browser that came back, waiting to hear how it went (oauth_done).
static PENDING: Mutex<Option<TcpStream>> = Mutex::new(None);
/// Starting again gives up on a wait still going (a sign-in left half done in the browser).
static ROUND: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn oauth_start(port: Option<u16>) -> Result<u16, String> {
    // A wait still going gives up first and lets go of its port within 100 ms, so trying again can have it.
    ROUND.fetch_add(1, Ordering::SeqCst);
    PENDING.lock().unwrap().take();
    let ports = port.map_or(PORTS.to_vec(), |p| vec![p]);
    let bind = || ports.iter().find_map(|p| TcpListener::bind(("127.0.0.1", *p)).ok());
    let l = bind().or_else(|| (std::thread::sleep(Duration::from_millis(250)), bind()).1).ok_or("Every sign-in port is in use")?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    *LISTENER.lock().unwrap() = Some(l);
    Ok(port)
}

/// Waits up to fifteen minutes for the browser to come back and returns the query string it brought (code
/// and state, or error). The browser waits on for oauth_done.
#[tauri::command]
pub async fn oauth_wait() -> Result<String, String> {
    let l = LISTENER.lock().unwrap().take().ok_or("Sign-in wasn't started")?;
    let round = ROUND.load(Ordering::SeqCst);
    let (query, stream) = tauri::async_runtime::spawn_blocking(move || wait(&l, Duration::from_secs(900), || ROUND.load(Ordering::SeqCst) != round))
        .await
        .map_err(|e| e.to_string())??;
    *PENDING.lock().unwrap() = Some(stream);
    Ok(query)
}

/// Tells the waiting browser how it went: on to `to`, the website's page saying so, or with no website, a
/// page of its own.
#[tauri::command]
pub fn oauth_done(to: Option<String>, failed: bool) {
    if let Some(s) = PENDING.lock().unwrap().take() {
        answer(s, to.as_deref(), failed);
    }
}

fn answer(mut stream: TcpStream, to: Option<&str>, failed: bool) {
    // 303, so the website's POST comes back as a plain GET too.
    if let Some(to) = to {
        let _ = write!(stream, "HTTP/1.1 303 See Other\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    }
    let (title, says) = if failed { ("That didn’t work.", "Signing in didn’t finish. Go back to Mixtape to try again.") } else { ("You’re in.", "Mixtape is signed in. You can close this tab.") };
    let page = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><meta name=referrer content=no-referrer><title>Mixtape</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#fff;font-family:-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif\"><main style=\"padding:32px\"><h1 style=\"margin:0;font-size:clamp(48px,8vw,84px);line-height:.9;font-weight:900;letter-spacing:-.05em\">{title}</h1><p style=\"margin:20px 0 0;font-size:17px;color:rgba(255,255,255,.55)\">{says}</p></main><script>history.replaceState(null,'','/')</script>"
    );
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len());
}

fn wait(l: &TcpListener, timeout: Duration, cancelled: impl Fn() -> bool) -> Result<(String, TcpStream), String> {
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let end = Instant::now() + timeout;
    while Instant::now() < end && !cancelled() {
        let Ok((mut stream, _)) = l.accept() else {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut r = BufReader::new(&stream);
        let mut line = String::new();
        if r.read_line(&mut line).is_err() {
            continue;
        }
        // "GET /callback?code=…&state=… HTTP/1.1"; anything else (a favicon) gets a 404 and we wait on.
        // The website hands a session back as a POST instead, so its tokens stay out of the address bar and history.
        let path = line.split_whitespace().nth(1).unwrap_or("");
        let Some(rest) = path.strip_prefix("/callback") else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        };
        let mut body = String::new();
        if line.starts_with("POST ") {
            let (mut len, mut h) = (0, String::new());
            while r.read_line(&mut h).is_ok_and(|n| n > 2) {
                if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
                h.clear();
            }
            let mut b = vec![0; len.min(16_384)];
            if r.read_exact(&mut b).is_err() {
                continue;
            }
            body = String::from_utf8_lossy(&b).into_owned();
        }
        let query = if body.is_empty() { rest.strip_prefix('?').unwrap_or("").to_string() } else { body };
        drop(r);
        return Ok((query, stream));
    }
    Err(if cancelled() { "Sign-in was started again" } else { "Sign-in timed out" }.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    // The app's half of a sign-in: wait, then say how it went.
    fn finish(l: &TcpListener, to: Option<&str>, failed: bool) -> String {
        let (query, stream) = wait(l, Duration::from_secs(5), || false).unwrap();
        answer(stream, to, failed);
        query
    }

    #[test]
    fn hands_back_the_callback_query() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || (get(port, "/favicon.ico"), get(port, "/callback?code=abc-123&state=xyz")));
        assert_eq!(finish(&l, None, false), "code=abc-123&state=xyz");
        let (favicon, callback) = browser.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(callback.starts_with("HTTP/1.1 200") && callback.contains("You’re in"));
    }

    #[test]
    fn takes_a_posted_session() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let body = "state=xyz&access_token=a&refresh_token=r";
        std::thread::spawn(move || {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(s, "POST /callback HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let _ = s.read_to_string(&mut String::new());
        });
        assert_eq!(finish(&l, None, false), body);
    }

    #[test]
    fn says_so_when_it_failed_or_nobody_came() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || get(port, "/callback?error=access_denied&error_description=No"));
        assert_eq!(finish(&l, None, true), "error=access_denied&error_description=No");
        assert!(browser.join().unwrap().contains("didn’t finish"));
        assert_eq!(wait(&l, Duration::from_millis(300), || false).unwrap_err(), "Sign-in timed out");
        assert_eq!(wait(&l, Duration::from_secs(5), || true).unwrap_err(), "Sign-in was started again");
    }

    #[test]
    fn sends_the_browser_on_to_the_page_the_app_picks() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || get(port, "/callback?code=abc"));
        assert_eq!(finish(&l, Some("https://www.mixtaped.tech/signed-up"), false), "code=abc");
        let ok = browser.join().unwrap();
        assert!(ok.starts_with("HTTP/1.1 303") && ok.contains("Location: https://www.mixtaped.tech/signed-up\r\n"));
    }
}
