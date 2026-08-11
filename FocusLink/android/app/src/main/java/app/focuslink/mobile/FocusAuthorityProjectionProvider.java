package app.focuslink.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Read-only, same-signature bridge. It never returns a token, deviceId, cursor or envelope. */
public final class FocusAuthorityProjectionProvider extends ContentProvider {
    static final String AUTHORITY = BuildConfig.APPLICATION_ID + ".authority.projection";
    static final String READ_PERMISSION =
        BuildConfig.APPLICATION_ID + ".permission.READ_AUTHORITY_PROJECTION";
    static final String METHOD_GET_V1 = "getProjectionV1";
    static final String RESULT_PROJECTION = "projection";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Nullable
    @Override
    public Bundle call(@NonNull String method, @Nullable String arg, @Nullable Bundle extras) {
        if (!METHOD_GET_V1.equals(method)) {
            throw new IllegalArgumentException("unsupported authority projection method");
        }
        if (getContext() == null) throw new IllegalStateException("provider context unavailable");
        getContext().enforceCallingOrSelfPermission(READ_PERMISSION, "signature permission required");
        try {
            FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(
                getContext()
            );
            FocusRuntimeSnapshot snapshot = FocusRuntimeStore.getSnapshot(getContext());
            FocusAuthorityProjectionStore.Snapshot projectionCache =
                FocusAuthorityProjectionStore.reconcileAndRead(getContext(), snapshot);
            JSONObject diagnostics = FocusNotificationService.pollDiagnostics(getContext());
            long liveVerifiedAt = diagnostics.optLong("lastSuccessAtEpochMs", 0L);
            long liveAttemptAt = diagnostics.optLong("lastAttemptAtEpochMs", 0L);
            // Poll diagnostics can predate the structured-code migration. Never let a
            // legacy preference value (or a damaged preference) escape through the
            // same-signature projection or influence freshness as arbitrary text.
            String liveErrorCode = projectionErrorCode(
                diagnostics.optString("lastErrorCode", "")
            );
            boolean hasProjectedHistory = projectionCache.history.length() > 0;
            long lastVerifiedAt = hasProjectedHistory
                ? oldestPositive(liveVerifiedAt, projectionCache.lastVerifiedAt)
                : liveVerifiedAt;
            long lastAttemptAt = Math.max(liveAttemptAt, projectionCache.lastAttemptAt);
            String lastErrorCode = mergedError(
                liveErrorCode,
                liveAttemptAt,
                liveVerifiedAt,
                projectionCache.lastErrorCode,
                projectionCache.lastAttemptAt,
                projectionCache.lastVerifiedAt
            );
            FocusLedgerNativeOutboxStore.TerminalStatus terminalLedger = connection == null
                ? new FocusLedgerNativeOutboxStore.TerminalStatus(0, "")
                : FocusLedgerNativeOutboxStore.terminalStatusForDevice(
                    getContext(),
                    connection.deviceId
                );
            lastErrorCode = projectionErrorCode(terminalAwareError(lastErrorCode, terminalLedger));
            String freshness = FocusAuthorityProjectionV1.freshness(
                connection != null,
                lastVerifiedAt,
                lastAttemptAt,
                lastErrorCode,
                System.currentTimeMillis()
            );
            JSONObject currentFocus = new JSONObject()
                .put("state", snapshot.state)
                .put("sessionId", snapshot.sessionId)
                .put("title", snapshot.title)
                .put("revision", projectionCache.revision)
                .put("primaryElapsedMs", snapshot.primaryElapsedMs)
                .put("primaryAdvances", snapshot.primaryAdvances)
                .put("controlsEnabled", snapshot.allowsCommands(getContext()));
            int nativeLedgerPending = connection == null
                ? 0
                : FocusLedgerNativeOutboxStore.countForDevice(
                    getContext(),
                    connection.deviceId
                );
            long exposedRevision = projectionCache.revision;
            long exposedLastVerifiedAt = lastVerifiedAt;
            if (exposedRevision < 0L || exposedLastVerifiedAt <= 0L) {
                exposedRevision = -1L;
                exposedLastVerifiedAt = 0L;
            }
            if (exposedRevision >= 0L) currentFocus.put("revision", exposedRevision);
            boolean redactProjection = shouldRedactProjection(freshness, exposedRevision);
            JSONObject projection = FocusAuthorityProjectionV1.build(
                exposedRevision,
                exposedLastVerifiedAt,
                freshness,
                identityStatus(connection != null, lastErrorCode),
                lastErrorCode,
                logicalPendingCount(
                    FocusRuntimeStore.pendingCount(getContext()),
                    nativeLedgerPending,
                    terminalLedger.count,
                    projectionCache.webPendingCount
                ),
                redactProjection ? null : currentFocus,
                redactProjection ? new JSONArray() : projectionCache.history
            );
            Bundle result = new Bundle();
            result.putString(RESULT_PROJECTION, projection.toString());
            return result;
        } catch (JSONException exception) {
            throw new IllegalStateException("authority projection serialization failed");
        }
    }

