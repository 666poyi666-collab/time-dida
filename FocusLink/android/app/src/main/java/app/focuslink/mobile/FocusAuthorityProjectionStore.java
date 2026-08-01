package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * App-private, credential-free cache for the read-only authority projection.
 *
 * <p>This is a derived view of the existing Account DO authority. It deliberately stores no
 * access token, device identity, sync cursor or writable command surface.
 */
final class FocusAuthorityProjectionStore {
    private static final String PREFERENCES_NAME = "focus_authority_projection_v1";
    private static final String KEY_HISTORY = "history";
    private static final String KEY_HISTORY_FINGERPRINT = "historyFingerprint";
    private static final String KEY_LIVE_FINGERPRINT = "liveFingerprint";
    private static final String KEY_LIVE_SOURCE_REVISION = "liveSourceRevision";
    private static final String KEY_PROJECTION_REVISION = "projectionRevision";
    private static final String KEY_LAST_VERIFIED_AT = "lastVerifiedAt";
    private static final String KEY_LAST_ATTEMPT_AT = "lastAttemptAt";
    private static final String KEY_LAST_ERROR_CODE = "lastErrorCode";
    private static final String KEY_WEB_PENDING_COUNT = "webPendingCount";
    private static final String KEY_LEDGER_ACCOUNT_GENERATION = "ledgerAccountGeneration";
    private static final String KEY_LEDGER_CHANGE_SEQ = "ledgerChangeSeq";
    private static final String KEY_LEDGER_SYNC_EPOCH = "ledgerSyncEpoch";
    private static final String KEY_LEDGER_CURSOR_EPOCH = "ledgerCursorEpoch";
    private static final int MAX_HISTORY = 500;
    private static final int MAX_HISTORY_BYTES = 512 * 1024;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Set<String> HISTORY_KEYS = setOf(
        "sessionId",
        "startedAt",
        "endedAt",
        "status",
        "activeMs",
        "pausedMs",
        "wallMs",
        "title",
        "task"
    );
    private static final Set<String> TASK_KEYS = setOf("taskId", "source", "title");
    private static final Set<String> SAFE_ERROR_CODES = setOf(
        "",
        "authentication_failed",
        "authorization_failed",
        "cache_corrupt",
        "contract_error",
        "cursor_ahead",
        "network_error",
        "response_too_large",
        "revision_conflict",
        "revision_rollback",
        "sync_failed",
        "timeout"
    );

    static final class Snapshot {
        final long revision;
        final JSONArray history;
        final long lastVerifiedAt;
        final long lastAttemptAt;
        final String lastErrorCode;
        final int webPendingCount;

        Snapshot(
            long revision,
            JSONArray history,
            long lastVerifiedAt,
            long lastAttemptAt,
            String lastErrorCode,
            int webPendingCount
        ) {
            this.revision = revision;
            this.history = history;
            this.lastVerifiedAt = lastVerifiedAt;
            this.lastAttemptAt = lastAttemptAt;
            this.lastErrorCode = lastErrorCode;
            this.webPendingCount = webPendingCount;
        }
    }

    private FocusAuthorityProjectionStore() {}

