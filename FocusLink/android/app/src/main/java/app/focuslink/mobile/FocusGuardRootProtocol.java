package app.focuslink.mobile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Pure Java implementation of the Focus Guard root/recovery contract. */
final class FocusGuardRootProtocol {
    static final int ROOT_BYTES = 32;
    static final int RECOVERY_SECRET_BYTES = 32;
    static final int NONCE_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Set<String> ENVELOPE_KEYS = new HashSet<>(Arrays.asList(
        "aadHash", "accountPublicId", "algorithm", "ciphertext", "createdAt",
        "fromGeneration", "generation", "kdf", "nonce", "product", "purpose", "version"
    ));

    static final class RootMaterial {
        final String accountPublicId;
        final int generation;
        final String keyId;
        final long createdAt;
        final byte[] rootKey;

        RootMaterial(String accountPublicId, int generation, String keyId, long createdAt, byte[] rootKey) {
            this.accountPublicId = accountPublicId;
            this.generation = generation;
            this.keyId = keyId;
            this.createdAt = createdAt;
            this.rootKey = copyExact(rootKey, ROOT_BYTES, "account root");
        }
    }

    static final class ProvisioningResult {
        final RootMaterial material;
        final byte[] recoverySecret;
        final String recoveryEnvelope;

        ProvisioningResult(RootMaterial material, byte[] recoverySecret, String recoveryEnvelope) {
            this.material = material;
            this.recoverySecret = copyExact(recoverySecret, RECOVERY_SECRET_BYTES, "recovery secret");
            this.recoveryEnvelope = recoveryEnvelope;
        }
    }

    static final class RotationResult {
        final RootMaterial material;
        final String recoveryEnvelope;
        final String rotationEnvelope;

        RotationResult(RootMaterial material, String recoveryEnvelope, String rotationEnvelope) {
            this.material = material;
            this.recoveryEnvelope = recoveryEnvelope;
            this.rotationEnvelope = rotationEnvelope;
        }
    }

    private FocusGuardRootProtocol() {}

    static ProvisioningResult provision(String accountPublicId, int generation) {
        return provision(
            accountPublicId,
            generation,
            randomBytes(ROOT_BYTES),
            randomBytes(RECOVERY_SECRET_BYTES),
            randomBytes(NONCE_BYTES),
            System.currentTimeMillis()
        );
    }

    static ProvisioningResult provision(
        String accountPublicId,
        int generation,
        byte[] rootKey,
        byte[] recoverySecret,
        byte[] nonce,
        long createdAt
    ) {
        validateAccount(accountPublicId);
        validateGeneration(generation);
        validateTimestamp(createdAt);
        RootMaterial material = material(accountPublicId, generation, createdAt, rootKey);
        String envelope = wrapRecovery(material, recoverySecret, nonce);
        return new ProvisioningResult(material, recoverySecret, envelope);
    }

    static RotationResult rotate(
        RootMaterial current,
        byte[] recoverySecret,
        byte[] nextRootKey,
        byte[] rotationNonce,
        byte[] recoveryNonce,
        long createdAt
    ) {
        validateMaterial(current);
        copyExact(recoverySecret, RECOVERY_SECRET_BYTES, "recovery secret");
        validateTimestamp(createdAt);
        byte[] nextKey = copyExact(nextRootKey, ROOT_BYTES, "next account root");
        if (constantTimeEquals(current.rootKey, nextKey)) throw verificationError();
        RootMaterial next = material(
            current.accountPublicId,
            checkedNextGeneration(current.generation),
            createdAt,
            nextKey
        );
        String rotation = wrapRoot(
            "rotation",
            "direct-root",
            current.rootKey,
            next,
            current.generation,
            rotationNonce
        );
        String recovery = wrapRecovery(next, recoverySecret, recoveryNonce);
        return new RotationResult(next, recovery, rotation);
    }

    static String wrapRecovery(RootMaterial material, byte[] recoverySecret, byte[] nonce) {
        validateMaterial(material);
        byte[] secret = copyExact(recoverySecret, RECOVERY_SECRET_BYTES, "recovery secret");
        byte[] wrappingKey = deriveRecoveryKey(secret, material.accountPublicId, material.generation);
        return wrapRoot("recovery", "HKDF-SHA256", wrappingKey, material, null, nonce);
    }

    static RootMaterial recover(
        String envelopeJson,
        byte[] recoverySecret,
        String expectedAccountPublicId,
        int minimumGeneration
    ) {
        Envelope envelope = parseEnvelope(envelopeJson, "recovery");
        validateAccount(expectedAccountPublicId);
        validateGeneration(minimumGeneration);
        if (!envelope.accountPublicId.equals(expectedAccountPublicId) || envelope.generation < minimumGeneration) {
            throw verificationError();
        }
        byte[] secret = copyExact(recoverySecret, RECOVERY_SECRET_BYTES, "recovery secret");
        byte[] wrappingKey = deriveRecoveryKey(secret, envelope.accountPublicId, envelope.generation);
        return unwrapRoot(envelope, wrappingKey);
    }

