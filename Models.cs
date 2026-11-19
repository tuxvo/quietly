namespace Quietly;

public sealed record AuthRequest(string? Username, string? Passphrase);

public sealed record JournalRequest(string? Text, string? Day);

public sealed record DeleteAccountRequest(string? Passphrase);
