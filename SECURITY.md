# Security

This project asks people to type private things, so it is built to keep that private even if the database is copied and even though
the source code is public. This page says what is protected, what is not, and what to switch on if you run your own copy.

## Reporting a problem

If you find a security problem, **please don't post it as a public issue.** Use the repository's **Security** tab, then
**Report a vulnerability**, so it stays private until it is fixed. (The repository owner turns this on under
Settings, **Security and quality**, **Advanced Security**, **Private vulnerability reporting**.)
Say what you did and what happened. Please don't include anyone's real personal information.

## What is protected, and how

| Risk | What stops it |
|---|---|
| Someone copies the database file | Answers and notes are encrypted (AES-256-GCM) with a key made from the person's passphrase. The key is never stored in the database. |
| Guessing a passphrase on the site | 5 wrong tries lock the account for 5 minutes; sign-in is limited to 12 tries a minute per address; an unknown username and a wrong passphrase get the same answer and take the same time. |
| Guessing offline from a stolen database | Every guess costs 600,000 rounds of PBKDF2-SHA256 and each user has their own random salt. The real protection is a long passphrase (several random words), which the app encourages. |
| Another website making your browser act | Sign-in cookie is `SameSite=Strict`, and every change must carry an `X-Quietly` header other sites can't add. |
| Malicious script on the page (XSS) | The page never builds HTML from text (no `innerHTML`). A Content-Security-Policy allows only this site's own scripts and requests. AI replies are drawn as plain text nodes. |
| SQL injection | Every SQL statement is a fixed string with parameters (`Data/Db.cs`). Nothing is ever pasted into a query. |
| Stealing the sign-in cookie | `HttpOnly`, `Secure` (HTTPS only), `SameSite=Strict`, session-only, 30 minutes idle. |
| Putting the page inside another page | `X-Frame-Options: DENY` and `frame-ancestors 'none'`. |
| Running up the AI bill | The Gemini key lives only on the server. The helper is limited to 10 questions a minute per address and a daily ceiling for the whole site (`Gemini:DailyLimit`). |
| Filling the disk | Requests are capped at 128 KB; saved data and notes have size limits; new accounts stop at `Quietly:MaxAccounts` (5,000 by default). |
| Private files being downloaded | Only the `wwwroot` folder is served. The automated test checks that settings, source files and the database are refused. |
| Secrets in the public repository | None are in the code. `.gitignore` keeps databases, keys and settings files out. Turn on GitHub secret scanning with push protection (below). |
| Old, vulnerable libraries | Dependabot (`.github/dependabot.yml`) proposes updates weekly. CodeQL scans the code on every change. |

## What this does NOT protect against

Please read these. They are the honest limits.

- **It is not end-to-end encrypted.** When someone signs in, their passphrase reaches the server for a moment so it can derive the key.
  Data is encrypted *at rest* (in the database), but whoever controls the running server could in principle watch it happen.
  Run it somewhere you trust, and don't let anyone else deploy their own copy and send people to it believing it's yours.
- **A person who controls the device.** Spyware, a shared browser profile, a parent or partner who can see the screen, or shared Wi-Fi logs can all reveal that someone visited.
  A website can't fix that. The guide tells people to use a private window on a device nobody else can reach.
- **Forgotten passphrases can't be recovered.** There is no email, so there is no reset. That is deliberate.
- **Signing out doesn't cancel a stolen cookie.** The cookie is stateless. Signing out removes it from the browser, but a copy someone already stole works until it expires (30 minutes without use).
- **Usernames aren't secret.** Sign-up says if a name is taken. The passphrase is the secret.
- **The lock-out can be abused.** Anyone who knows a username can type five wrong passphrases and lock that account for five minutes. That is the price of slowing guessing down.
- **The per-address limit trusts the host's proxy.** The Dockerfile reads the visitor's address from the host's forwarded headers. That is right on Railway, Render and similar hosts where only their proxy can reach the app.
  If you expose the container directly to the internet, remove `ASPNETCORE_FORWARDEDHEADERS_ENABLED` or visitors can fake their address.
- **Cookie keys are not encrypted on disk.** They live in `keys/` inside the data folder. Protect that volume (and back it up). Losing it only signs everyone out. Losing the *database* loses everyone's notes.
- **The container runs as root**, so a mounted volume is writable. On a hardened host you can switch to a normal user and set the volume's ownership instead.
- **The AI helper sends what people type into it to Google.** Nothing else is sent, but people should not put names, addresses or secrets in it. The free Gemini tier may use data to improve Google's products; use a paid key.
- **Hotline numbers are US ones and were not verified.** Check them before launch.
- **No independent security audit or penetration test has been done.** The automated tests in this repository are real, but they are not a substitute for one. If a lot of people will trust this, pay for a review.

## If you run your own copy: checklist

1. **Never commit a key.** Give the Gemini key to the host as an environment variable (`Gemini__ApiKey`), or use `dotnet user-secrets` on your own computer.
   If one ever reaches GitHub, treat it as burned: delete it in Google AI Studio, make a new one, update the host. Deleting the file afterwards isn't enough, because the history keeps it.
2. **Switch on GitHub's free protections** (public repositories get them at no cost). In the repository, open **Settings**, then **Security and quality**, then **Advanced Security**, and enable:
   Dependency graph, Dependabot alerts, Dependabot security updates, **Secret scanning** and **Push protection**, and **Private vulnerability reporting**.
   The names move around from time to time; GitHub's own settings page is the source of truth.
   CodeQL is already set up by `.github/workflows/codeql.yml`; don't also switch on "Default setup" for code scanning, or it will run twice.
3. **Protect the `main` branch** (Settings, Rules): require a pull request and require the **Build and test** check to pass before merging. Merge Dependabot's pull requests promptly.
4. **Turn on two-step sign-in** for your GitHub account and your hosting account. Someone taking over either is a bigger risk than anything in the code.
5. **Keep HTTPS on.** Leave `Quietly:RequireHttps` at `true`. Set `AllowedHosts` to your own domain (environment variable `AllowedHosts=yourdomain.com`).
6. **Set a spending limit or budget alert** on the Google key, as a second guard behind `Gemini:DailyLimit`.
7. **Turn off access logs** on any proxy in front of the app, or don't log addresses, so the "no records of visits" promise is true end to end.
8. **Back up the data folder** and keep its permissions tight.
