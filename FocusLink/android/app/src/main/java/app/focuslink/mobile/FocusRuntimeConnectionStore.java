package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class FocusRuntimeConnectionStore {
    private static final String PREFERENCES_NAME = "focus_runtime_connection_v1";
    private static final String KEY_ENDPOINT = "endpoint";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_DEVICE_ID = "deviceId";
    private static final String KEY_ALIAS = "focuslink_runtime_connection_v1";
    private static final int GCM_TAG_BITS = 128;
    private static long connectionGeneration = 0L;

    interface CurrentConnectionOperation<T> {
        T run();
    }

    static final class Connection {
        final String endpoint;
        final String accessToken;
        final String deviceId;
        final long generation;

        Connection(String endpoint, String accessToken, String deviceId) {
            this(endpoint, accessToken, deviceId, -1L);
        }

        private Connection(
            String endpoint,
            String accessToken,
            String deviceId,
            long generation
        ) {
            this.endpoint = validateEndpoint(endpoint);
            this.accessToken = validateAccessToken(accessToken);
            this.deviceId = validateDeviceId(deviceId);
            this.generation = generation;
        }
    }

    private FocusRuntimeConnectionStore() {}

    static synchronized void put(
        Context context,
        String endpoint,
        String accessToken,
        String deviceId
    ) {
        String normalizedEndpoint = validateEndpoint(endpoint);
        String validatedToken = validateAccessToken(accessToken);
        String validatedDeviceId = validateDeviceId(deviceId);
        boolean committed = preferences(context)
            .edit()
            .putString(KEY_ENDPOINT, normalizedEndpoint)
            .putString(KEY_TOKEN, encrypt(validatedToken))
            .putString(KEY_DEVICE_ID, validatedDeviceId)
            .commit();
        if (!committed) throw new IllegalStateException("unable to save cloud credential");
        connectionGeneration += 1L;
    }

    static synchronized Connection get(Context context) {
        SharedPreferences preferences = preferences(context);
        String endpoint = preferences.getString(KEY_ENDPOINT, null);
        String encryptedToken = preferences.getString(KEY_TOKEN, null);
        String deviceId = preferences.getString(KEY_DEVICE_ID, null);
        if (endpoint == null || encryptedToken == null || deviceId == null) return null;
        try {
            String normalizedEndpoint = validateEndpoint(endpoint);
            String token;
            if (encryptedToken.indexOf('.') < 0 && encryptedToken.length() > 0
                    && encryptedToken.length() <= 4096) {
                // Pre-Keystore builds stored the bearer directly.  Migrate in
                // place only after the encrypted replacement is durably
                // committed; never erase the sole copy on a failed migration.
                token = encryptedToken;
                boolean committed = preferences.edit()
                    .putString(KEY_TOKEN, encrypt(token))
                    .commit();
                if (!committed) throw new IllegalStateException("unable to migrate cloud credential");
                connectionGeneration += 1L;
            } else {
                token = decrypt(encryptedToken);
            }
            if (token.length() == 0 || token.length() > 4096) {
                throw new IllegalStateException("cloud credential is invalid");
            }
            return new Connection(normalizedEndpoint, token, deviceId, connectionGeneration);
        } catch (RuntimeException exception) {
            // Keep the unreadable record for explicit recovery/forensics.  A
            // transient Keystore failure must not silently delete endpoint,
            // device identity and the only wrapped token.
            return null;
        }
    }

    static synchronized void clear(Context context) {
        if (!preferences(context).edit().clear().commit()) {
            throw new IllegalStateException("unable to clear cloud credential");
        }
        connectionGeneration += 1L;
    }

    static synchronized boolean isCurrent(Context context, Connection expected) {
        if (expected == null || expected.generation < 0L) return false;
        Connection current = get(context);
        return current != null &&
            current.generation == expected.generation &&
            connectionGeneration == expected.generation &&
            current.endpoint.equals(expected.endpoint) &&
            current.accessToken.equals(expected.accessToken) &&
            current.deviceId.equals(expected.deviceId);
    }

    static synchronized <T> T runIfCurrent(
        Context context,
        Connection expected,
        CurrentConnectionOperation<T> operation
    ) {
        if (!isCurrent(context, expected)) return null;
        return operation.run();
    }

    private static String validateEndpoint(String raw) {
        if (raw == null) throw new IllegalArgumentException("endpoint is required");
        try {
            URI uri = URI.create(raw.trim());
            String host = uri.getHost();
            if (
                !"https".equals(uri.getScheme()) ||
                host == null ||
                uri.getUserInfo() != null ||
                uri.getQuery() != null ||
                uri.getFragment() != null
            ) {
                throw new IllegalArgumentException("endpoint must be HTTPS");
            }
            String value = uri.toString();
            String normalized = value.endsWith("/")
                ? value.substring(0, value.length() - 1)
                : value;
            if (!BuildConfig.CANONICAL_SYNC_ORIGIN.equals(normalized)) {
                throw new IllegalArgumentException("endpoint must be the canonical FocusLink origin");
            }
            return normalized;
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("endpoint is invalid", exception);
        }
    }

    private static String validateAccessToken(String accessToken) {
        if (accessToken == null || accessToken.isEmpty() || accessToken.length() > 4096) {
            throw new IllegalArgumentException("accessToken is invalid");
        }
        return accessToken;
    }

    private static String validateDeviceId(String deviceId) {
        if (deviceId == null || deviceId.isEmpty() || deviceId.length() > 200) {
            throw new IllegalArgumentException("deviceId is invalid");
        }
        return deviceId;
    }

    private static String encrypt(String plaintext) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
            Base64.encodeToString(encrypted, Base64.NO_WRAP);
        } catch (Exception exception) {
            throw new IllegalStateException("unable to protect cloud credential", exception);
        }
    }

    private static String decrypt(String value) {
        try {
            String[] parts = value.split("\\.", 2);
            if (parts.length != 2) throw new IllegalArgumentException("invalid credential");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            if (iv.length != 12 || encrypted.length < 16) {
                throw new IllegalArgumentException("invalid credential envelope");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception exception) {
            throw new IllegalStateException("unable to read cloud credential", exception);
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

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }
}
