package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android-only vault. Root bytes never enter WebView, Plugin, or ordinary preferences. */
final class FocusGuardRootStore {
    private static final String PREFERENCES_NAME = "focus_guard_root_v1";
    private static final String KEY_STATE = "state";
    private static final String KEY_ACCOUNT = "accountPublicId";
    private static final String KEY_GENERATION = "generation";
    private static final String KEY_KEY_ID = "keyId";
    private static final String KEY_UPDATED_AT = "updatedAt";
    private static final String KEY_MATERIAL = "encryptedMaterial";
    private static final String KEY_ALIAS = "focus_guard_root_v1";
    private static final int TAG_BITS = 128;

    enum Status {
        ABSENT,
        READY,
        RECOVERY_REQUIRED,
        LOST,
        REVOKED,
        CORRUPT,
        SECURE_STORAGE_UNAVAILABLE
    }

    static final class Snapshot {
        final Status status;
        final String accountPublicId;
        final int generation;
        final String keyId;
        final long updatedAt;

        Snapshot(Status status, String accountPublicId, int generation, String keyId, long updatedAt) {
            this.status = status;
            this.accountPublicId = accountPublicId;
            this.generation = generation;
            this.keyId = keyId;
            this.updatedAt = updatedAt;
        }
    }

    private FocusGuardRootStore() {}

    static synchronized Snapshot status(Context context, String accountPublicId) {
        SharedPreferences preferences = preferences(context);
        if (!preferences.contains(KEY_STATE)) return new Snapshot(Status.ABSENT, null, 0, null, 0L);
        try {
            Snapshot stored = readSnapshot(preferences);
            if (accountPublicId != null && !accountPublicId.equals(stored.accountPublicId)) {
                return new Snapshot(Status.ABSENT, null, 0, null, 0L);
            }
            if (stored.status != Status.READY) return stored;
            if (!hasKey()) return new Snapshot(Status.CORRUPT, stored.accountPublicId, stored.generation, stored.keyId, stored.updatedAt);
            decryptMaterial(preferences.getString(KEY_MATERIAL, null));
            return stored;
        } catch (SecureStorageUnavailableException exception) {
            return new Snapshot(Status.SECURE_STORAGE_UNAVAILABLE, null, 0, null, 0L);
        } catch (RuntimeException exception) {
            return new Snapshot(Status.CORRUPT, null, 0, null, 0L);
        }
    }

    static synchronized FocusGuardRootProtocol.RootMaterial load(Context context, String accountPublicId) {
        SharedPreferences preferences = preferences(context);
        if (!preferences.contains(KEY_STATE)) return null;
        Snapshot snapshot = readSnapshot(preferences);
        if (!snapshot.accountPublicId.equals(accountPublicId) || snapshot.status != Status.READY) return null;
        if (!hasKey()) throw new SecureStorageUnavailableException();
        FocusGuardRootProtocol.RootMaterial material = decryptMaterial(preferences.getString(KEY_MATERIAL, null));
        if (
            !material.accountPublicId.equals(snapshot.accountPublicId) ||
            material.generation != snapshot.generation ||
            !material.keyId.equals(snapshot.keyId)
        ) throw verificationError();
        return material;
    }

    static synchronized FocusGuardRootProtocol.ProvisioningResult provision(
        Context context,
        String accountPublicId,
        int generation
    ) {
        if (preferences(context).contains(KEY_STATE)) throw new IllegalStateException("Focus Guard root already exists");
        FocusGuardRootProtocol.ProvisioningResult result = FocusGuardRootProtocol.provision(accountPublicId, generation);
        persistMaterial(context, result.material);
        return result;
    }

    static synchronized FocusGuardRootProtocol.RootMaterial recover(
        Context context,
        String envelopeJson,
        byte[] recoverySecret,
        String expectedAccountPublicId,
        int minimumGeneration
    ) {
        SharedPreferences preferences = preferences(context);
        Snapshot existing = preferences.contains(KEY_STATE) ? readSnapshot(preferences) : null;
        if (existing != null && existing.status == Status.REVOKED) throw new IllegalStateException("Focus Guard root is revoked");
        if (existing != null && !existing.accountPublicId.equals(expectedAccountPublicId)) {
            throw new IllegalStateException("Focus Guard root belongs to another account");
        }
        // A READY snapshot whose Keystore alias disappeared is no longer usable.
        // Treat it like a consumed generation so an old recovery envelope cannot
        // resurrect the same root after the secure key was lost.
        int highWater = recoveryHighWater(existing, minimumGeneration);
        FocusGuardRootProtocol.RootMaterial material = FocusGuardRootProtocol.recover(
            envelopeJson, recoverySecret, expectedAccountPublicId, highWater
        );
        persistMaterial(context, material);
        return material;
    }

    static synchronized FocusGuardRootProtocol.RotationResult rotate(
        Context context,
        String accountPublicId,
        byte[] recoverySecret,
        byte[] nextRootKey,
        byte[] rotationNonce,
        byte[] recoveryNonce,
        long createdAt
    ) {
        FocusGuardRootProtocol.RootMaterial current = load(context, accountPublicId);
        if (current == null) throw new IllegalStateException("Focus Guard root is unavailable");
        FocusGuardRootProtocol.RotationResult result = FocusGuardRootProtocol.rotate(
            current, recoverySecret, nextRootKey, rotationNonce, recoveryNonce, createdAt
        );
        persistMaterial(context, result.material);
        return result;
    }

    static synchronized void markRecoveryRequired(Context context, String accountPublicId, int generation) {
        persistState(context, "recovery-required", accountPublicId, generation, null, null);
    }

