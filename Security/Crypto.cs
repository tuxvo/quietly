using System.Security.Cryptography;
using System.Text;

namespace Quietly.Security;

/// <summary>
/// Key handling in one place.
///
///   passphrase --PBKDF2-SHA256 (600,000 rounds, per-user random salt)--> master (32 bytes)
///   master --HMAC "auth"--> verifier   (stored in the database, only lets us check the passphrase)
///   master --HMAC "data"--> data key   (NEVER stored in the database; kept only inside the encrypted sign-in cookie)
///
/// Notes and progress are encrypted with AES-256-GCM using the data key. Someone who copies the database file
/// gets usernames, verifiers and ciphertext, but cannot read anyone's answers or notes without their passphrase.
/// </summary>
public static class Crypto
{
    public const int Iterations = 600_000;
    private const int NonceSize = 12;
    private const int TagSize = 16;

    public static byte[] Master(string passphrase, byte[] salt, int iterations)
    {
        // The browser already sends the passphrase in NFKC form (see wwwroot/js/api.js). This call is a second line of defence;
        // with InvariantGlobalization on, .NET treats text as already normalized, so the browser is what actually guarantees it.
        byte[] password = Encoding.UTF8.GetBytes(passphrase.Normalize(NormalizationForm.FormKC));
        return Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, 32);
    }

    public static byte[] Derive(byte[] master, string purpose)
    {
        return HMACSHA256.HashData(master, Encoding.UTF8.GetBytes("quietly/" + purpose));
    }

    public static bool SameBytes(byte[] a, byte[] b)
    {
        return CryptographicOperations.FixedTimeEquals(a, b);
    }

    /// <summary>Returns base64(nonce | tag | ciphertext). "aad" ties the blob to its owner and purpose.</summary>
    public static string Encrypt(byte[] key, string aad, string plaintext)
    {
        byte[] nonce = RandomNumberGenerator.GetBytes(NonceSize);
        byte[] plain = Encoding.UTF8.GetBytes(plaintext);
        byte[] cipher = new byte[plain.Length];
        byte[] tag = new byte[TagSize];

        using (var gcm = new AesGcm(key, TagSize))
        {
            gcm.Encrypt(nonce, plain, cipher, tag, Encoding.UTF8.GetBytes(aad));
        }

        byte[] all = new byte[NonceSize + TagSize + cipher.Length];
        Buffer.BlockCopy(nonce, 0, all, 0, NonceSize);
        Buffer.BlockCopy(tag, 0, all, NonceSize, TagSize);
        Buffer.BlockCopy(cipher, 0, all, NonceSize + TagSize, cipher.Length);
        return Convert.ToBase64String(all);
    }

    /// <summary>Returns null if the blob is damaged, was made for someone else, or the key is wrong.</summary>
    public static string? TryDecrypt(byte[] key, string aad, string blob)
    {
        try
        {
            byte[] all = Convert.FromBase64String(blob);
            if (all.Length < NonceSize + TagSize) return null;

            byte[] nonce = new byte[NonceSize];
            byte[] tag = new byte[TagSize];
            byte[] cipher = new byte[all.Length - NonceSize - TagSize];
            Buffer.BlockCopy(all, 0, nonce, 0, NonceSize);
            Buffer.BlockCopy(all, NonceSize, tag, 0, TagSize);
            Buffer.BlockCopy(all, NonceSize + TagSize, cipher, 0, cipher.Length);

            byte[] plain = new byte[cipher.Length];
            using (var gcm = new AesGcm(key, TagSize))
            {
                gcm.Decrypt(nonce, cipher, tag, plain, Encoding.UTF8.GetBytes(aad));
            }
            return Encoding.UTF8.GetString(plain);
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
