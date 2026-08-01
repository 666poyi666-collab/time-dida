package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** App-private completed-ledger bridge. It never stores credentials or a sync cursor. */
final class FocusLedgerNativeOutboxStore {
    private static final String PREFERENCES_NAME = "focus_ledger_native_outbox_v1";
    private static final String KEY_RECORDS = "records";
    private static final int MAX_RECORDS = 128;
    private static final int MAX_BYTES = 1024 * 1024;
    private static final Set<String> RECORD_KEYS = setOf(
        "schemaVersion",
        "bundleId",
        "deviceId",
        "mutations"
    );
    private static final Set<String> MUTATION_KEYS = setOf(
        "opId",
        "entityType",
        "entityId",
        "kind",
        "baseRevision",
        "baseFingerprint",
        "payload"
    );
    private static final Set<String> LEDGER_KEYS = setOf(
        "sessionId",
        "startedAt",
        "endedAt",
        "status",
        "activeElapsedMs",
        "pausedElapsedMs",
        "wallElapsedMs",
        "originDeviceId",
        "segments",
        "pauses"
    );
    private static final Set<String> METADATA_KEYS = setOf(
        "sessionId",
        "title",
        "note",
        "subject",
        "tags",
        "taskAssociation",
        "updatedAt",
        "updatedByDeviceId"
    );
    private static final Set<String> FORBIDDEN_KEYS = setOf(
        "accesstoken",
        "authorization",
        "cookie",
        "password",
        "secret",
        "token"
    );

    static final class Record {
        final String bundleId;
        final String deviceId;
        final JSONObject value;

        Record(String bundleId, String deviceId, JSONObject value) {
            this.bundleId = bundleId;
            this.deviceId = deviceId;
            this.value = value;
        }

        JSONArray mutations() throws JSONException {
            return value.getJSONArray("mutations");
        }
    }

    private FocusLedgerNativeOutboxStore() {}

    static synchronized boolean enqueue(Context context, JSONObject input, String expectedDeviceId) {
        Record candidate = validate(input, expectedDeviceId);
        JSONArray records = readArray(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject stored = records.optJSONObject(index);
            if (stored == null) throw new IllegalStateException("completed ledger outbox is invalid");
            Record existing = validate(stored, stored.optString("deviceId", ""));
            if (existing.bundleId.equals(candidate.bundleId)) {
                if (!existing.value.toString().equals(candidate.value.toString())) {
                    throw new IllegalArgumentException("completed ledger identity already exists");
                }
                return false;
            }
        }
        if (records.length() >= MAX_RECORDS) {
            throw new IllegalStateException("completed ledger outbox is full");
        }
        records.put(candidate.value);
        commit(context, records);
        return true;
    }

    static synchronized List<Record> readForDevice(Context context, String expectedDeviceId) {
        JSONArray records = readArray(context);
        List<Record> result = new ArrayList<>();
        for (int index = 0; index < records.length(); index++) {
            JSONObject value = records.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger outbox is invalid");
            String storedDeviceId = value.optString("deviceId", "");
            if (!expectedDeviceId.equals(storedDeviceId)) continue;
            result.add(validate(value, expectedDeviceId));
        }
        return result;
    }

    static synchronized int countForDevice(Context context, String expectedDeviceId) {
        return readForDevice(context, expectedDeviceId).size();
    }

    static synchronized void remove(Context context, String bundleId, String deviceId) {
        JSONArray records = readArray(context);
        JSONArray next = new JSONArray();
        boolean removed = false;
        for (int index = 0; index < records.length(); index++) {
            JSONObject value = records.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger outbox is invalid");
            if (
                bundleId.equals(value.optString("bundleId", "")) &&
                deviceId.equals(value.optString("deviceId", ""))
            ) {
                removed = true;
            } else {
                next.put(value);
            }
        }
        if (removed) commit(context, next);
    }

