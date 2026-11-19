using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.Sqlite;
using Quietly;
using Quietly.Ai;
using Quietly.Data;
using Quietly.Security;

var builder = WebApplication.CreateBuilder(args);

// ---------- settings ----------
string configuredDir = builder.Configuration["Quietly:DataDirectory"] ?? "";
string dataDir = string.IsNullOrWhiteSpace(configuredDir)
    ? Path.Combine(builder.Environment.ContentRootPath, "App_Data")
    : configuredDir;
Directory.CreateDirectory(dataDir);
bool requireHttps = builder.Configuration.GetValue("Quietly:RequireHttps", true);
// Stops a bot from filling the disk with fake accounts. Raise it (or set it to a huge number) if you really expect more people.
int maxAccounts = builder.Configuration.GetValue("Quietly:MaxAccounts", 5000);
// Sign-up / sign-in / delete-account attempts allowed per address per minute. Leave at 12; only the automated test raises it.
int authPerMinute = builder.Configuration.GetValue("Quietly:AuthAttemptsPerMinute", 12);

// Warnings only: no per-request log lines, so the server keeps no record of who opened what.
builder.Logging.SetMinimumLevel(LogLevel.Warning);

builder.WebHost.ConfigureKestrel(o =>
{
    o.AddServerHeader = false;
    o.Limits.MaxRequestBodySize = 128 * 1024;
});

// ---------- services ----------
var db = new Db(Path.Combine(dataDir, "quietly.db"));
db.Init(Path.Combine(AppContext.BaseDirectory, "Data", "schema.sql"));
builder.Services.AddSingleton(db);

// ---------- optional AI helper (Google Gemini) ----------
// The key is read from configuration only: `dotnet user-secrets set "Gemini:ApiKey" "..."` while developing,
// or the environment variable Gemini__ApiKey when hosting. With no key, the helper button is simply not shown.
var gemini = new GeminiSettings(
    builder.Configuration["Gemini:ApiKey"] ?? "",
    builder.Configuration["Gemini:Model"] ?? "gemini-4-argon",
    builder.Configuration["Gemini:Thinking"] ?? "medium",
    builder.Configuration.GetValue("Gemini:MaxOutputTokens", 8192),
    builder.Configuration.GetValue("Gemini:DailyLimit", 300));
string systemPrompt = AssistantPrompt.Build(Path.Combine(builder.Environment.WebRootPath ?? "", "content", "core.json"));
builder.Services.AddHttpClient("gemini", c => c.Timeout = TimeSpan.FromSeconds(60));
builder.Services.AddSingleton(sp => new GeminiHelper(
    sp.GetRequiredService<IHttpClientFactory>(),
    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Quietly.Ai"),
    gemini,
    systemPrompt));

builder.Services.AddDataProtection()
    .SetApplicationName("Quietly")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDir, "keys")));

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "q";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromMinutes(30);
        o.SlidingExpiration = true;
        o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

// Slows down password guessing. The address is only held in memory for the length of the one-minute window.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = authPerMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    // The helper costs money per question, so it is limited per address as well.
    o.AddPolicy("assistant", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
});

var app = builder.Build();

if (!app.Services.GetRequiredService<GeminiHelper>().Enabled)
{
    app.Logger.LogWarning("Gemini:ApiKey is not set, so the AI helper button is hidden. See README.md to turn it on.");
}

// ---------- headers: nothing is cached, nothing leaves the site ----------
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["Cache-Control"] = "no-store";
    h["Pragma"] = "no-cache";
    h["X-Content-Type-Options"] = "nosniff";
    h["Referrer-Policy"] = "no-referrer";
    h["X-Frame-Options"] = "DENY";
    h["Permissions-Policy"] = "geolocation=(), camera=(), microphone=(), interest-cohort=()";
    h["Cross-Origin-Opener-Policy"] = "same-origin";
    h["Cross-Origin-Resource-Policy"] = "same-origin";
    if (requireHttps && ctx.Request.IsHttps)
    {
        // Tells the browser to only ever use https for this site. Sent only over https, and without includeSubDomains
        // so it can't affect other sites you run on the same domain.
        h["Strict-Transport-Security"] = "max-age=31536000";
    }
    h["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
        "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    await next();
});

// Anything that changes data must carry a header that other websites cannot add to a request (extra CSRF protection).
app.Use(async (ctx, next) =>
{
    bool isApi = ctx.Request.Path.StartsWithSegments("/api");
    bool changesData = !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method);
    if (isApi && changesData && ctx.Request.Headers["X-Quietly"].ToString() != "1")
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }
    await next();
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

