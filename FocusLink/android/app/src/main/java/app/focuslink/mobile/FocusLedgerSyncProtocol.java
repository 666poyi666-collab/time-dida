package app.focuslink.mobile;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Minimal cursorless Sync v2 contract used only for durable completed-ledger delivery. */
final class FocusLedgerSyncProtocol {
    private static final int PROTOCOL_VERSION = 2;

    private FocusLedgerSyncProtocol() {}

    static JSONObject validateStatus(JSONObject status) throws JSONException {
        if (
            status.getInt("protocolVersion") != PROTOCOL_VERSION ||
            !validEpoch(status.getString("syncEpoch")) ||
            !validEpoch(status.getString("cursorEpoch")) ||
            status.getInt("accountGeneration") < 1 ||
            status.getLong("changeSeq") < 0 ||
            status.getDouble("serverTime") < 0
        ) {
            throw new IllegalArgumentException("Sync v2 status is invalid");
        }
        return status;
    }

    static JSONObject buildExchange(
        FocusLedgerNativeOutboxStore.Record record,
        JSONObject status
    ) throws JSONException {
        validateStatus(status);
        JSONArray mutations = new JSONArray();
        JSONArray stored = record.mutations();
        for (int index = 0; index < stored.length(); index++) {
            JSONObject source = stored.getJSONObject(index);
            JSONObject mutation = new JSONObject(source.toString());
            mutation.put("deviceId", record.deviceId);
            mutation.put("accountGeneration", status.getInt("accountGeneration"));
            mutations.put(mutation);
        }
        return new JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("deviceId", record.deviceId)
            .put("cursor", JSONObject.NULL)
            .put("mutations", mutations)
            .put("pullLimit", 1)
            .put("syncEpoch", status.getString("syncEpoch"))
            .put("cursorEpoch", status.getString("cursorEpoch"))
            .put("accountGeneration", status.getInt("accountGeneration"));
    }

    static void validateSuccessfulResponse(
        FocusLedgerNativeOutboxStore.Record record,
        JSONObject status,
        JSONObject response
    ) throws JSONException {
        if (
            response.getInt("protocolVersion") != PROTOCOL_VERSION ||
            !status.getString("syncEpoch").equals(response.getString("syncEpoch")) ||
            !status.getString("cursorEpoch").equals(response.getString("cursorEpoch")) ||
            status.getInt("accountGeneration") != response.getInt("accountGeneration") ||
            !response.has("changes") ||
            !(response.get("changes") instanceof JSONArray) ||
            !response.has("hasMore") ||
            !(response.get("hasMore") instanceof Boolean) ||
            !response.getString("nextCursor").matches("^c[0-9a-z]+$") ||
            response.getDouble("serverTime") < 0
        ) {
            throw new IllegalArgumentException("Sync v2 response is invalid");
        }
        JSONArray expectedMutations = record.mutations();
        JSONArray acknowledgements = response.getJSONArray("acks");
        if (acknowledgements.length() != expectedMutations.length()) {
            throw new IllegalArgumentException("Sync v2 acknowledgement count is invalid");
        }
        Map<String, JSONObject> expected = new HashMap<>();
        for (int index = 0; index < expectedMutations.length(); index++) {
            JSONObject mutation = expectedMutations.getJSONObject(index);
            expected.put(mutation.getString("opId"), mutation);
        }
        Set<String> seen = new HashSet<>();
        for (int index = 0; index < acknowledgements.length(); index++) {
            JSONObject acknowledgement = acknowledgements.getJSONObject(index);
            String opId = acknowledgement.getString("opId");
            JSONObject mutation = expected.get(opId);
            String statusValue = acknowledgement.getString("status");
            String fingerprint = acknowledgement.getString("fingerprint");
            if (
                mutation == null ||
                !seen.add(opId) ||
                !mutation.getString("entityType").equals(
                    acknowledgement.getString("entityType")
                ) ||
                !mutation.getString("entityId").equals(acknowledgement.getString("entityId")) ||
                (!"applied".equals(statusValue) && !"duplicate".equals(statusValue)) ||
                acknowledgement.getInt("revision") < 1 ||
                !fingerprint.matches("^[a-fA-F0-9]{32,128}$")
            ) {
                throw new IllegalArgumentException("Sync v2 acknowledgement is invalid");
            }
        }
    }

    private static boolean validEpoch(String value) {
        return value != null && !value.isEmpty() && value.length() <= 128;
    }
}
