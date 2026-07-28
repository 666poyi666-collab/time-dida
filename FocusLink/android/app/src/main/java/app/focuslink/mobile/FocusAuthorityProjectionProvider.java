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
    static final String AUTHORITY = "app.focuslink.mobile.authority.projection";
    static final String READ_PERMISSION = "app.focuslink.mobile.permission.READ_AUTHORITY_PROJECTION";
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
            JSONObject diagnostics = FocusNotificationService.pollDiagnostics(getContext());
            long lastVerifiedAt = diagnostics.optLong("lastSuccessAtEpochMs", 0L);
            long lastAttemptAt = diagnostics.optLong("lastAttemptAtEpochMs", 0L);
            long revision = diagnostics.optLong("lastRevision", -1L);
            String lastErrorCode = diagnostics.optString("lastErrorCode", "");
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
                .put("revision", snapshot.stateRevision)
                .put("primaryElapsedMs", snapshot.primaryElapsedMs)
                .put("primaryAdvances", snapshot.primaryAdvances)
                .put("controlsEnabled", snapshot.allowsCommands(getContext()));
            JSONObject projection = FocusAuthorityProjectionV1.build(
                revision,
                lastVerifiedAt,
                freshness,
                connection == null ? "unpaired" : "paired",
                lastErrorCode,
                FocusRuntimeStore.pendingCount(getContext()),
                currentFocus,
                new JSONArray()
            );
            Bundle result = new Bundle();
            result.putString(RESULT_PROJECTION, projection.toString());
            return result;
        } catch (JSONException exception) {
            throw new IllegalStateException("authority projection serialization failed");
        }
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