    private static long oldestPositive(long left, long right) {
        if (left <= 0L || right <= 0L) return 0L;
        return Math.min(left, right);
    }

    private static String mergedError(
        String liveError,
        long liveAttemptAt,
        long liveVerifiedAt,
        String ledgerError,
        long ledgerAttemptAt,
        long ledgerVerifiedAt
    ) {
        if (FocusAuthorityProjectionV1.isBlockingError(ledgerError)) return ledgerError;
        if (FocusAuthorityProjectionV1.isBlockingError(liveError)) return liveError;
        boolean liveFailed = liveError != null &&
        !liveError.isEmpty() &&
        liveAttemptAt > liveVerifiedAt;
        boolean ledgerFailed = ledgerError != null &&
        !ledgerError.isEmpty() &&
        ledgerAttemptAt > ledgerVerifiedAt;
        if (liveFailed && ledgerFailed) {
            return liveAttemptAt >= ledgerAttemptAt ? liveError : ledgerError;
        }
        if (liveFailed) return liveError;
        if (ledgerFailed) return ledgerError;
        return "";
    }

    private static String identityStatus(boolean configured, String errorCode) {
        if (!configured) return "unpaired";
        if (
            "cache_corrupt".equals(errorCode) ||
            "revision_conflict".equals(errorCode) ||
            "revision_rollback".equals(errorCode)
        ) {
            return "unpaired";
        }
        return "paired";
    }

    static String terminalAwareError(
        String existingError,
        FocusLedgerNativeOutboxStore.TerminalStatus terminalLedger
    ) {
        if (existingError != null && !existingError.isEmpty()) return existingError;
        if (terminalLedger == null || terminalLedger.count <= 0) {
            return "";
        }
        if (
            "conflict_present".equals(terminalLedger.lastErrorCode) ||
            "rejected_operation".equals(terminalLedger.lastErrorCode)
        ) {
            return terminalLedger.lastErrorCode;
        }
        return "sync_failed";
    }

    /**
     * The provider is a cross-process contract, so it must not rely on every
     * historical diagnostics writer having already normalized its value.
     */
    static String projectionErrorCode(String value) {
        return FocusAuthorityProjectionStore.safeErrorCode(value);
    }

    static int logicalPendingCount(
        int commandPending,
        int nativeLedgerPending,
        int terminalLedgerPending,
        int webLedgerPending
    ) {
        long nativeLedgerTotal = (long) Math.max(0, nativeLedgerPending) + Math.max(
            0,
            terminalLedgerPending
        );
        long total = Math.max(0, commandPending) + Math.max(
            nativeLedgerTotal,
            Math.max(0, webLedgerPending)
        );
        return total > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) total;
    }

    static boolean shouldRedactProjection(String freshness, long revision) {
        return revision < 0L || "blocked".equals(freshness) || "unknown".equals(freshness);
    }

    @Nullable
    @Override
    public Cursor query(
        @NonNull Uri uri,
        @Nullable String[] projection,
        @Nullable String selection,
        @Nullable String[] selectionArgs,
        @Nullable String sortOrder
    ) {
        throw new UnsupportedOperationException("authority projection is call-only");
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        return "application/vnd.focuslink.authority-projection.v1+json";
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        throw new UnsupportedOperationException("authority projection is read-only");
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) {
        throw new UnsupportedOperationException("authority projection is read-only");
    }

    @Override
    public int update(
        @NonNull Uri uri,
        @Nullable ContentValues values,
        @Nullable String selection,
        @Nullable String[] selectionArgs
    ) {
        throw new UnsupportedOperationException("authority projection is read-only");
    }
}
