# Quietly (placeholder name)

**Version 1.0.0**: the first release.

A private, dark-mode, interactive guide to going no contact. It starts by asking who you're stepping away from
(an ex, a parent, a friend, or someone else) and builds a different step-by-step plan for each, shaped by a few
follow-up questions. Accounts are anonymous: a username and a passphrase, no email, no phone, no real name.

**Stack:** C# / ASP.NET Core Minimal API (.NET 10) · SQLite (plain SQL) · HTML + CSS + vanilla JavaScript · JSON content files.

> **Status.** The front end was tested in a real browser (94 automated checks against a stand-in server for the full site, plus 70 for the no-server version).
> The C# server could not be compiled where this was written (no .NET SDK was available). Instead, **GitHub compiles it and runs a full
> sign-up / sign-in / save / security test against the real server on every change** (`.github/workflows/build.yml`, `scripts/smoke-test.sh`).
> Run `dotnet build` yourself first and see [Checking it works](#checking-it-works). A red cross on GitHub means something needs fixing.
> What is protected, and what isn't, is written down in [SECURITY.md](SECURITY.md).

---

## Run it

You need the [.NET SDK](https://dotnet.microsoft.com/download). The project is written for .NET 10 (the long-term-support version, supported until November 2028).
A newer version such as .NET 11 also works, because the project is set to roll forward to whatever newer .NET is installed. (I wrote it against .NET 10 and could not
compile it on any version here, so if a newer one gives an error, installing .NET 10 alongside it is the safe fix. Versions can be installed side by side.)

```bash
cd quietly
dotnet run
```

Open <http://localhost:5080>. In Development the app allows plain HTTP; everywhere else it requires HTTPS (see below).

Older versions (.NET 9 and 8) are no longer supported by Microsoft, so install .NET 10 or newer. The hosting `Dockerfile` uses .NET 10 images regardless of what is on your own computer.

### Checking it works

1. `dotnet build` should finish with no errors. If it doesn't, the message will point at one line; that's the quickest thing to fix.
2. `dotnet run`, then create an account, answer the questions, tick a step, add a journal note, sign out and back in.
   Your tick and note should still be there. That confirms the database, the encryption and the cookie all work together.
3. Open `App_Data/quietly.db` in any SQLite viewer. You should see only `Users` (username, salt, verifier), and
   `Blob` columns full of unreadable text. No answers, no notes.
4. Optional, for a test copy only: the automated check that GitHub runs can also be run on your computer. It makes throw-away accounts and makes about 17 sign-in calls, which is more than the normal 12-a-minute limit, so raise the limit just for the test.
   In one terminal: `Quietly__AuthAttemptsPerMinute=40 dotnet run` (on Windows PowerShell: `$env:Quietly__AuthAttemptsPerMinute=40; dotnet run`). In another: `bash scripts/smoke-test.sh http://localhost:5080`.
   It prints "All checks passed." when everything works.

---

## How privacy works

| Question | Answer |
|---|---|
| What does the server know about me? | A username you chose, a random salt, a check value for your passphrase, and encrypted blobs. No email, phone, name, IP address or device details are stored. |
| Can the database owner read my notes? | Not from the database alone. Everything you write is encrypted with AES-256-GCM under a key derived from your passphrase. |
| Where is that key kept? | Only inside your encrypted, HttpOnly, session-only sign-in cookie. It is never written to disk. |
| What if I forget my passphrase? | The data can't be recovered. That is deliberate: there is no reset link because there is no email to send it to. |
| What leaves the site? | Nothing, with one optional exception: if you turn on the [AI helper](#ai-helper-gemini), the questions people type into it are sent to Google's Gemini. No analytics, ads, third-party fonts or scripts. The browser is only allowed to talk to this site (Content-Security-Policy), so even the helper goes through your server. |
| Does the browser keep a copy? | Responses are sent with `Cache-Control: no-store`. Notes are never put in `localStorage` or cookies. |
| Is the server logging my visits? | The app logs warnings and errors only, never per-request lines. A reverse proxy in front of it may log; see Deployment. |

### The crypto, in short

```
passphrase ──PBKDF2-SHA256 (600,000 rounds, random 16-byte salt per user)──▶ master key
master ──HMAC "quietly/auth"──▶ verifier   (stored; lets the server check a passphrase)
master ──HMAC "quietly/data"──▶ data key   (never stored; lives only in the encrypted cookie)
progress + notes ──AES-256-GCM (random nonce, owner-bound)──▶ ciphertext in SQLite
```

Other protections: 5 wrong passphrases lock an account for 5 minutes; sign-in and registration are also rate-limited
per address (12 a minute, held only in memory); unknown usernames take as long to reject as wrong passphrases; the
`X-Quietly` header is required on every state-changing request as extra CSRF protection; request bodies are capped at 128 KB;
new accounts stop at 5,000 so a bot can't fill the disk; every response carries anti-framing, no-referrer, cross-origin and (over HTTPS) HSTS headers.
Passphrases are normalized to Unicode NFKC in the browser so they produce the same key on every device.

### In the app

- **Quick exit** (top right, or press **Esc three times**) signs you out, wipes the page and jumps to another site
  (default: google.com; change it in Settings). It can't clear your browser history, so a private window is still wise.
- **Guest mode** keeps everything in memory only. Closing the tab erases it.
- **Idle sign-out** after 5, 10 or 30 minutes (Settings).
- **Delete my account** removes the user and every row that belongs to them (foreign-key cascade, `secure_delete` on).

### Honest limits

This can't hide that someone visited from a person who controls the device, the Wi-Fi or the browser profile. Spyware,
shared accounts, and shoulder-surfing are outside what a website can fix. The guide says so, and recommends a private window
on a device the other person can't reach. If someone could be dangerous, the Safety page and hotlines come first.

---

## Free version (no server)

The `wwwroot` folder is a complete website on its own. If you put it on a plain web host (one that only serves files, no .NET), the page notices there is no
server and switches itself to **guest-only mode**: the start page is a single "Start the guide" button, nothing is saved, and the AI helper and accounts don't appear.
Closing the tab erases everything, and nothing a visitor types is sent anywhere. The same files run both ways, so there is nothing to build or convert.

What you give up compared with the full site: accounts, saved progress and notes across visits, and the AI helper. Everything else (the questions, all ~95 steps, the
urge timer, the contact helper, the safety pages, Quick exit, idle hiding) works the same.

**Publish it free on Cloudflare Pages (easiest, no GitHub needed)**

1. Make a free account at cloudflare.com and open **Workers & Pages**.
2. Choose **Create application**, then **Get started** under "Drag and drop your files" (Direct Upload).
3. Name the project and drag in `quietly-static-site-v1.0.0.zip` (or the unzipped folder). `index.html` must be at the top level of what you upload.
4. Press Deploy. You get a link like `your-name.pages.dev`. A custom domain can be added later in the project's settings.

Cloudflare's docs list the drag-and-drop limits as 1,000 files and 25 MiB per file; this site is about 25 small files.

**Or on GitHub Pages:** put the *contents* of `wwwroot` (so `index.html` is at the top of the repository) in a **public** repository, then in the repository's
Settings, open **Pages** and publish from the main branch. GitHub's limits for Pages sites are 1 GB in size and a soft 100 GB of traffic a month.
Pages from private repositories need a paid GitHub plan. GitHub also asks that Pages not be used as free hosting for a commercial service.

Notes:
- Opening `index.html` by double-clicking it does not work, because browsers block the site's scripts when it is opened straight from a folder. Use a host, or preview locally
  with `python3 -m http.server` inside `wwwroot` and open <http://localhost:8000>.
- A plain host can't be told to send security headers, so the page carries its own Content-Security-Policy. It blocks scripts and requests to any other website.
  Cloudflare Pages also reads the included `wwwroot/_headers` file and adds the same protections the full server sends (no framing, no referrer, no caching). Other hosts ignore that file.
- The host can still see that a visit happened (and usually the visitor's IP address), like any website. The start page says so.
- When the host has no server, the browser's first request to `api/me` fails with a 404. That single failed request in the browser's console is expected.

---

## Making the code public

This repository is set up to be public from day one. Every file was checked: no API keys, passwords, email addresses, personal paths or database files.
The Gemini key lives outside the project (user-secrets or a hosting environment variable), and `.gitignore` keeps databases, encryption keys, `.env` files,
settings overrides and build folders out. The security design doesn't depend on the code being secret, so publishing it doesn't weaken anyone's privacy.

**Safety pieces already in the repository**

| File | What it does |
|---|---|
| [`SECURITY.md`](SECURITY.md) | What is protected, the honest limits, how to report a problem, and a checklist for your own copy. GitHub shows it on the Security tab. |
| `.github/workflows/build.yml` | On every change: compiles the C#, starts the real server and runs `scripts/smoke-test.sh` (sign-up, sign-in, saving, lock-out, rate limit, files that must stay private). |
| `.github/workflows/codeql.yml` | GitHub's code scanner for the C# and JavaScript. Findings appear under the Security tab. |
| `.github/dependabot.yml` | Opens a pull request each week when a library or the Docker image has a newer version. |
| `.gitignore`, `.gitattributes` | Keep databases, keys, secrets and build output out of Git, and keep line endings the same on every computer. |

**Publishing it**

1. Make a GitHub account. A public repository shows its owner's username, so use a separate account if you want to stay anonymous.
2. Create a new repository and choose **Public** (you can start **Private** and switch later). Leave GitHub's "add .gitignore" off, because this project already has one.
3. Upload the project. The most reliable ways keep hidden folders such as `.github` and honor `.gitignore`: **GitHub Desktop**, or in a terminal inside the project folder:
   ```bash
   git init -b main
   git add .
   git status        # read the list: there should be no .db files, no keys, no .env
   git commit -m "First version"
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```
   (Dragging files onto github.com also works, but it ignores `.gitignore` and can miss hidden folders.)
4. Open the **Actions** tab. **Build and test** should turn green within a few minutes. If it is red, open it: the log shows the first thing that failed.
5. Switch on GitHub's free protections (secret scanning with push protection, Dependabot alerts, private vulnerability reporting). The click-by-click list is in [SECURITY.md](SECURITY.md#if-you-run-your-own-copy-checklist).
6. **Choose a licence.** With no licence file, people can see the code but have no legal right to reuse it. On GitHub: Add file, Create new file, name it `LICENSE`, and pick a template (MIT is a common, permissive choice). That is your decision, so none is included.
7. **Never commit your Gemini key.** If one ever goes into the repository, treat it as leaked: delete it in Google AI Studio and make a new one.
8. Check the hotline numbers in `core.json` before launch; they were not verified and are US ones.

---

## AI helper (Gemini)

A round turquoise button at the bottom right opens a chat for questions the guide doesn't answer. It is **off until you add a key**:
with no key, the button simply isn't shown and the console prints a one-line warning.

**Turn it on**

1. Make an API key in Google AI Studio (aistudio.google.com).
2. **Turn on billing for that key's project.** This matters for a private app. Google's terms say that on the free tier your
   prompts and the replies can be used to improve its products and may be read by human reviewers, and they tell developers not
   to send sensitive information there. On the paid tier Google says it doesn't use prompts to improve its products (it keeps
   them for a limited time to detect misuse). See <https://ai.google.dev/terms>. People using this guide may type very personal things.
3. Give the key to the app, **not** in a file you'd share:
   - On your own computer: `dotnet user-secrets set "Gemini:ApiKey" "YOUR_KEY"` (run it in the project folder).
   - On a server: set the environment variable `Gemini__ApiKey` (two underscores).
4. Run it. The warning disappears and the round button appears once someone signs in or continues as a guest.

**What it does and doesn't send.** The browser talks only to your server; the server talks to Google, so the key never reaches the browser.
Google receives the instructions in `Ai/AssistantPrompt.cs` and the messages typed into the chat (the last 12 turns).
It never receives saved answers, checklist ticks, the journal or the username. Nothing from the chat is stored or logged on your server,
and it vanishes on sign-out, Quick exit or tab close. The first time, the person is shown exactly this and must agree. They can also hide the button in Settings.

**Cost and limits.** Each question is a paid API call. The app limits each address to 10 questions a minute and the whole site to
`Gemini:DailyLimit` a day (if someone uses them all up, the helper pauses until the next UTC day). I could not check current prices; look at Google's pricing page and set a budget alert in Google Cloud.
A lighter model such as `gemini-3.8-flash` (Google's most capable Flash model) is typically faster and cheaper than the flagship, so compare prices and set `Gemini:Model` to switch.
Model names change over time. If Google rejects the name or key, the server logs the HTTP status and reason (never your users' text).

**Safety.** The instructions tell the model to put safety first, point to the Safety page and hotlines when someone may be in danger or
mentions self-harm, never help with tracking or harassing the other person, and say it is an AI. A model can still get things wrong,
so the panel always shows a reminder. Try it with hard questions before you launch, and adjust `AssistantPrompt.cs` if needed.

---

## Project layout

```
Program.cs              Config, security headers, cookie auth, rate limiting, every API endpoint
Models.cs               Request shapes (register/login, journal, delete account)
Ai/GeminiHelper.cs      The AI helper: checks a chat, calls Gemini, caps daily use
Ai/AssistantPrompt.cs   The instructions the model is given (edit to change its behavior)
Data/schema.sql         Three tables: Users, UserState, JournalEntries
Data/Db.cs              All SQL, as plain constants, plus a small data-access class
Security/Crypto.cs      Key derivation and AES-GCM
Security/Accounts.cs    Passphrase checking, lockout, and the sign-in cookie
appsettings*.json       Settings (see below)
wwwroot/
  index.html            The one page
  css/app.css           Dark theme (colours are variables at the top)
  content/*.json        THE GUIDE ITSELF: edit these to change what people read
  js/                   dom.js, api.js, env.js, store.js, content.js, app.js, assistant.js, views/*.js
Dockerfile              Optional: build and run in a container (see Putting it online)
SECURITY.md             What is protected, what isn't, and a checklist for your own copy
scripts/smoke-test.sh   End-to-end check of a running server (GitHub's build runs it)
.github/                Build and test, CodeQL scan, Dependabot
```

### API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` | Anonymous account |
| GET | `/api/me` | `{ "username": "…" }`, or `{ "username": null }` when signed out |
| GET / PUT | `/api/state` | The user's encrypted progress (answers, ticked steps, reasons, settings) |
| GET / POST / DELETE | `/api/journal`, `/api/journal/{id}` | Encrypted private notes |
| POST | `/api/account/delete` | Needs the passphrase again |
| GET / POST | `/api/assistant` | Whether the AI helper is set up / ask it a question |

### Settings (`appsettings.json`)

| Key | Default | Meaning |
|---|---|---|
| `Quietly:RequireHttps` | `true` (`false` in Development) | Marks the cookie `Secure`. Leave on in production. |
| `Quietly:DataDirectory` | `App_Data` next to the app | Where `quietly.db` and the cookie-protection keys (`keys/`) live. Back this folder up. Deleting `keys/` only signs everyone out. |
| `Quietly:MaxAccounts` | `5000` | Most accounts the site will hold. A guard against bots filling the disk; raise it if you really grow. |
| `Quietly:AuthAttemptsPerMinute` | `12` | Sign-up and sign-in tries allowed per address per minute. Leave it; only the automated test raises it. |
| `AllowedHosts` | `*` | Set this (environment variable `AllowedHosts=yourdomain.com`) so the app only answers for your own domain. |
| `Gemini:ApiKey` | none | Turns the AI helper on. Never put it in a file you share; see below. |
| `Gemini:Model` | `gemini-4-argon` | Which Gemini model answers. |
| `Gemini:Thinking` | `medium` | `low`, `medium` or `high`. Higher is slower and costs more. Empty = the model's default. |
| `Gemini:MaxOutputTokens` | `8192` | Reply limit. Thinking tokens count toward it, so keep it generous. |
| `Gemini:DailyLimit` | `300` | Most questions the whole site will send to Gemini per day (UTC). A guard against surprise bills. |

---

## Editing the guide

The guide is data. You can change or add advice without touching C# or JavaScript.

**Files:** `core.json` holds what every path shares (22 steps, the safety page, urge toolkit, contact-response types,
resources and the source list). `ex.json`, `parent.json`, `friend.json` and `other.json` each hold that path's intro,
questions, "what to expect" and its own steps.

**A step** (the `//` notes are for explanation only; real JSON files can't contain comments):

```json
{
  "id": "ex-home",                  // unique across all files
  "phase": "prepare",               // prepare | break | hold | rebuild
  "title": "Sort out where you’ll live",
  "summary": "One or two sentences shown when the step is collapsed.",
  "how": ["Concrete action one.", "Concrete action two."],
  "scripts": [{ "label": "Short, calm", "text": "Words someone can copy." }],   // optional, each gets a Copy button
  "tool": "reasons",                // optional button: reasons | urge | contact | journal | safety | digital | privacy
  "requires": ["home"],             // show only if one of these flags is set
  "unless": ["safety"],             // hide if any of these flags is set
  "variants": [{ "when": "safety", "summary": "…", "how": ["Replacement advice for people who may be unsafe."] }],
  "src": ["cc-hoover"]              // ids from core.json "sources"
}
```

**Flags** come from the questions. The follow-up options for each path are in its JSON file (`questions[].options[].id`).
Those option ids, plus `safety` (answered Yes or Not sure) and `stage_deciding` / `stage_preparing` / `stage_started`, are
what `requires` and `unless` check. Steps with neither field are shown to everyone on that path.

**To add a question option:** add `{ "id": "newflag", "label": "…" }` to the question, then use `"requires": ["newflag"]` on steps.

**To add a source:** add `{ "id", "title", "by", "url" }` to `core.json` `sources`, then list its id in a step's `src`.

**Check your edit:** every `src` id must exist, step ids must be unique, and every flag in `requires` must be one a question can set.
A mistake in JSON stops the guide loading, and the page says "Could not load the guide."

## Changing the name

Change `app.name` and `app.tagline` in `core.json`, the `<title>` and brand text in `wwwroot/index.html`, the
`SetApplicationName("Quietly")` line in `Program.cs`, and (optionally) the namespace. The tab title is deliberately plain so
it doesn't reveal the topic.

---

## Putting it online

This is a normal ASP.NET Core app, so it needs a host that can run Docker (or .NET), a persistent disk for the database, and HTTPS.
Hosts also give you a free web address to start with, so you can share a link before you buy a domain name.

**Example: Railway** (checked against Railway's docs in November 2026; prices change, so look at their pricing page)

1. Put the project in your GitHub repository, public or private (it contains no secrets). The steps are under [Making the code public](#making-the-code-public).
2. On railway.com, create a project, choose "Deploy from GitHub repo", and pick it. Railway finds the `Dockerfile` by itself.
3. In the service's **Variables**, add `Gemini__ApiKey` with your paid Gemini key (skip this to run without the AI helper).
4. In the service's **Settings**, add a **Volume** and set its mount path to `/data`. Without this, accounts and notes are erased each time the app restarts.
5. In **Settings, Networking**, click Generate Domain. That gives you a link people can open. To use your own domain, choose Custom Domain and add the DNS record it shows at the place you bought the domain.

Railway's plan is usage-based (a $5/month plan plus small charges for memory, CPU and disk). Render works the same way with a Dockerfile
($7/month for the smallest paid web service plus $0.25 per GB of persistent disk). Fly.io is cheaper but is driven from the command line (`fly launch`).

**Or run it yourself with Docker:**

```bash
docker build -t quietly .
docker run -p 8080:8080 -v quietly-data:/data -e Gemini__ApiKey=YOUR_KEY quietly
```

The Dockerfile listens on the host's `PORT` (or 8080) and sets `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` so rate limits see real visitor
addresses behind the host's proxy. I could not run Docker where this was written, so treat the Dockerfile as a starting point and read the build logs if something fails.

## Deployment notes

- **HTTPS is required** in production. With `RequireHttps` on, the sign-in cookie is only sent over HTTPS.
- Put it behind a reverse proxy (Caddy, nginx, IIS) that terminates TLS. **Turn off access logs there**, or at least
  don't log IP addresses, or the "no per-request records" promise is weaker than the app itself.
- The Dockerfile already turns on forwarded headers, so the per-address rate limit sees real visitor addresses behind the host's proxy.
  If you run it some other way behind a proxy, set `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` yourself. If the app can be reached
  directly from the internet, don't (visitors could fake their address). See [SECURITY.md](SECURITY.md).
- Set `AllowedHosts` to your domain, and keep `Quietly:RequireHttps` on.
- Persist `Quietly:DataDirectory` (a volume or mounted folder) and back it up. Restrict its file permissions.
- Several app instances need a shared Data Protection key store; for a single instance the default folder is fine.
- Hotline numbers and links in `core.json` are for the United States. Check them before publishing, and add local ones for
  other countries.

## What isn't built yet

- **AI answers don't use the guide's full text yet.** The helper gets the guide's seven core rules and safety guidance, not all ~95 steps.
  Feeding it the step content (or retrieval over it) would make its answers match the guide more closely.
- Change passphrase (needs re-encrypting the user's data), export/import across accounts, translations, and non-US resources.
- Rich content you plan to add later. The JSON model is meant to grow: new tracks are one more file plus one entry in `js/content.js`.

## Content and sources

The guide is general information, not therapy, medical or legal advice, and it says so on screen. The advice draws on 18
sources (domestic-violence advocacy organizations, therapist-written guides, and psychology reporting); each step lists the
sources behind it and the full list is in the app under **Resources**.

If someone is in danger: call your local emergency number. In the US, the National Domestic Violence Hotline is
1-800-799-7233 (text START to 88788), and 988 reaches the Suicide & Crisis Lifeline.
