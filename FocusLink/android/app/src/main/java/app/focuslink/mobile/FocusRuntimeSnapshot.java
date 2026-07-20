package app.focuslink.mobile;

import android.content.Context;
import android.os.SystemClock;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import org.json.JSONException;
import org.json.JSONObject;

final class FocusRuntimeSnapshot {
    private static final String INTERNAL_RECEIVED_AT_EPOCH_MS = "_receivedAtEpochMs";
    private static final String INTERNAL_RECEIVED_AT_ELAPSED_MS = "_receivedAtElapsedMs";
    private static final String INTERNAL_BOOT_COUNT = "_bootCount";

    final String state;
    final String sessionId;
    final long stateRevision;
    final String title;
    final String timeLabel;
    final String detail;
    final long primaryElapsedMs;
    final boolean primaryAdvances;
    final boolean controlsEnabled;
    final long validUntilEpochMs;
    final long receivedAtEpochMs;
    final long receivedAtElapsedMs;
    final int bootCount;

    private FocusRuntimeSnapshot(
        String state,
        String sessionId,
        long stateRevision,
        String title,
        String timeLabel,
        String detail,
        long primaryElapsedMs,
        boolean primaryAdvances,
        boolean controlsEnabled,
        long validUntilEpochMs,
        long receivedAtEpochMs,
        long receivedAtElapsedMs,
        int bootCount
    ) {
        this.state = state;
        this.sessionId = sessionId;
        this.stateRevision = stateRevision;
        this.title = title;
        this.timeLabel = timeLabel;
        this.detail = detail;
        this.primaryElapsedMs = primaryElapsedMs;
        this.primaryAdvances = primaryAdvances;
        this.controlsEnabled = controlsEnabled;
        this.validUntilEpochMs = validUntilEpochMs;
        this.receivedAtEpochMs = receivedAtEpochMs;
        this.receivedAtElapsedMs = receivedAtElapsedMs;
        this.bootCount = bootCount;
    }

    static FocusRuntimeSnapshot fromPlugin(Context context, JSObject object) {
        if (object == null) {
            throw new IllegalArgumentException("snapshot is required");
        }

        long nowEpochMs = System.currentTimeMillis();
        long nowElapsedMs = SystemClock.elapsedRealtime();
        return parse(
            object,
            nowEpochMs,
            nowElapsedMs,
            readBootCount(context),
            false
        );
    }

    static FocusRuntimeSnapshot fromStored(Context context, String raw) {
        if (raw == null || raw.isEmpty()) {
            return idle(context);
        }
        try {
            JSONObject object = new JSONObject(raw);
            return parse(
                object,
                object.optLong(INTERNAL_RECEIVED_AT_EPOCH_MS, 0L),
                object.optLong(INTERNAL_RECEIVED_AT_ELAPSED_MS, -1L),
                object.optInt(INTERNAL_BOOT_COUNT, -1),
                true
            );
        } catch (JSONException | IllegalArgumentException exception) {
            return idle(context);
        }
    }

    static FocusRuntimeSnapshot idle(Context context) {
        return new FocusRuntimeSnapshot(
            FocusRuntimeContract.STATE_IDLE,
            "",
            0L,
            "",
            "",
            "",
            0L,
            false,
            false,
            0L,
            System.currentTimeMillis(),
            SystemClock.elapsedRealtime(),
            readBootCount(context)
        );
    }

    private static FocusRuntimeSnapshot parse(
        JSONObject object,
        long receivedAtEpochMs,
        long receivedAtElapsedMs,
        int bootCount,
        boolean stored
    ) {
        String state = requiredString(object, "state", 16);
        if (
            !FocusRuntimeContract.STATE_IDLE.equals(state) &&
            !FocusRuntimeContract.STATE_RUNNING.equals(state) &&
            !FocusRuntimeContract.STATE_PAUSED.equals(state)
        ) {
            throw new IllegalArgumentException("snapshot.state is invalid");
        }

        boolean active = FocusRuntimeContract.isActiveState(state);
        String sessionId = optionalString(object, "sessionId", 200);
        long revision = safeInteger(object, "stateRevision", active);
        String title = optionalString(object, "title", 120);
        String timeLabel = optionalString(object, "timeLabel", 32);
        String detail = optionalString(object, "detail", 160);
        long primaryElapsedMs = safeInteger(object, "primaryElapsedMs", active);
        boolean primaryAdvances = strictBoolean(object, "primaryAdvances", active);
        boolean controlsEnabled = object.optBoolean("controlsEnabled", false);
        long validUntilEpochMs = safeInteger(object, "validUntilEpochMs", active);

        if (active && sessionId.isEmpty()) {
            throw new IllegalArgumentException("snapshot.sessionId is required while active");
        }
        if (active && revision < 0L) {
            throw new IllegalArgumentException("snapshot.stateRevision is required while active");
        }
        if (active && validUntilEpochMs <= 0L) {
            throw new IllegalArgumentException("snapshot.validUntilEpochMs is required while active");
        }
        if (!stored && receivedAtEpochMs <= 0L) {
            throw new IllegalArgumentException("snapshot receipt time is invalid");
        }

        return new FocusRuntimeSnapshot(
            state,
            active ? sessionId : "",
            active ? revision : 0L,
            title,
            timeLabel,
            detail,
            active ? primaryElapsedMs : 0L,
            active && primaryAdvances,
            active && controlsEnabled,
            active ? validUntilEpochMs : 0L,
            receivedAtEpochMs,
            receivedAtElapsedMs,
            bootCount
        );
    }