    static synchronized Snapshot reconcileAndRead(
        Context context,
        FocusRuntimeSnapshot liveSnapshot
    ) {
        SharedPreferences preferences = preferences(context);
        try {
            JSONArray history = sanitizeHistory(
                new JSONArray(preferences.getString(KEY_HISTORY, "[]"))
            );
            long revision = nonNegativeSafeLong(
                preferences.getLong(KEY_PROJECTION_REVISION, 0L),
                "projection revision"
            );
            long sourceRevision = nonNegativeSafeLong(
                liveSnapshot.stateRevision,
                "live source revision"
            );
            long storedSourceRevision = preferences.getLong(KEY_LIVE_SOURCE_REVISION, -1L);
            String liveFingerprint = liveFingerprint(
                liveSnapshot,
                liveSnapshot.allowsCommands(context)
            );
            String storedFingerprint = preferences.getString(KEY_LIVE_FINGERPRINT, "");
            String errorCode = safeErrorCode(
                preferences.getString(KEY_LAST_ERROR_CODE, "")
            );
            long lastAttemptAt = preferences.getLong(KEY_LAST_ATTEMPT_AT, 0L);

            if (storedSourceRevision >= 0L && sourceRevision < storedSourceRevision) {
                errorCode = "revision_rollback";
                lastAttemptAt = System.currentTimeMillis();
            } else if (
                storedSourceRevision == sourceRevision &&
                !storedFingerprint.isEmpty() &&
                !storedFingerprint.equals(liveFingerprint)
            ) {
                errorCode = "revision_conflict";
                lastAttemptAt = System.currentTimeMillis();
            } else if (
                storedSourceRevision != sourceRevision ||
                !storedFingerprint.equals(liveFingerprint)
            ) {
                revision = nextRevision(revision, sourceRevision);
                storedSourceRevision = sourceRevision;
                storedFingerprint = liveFingerprint;
            }

            boolean committed = preferences
                .edit()
                .putLong(KEY_PROJECTION_REVISION, revision)
                .putLong(KEY_LIVE_SOURCE_REVISION, storedSourceRevision)
                .putString(KEY_LIVE_FINGERPRINT, storedFingerprint)
                .putString(KEY_LAST_ERROR_CODE, errorCode)
                .putLong(KEY_LAST_ATTEMPT_AT, lastAttemptAt)
                .commit();
            if (!committed) throw new IllegalStateException("unable to persist authority projection");
            return snapshotFromPreferences(preferences, revision, history, errorCode, lastAttemptAt);
        } catch (JSONException | IllegalArgumentException exception) {
            return new Snapshot(
                -1L,
                new JSONArray(),
                0L,
                System.currentTimeMillis(),
                "cache_corrupt",
                0
            );
        }
    }

    static synchronized void updateHistory(
        Context context,
        JSONArray input,
        long lastVerifiedAt,
        long lastAttemptAt,
        int webPendingCount,
        String lastErrorCode
    ) {
        JSONArray history = sanitizeHistory(input);
        if (history.toString().getBytes(StandardCharsets.UTF_8).length > MAX_HISTORY_BYTES) {
            throw new IllegalArgumentException("authority history is too large");
        }
        SharedPreferences preferences = preferences(context);
        String fingerprint = fingerprint(history.toString());
        String previous = preferences.getString(KEY_HISTORY_FINGERPRINT, "");
        long revision = preferences.getLong(KEY_PROJECTION_REVISION, 0L);
        if (!fingerprint.equals(previous)) revision = nextRevision(revision, 0L);
        String safeError = safeErrorCode(lastErrorCode);
        boolean committed = preferences
            .edit()
            .putString(KEY_HISTORY, history.toString())
            .putString(KEY_HISTORY_FINGERPRINT, fingerprint)
            .putLong(KEY_PROJECTION_REVISION, revision)
            .putLong(KEY_LAST_VERIFIED_AT, checkedTimestamp(lastVerifiedAt, "lastVerifiedAt"))
            .putLong(KEY_LAST_ATTEMPT_AT, checkedTimestamp(lastAttemptAt, "lastAttemptAt"))
            .putString(KEY_LAST_ERROR_CODE, safeError)
            .putInt(KEY_WEB_PENDING_COUNT, Math.max(0, webPendingCount))
            .commit();
        if (!committed) throw new IllegalStateException("unable to persist authority history");
    }

    static synchronized void recordLedgerAttempt(Context context, long attemptedAt) {
        long safeAttempt = checkedTimestamp(attemptedAt, "lastAttemptAt");
        boolean committed = preferences(context)
            .edit()
            .putLong(KEY_LAST_ATTEMPT_AT, safeAttempt)
            .commit();
        if (!committed) throw new IllegalStateException("unable to persist ledger attempt");
    }