// ---------- API ----------
var usernamePattern = new Regex("^[a-z0-9._-]{3,32}$", RegexOptions.Compiled);
var dayPattern = new Regex("^\\d{4}-\\d{2}-\\d{2}$", RegexOptions.Compiled);

var api = app.MapGroup("/api");
var auth = api.MapGroup("/auth");

auth.MapPost("/register", async (HttpContext ctx, Db store, AuthRequest req) =>
{
    string name = Accounts.NormalizeName(req.Username);
    string pass = req.Passphrase ?? "";
    if (!usernamePattern.IsMatch(name))
    {
        return Results.BadRequest(new { error = "Usernames use 3 to 32 letters, numbers, dots, dashes or underscores." });
    }
    if (pass.Length < 10 || pass.Length > 200)
    {
        return Results.BadRequest(new { error = "Use a passphrase of at least 10 characters. A few random words works well." });
    }

    if (store.CountUsers() >= maxAccounts)
    {
        return Results.Json(new { error = "New accounts are paused on this site right now." }, statusCode: 503);
    }

    byte[] salt = RandomNumberGenerator.GetBytes(16);
    byte[] master = Crypto.Master(pass, salt, Crypto.Iterations);
    long id;
    try
    {
        id = store.CreateUser(name, salt, Crypto.Iterations, Crypto.Derive(master, "auth"));
    }
    catch (SqliteException e) when (e.SqliteErrorCode == 19)
    {
        return Results.Conflict(new { error = "That username is taken. Try another." });
    }

    await Session.SignIn(ctx, id, name, Crypto.Derive(master, "data"));
    return Results.Ok(new { username = name });
}).RequireRateLimiting("auth");

auth.MapPost("/login", async (HttpContext ctx, Db store, AuthRequest req) =>
{
    VerifyOutcome v = Accounts.Verify(store, req.Username, req.Passphrase);
    if (v.Result == LoginResult.Locked)
    {
        return Results.Json(new { error = "Too many tries. Please wait a few minutes." }, statusCode: 429);
    }
    if (v.Result != LoginResult.Ok || v.User is null || v.DataKey is null)
    {
        return Results.Json(new { error = "That username and passphrase don't match." }, statusCode: 401);
    }

    await Session.SignIn(ctx, v.User.Id, v.User.Username, v.DataKey);
    return Results.Ok(new { username = v.User.Username });
}).RequireRateLimiting("auth");

auth.MapPost("/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
});

api.MapGet("/me", (HttpContext ctx) =>
{
    // Always 200, so the page can ask "am I signed in?" without an error showing up in the browser console.
    string? name = ctx.User.Identity?.IsAuthenticated == true ? ctx.User.Identity.Name : null;
    return Results.Ok(new { username = name });
});

api.MapPost("/account/delete", async (HttpContext ctx, Db store, DeleteAccountRequest req) =>
{
    long uid = Session.UserId(ctx.User);
    VerifyOutcome v = Accounts.Verify(store, ctx.User.Identity?.Name, req.Passphrase);
    if (v.Result != LoginResult.Ok || v.User is null || v.User.Id != uid)
    {
        return Results.Json(new { error = "That passphrase doesn't match." }, statusCode: 401);
    }

    store.DeleteUser(uid);   // cascades to the saved state and every journal entry
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
}).RequireAuthorization().RequireRateLimiting("auth");

// ----- AI helper -----
// Open to guests as well as signed-in people, so it is limited per address (policy above) and by a daily ceiling.
// Only the messages typed into the chat are sent to Google. Nothing from saved answers or notes.

api.MapGet("/assistant", (GeminiHelper helper) => Results.Ok(new { enabled = helper.Enabled }));

api.MapPost("/assistant", async (GeminiHelper helper, ChatRequest req, CancellationToken ct) =>
{
    if (!helper.Enabled)
    {
        return Results.Json(new { error = "The helper isn't set up on this site." }, statusCode: 503);
    }

    string? problem = GeminiHelper.Validate(req, out List<ChatTurn> turns);
    if (problem is not null) return Results.BadRequest(new { error = problem });

    AskResult result = await helper.AskAsync(turns, ct);
    return result.Status switch
    {
        200 => Results.Ok(new { reply = result.Text }),
        429 => Results.Json(new { error = "The helper has reached its limit for now. Please try again later." }, statusCode: 429),
        504 => Results.Json(new { error = "That took too long. Please try again." }, statusCode: 504),
        _ => Results.Json(new { error = "The helper couldn't answer just now. Please try again in a moment." }, statusCode: 502),
    };
}).RequireRateLimiting("assistant");