    private static Record validate(JSONObject input, String expectedDeviceId) {
        if (input == null) throw new IllegalArgumentException("completed ledger record is required");
        try {
            requireExactKeys(input, RECORD_KEYS);
            if (input.getInt("schemaVersion") != 1) {
                throw new IllegalArgumentException("completed ledger schema is invalid");
            }
            String bundleId = requireId(input.getString("bundleId"), "bundleId");
            String deviceId = requireId(input.getString("deviceId"), "deviceId");
            if (!deviceId.equals(expectedDeviceId)) {
                throw new IllegalArgumentException("completed ledger device does not match credential");
            }
            JSONArray mutations = input.getJSONArray("mutations");
            if (mutations.length() != 2) {
                throw new IllegalArgumentException("completed ledger mutations are invalid");
            }
            Set<String> types = new HashSet<>();
            for (int index = 0; index < mutations.length(); index++) {
                JSONObject mutation = mutations.getJSONObject(index);
                requireExactKeys(mutation, MUTATION_KEYS);
                requireId(mutation.getString("opId"), "opId");
                String entityType = mutation.getString("entityType");
                if (
                    !"focus_ledger_v2".equals(entityType) &&
                    !"focus_metadata_v2".equals(entityType)
                ) {
                    throw new IllegalArgumentException("completed ledger entity type is invalid");
                }
                if (!types.add(entityType)) {
                    throw new IllegalArgumentException("completed ledger entity type is duplicated");
                }
                if (!bundleId.equals(requireId(mutation.getString("entityId"), "entityId"))) {
                    throw new IllegalArgumentException("completed ledger entity does not match bundle");
                }
                if (!"put".equals(mutation.getString("kind"))) {
                    throw new IllegalArgumentException("completed ledger mutation kind is invalid");
                }
                if (mutation.getInt("baseRevision") != 0 || !mutation.isNull("baseFingerprint")) {
                    throw new IllegalArgumentException("completed ledger base is invalid");
                }
                JSONObject payload = mutation.getJSONObject("payload");
                requireExactKeys(
                    payload,
                    "focus_ledger_v2".equals(entityType) ? LEDGER_KEYS : METADATA_KEYS
                );
                if (!bundleId.equals(payload.getString("sessionId"))) {
                    throw new IllegalArgumentException("completed ledger payload identity is invalid");
                }
                rejectForbiddenKeys(payload);
            }
            JSONObject copy = new JSONObject(input.toString());
            if (copy.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES / 2) {
                throw new IllegalArgumentException("completed ledger record is too large");
            }
            return new Record(bundleId, deviceId, copy);
        } catch (JSONException exception) {
            throw new IllegalArgumentException("completed ledger record is invalid", exception);
        }
    }

    private static JSONArray readArray(Context context) {
        String raw = preferences(context).getString(KEY_RECORDS, "[]");
        try {
            if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
                throw new IllegalStateException("completed ledger outbox is too large");
            }
            JSONArray value = new JSONArray(raw);
            if (value.length() > MAX_RECORDS) {
                throw new IllegalStateException("completed ledger outbox is invalid");
            }
            return value;
        } catch (JSONException exception) {
            throw new IllegalStateException("completed ledger outbox is invalid", exception);
        }
    }

    private static void commit(Context context, JSONArray records) {
        String encoded = records.toString();
        if (encoded.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IllegalStateException("completed ledger outbox is full");
        }
        boolean committed = preferences(context).edit().putString(KEY_RECORDS, encoded).commit();
        if (!committed) throw new IllegalStateException("unable to persist completed ledger");
    }

    private static void requireExactKeys(JSONObject value, Set<String> expected) {
        Set<String> actual = new HashSet<>();
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) actual.add(keys.next());
        if (!actual.equals(expected)) {
            throw new IllegalArgumentException("completed ledger fields are invalid");
        }
    }

    private static void rejectForbiddenKeys(Object value) throws JSONException {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (FORBIDDEN_KEYS.contains(key.toLowerCase())) {
                    throw new IllegalArgumentException("completed ledger contains forbidden fields");
                }
                rejectForbiddenKeys(object.get(key));
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) {
                rejectForbiddenKeys(array.get(index));
            }
        }
    }

    private static String requireId(String value, String name) {
        if (value == null || value.isEmpty() || value.length() > 200) {
            throw new IllegalArgumentException(name + " is invalid");
        }
        return value;
    }

    private static Set<String> setOf(String... values) {
        Set<String> result = new HashSet<>();
        java.util.Collections.addAll(result, values);
        return java.util.Collections.unmodifiableSet(result);
    }

    private static SharedPreferences preferences(Context context) {
        return FocusRuntimePreferences.get(context, PREFERENCES_NAME);
    }
}
