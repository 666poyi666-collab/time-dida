package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** App-private completed-ledger bridge. It never stores credentials or a sync cursor. */
final class FocusLedgerNativeOutboxStore {
    private static final String PREFERENCES_NAME = "focus_ledger_native_outbox_v1";
    private static final String KEY_RECORDS = "records";
    private static final String KEY_TERMINALS = "terminals";
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
    private static final Set<String> TERMINAL_KEYS = setOf(
        "bundleId",
        "deviceId",
        "errorCode",
        "recordedAtEpochMs"
    );
    private static final Set<String> TERMINAL_ERROR_CODES = setOf(
        "conflict_present",
        "rejected_operation"
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

    static final class TerminalStatus {
        final int count;
        final String lastErrorCode;

        TerminalStatus(int count, String lastErrorCode) {
            this.count = Math.max(0, count);
            this.lastErrorCode = lastErrorCode == null ? "" : lastErrorCode;
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
        clearTerminal(context, candidate.bundleId, candidate.deviceId);
        return true;
    }

    static synchronized List<Record> readForDevice(Context context, String expectedDeviceId) {
        return readForDevice(context, expectedDeviceId, false);
    }

    /**
     * Returns only records that are still marked terminal for the device's explicit foreground
     * recheck. Ordinary workers must always use {@link #readForDevice(Context, String)}.
     */
    static synchronized List<Record> readTerminalRecordsForDevice(
        Context context,
        String expectedDeviceId
    ) {
        return readForDevice(context, expectedDeviceId, true);
    }

    static synchronized int countForDevice(Context context, String expectedDeviceId) {
        return readForDevice(context, expectedDeviceId).size();
    }

    private static List<Record> readForDevice(
        Context context,
        String expectedDeviceId,
        boolean terminalOnly
    ) {
        String deviceId = requireId(expectedDeviceId, "deviceId");
        JSONArray records = readArray(context);
        Set<String> terminalBundleIds = terminalBundleIds(context, deviceId);
        List<Record> result = new ArrayList<>();
        for (int index = 0; index < records.length(); index++) {
            JSONObject value = records.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger outbox is invalid");
            String storedDeviceId = value.optString("deviceId", "");
            if (!deviceId.equals(storedDeviceId)) continue;
            Record record = validate(value, deviceId);
            if (terminalBundleIds.contains(record.bundleId) == terminalOnly) result.add(record);
        }
        return result;
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
        if (removed) {
            commit(context, next);
            clearTerminal(context, bundleId, deviceId);
        }
    }

    /**
     * Keep a server-terminal record durable without repeatedly delivering it.
     * The original record is intentionally retained for later explicit repair.
     */
    static synchronized void markTerminal(
        Context context,
        String bundleId,
        String deviceId,
        String errorCode,
        long recordedAtEpochMs
    ) {
        if (!TERMINAL_ERROR_CODES.contains(errorCode)) {
            throw new IllegalArgumentException("completed ledger terminal reason is invalid");
        }
        boolean exists = false;
        JSONArray records = readArray(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject value = records.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger outbox is invalid");
            Record record = validate(value, value.optString("deviceId", ""));
            if (bundleId.equals(record.bundleId) && deviceId.equals(record.deviceId)) {
                exists = true;
                break;
            }
        }
        if (!exists) throw new IllegalArgumentException("completed ledger terminal record is missing");

        // Capacity recovery is the only global cleanup path. It removes only markers with no
        // durable identity at all, including abandoned foreign-account remnants.
        JSONArray existing = pruneAllOrphanTerminals(context);
        JSONArray next = new JSONArray();
        for (int index = 0; index < existing.length(); index++) {
            JSONObject value = existing.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            if (bundleId.equals(terminal.bundleId) && deviceId.equals(terminal.deviceId)) continue;
            next.put(value);
        }
        if (next.length() >= MAX_RECORDS) {
            throw new IllegalStateException("completed ledger terminal state is full");
        }
        try {
            next.put(
                new JSONObject()
                    .put("bundleId", bundleId)
                    .put("deviceId", deviceId)
                    .put("errorCode", errorCode)
                    .put("recordedAtEpochMs", checkedTimestamp(recordedAtEpochMs))
            );
        } catch (JSONException exception) {
            throw new IllegalStateException("unable to persist completed ledger terminal state", exception);
        }
        commitTerminals(context, next);
    }

    /**
     * Prepares a foreground-only explicit recheck without making any terminal record eligible for
     * ordinary delivery. It removes stale markers for this device that no longer have a durable
     * outbox record, while retaining every foreign marker unchanged.
     */
    static synchronized int prepareExplicitRecheck(Context context, String expectedDeviceId) {
        String deviceId = requireId(expectedDeviceId, "deviceId");
        JSONArray existing = pruneOrphanTerminalsForDevice(context, deviceId);
        JSONArray next = new JSONArray();
        Set<String> retainedBundleIds = new HashSet<>();
        boolean changed = false;
        int recheckable = 0;
        for (int index = 0; index < existing.length(); index++) {
            JSONObject value = existing.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            if (!deviceId.equals(terminal.deviceId)) {
                next.put(value);
                continue;
            }
            if (
                retainedBundleIds.add(terminal.bundleId)
            ) {
                next.put(value);
                recheckable += 1;
            } else {
                // This device's orphan or duplicate cannot be delivered. Drop only this marker;
                // foreign account/device markers are never touched by this foreground action.
                changed = true;
            }
        }
        if (changed) commitTerminals(context, next);
        return recheckable;
    }

    static synchronized TerminalStatus terminalStatusForDevice(Context context, String deviceId) {
        String expectedDeviceId = requireId(deviceId, "deviceId");
        int count = 0;
        long latestAt = -1L;
        String latestCode = "";
        JSONArray terminals = pruneOrphanTerminalsForDevice(context, expectedDeviceId);
        for (int index = 0; index < terminals.length(); index++) {
            JSONObject value = terminals.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            if (!expectedDeviceId.equals(terminal.deviceId)) continue;
            count += 1;
            if (terminal.recordedAtEpochMs >= latestAt) {
                latestAt = terminal.recordedAtEpochMs;
                latestCode = terminal.errorCode;
            }
        }
        return new TerminalStatus(count, latestCode);
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

    private static JSONArray readTerminalArray(Context context) {
        String raw = preferences(context).getString(KEY_TERMINALS, "[]");
        try {
            if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
                throw new IllegalStateException("completed ledger terminal state is too large");
            }
            JSONArray values = new JSONArray(raw);
            if (values.length() > MAX_RECORDS) {
                throw new IllegalStateException("completed ledger terminal state is invalid");
            }
            for (int index = 0; index < values.length(); index++) {
                JSONObject value = values.optJSONObject(index);
                if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
                validateTerminal(value);
            }
            return values;
        } catch (JSONException exception) {
            throw new IllegalStateException("completed ledger terminal state is invalid", exception);
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

    private static void commitTerminals(Context context, JSONArray terminals) {
        String encoded = terminals.toString();
        if (encoded.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IllegalStateException("completed ledger terminal state is full");
        }
        boolean committed = preferences(context).edit().putString(KEY_TERMINALS, encoded).commit();
        if (!committed) throw new IllegalStateException("unable to persist completed ledger terminal state");
    }

    /**
     * Returns terminal markers with no corresponding durable outbox record removed. This is
     * intentionally global: an orphan cannot belong to any account, while a foreign marker with
     * a durable foreign record remains untouched. Callers already hold this store's monitor.
     */
    private static JSONArray pruneAllOrphanTerminals(Context context) {
        Set<String> durableIdentities = new HashSet<>();
        JSONArray records = readArray(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject value = records.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger outbox is invalid");
            String deviceId = value.optString("deviceId", "");
            Record record = validate(value, deviceId);
            durableIdentities.add(record.bundleId + "\u0000" + record.deviceId);
        }
        JSONArray existing = readTerminalArray(context);
        JSONArray next = new JSONArray();
        Set<String> retainedIdentities = new HashSet<>();
        boolean changed = false;
        for (int index = 0; index < existing.length(); index++) {
            JSONObject value = existing.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            String identity = terminal.bundleId + "\u0000" + terminal.deviceId;
            if (durableIdentities.contains(identity) && retainedIdentities.add(identity)) {
                next.put(value);
            } else {
                changed = true;
            }
        }
        if (changed) commitTerminals(context, next);
        return next;
    }

    /**
     * Device-scoped presentation cleanup. Refreshing A must never rewrite B's terminal sidecar,
     * even when B happens to contain an orphan left by an older build.
     */
    private static JSONArray pruneOrphanTerminalsForDevice(Context context, String expectedDeviceId) {
        String deviceId = requireId(expectedDeviceId, "deviceId");
        Set<String> durableBundleIds = new HashSet<>();
        JSONArray records = readArray(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject value = records.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger outbox is invalid");
            if (!deviceId.equals(value.optString("deviceId", ""))) continue;
            durableBundleIds.add(validate(value, deviceId).bundleId);
        }
        JSONArray existing = readTerminalArray(context);
        JSONArray next = new JSONArray();
        Set<String> retainedBundleIds = new HashSet<>();
        boolean changed = false;
        for (int index = 0; index < existing.length(); index++) {
            JSONObject value = existing.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            if (!deviceId.equals(terminal.deviceId)) {
                next.put(value);
            } else if (
                durableBundleIds.contains(terminal.bundleId) &&
                retainedBundleIds.add(terminal.bundleId)
            ) {
                next.put(value);
            } else {
                changed = true;
            }
        }
        if (changed) commitTerminals(context, next);
        return next;
    }

    private static void clearTerminal(Context context, String bundleId, String deviceId) {
        JSONArray existing = readTerminalArray(context);
        JSONArray next = new JSONArray();
        boolean removed = false;
        for (int index = 0; index < existing.length(); index++) {
            JSONObject value = existing.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            if (bundleId.equals(terminal.bundleId) && deviceId.equals(terminal.deviceId)) {
                removed = true;
            } else {
                next.put(value);
            }
        }
        if (removed) commitTerminals(context, next);
    }

    private static Set<String> terminalBundleIds(Context context, String deviceId) {
        Set<String> result = new HashSet<>();
        JSONArray terminals = readTerminalArray(context);
        for (int index = 0; index < terminals.length(); index++) {
            JSONObject value = terminals.optJSONObject(index);
            if (value == null) throw new IllegalStateException("completed ledger terminal state is invalid");
            TerminalRecord terminal = validateTerminal(value);
            if (deviceId.equals(terminal.deviceId)) result.add(terminal.bundleId);
        }
        return result;
    }

    private static final class TerminalRecord {
        final String bundleId;
        final String deviceId;
        final String errorCode;
        final long recordedAtEpochMs;

        TerminalRecord(String bundleId, String deviceId, String errorCode, long recordedAtEpochMs) {
            this.bundleId = bundleId;
            this.deviceId = deviceId;
            this.errorCode = errorCode;
            this.recordedAtEpochMs = recordedAtEpochMs;
        }
    }

    private static TerminalRecord validateTerminal(JSONObject value) {
        try {
            requireExactKeys(value, TERMINAL_KEYS);
            String bundleId = requireId(value.getString("bundleId"), "terminal bundleId");
            String deviceId = requireId(value.getString("deviceId"), "terminal deviceId");
            String errorCode = value.getString("errorCode");
            if (!TERMINAL_ERROR_CODES.contains(errorCode)) {
                throw new IllegalArgumentException("completed ledger terminal reason is invalid");
            }
            long recordedAtEpochMs = checkedTimestamp(value.getLong("recordedAtEpochMs"));
            return new TerminalRecord(bundleId, deviceId, errorCode, recordedAtEpochMs);
        } catch (JSONException exception) {
            throw new IllegalArgumentException("completed ledger terminal state is invalid", exception);
        }
    }

    private static long checkedTimestamp(long value) {
        if (value < 0L) throw new IllegalArgumentException("completed ledger terminal timestamp is invalid");
        return value;
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
                if (isForbiddenKey(key)) {
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

    static boolean isForbiddenKey(String key) {
        return FORBIDDEN_KEYS.contains(key.toLowerCase(Locale.ROOT));
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