    static synchronized void recordLedgerCheckpoint(Context context, JSONObject status)
        throws JSONException {
        int accountGeneration = status.getInt("accountGeneration");
        long changeSeq = safeLong(status.get("changeSeq"), "ledger changeSeq");
        String syncEpoch = requireText(status.getString("syncEpoch"), 128, "syncEpoch");
        String cursorEpoch = requireText(status.getString("cursorEpoch"), 128, "cursorEpoch");
        SharedPreferences preferences = preferences(context);
        int storedGeneration = preferences.getInt(KEY_LEDGER_ACCOUNT_GENERATION, 0);
        long storedChangeSeq = preferences.getLong(KEY_LEDGER_CHANGE_SEQ, 0L);
        String storedSyncEpoch = preferences.getString(KEY_LEDGER_SYNC_EPOCH, "");
        String storedCursorEpoch = preferences.getString(KEY_LEDGER_CURSOR_EPOCH, "");
        requireMonotonicLedgerCheckpoint(
            storedGeneration,
            storedChangeSeq,
            storedSyncEpoch,
            storedCursorEpoch,
            accountGeneration,
            changeSeq,
            syncEpoch,
            cursorEpoch
        );
        boolean committed = preferences
            .edit()
            .putInt(KEY_LEDGER_ACCOUNT_GENERATION, accountGeneration)
            .putLong(KEY_LEDGER_CHANGE_SEQ, changeSeq)
            .putString(KEY_LEDGER_SYNC_EPOCH, syncEpoch)
            .putString(KEY_LEDGER_CURSOR_EPOCH, cursorEpoch)
            .commit();
        if (!committed) throw new IllegalStateException("unable to persist ledger checkpoint");
    }

    static void requireMonotonicLedgerCheckpoint(
        int storedGeneration,
        long storedChangeSeq,
        String storedSyncEpoch,
        String storedCursorEpoch,
        int incomingGeneration,
        long incomingChangeSeq,
        String incomingSyncEpoch,
        String incomingCursorEpoch
    ) {
        if (incomingGeneration < 1 || incomingChangeSeq < 0L) {
            throw new IllegalArgumentException("revision rollback");
        }
        if (storedGeneration <= 0) return;
        if (
            incomingGeneration < storedGeneration ||
            (incomingGeneration == storedGeneration && incomingChangeSeq < storedChangeSeq)
        ) {
            throw new IllegalArgumentException("revision rollback");
        }
        if (
            incomingGeneration == storedGeneration &&
            (!storedSyncEpoch.equals(incomingSyncEpoch) ||
                !storedCursorEpoch.equals(incomingCursorEpoch))
        ) {
            throw new IllegalArgumentException("revision conflict");
        }
    }

    static synchronized void recordLedgerFailure(
        Context context,
        String errorCode,
        long attemptedAt
    ) {
        String safeError = safeErrorCode(errorCode);
        if (safeError.isEmpty()) throw new IllegalArgumentException("failure code is required");
        boolean committed = preferences(context)
            .edit()
            .putLong(KEY_LAST_ATTEMPT_AT, checkedTimestamp(attemptedAt, "lastAttemptAt"))
            .putString(KEY_LAST_ERROR_CODE, safeError)
            .commit();
        if (!committed) throw new IllegalStateException("unable to persist ledger failure");
    }

    static synchronized void confirmCompletedRecord(
        Context context,
        FocusLedgerNativeOutboxStore.Record record,
        long verifiedAt
    ) throws JSONException {
        SharedPreferences preferences = preferences(context);
        JSONArray existing = sanitizeHistory(
            new JSONArray(preferences.getString(KEY_HISTORY, "[]"))
        );
        JSONObject confirmed = historyFromCompletedRecord(record);
        JSONArray merged = new JSONArray();
        merged.put(confirmed);
        for (int index = 0; index < existing.length() && merged.length() < MAX_HISTORY; index++) {
            JSONObject value = existing.getJSONObject(index);
            if (!record.bundleId.equals(value.getString("sessionId"))) merged.put(value);
        }
        updateHistory(
            context,
            merged,
            verifiedAt,
            verifiedAt,
            Math.max(0, preferences.getInt(KEY_WEB_PENDING_COUNT, 0)),
            ""
        );
    }

    static synchronized void clear(Context context) {
        if (!preferences(context).edit().clear().commit()) {
            throw new IllegalStateException("unable to clear authority projection");
        }
    }