// ----- saved progress (one encrypted JSON object per user) -----

api.MapGet("/state", (HttpContext ctx, Db store) =>
{
    long uid = Session.UserId(ctx.User);
    byte[]? key = Session.DataKey(ctx.User);
    if (uid == 0 || key is null) return Results.Unauthorized();

    string? blob = store.GetState(uid);
    if (blob is null) return Results.Json(new { state = (object?)null });

    string? json = Crypto.TryDecrypt(key, "state:" + uid, blob);
    if (json is null) return Results.Json(new { error = "Your saved data could not be opened." }, statusCode: 500);

    using JsonDocument doc = JsonDocument.Parse(json);
    return Results.Json(new { state = doc.RootElement.Clone() });
}).RequireAuthorization();

api.MapPut("/state", async (HttpContext ctx, Db store) =>
{
    long uid = Session.UserId(ctx.User);
    byte[]? key = Session.DataKey(ctx.User);
    if (uid == 0 || key is null) return Results.Unauthorized();

    string body;
    using (var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8))
    {
        body = await reader.ReadToEndAsync();
    }
    if (body.Length == 0 || body.Length > 65536)
    {
        return Results.BadRequest(new { error = "Saved data is empty or too large." });
    }

    try
    {
        using JsonDocument doc = JsonDocument.Parse(body);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
        {
            return Results.BadRequest(new { error = "Saved data must be a JSON object." });
        }
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Saved data is not valid JSON." });
    }

    store.PutState(uid, Crypto.Encrypt(key, "state:" + uid, body));
    return Results.NoContent();
}).RequireAuthorization();

// ----- journal (one encrypted entry per row) -----

api.MapGet("/journal", (HttpContext ctx, Db store) =>
{
    long uid = Session.UserId(ctx.User);
    byte[]? key = Session.DataKey(ctx.User);
    if (uid == 0 || key is null) return Results.Unauthorized();

    var items = new List<object>();
    foreach (EntryRow row in store.ListEntries(uid))
    {
        string? json = Crypto.TryDecrypt(key, "entry:" + uid, row.Blob);
        if (json is null) continue;
        try
        {
            using JsonDocument doc = JsonDocument.Parse(json);
            string text = doc.RootElement.GetProperty("t").GetString() ?? "";
            string at = doc.RootElement.GetProperty("at").GetString() ?? "";
            items.Add(new { id = row.Id, text, at });
        }
        catch (Exception e) when (e is JsonException || e is KeyNotFoundException || e is InvalidOperationException)
        {
            // skip an entry we cannot read rather than failing the whole list
        }
    }
    return Results.Ok(new { entries = items });
}).RequireAuthorization();

api.MapPost("/journal", (HttpContext ctx, Db store, JournalRequest req) =>
{
    long uid = Session.UserId(ctx.User);
    byte[]? key = Session.DataKey(ctx.User);
    if (uid == 0 || key is null) return Results.Unauthorized();

    string text = (req.Text ?? "").Trim();
    if (text.Length == 0) return Results.BadRequest(new { error = "Write something first." });
    if (text.Length > 8000) return Results.BadRequest(new { error = "That note is too long (8,000 characters max)." });
    if (store.CountEntries(uid) >= 1000) return Results.BadRequest(new { error = "You have reached the limit of 1,000 notes." });

    string day = (req.Day ?? "");
    if (!dayPattern.IsMatch(day)) day = DateTime.UtcNow.ToString("yyyy-MM-dd");

    string json = JsonSerializer.Serialize(new { t = text, at = day });
    long id = store.InsertEntry(uid, Crypto.Encrypt(key, "entry:" + uid, json));
    return Results.Ok(new { id, text, at = day });
}).RequireAuthorization();

api.MapDelete("/journal/{id:long}", (HttpContext ctx, Db store, long id) =>
{
    long uid = Session.UserId(ctx.User);
    if (uid == 0) return Results.Unauthorized();
    return store.DeleteEntry(uid, id) ? Results.NoContent() : Results.NotFound();
}).RequireAuthorization();

app.Run();
