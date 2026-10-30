import type { ReactNode } from "react";

// The website's privacy policy and terms of use (mixtaped.tech/privacy and /terms), drawn without the app
// like done.tsx. Written from what Mixtape actually does: change them when that changes, and the date.
const UPDATED = "30 October 2026";
const MAIL = "legal@mixtaped.tech";
const Mail = () => <a href={`mailto:${MAIL}`}>{MAIL}</a>;
const Out = ({ to, children }: { to: string; children: ReactNode }) => <a href={to} target="_blank" rel="noopener">{children}</a>;

type Page = { title: string; short: string[]; sections: [id: string, heading: string, body: ReactNode][] };
const PAGES: Record<string, Page> = {
  "/privacy": {
    title: "Privacy Policy",
    short: [
      "Mixtape has no ads, no analytics and no tracking, and sets no cookies.",
      "Mixtape needs an account. Your library syncs with it through Supabase, and you can export or delete it all from Settings → Account.",
      "Your listening history and settings stay on your device.",
      "To find and play songs, Mixtape asks services like YouTube Music and Apple Music directly, so they see your IP address and what you looked up.",
      "Crash reports, scrobbling and Spotify history are off until you turn them on.",
    ],
    sections: [
      ["who", "Who runs Mixtape", <>
        <p>Mixtape is a free music player made and run by one private person in Austria, not a company. For this policy that person is the controller: the one who decides what happens to your data. Write to <Mail /> about anything here, including any of the rights below. You’ll get an answer within a month.</p>
      </>],
      ["what", "What Mixtape handles, and why", <>
        <h3>On your device</h3>
        <p>Your library (songs, playlists, likes, folders), listening history, recent searches, settings, edits to song info, your own lyrics, and songs you download for offline (encrypted with a key that stays on the device). Local audio files are read where they are and never uploaded. Only what the sections below describe leaves your device.</p>
        <h3>Your account</h3>
        <p>Mixtape needs an account to work. To make one you give an email address and password, or sign in with Google, which shares your name, email address and profile picture with Mixtape. Your profile starts with that name and picture; you can change both. Mixtape keeps a copy of your library, your lyrics and timing edits, and your profile so it can sync them between your devices. Signing in also leaves the usual technical records with the account service (your IP address, browser or app version, and when you signed in), which it uses to keep accounts secure.</p>
        <h3>Your @handle and what you share</h3>
        <p>Your @handle, display name and picture are public, so people can find and follow you. A playlist you share, or your public profile, can be opened by anyone with the link. You choose what to share and can stop sharing at any time.</p>
        <h3>Spotify (if you connect it)</h3>
        <p>Connecting Spotify lets Mixtape import your playlists and saved songs. Mixtape also keeps a Spotify sign-in token on its server and, every half hour, fetches the last songs you played on Spotify into your History. Sign out of Spotify in Mixtape’s Spotify import to stop this and delete the token.</p>
        <h3>Finding and playing music</h3>
        <p>When you search, play a song, or open lyrics, artwork or song details, Mixtape asks the service that has them, straight from your device: YouTube Music (songs, search, artwork), Apple Music, the iTunes Search API and Deezer (song details, artwork and charts), LRCLIB, binimum, lrc.red and NetEase Cloud Music (lyrics), and Google Translate (only when you translate lyrics). They see your IP address and what was asked for, such as a search term or song title. Identifying a local song sends Shazam a short audio fingerprint made from the file, never sound from your microphone.</p>
        <p>In the web version, browsers block most of these requests, so they go through Mixtape’s own relay (a Supabase Edge Function), which passes them on without your cookies or sign-in details. Mixtape doesn’t store them; Supabase keeps short-lived request logs. Playing a song in the web version also sends its YouTube ID, and nothing else about you, to Mixtape’s resolver, which finds a playable stream.</p>
        <h3>Things you turn on</h3>
        <p><strong>Scrobbling:</strong> connect Last.fm or ListenBrainz and Mixtape tells them each song you play. <strong>Discord:</strong> turn on Discord status (both in Settings → Linked Accounts) and Mixtape shows the current song on your Discord profile through the Discord app on your computer.</p>
        <p><strong>Crash reports:</strong> off until you turn them on in Settings → Privacy (Mixtape asks once, after its first crash). Reports go to Sentry with your email, passwords, tokens, file paths and song and playlist names removed. Send Feedback uses Sentry too while reports are on, otherwise your email app.</p>
        <h3>Email, the website and updates</h3>
        <p>When you email Mixtape, your message and address are kept as long as needed to answer you. The website is hosted by Cloudflare, which keeps short-lived server logs (including IP addresses) to run it and fend off attacks. The app checks GitHub for updates, so GitHub sees your IP address.</p>
      </>],
      ["bases", "Legal bases", <>
        <ul>
          <li><strong>Providing what you asked for</strong> (GDPR Art. 6(1)(b)): your account, syncing, sharing, Spotify import and history, and finding and playing music.</li>
          <li><strong>Your consent</strong> (Art. 6(1)(a)): crash reports, scrobbling and Discord status. You can withdraw it at any time by turning them off; that doesn’t undo what was already sent.</li>
          <li><strong>Legitimate interests</strong> (Art. 6(1)(f)): keeping the website and accounts running and secure, checking for updates, and answering your emails.</li>
        </ul>
      </>],
      ["services", "Services Mixtape relies on", <>
        <p>These process data for Mixtape: <strong>Supabase</strong> (accounts, sync, the web relay), <strong>Cloudflare</strong> (website and email), <strong>Sentry</strong> (crash reports, only if on) and <strong>GitHub</strong> (updates). The music services above, plus Spotify, Last.fm, ListenBrainz and Discord, are independent services that you reach through Mixtape. Their own privacy policies apply to what they receive.</p>
        <p>Several of these are based in the United States. Transfers there rely on the EU–US Data Privacy Framework where the company is certified, or on the European Commission’s Standard Contractual Clauses.</p>
        <p>Mixtape never sells your data, never shares it for advertising, and doesn’t use it to profile you.</p>
      </>],
      ["retention", "How long things are kept", <>
        <ul>
          <li>Everything on your device stays until you remove it: clear your history, remove songs, or uninstall Mixtape (or clear the site’s data in your browser).</li>
          <li>Your account and everything synced with it stay until you delete the account, which removes them for good, Spotify plays and token included.</li>
          <li>Spotify plays fetched for your History stay until you clear your history or delete your account. The Spotify token goes when you sign out of Spotify in Mixtape.</li>
          <li>Sentry deletes crash reports within 90 days. Server logs at Supabase and Cloudflare last days to weeks.</li>
        </ul>
      </>],
      ["storage", "Cookies and storage on your device", <>
        <p>Mixtape sets no cookies and has no analytics, advertising or tracking. It does keep data in your browser or app storage (local storage and IndexedDB): your sign-in, so you stay signed in; your library, history and settings; where you were in a song; and copies of artwork and lyrics so they load quickly. All of it is needed for the service you asked for, which is why there’s no consent banner. Crash reporting loads only after you turn it on.</p>
      </>],
      ["rights", "Your rights", <>
        <p>You can ask to see your data, get a copy, have it corrected or deleted, restrict or object to how it’s used, and withdraw consent. Most of this is built in:</p>
        <ul>
          <li><strong>Copy of your data:</strong> Settings → Account → Export Your Data.</li>
          <li><strong>Delete everything:</strong> Settings → Account → Delete Account.</li>
          <li><strong>Correct it:</strong> edit your profile, name and @handle in Settings → Account.</li>
          <li><strong>Withdraw consent:</strong> turn off crash reports in Settings → Privacy, disconnect Last.fm, ListenBrainz or Discord in Settings → Linked Accounts, and sign out of Spotify in the Spotify import.</li>
          <li><strong>History:</strong> clear it, turn it off, or use a Private Session in Settings → Privacy.</li>
        </ul>
        <p>For anything else, write to <Mail />. If you think your data is mishandled, you can complain to a data protection authority. In Austria that’s the Datenschutzbehörde (<Out to="https://dsb.gv.at">dsb.gv.at</Out>); you can also go to the one where you live.</p>
      </>],
      ["age", "Age", <>
        <p>You need to be at least 14 to make a Mixtape account. Mixtape doesn’t knowingly hold accounts of younger children; write in and it’ll be deleted.</p>
      </>],
      ["changes", "Changes", <>
        <p>If Mixtape starts handling your data differently, this page changes first, with a new date at the top.</p>
      </>],
    ],
  },
  "/terms": {
    title: "Terms of Use",
    short: [
      "Mixtape is free and in beta: use it as it is, and expect things to change.",
      "Mixtape doesn’t host music. Songs come from YouTube Music and your own files, and belong to their owners.",
      "Be decent with your @handle and anything you share, and don’t abuse Mixtape’s servers.",
      "You can delete your account any time.",
    ],
    sections: [
      ["agreement", "These terms", <>
        <p>These terms apply when you use Mixtape, the app or the website at mixtaped.tech. By using it you agree to them. The <a href="/privacy">Privacy Policy</a> says what happens to your data.</p>
      </>],
      ["service", "What Mixtape is", <>
        <p>Mixtape is a free music player run by one private person, not a company. It plays songs from YouTube Music and audio files on your device, and can import libraries from Spotify, Apple Music and Deezer. It’s in beta: features can change, break or go away, and there’s no guarantee it will always be available.</p>
      </>],
      ["music", "Music and other services", <>
        <p>Mixtape doesn’t host, sell or own any music. Songs, artwork and lyrics come from other services and stay the property of their rights holders. Those services set their own rules, and they can stop working with Mixtape at any time. You’re responsible for the files you add and for how you use what you play.</p>
      </>],
      ["account", "Your account", <>
        <p>You need an account to use Mixtape. Keep your password to yourself; you’re responsible for what happens on your account. You need to be at least 14 to make one.</p>
        <p>Your @handle and display name are public. Don’t pick ones that impersonate someone, mislead, or offend. Mixtape can change or take back a handle that does.</p>
      </>],
      ["sharing", "What you share", <>
        <p>Playlists, names, pictures and descriptions you share stay yours. By sharing them you let Mixtape store and show them to the people you share with, for as long as you keep sharing. Don’t share anything you don’t have the right to, or that’s illegal, hateful or meant to harass someone.</p>
      </>],
      ["use", "Fair use", <>
        <p>Don’t use Mixtape’s servers for anything other than using Mixtape: no scraping, no automated bulk requests, no using the web relay or resolver for other apps, and no trying to get into other people’s accounts or break Mixtape’s security.</p>
      </>],
      ["ending", "Ending", <>
        <p>You can stop using Mixtape and delete your account at any time in Settings → Account. Mixtape can suspend or delete accounts that break these terms, and will say why when it can.</p>
      </>],
      ["liability", "Warranty and liability", <>
        <p>Mixtape is free and provided as it is, without promises that it’s error-free or always available. Back up anything you can’t afford to lose; Export Your Data in Settings makes a copy.</p>
        <p>Mixtape is liable without limit for harm caused on purpose or through gross negligence, and for injury to life, body or health. For slight negligence, it’s liable only for breaching essential duties, and only for harm that was typical and foreseeable. Nothing here limits rights you have by law as a consumer.</p>
      </>],
      ["law", "Law", <>
        <p>Austrian law applies, except where the law of the country you live in gives you, as a consumer, protections that can’t be signed away. You can bring a claim in the courts where you live.</p>
      </>],
      ["changes", "Changes and contact", <>
        <p>These terms can change as Mixtape does. The date at the top says when they last did. Questions? Write to <Mail />.</p>
      </>],
    ],
  },
};
export const isLegal = (path: string) => path.replace(/\/$/, "") in PAGES;