    static RootMaterial applyRotation(String envelopeJson, RootMaterial current) {
        Envelope envelope = parseEnvelope(envelopeJson, "rotation");
        validateMaterial(current);
        if (
            !envelope.accountPublicId.equals(current.accountPublicId) ||
            envelope.fromGeneration != current.generation ||
            envelope.generation != current.generation + 1
        ) {
            throw verificationError();
        }
        RootMaterial next = unwrapRoot(envelope, current.rootKey);
        if (constantTimeEquals(current.rootKey, next.rootKey)) throw verificationError();
        return next;
    }

    static String encodeMaterial(RootMaterial material) {
        validateMaterial(material);
        try {
            return new JSONObject()
                .put("accountPublicId", material.accountPublicId)
                .put("generation", material.generation)
                .put("keyId", material.keyId)
                .put("createdAt", material.createdAt)
                .put("rootKey", encode(material.rootKey))
                .toString();
        } catch (JSONException exception) {
            throw verificationError();
        }
    }

    static RootMaterial decodeMaterial(String json) {
        try {
            JSONObject value = new JSONObject(json);
            JSONArray names = value.names();
            Set<String> keys = new HashSet<>();
            if (names == null || names.length() != 5) throw verificationError();
            for (int index = 0; index < names.length(); index++) keys.add(names.getString(index));
            if (!keys.equals(new HashSet<>(Arrays.asList("accountPublicId", "createdAt", "generation", "keyId", "rootKey")))) {
                throw verificationError();
            }
            RootMaterial material = new RootMaterial(
                value.getString("accountPublicId"),
                readIntStrict(value, "generation"),
                value.getString("keyId"),
                readLongStrict(value, "createdAt"),
                decode(value.getString("rootKey"), ROOT_BYTES, ROOT_BYTES)
            );
            validateMaterial(material);
            return material;
        } catch (Exception exception) {
            throw verificationError();
        }
    }

    private static String wrapRoot(
        String purpose,
        String kdf,
        byte[] wrappingKey,
        RootMaterial material,
        Integer fromGeneration,
        byte[] nonce
    ) {
        try {
            byte[] key = copyExact(wrappingKey, ROOT_BYTES, "wrapping key");
            byte[] iv = copyExact(nonce, NONCE_BYTES, "nonce");
            String aad = rootAad(purpose, material.accountPublicId, fromGeneration, material.generation, material.createdAt);
            byte[] ciphertext = encrypt(key, iv, aad.getBytes(StandardCharsets.UTF_8), material.rootKey);
            JSONObject value = new JSONObject()
                .put("version", 1)
                .put("algorithm", "A256GCM")
                .put("kdf", kdf)
                .put("product", "focus-guard-root")
                .put("purpose", purpose)
                .put("accountPublicId", material.accountPublicId)
                .put("fromGeneration", fromGeneration == null ? JSONObject.NULL : fromGeneration)
                .put("generation", material.generation)
                .put("nonce", encode(iv))
                .put("ciphertext", encode(ciphertext))
                .put("aadHash", hex(sha256(aad.getBytes(StandardCharsets.UTF_8))))
                .put("createdAt", material.createdAt);
            return value.toString();
        } catch (Exception exception) {
            throw verificationError();
        }
    }

    private static RootMaterial unwrapRoot(Envelope envelope, byte[] wrappingKey) {
        try {
            byte[] aad = rootAad(
                envelope.purpose,
                envelope.accountPublicId,
                envelope.fromGeneration,
                envelope.generation,
                envelope.createdAt
            ).getBytes(StandardCharsets.UTF_8);
            if (!constantTimeEquals(hex(sha256(aad)), envelope.aadHash)) throw verificationError();
            byte[] plaintext = decrypt(
                copyExact(wrappingKey, ROOT_BYTES, "wrapping key"),
                envelope.nonce,
                aad,
                envelope.ciphertext
            );
            return material(envelope.accountPublicId, envelope.generation, envelope.createdAt, plaintext);
        } catch (Exception exception) {
            throw verificationError();
        }
    }

