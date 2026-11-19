using System.Text;
using System.Text.Json;

namespace Quietly.Ai;

public sealed record ChatTurn(string? Role, string? Text);

public sealed record ChatRequest(List<ChatTurn>? Messages);

/// <summary>Status is 200 (Text is the reply), 429 (daily cap reached), 503 (not set up), 502 (Google failed) or 504 (timed out).</summary>
public sealed record AskResult(int Status, string Text);

public sealed record GeminiSettings(string ApiKey, string Model, string Thinking, int MaxOutputTokens, int DailyLimit);

/// <summary>
/// Sends a short chat to Google's Gemini API and returns the answer.
///
/// The API key lives only on the server (user-secrets or an environment variable) and is never sent to the browser.
/// What is sent to Google: the system prompt and the messages typed into the chat. Nothing from the person's
/// saved answers, checklist or journal. Nothing is logged here: no message text, no replies, no addresses.
/// </summary>
public sealed class GeminiHelper
{
    public const int MaxTurns = 14;
    public const int MaxUserChars = 2000;
    public const int MaxModelChars = 8000;
    public const int MaxTotalChars = 24000;

    public const string Fallback =
        "I can’t answer that one here. If you’re in danger, call your local emergency number. " +
        "In the US you can also call or text 988 any time, or call the National Domestic Violence Hotline at 1-800-799-7233.";

    private readonly IHttpClientFactory _factory;
    private readonly ILogger _log;
    private readonly GeminiSettings _s;
    private readonly string _system;
    private readonly object _gate = new();
    private string _day = "";
    private int _used;

    public GeminiHelper(IHttpClientFactory factory, ILogger log, GeminiSettings settings, string systemPrompt)
    {
        _factory = factory;
        _log = log;
        _s = settings;
        _system = systemPrompt;
    }

    public bool Enabled => _s.ApiKey.Trim().Length > 0;

    /// <summary>
    /// Checks the shape of a chat request. Returns a message for the person if it is not acceptable, otherwise null.
    /// Two user turns in a row (after a failed reply) are merged, because the API wants turns to alternate.
    /// </summary>
    public static string? Validate(ChatRequest? req, out List<ChatTurn> turns)
    {
        turns = new List<ChatTurn>();
        if (req?.Messages is null || req.Messages.Count == 0) return "Write a question first.";
        if (req.Messages.Count > MaxTurns) return "This conversation is getting long. Start a new one.";

        int total = 0;
        foreach (ChatTurn? t in req.Messages)
        {
            if (t is null) return "Something went wrong with that message.";
            string role = t.Role ?? "";
            string text = (t.Text ?? "").Trim();
            if (role != "user" && role != "model") return "Something went wrong with that message.";
            if (text.Length == 0) return "Write a question first.";
            if (text.Length > (role == "user" ? MaxUserChars : MaxModelChars)) return "Messages can be up to 2,000 characters.";
            total += text.Length;

            if (turns.Count > 0 && turns[^1].Role == role)
            {
                turns[^1] = new ChatTurn(role, turns[^1].Text + "\n\n" + text);
            }
            else
            {
                turns.Add(new ChatTurn(role, text));
            }
        }

        if (total > MaxTotalChars) return "This conversation is getting long. Start a new one.";
        if (turns[0].Role != "user" || turns[^1].Role != "user") return "Write a question first.";
        return null;
    }

    // A simple daily ceiling, so the bill can't run away if the page is hammered.
    private bool TryTake()
    {
        string today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        lock (_gate)
        {
            if (_day != today)
            {
                _day = today;
                _used = 0;
            }
            if (_used >= _s.DailyLimit) return false;
            _used++;
            return true;
        }
    }

    public async Task<AskResult> AskAsync(List<ChatTurn> turns, CancellationToken ct)
    {
        if (!Enabled) return new AskResult(503, "");
        if (!TryTake()) return new AskResult(429, "");

        var gen = new Dictionary<string, object?> { ["maxOutputTokens"] = _s.MaxOutputTokens };
        // Thinking tokens count toward maxOutputTokens, so the limit above is generous. An empty setting leaves thinking at the model's default.
        if (_s.Thinking.Length > 0) gen["thinkingConfig"] = new { thinkingLevel = _s.Thinking };

        var body = new Dictionary<string, object?>
        {
            ["system_instruction"] = new { parts = new[] { new { text = _system } } },
            ["contents"] = turns.Select(t => new { role = t.Role, parts = new[] { new { text = t.Text } } }).ToList(),
            ["generationConfig"] = gen,
        };
        string json = JsonSerializer.Serialize(body);

        string url = "https://generativelanguage.googleapis.com/v1beta/models/" + Uri.EscapeDataString(_s.Model) + ":generateContent";
        using var msg = new HttpRequestMessage(HttpMethod.Post, url);
        msg.Headers.Add("x-goog-api-key", _s.ApiKey.Trim());
        msg.Content = new StringContent(json, Encoding.UTF8, "application/json");

        try
        {
            HttpClient client = _factory.CreateClient("gemini");
            using HttpResponseMessage res = await client.SendAsync(msg, ct);
            string text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                // Only the status codes are logged (for example NOT_FOUND = wrong model name, PERMISSION_DENIED = bad key).
                _log.LogWarning("Gemini returned HTTP {Status} ({Reason}). Check Gemini:ApiKey and Gemini:Model.", (int)res.StatusCode, ErrorStatus(text));
                return new AskResult(res.StatusCode == System.Net.HttpStatusCode.TooManyRequests ? 429 : 502, "");
            }
            return new AskResult(200, ExtractText(text));
        }
        catch (HttpRequestException)
        {
            _log.LogWarning("Could not reach the Gemini API.");
            return new AskResult(502, "");
        }
        catch (TaskCanceledException)
        {
            return new AskResult(504, "");
        }
    }

    private static string ErrorStatus(string json)
    {
        try
        {
            using JsonDocument doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("error", out JsonElement err) &&
                err.TryGetProperty("status", out JsonElement st) &&
                st.ValueKind == JsonValueKind.String)
            {
                return st.GetString() ?? "unknown";
            }
        }
        catch (JsonException)
        {
            // not JSON; fall through
        }
        return "unknown";
    }

    private static string ExtractText(string json)
    {
        try
        {
            using JsonDocument doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("candidates", out JsonElement cands) &&
                cands.ValueKind == JsonValueKind.Array && cands.GetArrayLength() > 0)
            {
                JsonElement first = cands[0];
                if (first.TryGetProperty("content", out JsonElement content) &&
                    content.TryGetProperty("parts", out JsonElement parts) &&
                    parts.ValueKind == JsonValueKind.Array)
                {
                    var sb = new StringBuilder();
                    foreach (JsonElement part in parts.EnumerateArray())
                    {
                        if (part.TryGetProperty("thought", out JsonElement thought) && thought.ValueKind == JsonValueKind.True) continue;
                        if (part.TryGetProperty("text", out JsonElement tx) && tx.ValueKind == JsonValueKind.String)
                        {
                            sb.Append(tx.GetString());
                        }
                    }
                    string answer = sb.ToString().Trim();
                    if (answer.Length > 0) return answer;
                }
            }
        }
        catch (JsonException)
        {
            // fall through to the safe default
        }
        // Blocked or empty (the model sometimes declines sensitive topics). Give something useful instead of nothing.
        return Fallback;
    }
}
