using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Quietly.Data;

namespace Quietly.Security;

public enum LoginResult { Ok, Invalid, Locked }

public sealed record VerifyOutcome(LoginResult Result, UserRow? User, byte[]? DataKey);

public static class Accounts
{
    // Used so that "unknown username" takes as long as "wrong passphrase" (no username guessing by timing).
    private static readonly byte[] DummySalt = new byte[16];

    public static string NormalizeName(string? username)
    {
        return (username ?? "").Trim().ToLowerInvariant();
    }

    public static VerifyOutcome Verify(Db db, string? username, string? passphrase)
    {
        string name = NormalizeName(username);
        string pass = passphrase ?? "";
        if (pass.Length == 0 || pass.Length > 200)
        {
            return new VerifyOutcome(LoginResult.Invalid, null, null);
        }

        // Real usernames are 3 to 32 characters, so anything longer can't exist and is never looked up.
        UserRow? user = (name.Length == 0 || name.Length > 32) ? null : db.FindUser(name);
        if (user is null)
        {
            Crypto.Master(pass, DummySalt, Crypto.Iterations);
            return new VerifyOutcome(LoginResult.Invalid, null, null);
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (user.LockedUntil > now)
        {
            return new VerifyOutcome(LoginResult.Locked, user, null);
        }

        byte[] master = Crypto.Master(pass, user.Salt, user.Iterations);
        if (!Crypto.SameBytes(Crypto.Derive(master, "auth"), user.Verifier))
        {
            db.RecordFailure(user.Id, now + 300);   // five wrong tries in a row = five-minute pause
            return new VerifyOutcome(LoginResult.Invalid, user, null);
        }

        db.ClearFailures(user.Id);
        return new VerifyOutcome(LoginResult.Ok, user, Crypto.Derive(master, "data"));
    }
}

/// <summary>Reads and writes the sign-in cookie. The data key lives only inside this encrypted cookie.</summary>
public static class Session
{
    public static long UserId(ClaimsPrincipal user)
    {
        string? raw = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return long.TryParse(raw, out long id) ? id : 0;
    }

    public static byte[]? DataKey(ClaimsPrincipal user)
    {
        string? raw = user.FindFirstValue("dk");
        if (raw is null) return null;
        try
        {
            return Convert.FromBase64String(raw);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public static Task SignIn(HttpContext ctx, long id, string name, byte[] dataKey)
    {
        var identity = new ClaimsIdentity(
            new[]
            {
                new Claim(ClaimTypes.NameIdentifier, id.ToString()),
                new Claim(ClaimTypes.Name, name),
                new Claim("dk", Convert.ToBase64String(dataKey)),
            },
            CookieAuthenticationDefaults.AuthenticationScheme);

        // IsPersistent = false: a session cookie that disappears when the browser closes.
        return ctx.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = false });
    }
}