    private static Envelope parseEnvelope(String json, String expectedPurpose) {
        try {
            JSONObject value = new JSONObject(json);
            JSONArray names = value.names();
            if (names == null || names.length() != ENVELOPE_KEYS.size()) throw verificationError();
            Set<String> keys = new HashSet<>();
            for (int index = 0; index < names.length(); index++) keys.add(names.getString(index));
            if (!keys.equals(ENVELOPE_KEYS)) throw verificationError();
            int version = readIntStrict(value, "version");
            String algorithm = value.getString("algorithm");
            String kdf = value.getString("kdf");
            String product = value.getString("product");
            String purpose = value.getString("purpose");
            String account = value.getString("accountPublicId");
            Object from = value.get("fromGeneration");
            Integer fromGeneration = from == JSONObject.NULL ? null : readIntStrict(value, "fromGeneration");
            int generation = readIntStrict(value, "generation");
            byte[] nonce = decode(value.getString("nonce"), NONCE_BYTES, NONCE_BYTES);
            byte[] ciphertext = decode(value.getString("ciphertext"), 48, 48);
            String aadHash = value.getString("aadHash");
            long createdAt = readLongStrict(value, "createdAt");
            if (
                version != 1 ||
                !"A256GCM".equals(algorithm) ||
                !"focus-guard-root".equals(product) ||
                !expectedPurpose.equals(purpose) ||
                ("recovery".equals(purpose) && (!"HKDF-SHA256".equals(kdf) || fromGeneration != null)) ||
                ("rotation".equals(purpose) && (!"direct-root".equals(kdf) || fromGeneration == null))
            ) throw verificationError();
            validateAccount(account);
            validateGeneration(generation);
            if (fromGeneration != null && (fromGeneration < 1 || fromGeneration + 1 != generation)) throw verificationError();
            if (!aadHash.matches("[0-9a-f]{64}")) throw verificationError();
            validateTimestamp(createdAt);
            return new Envelope(purpose, account, fromGeneration, generation, nonce, ciphertext, aadHash, createdAt);
        } catch (Exception exception) {
            throw verificationError();
        }
    }

    private static final class Envelope {
        final String purpose;
        final String accountPublicId;
        final Integer fromGeneration;
        final int generation;
        final byte[] nonce;
        final byte[] ciphertext;
        final String aadHash;
        final long createdAt;

        Envelope(String purpose, String accountPublicId, Integer fromGeneration, int generation,
            byte[] nonce, byte[] ciphertext, String aadHash, long createdAt) {
            this.purpose = purpose;
            this.accountPublicId = accountPublicId;
            this.fromGeneration = fromGeneration;
            this.generation = generation;
            this.nonce = nonce;
            this.ciphertext = ciphertext;
            this.aadHash = aadHash;
            this.createdAt = createdAt;
        }
    }

    private static RootMaterial material(String account, int generation, long createdAt, byte[] rootKey) {
        byte[] root = copyExact(rootKey, ROOT_BYTES, "account root");
        validateAccount(account);
        validateGeneration(generation);
        validateTimestamp(createdAt);
        return new RootMaterial(account, generation, hex(sha256(root)), createdAt, root);
    }

    private static int readIntStrict(JSONObject value, String key) throws JSONException {
        Object raw = value.get(key);
        if (!(raw instanceof Number) || raw instanceof Float || raw instanceof Double) throw verificationError();
        long candidate = ((Number) raw).longValue();
        if (candidate < Integer.MIN_VALUE || candidate > Integer.MAX_VALUE || ((Number) raw).doubleValue() != candidate) {
            throw verificationError();
        }
        return (int) candidate;
    }

    private static long readLongStrict(JSONObject value, String key) throws JSONException {
        Object raw = value.get(key);
        if (!(raw instanceof Number) || raw instanceof Float || raw instanceof Double) throw verificationError();
        long candidate = ((Number) raw).longValue();
        if (candidate <= 0L || candidate > 9007199254740991L || ((Number) raw).doubleValue() != candidate) {
            throw verificationError();
        }
        return candidate;
    }

    private static void validateMaterial(RootMaterial material) {
        if (material == null) throw verificationError();
        RootMaterial checked = material(material.accountPublicId, material.generation, material.createdAt, material.rootKey);
        if (!constantTimeEquals(checked.keyId, material.keyId)) throw verificationError();
    }

    private static byte[] deriveRecoveryKey(byte[] secret, String account, int generation) {
        try {
            byte[] salt = sha256(("focus-guard-root-recovery-salt-v1|" + account).getBytes(StandardCharsets.UTF_8));
            byte[] info = ("focus-guard-root|recovery|" + account + "|" + generation).getBytes(StandardCharsets.UTF_8);
            return hkdf(secret, salt, info, ROOT_BYTES);
        } catch (GeneralSecurityException exception) {
            throw verificationError();
        }
    }

