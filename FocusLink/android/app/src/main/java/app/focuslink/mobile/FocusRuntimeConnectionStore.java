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
    private static final String KEY_LOOPBACK_MIGRATED = "loopback18787Migrated";
    private static final String KEY_ALIAS = "focuslink_runtime_connection_v1";
    private static final String LEGACY_LOOPBACK_ENDPOINT = "http://127.0.0.1:8787";
    private static final String CURRENT_LOOPBACK_ENDPOINT = "http://127.0.0.1:18787";
    private static final int GCM_TAG_BITS = 128;

    static final class Connection {
        final String endpoint;
        final String accessToken;
        final String deviceId;

        Connection(String endpoint, String accessToken, String deviceId) {
            this.endpoint = endpoint;
            this.accessToken = accessToken;
            this.deviceId = deviceId;
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
        if (accessToken == null || accessToken.isEmpty() || accessToken.length() > 4096) {
            throw new IllegalArgumentException("accessToken is invalid");
        }
        if (deviceId == null || deviceId.isEmpty() || deviceId.length() > 200) {
            throw new IllegalArgumentException("deviceId is invalid");
        }
        boolean committed = preferences(context)
            .edit()
            .putString(KEY_ENDPOINT, normalizedEndpoint)
            .putString(KEY_TOKEN, encrypt(accessToken))
            .putString(KEY_DEVICE_ID, deviceId)
            .putBoolean(KEY_LOOPBACK_MIGRATED, true)
            .commit();
        if (!committed) throw new IllegalStateException("unable to save cloud credential");
    }

    static synchronized Connection get(Context context) {
        SharedPreferences preferences = preferences(context);
        String endpoint = preferences.getString(KEY_ENDPOINT, null);
        String encryptedToken = preferences.getString(KEY_TOKEN, null);
        String deviceId = preferences.getString(KEY_DEVICE_ID, null);
        if (endpoint == null || encryptedToken == null || deviceId == null) return null;
        try {
            String normalizedEndpoint = validateEndpoint(endpoint);
            if (!preferences.getBoolean(KEY_LOOPBACK_MIGRATED, false)) {
                normalizedEndpoint = migrateLegacyEndpoint(normalizedEndpoint);
                boolean committed = preferences
                    .edit()
                    .putString(KEY_ENDPOINT, normalizedEndpoint)
                    .putBoolean(KEY_LOOPBACK_MIGRATED, true)
                    .commit();
                if (!committed) throw new IllegalStateException("unable to migrate cloud endpoint");
            }
            return new Connection(normalizedEndpoint, decrypt(encryptedToken), deviceId);
        } catch (RuntimeException exception) {
            clear(context);
            return null;
        }
    }

    static synchronized void clear(Context context) {
        preferences(context).edit().clear().commit();
    }

    private static String validateEndpoint(String raw) {
        if (raw == null) throw new IllegalArgumentException("endpoint is required");
        try {
            URI uri = URI.create(raw.trim());
            String host = uri.getHost();
            boolean loopback = "localhost".equals(host) || "127.0.0.1".equals(host);
            boolean allowed = "https".equals(uri.getScheme()) ||
            ("http".equals(uri.getScheme()) && loopback);
            if (
                !allowed ||
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
            return normalized;
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("endpoint is invalid", exception);
        }
    }

    private static String migrateLegacyEndpoint(String endpoint) {
        return LEGACY_LOOPBACK_ENDPOINT.equals(endpoint)
            ? CURRENT_LOOPBACK_ENDPOINT
            : endpoint;
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
