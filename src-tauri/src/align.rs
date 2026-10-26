//! Word timings from the song itself (lyrics.ts useAligned): each line's words are pinned to the audio
//! inside the line's own time by forced alignment, which finds where a speech model hears each letter
//! when it already knows the words. The model (wav2vec2, English letters, 95 MB) is fetched the first
//! time it's needed and kept in the app's data folder. The whole song is heard once, and the lyrics are
//! first slid as one to where they fit (they're often timed to another upload). ponytail: English letters
//! only (lyrics.ts spells Cyrillic out), so other scripts keep the estimate; a multilingual model (MMS) is
//! the upgrade, at ten times the size.

use ort::session::Session;
use ort::value::Tensor;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};

const MODEL: &str = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model_quantized.onnx";
const RATE: f32 = 16_000.0;
const BLANK: usize = 0;
const SPACE: usize = 4; // "|", between words
// The model's letters, in its vocabulary's order from id 5.
const LETTERS: &[u8] = b"ETAONIHSRDLUMWCFGYPBVK'XJQZ";
// A line whose letters the model hears this badly on average (log probability) wasn't found: it keeps the estimate.
const WORST: f32 = -6.0;
// Sung words found from the audio read as late by about this much, so they're moved earlier (tuned by ear: 0.25 s still needed
// every aligned song nudged 0.25 s earlier).
const LEAD: f32 = 0.5;
// After a pause this long (s), a word only gets this much of that lead: the full one lights it while the last word is still
// held ("Uh, … Been"), as the model hears where a held word starts but not how long it rings.
const PAUSE: f32 = 0.5;
const AFTER_PAUSE: f32 = 0.15;
// The most a line's first word's letters can sit apart (s) before its first one is taken for noise.
const GAP: f32 = 1.0;
// One frame of the model's output (s): it hears 320 samples at a time.
const FRAME: f32 = 0.02;
// Lyrics can be off from the song by a few seconds (timed to another upload, or an intro cut), so they're
// tried this far either way (s) and slid to where their lines fit the singing best.
const SLIDE: f32 = 8.0;
// How much better (log probability a letter) another copy of the lyrics has to fit the song to be taken instead.
const BETTER: f32 = 1.0;

/// A line to time: from start to end (seconds), each word as the model's letters (A–Z and ').
#[derive(Deserialize)]
pub struct Line {
    start: f32,
    end: f32,
    words: Vec<String>,
}

static SESSION: Mutex<Option<(Session, ort::environment::Environment)>> = Mutex::new(None);
// One song at a time, so the model downloads once and alignment never fights the music for the CPU.
static BUSY: LazyLock<tauri::async_runtime::Mutex<()>> = LazyLock::new(Default::default);