    static JSONArray sanitizeHistory(JSONArray input) {
        if (input == null) throw new IllegalArgumentException("authority history is required");
        if (input.length() > MAX_HISTORY) {
            throw new IllegalArgumentException("authority history exceeds the V1 limit");
        }
        List<JSONObject> records = new ArrayList<>();
        Set<String> sessionIds = new HashSet<>();
        try {
            for (int index = 0; index < input.length(); index++) {
                JSONObject source = input.getJSONObject(index);
                requireExactKeys(source, HISTORY_KEYS);
                String sessionId = requireText(source.getString("sessionId"), 200, "sessionId");
                if (!sessionIds.add(sessionId)) {
                    throw new IllegalArgumentException("authority history contains duplicate sessions");
                }
                long startedAt = safeLong(source.get("startedAt"), "startedAt");
                long endedAt = safeLong(source.get("endedAt"), "endedAt");
                long activeMs = safeLong(source.get("activeMs"), "activeMs");
                long pausedMs = safeLong(source.get("pausedMs"), "pausedMs");
                long wallMs = safeLong(source.get("wallMs"), "wallMs");
                String status = source.getString("status");
                if (!"finished".equals(status) && !"aborted".equals(status)) {
                    throw new IllegalArgumentException("authority history status is invalid");
                }
                if (
                    endedAt <= startedAt ||
                    safeAdd(activeMs, pausedMs) != wallMs ||
                    endedAt - startedAt != wallMs
                ) {
                    throw new IllegalArgumentException("authority history timing is inconsistent");
                }
                Object titleValue = source.get("title");
                String title = titleValue == JSONObject.NULL
                    ? null
                    : requireText((String) titleValue, 240, "title");
                Object taskValue = source.get("task");
                JSONObject task = taskValue == JSONObject.NULL
                    ? null
                    : sanitizeTask((JSONObject) taskValue);
                records.add(
                    new JSONObject()
                        .put("sessionId", sessionId)
                        .put("startedAt", startedAt)
                        .put("endedAt", endedAt)
                        .put("status", status)
                        .put("activeMs", activeMs)
                        .put("pausedMs", pausedMs)
                        .put("wallMs", wallMs)
                        .put("title", title == null ? JSONObject.NULL : title)
                        .put("task", task == null ? JSONObject.NULL : task)
                );
            }
        } catch (JSONException | ClassCastException exception) {
            throw new IllegalArgumentException("authority history is invalid", exception);
        }
        Collections.sort(
            records,
            Comparator.comparingLong((JSONObject value) -> value.optLong("startedAt", 0L))
                .reversed()
                .thenComparing(value -> value.optString("sessionId", ""))
        );
        JSONArray result = new JSONArray();
        for (JSONObject record : records) result.put(record);
        return result;
    }

    private static JSONObject historyFromCompletedRecord(
        FocusLedgerNativeOutboxStore.Record record
    ) throws JSONException {
        JSONObject ledger = null;
        JSONObject metadata = null;
        JSONArray mutations = record.mutations();
        for (int index = 0; index < mutations.length(); index++) {
            JSONObject mutation = mutations.getJSONObject(index);
            String type = mutation.getString("entityType");
            if ("focus_ledger_v2".equals(type)) ledger = mutation.getJSONObject("payload");
            if ("focus_metadata_v2".equals(type)) metadata = mutation.getJSONObject("payload");
        }
        if (ledger == null || metadata == null) {
            throw new IllegalArgumentException("completed projection record is incomplete");
        }
        JSONObject candidate = new JSONObject()
            .put("sessionId", record.bundleId)
            .put("startedAt", ledger.getLong("startedAt"))
            .put("endedAt", ledger.getLong("endedAt"))
            .put("status", ledger.getString("status"))
            .put("activeMs", ledger.getLong("activeElapsedMs"))
            .put("pausedMs", ledger.getLong("pausedElapsedMs"))
            .put("wallMs", ledger.getLong("wallElapsedMs"))
            .put("title", metadata.opt("title"))
            .put("task", metadata.opt("taskAssociation"));
        return sanitizeHistory(new JSONArray().put(candidate)).getJSONObject(0);
    }