    boolean isActive() {
        return FocusRuntimeContract.isActiveState(state);
    }

    boolean isFresh(Context context, long nowEpochMs, long nowElapsedMs) {
        if (!isActive() || validUntilEpochMs <= nowEpochMs) {
            return false;
        }
        int currentBootCount = readBootCount(context);
        if (bootCount >= 0 && currentBootCount >= 0 && bootCount != currentBootCount) {
            return false;
        }
        if (receivedAtElapsedMs < 0L || nowElapsedMs < receivedAtElapsedMs) {
            return false;
        }
        if (nowElapsedMs - receivedAtElapsedMs > FocusRuntimeContract.MAX_NATIVE_SNAPSHOT_AGE_MS) {
            return false;
        }
        return true;
    }

    boolean allowsCommands(Context context) {
        return controlsEnabled && isFresh(context, System.currentTimeMillis(), SystemClock.elapsedRealtime());
    }

    long remainingFreshnessMs() {
        long epochRemaining = validUntilEpochMs - System.currentTimeMillis();
        if (bootCount >= 0) {
            return Math.max(0L, epochRemaining);
        }
        long ageRemaining = FocusRuntimeContract.MAX_NATIVE_SNAPSHOT_AGE_MS -
        (SystemClock.elapsedRealtime() - receivedAtElapsedMs);
        return Math.max(0L, Math.min(epochRemaining, ageRemaining));
    }

    boolean matches(String expectedSessionId, long expectedRevision) {
        return sessionId.equals(expectedSessionId) && stateRevision == expectedRevision;
    }

    JSONObject toStoredJson() {
        return toPublicJson()
            .put(INTERNAL_RECEIVED_AT_EPOCH_MS, receivedAtEpochMs)
            .put(INTERNAL_RECEIVED_AT_ELAPSED_MS, receivedAtElapsedMs)
            .put(INTERNAL_BOOT_COUNT, bootCount);
    }

    JSObject toPublicJson() {
        return new JSObject()
            .put("state", state)
            .put("sessionId", sessionId)
            .put("stateRevision", stateRevision)
            .put("title", title)
            .put("timeLabel", timeLabel)
            .put("detail", detail)
            .put("primaryElapsedMs", primaryElapsedMs)
            .put("primaryAdvances", primaryAdvances)
            .put("controlsEnabled", controlsEnabled)
            .put("validUntilEpochMs", validUntilEpochMs);
    }

    private static String requiredString(JSONObject object, String key, int maxLength) {
        String value = optionalString(object, key, maxLength);
        if (value.isEmpty()) {
            throw new IllegalArgumentException("snapshot." + key + " is required");
        }
        return value;
    }

    private static String optionalString(JSONObject object, String key, int maxLength) {
        Object raw = object.opt(key);
        if (raw == null || raw == JSONObject.NULL) {
            return "";
        }
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException("snapshot." + key + " must be a string");
        }
        String value = (String) raw;
        if (value.length() > maxLength || containsControlCharacter(value)) {
            throw new IllegalArgumentException("snapshot." + key + " is invalid");
        }
        return value;
    }

    private static long safeInteger(JSONObject object, String key, boolean required) {
        Object raw = object.opt(key);
        if (raw == null || raw == JSONObject.NULL) {
            if (required) {
                return -1L;
            }
            return 0L;
        }
        if (!(raw instanceof Number)) {
            throw new IllegalArgumentException("snapshot." + key + " must be an integer");
        }
        Number number = (Number) raw;
        double doubleValue = number.doubleValue();
        long longValue = number.longValue();
        if (
            !Double.isFinite(doubleValue) ||
            doubleValue != (double) longValue ||
            longValue < 0L ||
            longValue > FocusRuntimeContract.MAX_SAFE_INTEGER
        ) {
            throw new IllegalArgumentException("snapshot." + key + " must be a safe integer");
        }
        return longValue;
    }

    private static boolean strictBoolean(JSONObject object, String key, boolean required) {
        Object raw = object.opt(key);
        if (raw == null || raw == JSONObject.NULL) {
            if (required) {
                throw new IllegalArgumentException("snapshot." + key + " is required");
            }
            return false;
        }
        if (!(raw instanceof Boolean)) {
            throw new IllegalArgumentException("snapshot." + key + " must be a boolean");
        }
        return (Boolean) raw;
    }

    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character < 0x20 && character != '\n' && character != '\t') {
                return true;
            }
        }
        return false;
    }

    private static int readBootCount(Context context) {
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT);
        } catch (Settings.SettingNotFoundException | SecurityException exception) {
            return -1;
        }
    }
}
