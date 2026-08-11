package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import androidx.work.ExistingWorkPolicy;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class FocusLedgerSyncProtocolTest {
    @Test
    public void forbiddenLedgerKeysUseLocaleIndependentCaseFolding() {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            assertTrue(FocusLedgerNativeOutboxStore.isForbiddenKey("AUTHORIZATION"));
            assertTrue(FocusLedgerNativeOutboxStore.isForbiddenKey("ACCESS_TOKEN".replace("_", "")));
        } finally {
            Locale.setDefault(previous);
        }
    }

    @Test
    public void buildsCursorlessExchangeAndAcceptsOnlyMatchingAppliedOrDuplicateAcks() throws Exception {
        FocusLedgerNativeOutboxStore.Record record = record();
        JSONObject status = status();
        JSONObject request = FocusLedgerSyncProtocol.buildExchange(record, status);

        assertEquals(2, request.getInt("protocolVersion"));
        assertEquals("device-native", request.getString("deviceId"));
        assertEquals(JSONObject.NULL, request.get("cursor"));
        assertEquals(2, request.getJSONArray("mutations").length());
        assertEquals(
            3,
            request.getJSONArray("mutations").getJSONObject(0).getInt("accountGeneration")
        );

        FocusLedgerSyncProtocol.AcknowledgementResult applied =
            FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status, response(record, "applied"));
        FocusLedgerSyncProtocol.AcknowledgementResult duplicate =
            FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status, response(record, "duplicate"));
        assertFalse(applied.requiresManualResolution());
        assertFalse(duplicate.requiresManualResolution());
        assertFalse(FocusLedgerSyncWorker.stopsOrdinaryRetry(applied));
    }

    @Test
    public void classifiesConflictAndRejectedAcknowledgementsAsDurableTerminalReasons() throws Exception {
        FocusLedgerNativeOutboxStore.Record record = record();
        FocusLedgerSyncProtocol.AcknowledgementResult conflict =
            FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status(), response(record, "conflict"));
        assertTrue(conflict.requiresManualResolution());
        assertTrue(FocusLedgerSyncWorker.stopsOrdinaryRetry(conflict));
        assertEquals("conflict_present", conflict.terminalErrorCode);

        FocusLedgerSyncProtocol.AcknowledgementResult rejected =
            FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status(), response(record, "rejected"));
        assertTrue(rejected.requiresManualResolution());
        assertTrue(FocusLedgerSyncWorker.stopsOrdinaryRetry(rejected));
        assertEquals("rejected_operation", rejected.terminalErrorCode);

        JSONObject mixed = response(record, "conflict");
        mixed.getJSONArray("acks").getJSONObject(1).put("status", "rejected");
        assertEquals(
            "rejected_operation",
            FocusLedgerSyncProtocol
                .validateSuccessfulResponse(record, status(), mixed)
                .terminalErrorCode
        );
    }

    @Test
    public void rejectsMismatchedAcknowledgementsEvenWhenTheyClaimTerminalStatus() throws Exception {
        FocusLedgerNativeOutboxStore.Record record = record();
        JSONObject mismatched = response(record, "conflict");
        mismatched
            .getJSONArray("acks")
            .getJSONObject(0)
            .put("entityId", "different-session");
        assertRejected(record, mismatched);
    }

    @Test
    public void cursorlessNativeWriterIgnoresUnconsumedFocusGuardChanges() throws Exception {
        FocusLedgerNativeOutboxStore.Record record = record();
        JSONObject response = response(record, "applied");
        response
            .getJSONArray("changes")
            .put(
                new JSONObject()
                    .put("changeSeq", 9)
                    .put("entityType", "focus_guard_rule_v1")
                    .put("entityId", "rule-study-hours")
                    .put("revision", 1)
                    .put("fingerprint", "b".repeat(32))
                    .put("deleted", false)
                    .put("payload", new JSONObject().put("opaque", true))
                    .put("sourceDeviceId", "device-desktop")
            );

        FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status(), response);
    }

    @Test
    public void explicitTerminalRecheckReplacesAnInFlightOrdinaryWorker() {
        assertEquals(ExistingWorkPolicy.KEEP, FocusLedgerSyncScheduler.ordinaryPolicy());
        assertEquals(
            ExistingWorkPolicy.REPLACE,
            FocusLedgerSyncScheduler.explicitTerminalRecheckPolicy()
        );
        assertFalse(
            FocusLedgerSyncScheduler.UNIQUE_WORK_NAME.equals(
                FocusLedgerSyncScheduler.EXPLICIT_RECHECK_WORK_NAME
            )
        );
    }

    private static void assertRejected(
        FocusLedgerNativeOutboxStore.Record record,
        JSONObject response
    ) throws Exception {
        try {
            FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status(), response);
            fail("expected response rejection");
        } catch (IllegalArgumentException expected) {
            // Expected fail-closed behavior.
        }
    }

    private static FocusLedgerNativeOutboxStore.Record record() throws Exception {
        JSONObject value = new JSONObject()
            .put("schemaVersion", 1)
            .put("bundleId", "session-native")
            .put("deviceId", "device-native")
            .put(
                "mutations",
                new JSONArray()
                    .put(mutation("ledger-op", "focus_ledger_v2", ledger()))
                    .put(mutation("metadata-op", "focus_metadata_v2", metadata()))
            );
        return new FocusLedgerNativeOutboxStore.Record(
            "session-native",
            "device-native",
            value
        );
    }

    private static JSONObject mutation(String opId, String entityType, JSONObject payload)
        throws Exception {
        return new JSONObject()
            .put("opId", opId)
            .put("entityType", entityType)
            .put("entityId", "session-native")
            .put("kind", "put")
            .put("baseRevision", 0)
            .put("baseFingerprint", JSONObject.NULL)
            .put("payload", payload);
    }

    private static JSONObject ledger() throws Exception {
        return new JSONObject()
            .put("sessionId", "session-native")
            .put("startedAt", 1)
            .put("endedAt", 2)
            .put("status", "finished")
            .put("activeElapsedMs", 1)
            .put("pausedElapsedMs", 0)
            .put("wallElapsedMs", 1)
            .put("originDeviceId", "device-native")
            .put("segments", new JSONArray())
            .put("pauses", new JSONArray());
    }

    private static JSONObject metadata() throws Exception {
        return new JSONObject()
            .put("sessionId", "session-native")
            .put("title", "native")
            .put("note", JSONObject.NULL)
            .put("subject", JSONObject.NULL)
            .put("tags", new JSONArray())
            .put("taskAssociation", JSONObject.NULL)
            .put("updatedAt", 2)
            .put("updatedByDeviceId", "device-native");
    }

    private static JSONObject status() throws Exception {
        return new JSONObject()
            .put("protocolVersion", 2)
            .put("syncEpoch", "sync-1")
            .put("cursorEpoch", "cursor-1")
            .put("accountGeneration", 3)
            .put("changeSeq", 9)
            .put("serverTime", 10);
    }

    private static JSONObject response(
        FocusLedgerNativeOutboxStore.Record record,
        String ackStatus
    ) throws Exception {
        JSONArray acknowledgements = new JSONArray();
        JSONArray mutations = record.mutations();
        for (int index = 0; index < mutations.length(); index++) {
            JSONObject mutation = mutations.getJSONObject(index);
            boolean accepted = "applied".equals(ackStatus) || "duplicate".equals(ackStatus);
            acknowledgements.put(
                new JSONObject()
                    .put("opId", mutation.getString("opId"))
                    .put("entityType", mutation.getString("entityType"))
                    .put("entityId", mutation.getString("entityId"))
                    .put("status", ackStatus)
                    .put("revision", accepted ? index + 1 : JSONObject.NULL)
                    .put("fingerprint", accepted ? "a".repeat(32) : JSONObject.NULL)
                    .put("errorCode", accepted ? JSONObject.NULL : "server_terminal")
            );
        }
        return new JSONObject()
            .put("protocolVersion", 2)
            .put("syncEpoch", "sync-1")
            .put("cursorEpoch", "cursor-1")
            .put("accountGeneration", 3)
            .put("acks", acknowledgements)
            .put("changes", new JSONArray())
            .put("nextCursor", "c9")
            .put("hasMore", false)
            .put("serverTime", 11);
    }
}