    private static byte[] hkdf(byte[] input, byte[] salt, byte[] info, int length) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(input);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        byte[] output = new byte[length];
        byte[] previous = new byte[0];
        int offset = 0;
        int counter = 1;
        while (offset < length) {
            mac.reset();
            mac.update(previous);
            mac.update(info);
            mac.update((byte) counter++);
            previous = mac.doFinal();
            int copy = Math.min(previous.length, length - offset);
            System.arraycopy(previous, 0, output, offset, copy);
            offset += copy;
        }
        return output;
    }

    private static byte[] encrypt(byte[] key, byte[] nonce, byte[] aad, byte[] plaintext) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, nonce));
        cipher.updateAAD(aad);
        return cipher.doFinal(plaintext);
    }

    private static byte[] decrypt(byte[] key, byte[] nonce, byte[] aad, byte[] ciphertext) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, nonce));
        cipher.updateAAD(aad);
        return cipher.doFinal(ciphertext);
    }

    private static String rootAad(String purpose, String account, Integer fromGeneration, int generation, long createdAt) {
        return "focus-guard-root|" + purpose + "|" + account + "|" +
            (fromGeneration == null ? "none" : fromGeneration) + "|" + generation + "|" + createdAt;
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (GeneralSecurityException exception) {
            throw verificationError();
        }
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static byte[] copyExact(byte[] value, int length, String label) {
        if (value == null || value.length != length) throw new IllegalArgumentException("Focus Guard " + label + " must be " + length + " bytes");
        return Arrays.copyOf(value, value.length);
    }

    private static byte[] decode(String value, int minimum, int maximum) {
        try {
            if (value == null || !value.matches("[A-Za-z0-9_-]+")) throw verificationError();
            byte[] bytes = decodeBase64Url(value);
            if (bytes.length < minimum || bytes.length > maximum || !value.equals(encode(bytes))) throw verificationError();
            return bytes;
        } catch (Exception exception) {
            throw verificationError();
        }
    }

    private static String encode(byte[] value) {
        final char[] alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();
        StringBuilder result = new StringBuilder((value.length * 4 + 2) / 3);
        for (int index = 0; index < value.length; index += 3) {
            int first = value[index] & 0xff;
            int second = index + 1 < value.length ? value[index + 1] & 0xff : 0;
            int third = index + 2 < value.length ? value[index + 2] & 0xff : 0;
            result.append(alphabet[first >>> 2]);
            result.append(alphabet[((first & 0x03) << 4) | (second >>> 4)]);
            if (index + 1 < value.length) result.append(alphabet[((second & 0x0f) << 2) | (third >>> 6)]);
            if (index + 2 < value.length) result.append(alphabet[third & 0x3f]);
        }
        return result.toString();
    }

    private static byte[] decodeBase64Url(String value) {
        if ((value.length() & 3) == 1) throw verificationError();
        ByteArrayOutputStream result = new ByteArrayOutputStream(value.length() * 3 / 4);
        int accumulator = 0;
        int bits = 0;
        for (int index = 0; index < value.length(); index++) {
            char item = value.charAt(index);
            int digit = item >= 'A' && item <= 'Z' ? item - 'A' :
                item >= 'a' && item <= 'z' ? item - 'a' + 26 :
                item >= '0' && item <= '9' ? item - '0' + 52 :
                item == '-' ? 62 : item == '_' ? 63 : -1;
            if (digit < 0) throw verificationError();
            accumulator = (accumulator << 6) | digit;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                result.write((accumulator >>> bits) & 0xff);
            }
        }
        if (bits >= 6 || (bits > 0 && (accumulator & ((1 << bits) - 1)) != 0)) throw verificationError();
        return result.toByteArray();
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item & 0xff));
        return result.toString();
    }

    private static boolean constantTimeEquals(String left, String right) {
        if (left == null || right == null || left.length() != right.length()) return false;
        int difference = 0;
        for (int index = 0; index < left.length(); index++) difference |= left.charAt(index) ^ right.charAt(index);
        return difference == 0;
    }

    private static boolean constantTimeEquals(byte[] left, byte[] right) {
        if (left == null || right == null || left.length != right.length) return false;
        int difference = 0;
        for (int index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
        return difference == 0;
    }

    private static void validateAccount(String value) {
        if (value == null || !value.matches("[A-Za-z0-9-]{6,80}")) throw verificationError();
    }

    private static void validateGeneration(int value) {
        if (value < 1) throw verificationError();
    }

    private static int checkedNextGeneration(int value) {
        if (value < 1 || value == Integer.MAX_VALUE) throw verificationError();
        return value + 1;
    }

    private static void validateTimestamp(long value) {
        if (value <= 0) throw verificationError();
    }

    private static IllegalStateException verificationError() {
        return new IllegalStateException("Focus Guard root envelope verification failed");
    }
}
