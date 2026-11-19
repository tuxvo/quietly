-- Quietly database schema (SQLite).
--
-- Privacy design: the database never holds a person's answers, progress, or notes in readable form.
-- Users      : a made-up username, a random salt, and a verifier (not the passphrase, not a reversible hash).
-- UserState  : ONE encrypted blob per user (who the guide is about, checklist progress, reasons, contact log).
-- JournalEntries : one encrypted blob per note.
-- The encryption key is derived from the user's passphrase at sign-in and is never stored in the database.

CREATE TABLE IF NOT EXISTS Users (
    Id            INTEGER PRIMARY KEY AUTOINCREMENT,
    Username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    Salt          BLOB    NOT NULL,
    Iterations    INTEGER NOT NULL,
    Verifier      BLOB    NOT NULL,
    CreatedDay    TEXT    NOT NULL,                 -- yyyy-MM-dd only, no time of day
    FailedLogins  INTEGER NOT NULL DEFAULT 0,
    LockedUntil   INTEGER NOT NULL DEFAULT 0        -- unix seconds
);

CREATE TABLE IF NOT EXISTS UserState (
    UserId  INTEGER PRIMARY KEY REFERENCES Users(Id) ON DELETE CASCADE,
    Blob    TEXT    NOT NULL                        -- base64(nonce | tag | AES-256-GCM ciphertext of a JSON object)
);

CREATE TABLE IF NOT EXISTS JournalEntries (
    Id      INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId  INTEGER NOT NULL REFERENCES Users(Id) ON DELETE CASCADE,
    Blob    TEXT    NOT NULL                        -- same format; holds the note text and its date
);

CREATE INDEX IF NOT EXISTS IX_JournalEntries_User ON JournalEntries(UserId, Id);