    private static JSONObject sanitizeTask(JSONObject source) throws JSONException {
        requireExactKeys(source, TASK_KEYS);
        String taskId = requireText(source.getString("taskId"), 200, "taskId");
        String taskSource = source.getString("source");
        if (!"local".equals(taskSource) && !"ticktick".equals(taskSource)) {
            throw new IllegalArgumentException("authority task source is invalid");
        }
        Object titleValue = source.get("title");
        String title = titleValue == JSONObject.NULL
            ? null
            : requireText((String) titleValue, 240, "task title");
        return new JSONObject()
            .put("taskId", taskId)
            .put("source", taskSource)
            .put("title", title == null ? JSONObject.NULL : title);
    }

    private static Snapshot snapshotFromPreferences(
        SharedPreferences preferences,
        long revision,
        JSONArray history,
        String errorCode,
        long lastAttemptAt
    ) {
        return new Snapshot(
            revision,
            history,
            preferences.getLong(KEY_LAST_VERIFIED_AT, 0L),
            lastAttemptAt,
            errorCode,
            Math.max(0, preferences.getInt(KEY_WEB_PENDING_COUNT, 0))
        );
    }

    private static String liveFingerprint(
        FocusRuntimeSnapshot snapshot,
        boolean controlsEnabled
    ) {
        try {
            return fingerprint(
                new JSONObject()
                    .put("state", snapshot.state)
                    .put("sessionId", snapshot.sessionId)
                    .put("title", snapshot.title)
                    .put("primaryAdvances", snapshot.primaryAdvances)
                    .put("controlsEnabled", controlsEnabled)
                    .toString()
            );
        } catch (JSONException exception) {
            throw new IllegalStateException("unable to fingerprint live projection", exception);
        }
    }

    private static long nextRevision(long previous, long sourceRevision) {
        long floor = Math.max(0L, sourceRevision);
        if (previous >= MAX_SAFE_INTEGER) {
            throw new IllegalStateException("authority projection revision exhausted");
        }
        return Math.max(previous + 1L, floor);
    }

    private static long safeLong(Object value, String field) {
        if (!(value instanceof Number)) throw new IllegalArgumentException(field + " is invalid");
        Number number = (Number) value;
        long integer = number.longValue();
        if (
            number.doubleValue() != (double) integer ||
            integer < 0L ||
            integer > MAX_SAFE_INTEGER
        ) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return integer;
    }

    private static long nonNegativeSafeLong(long value, String field) {
        if (value < 0L || value > MAX_SAFE_INTEGER) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return value;
    }

    private static long checkedTimestamp(long value, String field) {
        return nonNegativeSafeLong(value, field);
    }

    private static long safeAdd(long left, long right) {
        if (left > MAX_SAFE_INTEGER - right) {
            throw new IllegalArgumentException("authority history duration overflow");
        }
        return left + right;
    }

    private static String requireText(String value, int maxLength, String field) {
        if (value == null || value.isEmpty() || value.length() > maxLength) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return value;
    }

    private static String safeErrorCode(String value) {
        String normalized = value == null ? "" : value;
        if (!SAFE_ERROR_CODES.contains(normalized)) return "sync_failed";
        return normalized;
    }

    private static String fingerprint(String value) {
        try {
            byte[] digest = MessageDigest
                .getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder encoded = new StringBuilder(digest.length * 2);
            for (byte item : digest) encoded.append(String.format("%02x", item & 0xff));
            return encoded.toString();
        } catch (Exception exception) {
            throw new IllegalStateException("unable to fingerprint authority projection", exception);
        }
    }

    private static void requireExactKeys(JSONObject value, Set<String> expected) {
        Set<String> actual = new HashSet<>();
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) actual.add(keys.next());
        if (!actual.equals(expected)) {
            throw new IllegalArgumentException("authority projection fields are invalid");
        }
    }

    private static Set<String> setOf(String... values) {
        Set<String> result = new HashSet<>();
        Collections.addAll(result, values);
        return Collections.unmodifiableSet(result);
    }

    private static SharedPreferences preferences(Context context) {
        return FocusRuntimePreferences.get(context, PREFERENCES_NAME);
    }
}
