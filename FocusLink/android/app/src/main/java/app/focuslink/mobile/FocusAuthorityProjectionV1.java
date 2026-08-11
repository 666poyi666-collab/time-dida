package app.focuslink.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Versioned, credential-free projection shared with same-signature companion apps. */
final class FocusAuthorityProjectionV1 {
    static final int SCHEMA_VERSION = 1;
    static final String SOURCE = "FocusLink";
    static final long FRESH_AFTER_MS = 2L * 60L * 1000L;

    private FocusAuthorityProjectionV1() {}

    static String freshness(
        boolean connectionConfigured,
        long lastVerifiedAt,
        long lastAttemptAt,
        String lastErrorCode,
        long now
    ) {
        if (!connectionConfigured) return "blocked";
        boolean hasError = lastErrorCode != null && !lastErrorCode.isEmpty();
        if (isBlockingError(lastErrorCode)) return "blocked";
        // A conflict/rejection is durable attention after an authoritative response, not
        // transport evidence. Preserve the last verified freshness while continuing to expose
        // its safe code and pending count. With no verified projection yet, remain unknown so
        // the provider keeps history redacted rather than inventing either freshness or outage.
        boolean requestFailed = hasError && !isAttentionError(lastErrorCode);
        if (lastVerifiedAt <= 0L) return requestFailed ? "offline" : "unknown";
        if (requestFailed && lastAttemptAt > lastVerifiedAt) return "offline";
        if (now >= lastVerifiedAt && now - lastVerifiedAt <= FRESH_AFTER_MS) return "fresh";
        return "stale";
    }

    static boolean isAttentionError(String errorCode) {
        return "conflict_present".equals(errorCode) || "rejected_operation".equals(errorCode);
    }

    static boolean isBlockingError(String errorCode) {
        return "authentication_failed".equals(errorCode) ||
        "authorization_failed".equals(errorCode) ||
        "cache_corrupt".equals(errorCode) ||
        "revision_conflict".equals(errorCode) ||
        "revision_rollback".equals(errorCode);
    }

    static JSONObject build(
        long revision,
        long lastVerifiedAt,
        String freshness,
        String identityStatus,
        String lastErrorCode,
        int pendingCount,
        JSONObject currentFocus,
        JSONArray history
    ) throws JSONException {
        JSONObject syncHealth = new JSONObject()
            .put("status", freshness)
            .put("pendingCount", Math.max(0, pendingCount))
            .put(
                "lastErrorCode",
                lastErrorCode == null || lastErrorCode.isEmpty()
                    ? JSONObject.NULL
                    : lastErrorCode
            );
        JSONObject payload = new JSONObject()
            .put("authority", SOURCE)
            .put("identityStatus", identityStatus)
            .put("syncHealth", syncHealth)
            .put("currentFocus", currentFocus == null ? JSONObject.NULL : currentFocus)
            .put("history", history == null ? new JSONArray() : history);
        return new JSONObject()
            .put("schemaVersion", SCHEMA_VERSION)
            .put("source", SOURCE)
            .put("revision", revision < 0L ? JSONObject.NULL : revision)
            .put("lastVerifiedAt", lastVerifiedAt <= 0L ? JSONObject.NULL : lastVerifiedAt)
            .put("freshness", freshness)
            .put("payload", payload);
    }
}