/// The song as 16 kHz mono f32 samples is the body (no JSON in between), its lines the x-lines header, and
/// maybe another copy of the lyrics' lines (LRCLIB's runner-up) the x-alt header. Comes back as how far the
/// lyrics sit from the song (s, positive: the song is later), each line's words' (start, end) in the lyrics'
/// own time, or None where it couldn't be found, and whether those are the other copy's, as the song fit it
/// clearly better.
#[tauri::command]
pub async fn align_words<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(f32, Vec<Option<Vec<(f32, f32)>>>, bool), String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(|v| serde_json::from_str::<Vec<Line>>(v).map_err(|e| e.to_string())).transpose();
    let lines = header("x-lines")?.ok_or("no lines")?;
    let alt = header("x-alt")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("no audio".into()) };
    let pcm: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let _busy = BUSY.lock().await;
    let path = model(&app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = SESSION.lock().map_err(|e| e.to_string())?;
        if session.is_none() {
            // Two threads: fast enough (a song in a few seconds) and leaves the rest of the machine alone.
            let env = ort::init().build().map_err(|e| e.to_string())?;
            let mut builder = Session::builder(&env).map_err(|e| e.to_string())?.with_intra_threads(2).map_err(|e| e.to_string())?;
            *session = Some((builder.commit_from_file(&path).map_err(|e| e.to_string())?, env));
        }
        let (session, _) = session.as_mut().unwrap();
        let lp = hear_all(session, &pcm).map_err(|e| e.to_string())?;
        let by = slide(&lp, &lines);
        let (lines, by, other) = match alt {
            Some(alt) => {
                let alt_by = slide(&lp, &alt);
                if per_letter(&lp, &alt, alt_by) - per_letter(&lp, &lines, by) > BETTER { (alt, alt_by, true) } else { (lines, by, false) }
            }
            None => (lines, by, false),
        };
        Ok((by, lines.iter().map(|l| align(&lp, l, by)).collect(), other))
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn model<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    let path = dir.join("wav2vec2-base-960h-int8.onnx");
    if path.exists() {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let bytes = reqwest::get(MODEL).await.and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
    // Through a temporary name, so a download cut off midway is never taken for the model.
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// The line's words in the song heard as lp, with the lyrics slid by `by` seconds.
fn align(lp: &[Vec<f32>], line: &Line, by: f32) -> Option<Vec<(f32, f32)>> {
    // A little either side, as a line's time is when it starts, give or take.
    let a = ((line.start + by - 0.3).max(0.0) / FRAME) as usize;
    let b = (((line.end + by + 0.3) / FRAME) as usize).min(lp.len());
    if b < a + 12 {
        return None;
    }
    let lp = &lp[a..b];
    let at = |frame: usize| (a + frame) as f32 * FRAME;
    let (tokens, owner) = spell(&line.words);
    let frames = path(&lp, &tokens)?;
    // A word runs from its first letter to the gap after it (its last letter, at the end of the line).
    let mut out = vec![None::<(usize, usize)>; line.words.len()];
    // Where each word's last letter is heard: the gap after it can be a pause or a held note, which a word's span hides.
    let mut sung = vec![0; line.words.len()];
    for (k, &f) in frames.iter().enumerate() {
        match owner[k] {
            Some(w) => {
                let span = out[w].get_or_insert((f, f));
                // In a line's first word, a letter long after the one before it: the earlier one was caught on
                // the music before the singing, so the word starts here. (Later words can hold a note that long.)
                if !owner[..k].contains(&None) && at(f) - at(span.1.saturating_sub(1)) > GAP {
                    span.0 = f;
                }
                span.1 = f + 1;
                sung[w] = f + 1;
            }
            None => {
                if let Some(span) = owner[..k].iter().rev().find_map(|o| *o).and_then(|w| out[w].as_mut()) {
                    span.1 = f + 1;
                }
            }
        }
    }
    // A word with no letters the model knows ("—", "2") sits where the one before it ended.
    // The word after a pause can then land after the full-lead words behind it, so they wait for it.
    let (mut last, mut heard, mut floor) = (0, 0, 0.0f32);
    Some(out.into_iter().zip(sung).enumerate().map(|(i, (s, h))| {
        let (s, e) = s.unwrap_or((last, last));
        let lead = if i > 0 && at(s) - at(heard) > PAUSE { AFTER_PAUSE } else { LEAD };
        (last, heard) = (e, h.max(s));
        floor = (at(s) - lead - by).max(floor).max(0.0);
        (floor, (at(e) - LEAD - by).max(floor))
    }).collect())
}

/// The whole song heard 20 s at a time, each piece with a second either side so no word is cut at a seam:
/// frame k is the song at k × FRAME seconds.
fn hear_all(session: &mut Session, pcm: &[f32]) -> ort::Result<Vec<Vec<f32>>> {
    let (step, pad) = (20 * RATE as usize, RATE as usize);
    let n = (pcm.len() as f32 / RATE / FRAME) as usize;
    let mut out = Vec::with_capacity(n);
    for c in (0..pcm.len()).step_by(step) {
        let (a, b) = (c.saturating_sub(pad), (c + step + pad).min(pcm.len()));
        let lp = hear(session, &pcm[a..b])?;
        let per = (b - a) as f32 / lp.len() as f32;
        while out.len() < n && out.len() as f32 * FRAME * RATE < (c + step) as f32 {
            let i = ((out.len() as f32 * FRAME * RATE - a as f32) / per) as usize;
            out.push(lp[i.min(lp.len() - 1)].clone());
        }
    }
    Ok(out)
}

/// How far (s) the lyrics sit from the song: the slide within ±SLIDE where the lines' letters fit best, in
/// 0.1 s steps. Only taken when it fits clearly better than none: by chance, slides differ by about 2 a line
/// (on lyrics 3.5 s off it was 14), so a song the model hears badly never gets its lyrics moved.
fn slide(lp: &[Vec<f32>], lines: &[Line]) -> f32 {
    let steps = (SLIDE * 10.0) as i32;
    let (by, best) = (-steps..=steps).map(|i| (i as f32 / 10.0, fits(lp, lines, i as f32 / 10.0))).fold((0.0, f32::NEG_INFINITY), |m, s| if s.1 > m.1 { s } else { m });
    if best - fits(lp, lines, 0.0) > 4.0 { by } else { 0.0 }
}

/// How well the lines fit the song slid by `by` (log probability, on average a line), counting only lines
/// inside() it.
fn fits(lp: &[Vec<f32>], lines: &[Line], by: f32) -> f32 {
    let scores = inside(lp, lines).map(|l| fit(lp, l, by)).collect::<Vec<f32>>();
    scores.iter().sum::<f32>() / scores.len().max(1) as f32
}

/// The same, a letter: so two copies of the lyrics compare fairly however long their lines are, and lines
/// that aren't sung (a skit, another version's verse) drag a copy down.
fn per_letter(lp: &[Vec<f32>], lines: &[Line], by: f32) -> f32 {
    let (sum, letters) = inside(lp, lines).fold((0.0, 0), |(s, n), l| (s + fit(lp, l, by), n + spell(&l.words).0.len()));
    sum / letters.max(1) as f32
}

/// The lines that stay inside the song however far they're slid, so every slide is scored on the same lines.
fn inside<'a>(lp: &[Vec<f32>], lines: &'a [Line]) -> impl Iterator<Item = &'a Line> {
    let end = lp.len() as f32 * FRAME;
    lines.iter().filter(move |l| l.start - SLIDE - 0.3 >= 0.0 && l.end + SLIDE + 0.3 <= end)
}

