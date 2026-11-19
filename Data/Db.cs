using Microsoft.Data.Sqlite;

namespace Quietly.Data;

public sealed record UserRow(long Id, string Username, byte[] Salt, int Iterations, byte[] Verifier, int FailedLogins, long LockedUntil);

public sealed record EntryRow(long Id, string Blob);

/// <summary>Every SQL statement the app runs. Kept as plain constants so they are easy to read and review.</summary>
public static class Sql
{
    public const string InsertUser = "INSERT INTO Users (Username, Salt, Iterations, Verifier, CreatedDay) VALUES ($name, $salt, $iter, $ver, $day) RETURNING Id";
    public const string FindUser = "SELECT Id, Username, Salt, Iterations, Verifier, FailedLogins, LockedUntil FROM Users WHERE Username = $name";
    public const string RecordFailure = "UPDATE Users SET FailedLogins = FailedLogins + 1, LockedUntil = CASE WHEN FailedLogins + 1 >= 5 THEN $until ELSE LockedUntil END WHERE Id = $id";
    public const string ClearFailures = "UPDATE Users SET FailedLogins = 0, LockedUntil = 0 WHERE Id = $id";
    public const string DeleteUser = "DELETE FROM Users WHERE Id = $id";
    public const string CountUsers = "SELECT COUNT(*) FROM Users";

    public const string GetState = "SELECT Blob FROM UserState WHERE UserId = $uid";
    public const string PutState = "INSERT INTO UserState (UserId, Blob) VALUES ($uid, $blob) ON CONFLICT(UserId) DO UPDATE SET Blob = excluded.Blob";

    public const string ListEntries = "SELECT Id, Blob FROM JournalEntries WHERE UserId = $uid ORDER BY Id DESC";
    public const string CountEntries = "SELECT COUNT(*) FROM JournalEntries WHERE UserId = $uid";
    public const string InsertEntry = "INSERT INTO JournalEntries (UserId, Blob) VALUES ($uid, $blob) RETURNING Id";
    public const string DeleteEntry = "DELETE FROM JournalEntries WHERE Id = $id AND UserId = $uid";
}

public sealed class Db
{
    private readonly string _connectionString;

    public Db(string path)
    {
        _connectionString = "Data Source=" + path;
    }

    /// <summary>Creates the database file and tables if they do not exist yet.</summary>
    public void Init(string schemaPath)
    {
        using var conn = Open();
        using (var wal = conn.CreateCommand())
        {
            wal.CommandText = "PRAGMA journal_mode = WAL";
            wal.ExecuteScalar();
        }
        using var cmd = conn.CreateCommand();
        cmd.CommandText = File.ReadAllText(schemaPath);
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var pragma = conn.CreateCommand();
        // foreign_keys makes "delete my account" remove everything that belongs to it.
        // secure_delete overwrites deleted data instead of leaving it in free pages.
        pragma.CommandText = "PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;";
        pragma.ExecuteNonQuery();
        return conn;
    }

    // ---- users ----

    /// <summary>Returns the new user's id, or throws SqliteException (error 19) if the username is taken.</summary>
    public long CreateUser(string username, byte[] salt, int iterations, byte[] verifier)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.InsertUser;
        cmd.Parameters.AddWithValue("$name", username);
        cmd.Parameters.AddWithValue("$salt", salt);
        cmd.Parameters.AddWithValue("$iter", iterations);
        cmd.Parameters.AddWithValue("$ver", verifier);
        cmd.Parameters.AddWithValue("$day", DateTime.UtcNow.ToString("yyyy-MM-dd"));
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public long CountUsers()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.CountUsers;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public UserRow? FindUser(string username)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.FindUser;
        cmd.Parameters.AddWithValue("$name", username);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new UserRow(
            r.GetInt64(0),
            r.GetString(1),
            (byte[])r["Salt"],
            r.GetInt32(3),
            (byte[])r["Verifier"],
            r.GetInt32(5),
            r.GetInt64(6));
    }

    public void RecordFailure(long id, long lockUntilUnix)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.RecordFailure;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$until", lockUntilUnix);
        cmd.ExecuteNonQuery();
    }

    public void ClearFailures(long id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.ClearFailures;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void DeleteUser(long id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.DeleteUser;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    // ---- encrypted state ----

    public string? GetState(long userId)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.GetState;
        cmd.Parameters.AddWithValue("$uid", userId);
        var value = cmd.ExecuteScalar();
        return value as string;
    }

    public void PutState(long userId, string blob)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.PutState;
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$blob", blob);
        cmd.ExecuteNonQuery();
    }

    // ---- encrypted journal ----

    public List<EntryRow> ListEntries(long userId)
    {
        var list = new List<EntryRow>();
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.ListEntries;
        cmd.Parameters.AddWithValue("$uid", userId);
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(new EntryRow(r.GetInt64(0), r.GetString(1)));
        return list;
    }

    public long CountEntries(long userId)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.CountEntries;
        cmd.Parameters.AddWithValue("$uid", userId);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public long InsertEntry(long userId, string blob)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.InsertEntry;
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$blob", blob);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public bool DeleteEntry(long userId, long entryId)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = Sql.DeleteEntry;
        cmd.Parameters.AddWithValue("$id", entryId);
        cmd.Parameters.AddWithValue("$uid", userId);
        return cmd.ExecuteNonQuery() > 0;
    }
}
