package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class FocusAuthorityProjectionV1Test {
    @Test
    public void projectionHasExactPublicTopLevelAndNoCredentialMaterial() throws Exception {
        JSONObject projection = FocusAuthorityProjectionV1.build(
            17L,
            1_000L,
            "fresh",
            "paired",
            "",
            2,
            new JSONObject().put("state", "running").put("title", "复习化学"),
            new JSONArray()
        );
        Set<String> keys = new HashSet<>();
        Iterator<String> iterator = projection.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        assertEquals(
            new HashSet<>(java.util.Arrays.asList(
                "schemaVersion",
                "source",
                "revision",
                "lastVerifiedAt",
                "freshness",
                "payload"
            )),
            keys
        );
        String serialized = projection.toString();
        assertFalse(serialized.contains("fl2_"));
        assertFalse(serialized.contains("Authorization"));
        assertFalse(serialized.contains("deviceId"));
        assertFalse(serialized.contains("cursor"));
        assertFalse(serialized.contains("envelope"));
    }

    @Test
    public void freshnessDistinguishesEveryFailClosedState() {
        assertEquals("blocked", FocusAuthorityProjectionV1.freshness(false, 0, 0, "", 10));
        assertEquals("unknown", FocusAuthorityProjectionV1.freshness(true, 0, 0, "", 10));
        assertEquals("offline", FocusAuthorityProjectionV1.freshness(true, 0, 9, "network_error", 10));
        assertEquals("fresh", FocusAuthorityProjectionV1.freshness(true, 10, 10, "", 11));
        assertEquals(
            "stale",
            FocusAuthorityProjectionV1.freshness(
                true,
                10,
                10,
                "",
                10 + FocusAuthorityProjectionV1.FRESH_AFTER_MS + 1
            )
        );
        assertEquals("offline", FocusAuthorityProjectionV1.freshness(true, 10, 11, "timeout", 12));
        assertEquals(
            "blocked",
            FocusAuthorityProjectionV1.freshness(
                true,
                10,
                11,
                "authentication_failed",
                12
            )
        );
        assertEquals(
            "blocked",
            FocusAuthorityProjectionV1.freshness(
                true,
                10,
                11,
                "revision_rollback",
                12
            )
        );
        assertTrue(FocusAuthorityProjectionV1.FRESH_AFTER_MS > 0L);
    }

    @Test
    public void historyProjectionKeepsExactTaskAndTimingFields() throws Exception {
        JSONObject task = new JSONObject()
            .put("taskId", "task-chemistry")
            .put("source", "ticktick")
            .put("title", "化学错题");
        JSONObject record = new JSONObject()
            .put("sessionId", "session-1")
            .put("startedAt", 1_000L)
            .put("endedAt", 61_000L)
            .put("status", "finished")
            .put("activeMs", 50_000L)
            .put("pausedMs", 10_000L)
            .put("wallMs", 60_000L)
            .put("title", "化学复习")
            .put("task", task);

        JSONArray history = FocusAuthorityProjectionStore.sanitizeHistory(
            new JSONArray().put(record)
        );

        assertEquals(1, history.length());
        assertEquals(task.toString(), history.getJSONObject(0).getJSONObject("task").toString());
        assertEquals(
            new HashSet<>(java.util.Arrays.asList(
                "sessionId",
                "startedAt",
                "endedAt",
                "status",
                "activeMs",
                "pausedMs",
                "wallMs",
                "title",
                "task"
            )),
            keys(history.getJSONObject(0))
        );
        assertEquals(
            new HashSet<>(java.util.Arrays.asList("taskId", "source", "title")),
            keys(history.getJSONObject(0).getJSONObject("task"))
        );
    }

    @Test
    public void historyProjectionRejectsInconsistentDurationsFailClosed() throws Exception {
        JSONObject record = new JSONObject()
            .put("sessionId", "session-invalid")
            .put("startedAt", 1_000L)
            .put("endedAt", 61_000L)
            .put("status", "finished")
            .put("activeMs", 50_000L)
            .put("pausedMs", 10_000L)
            .put("wallMs", 59_999L)
            .put("title", JSONObject.NULL)
            .put("task", JSONObject.NULL);
        try {
            FocusAuthorityProjectionStore.sanitizeHistory(new JSONArray().put(record));
            fail("expected inconsistent authority history to be rejected");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("timing"));
        }
    }

    @Test
    public void ledgerCheckpointRejectsRollbackAndEpochDriftButAcceptsNewGeneration() {
        FocusAuthorityProjectionStore.requireMonotonicLedgerCheckpoint(
            2,
            9L,
            "sync-2",
            "cursor-2",
            2,
            10L,
            "sync-2",
            "cursor-2"
        );
        FocusAuthorityProjectionStore.requireMonotonicLedgerCheckpoint(
            2,
            9L,
            "sync-2",
            "cursor-2",
            3,
            0L,
            "sync-3",
            "cursor-3"
        );
        assertLedgerCheckpointRejected(2, 8L, "sync-2", "cursor-2", "rollback");
        assertLedgerCheckpointRejected(2, 9L, "sync-drift", "cursor-2", "conflict");
    }

    @Test
    public void providerContractUsesTheVersionedSameSignatureConstants() {
        assertEquals(
            BuildConfig.APPLICATION_ID + ".authority.projection",
            FocusAuthorityProjectionProvider.AUTHORITY
        );
        assertEquals(
            BuildConfig.APPLICATION_ID + ".permission.READ_AUTHORITY_PROJECTION",
            FocusAuthorityProjectionProvider.READ_PERMISSION
        );
        assertEquals("getProjectionV1", FocusAuthorityProjectionProvider.METHOD_GET_V1);
        assertEquals("projection", FocusAuthorityProjectionProvider.RESULT_PROJECTION);
    }

    private static Set<String> keys(JSONObject value) {
        Set<String> result = new HashSet<>();
        Iterator<String> iterator = value.keys();
        while (iterator.hasNext()) result.add(iterator.next());
        return result;
    }

    private static void assertLedgerCheckpointRejected(
        int generation,
        long changeSeq,
        String syncEpoch,
        String cursorEpoch,
        String expected
    ) {
        try {
            FocusAuthorityProjectionStore.requireMonotonicLedgerCheckpoint(
                2,
                9L,
                "sync-2",
                "cursor-2",
                generation,
                changeSeq,
                syncEpoch,
                cursorEpoch
            );
            fail("expected ledger checkpoint rejection");
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains(expected));
        }
    }
}
