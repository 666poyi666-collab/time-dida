package app.focuslink.mobile;

import com.getcapacitor.JSObject;
import java.util.UUID;
import org.json.JSONObject;

final class FocusRuntimeCommand {
    final String id;
    final String type;
    final String source;
    final String sessionId;
    final long stateRevision;
    final long issuedAtEpochMs;

    private FocusRuntimeCommand(
        String id,
        String type,
        String source,
        String sessionId,
        long stateRevision,
        long issuedAtEpochMs
    ) {
        this.id = id;
        this.type = type;
        this.source = source;
        this.sessionId = sessionId;
        this.stateRevision = stateRevision;
        this.issuedAtEpochMs = issuedAtEpochMs;
    }

    static FocusRuntimeCommand create(String type, String source, FocusRuntimeSnapshot snapshot) {
        return new FocusRuntimeCommand(
            UUID.randomUUID().toString(),
            type,
            source,
            snapshot.sessionId,
            snapshot.stateRevision,
            System.currentTimeMillis()
        );
    }

    static FocusRuntimeCommand fromJson(JSONObject object) {
        String id = object.optString("id", "");
        String type = object.optString("type", "");
        String source = object.optString("source", "");
        String sessionId = object.optString("sessionId", "");
        long stateRevision = object.optLong("stateRevision", -1L);
        long issuedAtEpochMs = object.optLong("issuedAtEpochMs", -1L);
        if (
            id.isEmpty() ||
            sessionId.isEmpty() ||
            stateRevision < 0L ||
            issuedAtEpochMs < 0L ||
            !FocusRuntimeContract.isCommandAllowedForState(
                FocusRuntimeContract.STATE_RUNNING,
                type
            ) &&
            !FocusRuntimeContract.isCommandAllowedForState(
                FocusRuntimeContract.STATE_PAUSED,
                type
            ) ||
            !FocusRuntimeContract.SOURCE_NOTIFICATION.equals(source) &&
            !FocusRuntimeContract.SOURCE_QUICK_SETTINGS.equals(source)
        ) {
            throw new IllegalArgumentException("Stored native command is invalid");
        }
        return new FocusRuntimeCommand(
            id,
            type,
            source,
            sessionId,
            stateRevision,
            issuedAtEpochMs
        );
    }

    JSObject toJson() {
        return new JSObject()
            .put("id", id)
            .put("type", type)
            .put("source", source)
            .put("sessionId", sessionId)
            .put("stateRevision", stateRevision)
            .put("issuedAtEpochMs", issuedAtEpochMs);
    }

    JSObject toCloudRequest(String deviceId) {
        return new JSObject()
            .put("protocolVersion", 1)
            .put("deviceId", deviceId)
            .put(
                "command",
                new JSObject()
                    .put("commandId", id)
                    .put("action", type)
                    .put("expectedRevision", stateRevision)
                    .put("sessionId", sessionId)
            );
    }
}