/// How well one line's letters fit its time in the song slid by `by` (log probability).
fn fit(lp: &[Vec<f32>], l: &Line, by: f32) -> f32 {
    let (a, b) = (((l.start + by - 0.3) / FRAME) as usize, ((l.end + by + 0.3) / FRAME) as usize);
    let tokens = spell(&l.words).0;
    // The trellis below, one row at a time: only its last cell is wanted.
    let mut row = vec![f32::NEG_INFINITY; tokens.len() + 1];
    row[0] = 0.0;
    for frame in &lp[a..b] {
        for j in (0..=tokens.len()).rev() {
            let step = if j > 0 { row[j - 1] + frame[tokens[j - 1]] } else { f32::NEG_INFINITY };
            row[j] = (row[j] + frame[BLANK]).max(step);
        }
    }
    row[tokens.len()].max(-1e4)
}

/// Log probabilities of each letter (and blank) for each 20 ms of audio.
fn hear(session: &mut Session, clip: &[f32]) -> ort::Result<Vec<Vec<f32>>> {
    // The model wants zero mean and unit variance.
    let mean = clip.iter().sum::<f32>() / clip.len() as f32;
    let sd = (clip.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / clip.len() as f32).sqrt().max(1e-5);
    let input: Vec<f32> = clip.iter().map(|x| (x - mean) / sd).collect();
    let out = session.run(ort::inputs![Tensor::from_array(([1usize, input.len()], input.into_boxed_slice()))?])?;
    let (shape, logits) = out[0].try_extract_tensor::<f32>()?;
    let v = shape[2] as usize;
    Ok(logits.chunks(v).map(|row| {
        let max = row.iter().cloned().fold(f32::MIN, f32::max);
        let sum = row.iter().map(|x| (x - max).exp()).sum::<f32>().ln() + max;
        row.iter().map(|x| x - sum).collect()
    }).collect())
}