    static synchronized void markLost(Context context, String accountPublicId, int generation) {
        persistState(context, "lost", accountPublicId, generation, null, null);
    }

    static synchronized void revoke(Context context, String accountPublicId, int generation) {
        persistState(context, "revoked", accountPublicId, generation, null, null);
    }

    private static void persistMaterial(Context context, FocusGuardRootProtocol.RootMaterial material) {
        if (!isKeystoreAvailable()) throw new SecureStorageUnavailableException();
        String encrypted = encryptMaterial(FocusGuardRootProtocol.encodeMaterial(material));
        persistState(context, "ready", material.accountPublicId, material.generation, material.keyId, encrypted);
        FocusGuardRootProtocol.RootMaterial readback = load(context, material.accountPublicId);
        if (readback == null || !readback.keyId.equals(material.keyId) || readback.generation != material.generation) {
            throw new IllegalStateException("Focus Guard root write readback failed");
        }
    }

    private static void persistState(
        Context context,
        String state,
        String accountPublicId,
        int generation,
        String keyId,
        String encryptedMaterial
    ) {
        if (accountPublicId == null || accountPublicId.isEmpty() || generation < 1) throw verificationError();
        SharedPreferences preferences = preferences(context);
        if (preferences.contains(KEY_STATE)) {
            Snapshot current = readSnapshot(preferences);
            if (!current.accountPublicId.equals(accountPublicId)) {
                throw new IllegalStateException("Focus Guard root belongs to another account");
            }
            if (generation < current.generation) {
                throw new IllegalStateException("Focus Guard root generation rollback rejected");
            }
            if (current.status == Status.REVOKED && !"revoked".equals(state)) {
                throw new IllegalStateException("Focus Guard root is revoked");
            }
        }
        boolean committed = preferences
            .edit()
            .putString(KEY_STATE, state)
            .putString(KEY_ACCOUNT, accountPublicId)
            .putInt(KEY_GENERATION, generation)
            .putString(KEY_KEY_ID, keyId)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .putString(KEY_MATERIAL, encryptedMaterial)
            .commit();
        if (!committed) throw new IllegalStateException("unable to persist Focus Guard root state");
    }

    private static Snapshot readSnapshot(SharedPreferences preferences) {
        String state = preferences.getString(KEY_STATE, null);
        String account = preferences.getString(KEY_ACCOUNT, null);
        int generation = preferences.getInt(KEY_GENERATION, 0);
        String keyId = preferences.getString(KEY_KEY_ID, null);
        long updatedAt = preferences.getLong(KEY_UPDATED_AT, 0L);
        String material = preferences.getString(KEY_MATERIAL, null);
        if (
            state == null || account == null || generation < 1 || updatedAt <= 0L ||
            !(state.equals("ready") || state.equals("recovery-required") || state.equals("lost") || state.equals("revoked"))
        ) throw verificationError();
        if (state.equals("ready") && (keyId == null || material == null)) throw verificationError();
        if (!state.equals("ready") && (keyId != null || material != null)) throw verificationError();
        Status status = state.equals("ready") ? Status.READY :
            state.equals("recovery-required") ? Status.RECOVERY_REQUIRED :
            state.equals("lost") ? Status.LOST : Status.REVOKED;
        return new Snapshot(status, account, generation, keyId, updatedAt);
    }

    private static String encryptMaterial(String plaintext) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return encode(cipher.getIV()) + "." + encode(encrypted);
        } catch (SecureStorageUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalStateException("unable to protect Focus Guard root", exception);
        }
    }

    private static FocusGuardRootProtocol.RootMaterial decryptMaterial(String value) {
        try {
            if (value == null) throw verificationError();
            String[] parts = value.split("\\.", 2);
            if (parts.length != 2) throw verificationError();
            byte[] iv = decode(parts[0]);
            byte[] ciphertext = decode(parts[1]);
            if (iv.length != 12 || ciphertext.length < 16) throw verificationError();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getExistingKey(), new GCMParameterSpec(TAG_BITS, iv));
            return FocusGuardRootProtocol.decodeMaterial(new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8));
        } catch (SecureStorageUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            throw verificationError();
        }
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        );
        return generator.generateKey();
    }

    private static SecretKey getExistingKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (!(existing instanceof SecretKey)) throw new SecureStorageUnavailableException();
        return (SecretKey) existing;
    }

    private static boolean hasKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            return keyStore.containsAlias(KEY_ALIAS);
        } catch (Exception exception) {
            throw new SecureStorageUnavailableException();
        }
    }

    private static boolean isKeystoreAvailable() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            return true;
        } catch (Exception exception) {
            return false;
        }
    }

    static int recoveryHighWater(Snapshot existing, int minimumGeneration) {
        if (minimumGeneration < 1) throw verificationError();
        int storedHighWater = existing == null
            ? 1
            : existing.status == Status.READY ? checkedNextGeneration(existing.generation) : existing.generation;
        return Math.max(minimumGeneration, storedHighWater);
    }

    private static int checkedNextGeneration(int generation) {
        if (generation < 1 || generation == Integer.MAX_VALUE) throw verificationError();
        return generation + 1;
    }

    private static String encode(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static byte[] decode(String value) {
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static IllegalStateException verificationError() {
        return new IllegalStateException("Focus Guard root storage verification failed");
    }

    private static final class SecureStorageUnavailableException extends IllegalStateException {
        SecureStorageUnavailableException() {
            super("Focus Guard secure storage unavailable");
        }
    }
}