export default function Legal() {
  const path = location.pathname.replace(/\/$/, "");
  const { title, short, sections } = PAGES[path];
  document.title = `${title} · Mixtape`;
  return (
    // Scrolls itself: the app's body never does (index.css). And its text can be selected, unlike the app's.
    <main className="dark h-dvh overflow-y-auto bg-[#0b0b0c] select-text px-[clamp(20px,6vw,88px)] pt-[clamp(40px,8vw,96px)] pb-24 text-white [color-scheme:dark]">
      <div className="mx-auto max-w-[1080px] animate-[rise_600ms_var(--ease-out)_both]">
        <nav className="mb-14 flex items-center gap-6 text-[15px] font-semibold">
          <a href="/" className="mr-auto"><img src="/favicon.svg" alt="Mixtape" className="size-9" /></a>
          {Object.entries(PAGES).map(([to, p]) => <a key={to} href={to} aria-current={to === path ? "page" : undefined} className="text-white/45 transition-colors hover:text-white aria-[current=page]:text-white">{p.title}</a>)}
        </nav>
        <h1 className="text-[clamp(48px,8vw,104px)] leading-[0.9] font-black tracking-[-0.05em]">{title}</h1>
        <p className="mt-5 text-[15px] text-white/45">Last updated {UPDATED}</p>

        <div className="mt-14 grid gap-14 lg:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-10 lg:self-start">
            <ol className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-white/45 lg:flex-col">
              {sections.map(([id, heading]) => <li key={id}><a href={`#${id}`} className="transition-colors hover:text-white">{heading}</a></li>)}
            </ol>
          </aside>
          <div className="max-w-[68ch]">
            <section className="rounded-3xl bg-gradient-to-br from-white/[0.09] to-white/[0.03] p-7 ring-1 ring-white/10">
              <h2 className="text-[13px] font-bold tracking-[0.08em] text-white/50 uppercase">The short version</h2>
              <ul className="mt-4 flex flex-col gap-2.5 text-[17px] leading-snug">{short.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
            {/* Long-form text: links underlined, lists bulleted, subheads small. */}
            <div className="text-[16px] leading-[1.65] text-white/70 [&_a]:text-white [&_a]:underline [&_a]:decoration-white/30 [&_a]:underline-offset-[3px] [&_a:hover]:decoration-white [&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-white [&_li]:mt-2 [&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-white [&_ul]:list-disc [&_ul]:pl-5">
              {sections.map(([id, heading, body]) => (
                <section key={id} id={id} className="mt-14 scroll-mt-10">
                  <h2 className="text-[clamp(26px,3vw,34px)] leading-tight font-extrabold tracking-[-0.03em] text-white"><a href={`#${id}`} className="!no-underline">{heading}</a></h2>
                  {body}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