/// The words as the model's tokens, with "|" between them, and which word each token is part of.
fn spell(words: &[String]) -> (Vec<usize>, Vec<Option<usize>>) {
    let (mut tokens, mut owner) = (vec![], vec![]);
    for (w, word) in words.iter().enumerate() {
        let ids: Vec<usize> = word.bytes().filter_map(|c| LETTERS.iter().position(|&l| l == c).map(|i| i + 5)).collect();
        if ids.is_empty() {
            continue;
        }
        if !tokens.is_empty() {
            tokens.push(SPACE);
            owner.push(None);
        }
        owner.extend(ids.iter().map(|_| Some(w)));
        tokens.extend(ids);
    }
    (tokens, owner)
}

/// The frame each token is heard at: the likeliest path through the audio that says them all in order,
/// with blanks between (CTC forced alignment, as in torchaudio's tutorial). None if it can't fit or the
/// model barely hears them.
fn path(lp: &[Vec<f32>], tokens: &[usize]) -> Option<Vec<usize>> {
    let (t_len, j_len) = (lp.len(), tokens.len());
    if j_len == 0 || t_len < j_len {
        return None;
    }
    // best[t][j]: the best score having said the first j tokens in the first t frames.
    let mut best = vec![vec![f32::NEG_INFINITY; j_len + 1]; t_len + 1];
    best[0][0] = 0.0;
    for t in 0..t_len {
        for j in 0..=j_len {
            let stay = best[t][j] + lp[t][BLANK];
            let step = if j > 0 { best[t][j - 1] + lp[t][tokens[j - 1]] } else { f32::NEG_INFINITY };
            best[t + 1][j] = stay.max(step);
        }
    }
    let mut frames = vec![0; j_len];
    let mut j = j_len;
    let mut heard = 0.0;
    for t in (0..t_len).rev() {
        if j > 0 && best[t][j - 1] + lp[t][tokens[j - 1]] >= best[t][j] + lp[t][BLANK] {
            j -= 1;
            frames[j] = t;
            heard += lp[t][tokens[j]];
        }
    }
    (j == 0 && heard / j_len as f32 > WORST).then_some(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spells_words_with_gaps() {
        let (tokens, owner) = spell(&["HI".into(), "—".into(), "YO".into()]);
        assert_eq!(tokens, vec![11, 10, SPACE, 22, 8]);
        assert_eq!(owner, vec![Some(0), Some(0), None, Some(2), Some(2)]);
    }

    #[test]
    fn finds_tokens_in_order() {
        // Four frames: blank, A, blank, B. The path has to say A then B where they're loudest.
        let frame = |hot: usize| (0..32).map(|i| if i == hot { -0.1 } else { -5.0 }).collect::<Vec<f32>>();
        let lp = vec![frame(BLANK), frame(7), frame(BLANK), frame(24)];
        assert_eq!(path(&lp, &[7, 24]), Some(vec![1, 3]));
        assert_eq!(path(&lp, &[7, 24, 7, 24, 7]), None);
    }
    #[test]
    fn slides_lyrics_to_the_song() {
        // 30 s of nothing, with "AB" said at 12 s and 16 s; the lyrics have those lines at 10 s and 14 s.
        let frame = |hot: usize| (0..32).map(|i| if i == hot { -0.1 } else { -5.0 }).collect::<Vec<f32>>();
        let mut lp = vec![frame(BLANK); 1500];
        for (f, token) in [(600, 7), (605, 24), (800, 7), (805, 24)] {
            lp[f] = frame(token);
        }
        let lines: Vec<Line> = [10.0, 14.0].iter().map(|&start| Line { start, end: start + 0.2, words: vec!["AB".into()] }).collect();
        let by = slide(&lp, &lines);
        assert!((1.7..=2.3).contains(&by), "slid {by}");
        assert_eq!(align(&lp, &lines[0], by).unwrap()[0].0, 12.0 - LEAD - by);
        // Nothing said, nothing slid.
        assert_eq!(slide(&vec![frame(BLANK); 1500], &lines), 0.0);
    }
    // The real model on real audio: ALIGN_MODEL=model.onnx ALIGN_WAV=speech.wav (16 kHz f32, from `say`)
    // cargo test --lib real_speech -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_speech() {
        let wav = std::fs::read(std::env::var("ALIGN_WAV").unwrap()).unwrap();
        let data = wav.windows(4).position(|w| w == b"data").unwrap() + 8;
        let pcm: Vec<f32> = wav[data..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let env = ort::init().build().unwrap();
        let mut session = Session::builder(&env).unwrap().commit_from_file(std::env::var("ALIGN_MODEL").unwrap()).unwrap();
        let words: Vec<String> = "HELLO DARKNESS MY OLD FRIEND I'VE COME TO TALK WITH YOU AGAIN".split(' ').map(String::from).collect();
        let line = Line { start: 0.0, end: pcm.len() as f32 / RATE, words: words.clone() };
        let lp = hear_all(&mut session, &pcm).unwrap();
        let got = align(&lp, &line, 0.0).expect("found");
        for (w, (s, e)) in words.iter().zip(&got) {
            println!("{w:>10} {s:.2}-{e:.2}");
        }
        assert!(got[0].0 + LEAD > 0.6 && got[0].0 + LEAD < 1.1, "hello starts after the 0.8 s silence");
        assert!(got.windows(2).all(|p| p[0].0 <= p[1].0));
        // Words that aren't there aren't found.
        let wrong = Line { start: 0.0, end: line.end, words: "XYLOPHONE QUARTZ JUKEBOX ZEBRA".split(' ').map(String::from).collect() };
        println!("wrong: {:?}", align(&lp, &wrong, 0.0));
    }
    // A whole song: ALIGN_LINES=lines.json (each line's start, end, words, as lyrics.ts sends them) too.
    #[test]
    #[ignore]
    fn real_song() {
        let wav = std::fs::read(std::env::var("ALIGN_WAV").unwrap()).unwrap();
        let data = wav.windows(4).position(|w| w == b"data").unwrap() + 8;
        let pcm: Vec<f32> = wav[data..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let lines: Vec<Line> = serde_json::from_str(&std::fs::read_to_string(std::env::var("ALIGN_LINES").unwrap()).unwrap()).unwrap();
        let env = ort::init().build().unwrap();
        let mut session = Session::builder(&env).unwrap().commit_from_file(std::env::var("ALIGN_MODEL").unwrap()).unwrap();
        let at = std::time::Instant::now();
        let lp = hear_all(&mut session, &pcm).unwrap();
        println!("heard in {:?}", at.elapsed());
        let by = slide(&lp, &lines);
        println!("\nslid {by} in {:?}", at.elapsed());
        let got: Vec<_> = lines.iter().map(|l| align(&lp, l, by)).collect();
        println!("{} of {} lines in {:?}", got.iter().flatten().count(), lines.len(), at.elapsed());
        for (l, g) in lines.iter().zip(&got) {
            let w = g.as_ref().map(|g| l.words.iter().zip(g).map(|(w, (s, _))| format!("{w}@{s:.2}")).collect::<Vec<_>>().join(" "));
            println!("{:6.2}-{:6.2} {}", l.start, l.end, w.unwrap_or("-".into()));
        }
        // ALIGN_COPIES=a.json,b.json: how well other copies of the lyrics fit, to compare against BETTER.
        for file in std::env::var("ALIGN_COPIES").unwrap_or_default().split(',').filter(|f| !f.is_empty()) {
            let copy: Vec<Line> = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
            let by = slide(&lp, &copy);
            println!("{file}: slid {by}, {:.2} a letter (these lyrics {:.2})", per_letter(&lp, &copy, by), per_letter(&lp, &lines, slide(&lp, &lines)));
        }
    }
}
