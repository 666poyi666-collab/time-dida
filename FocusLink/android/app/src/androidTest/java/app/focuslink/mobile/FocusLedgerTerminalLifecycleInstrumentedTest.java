package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.concurrent.futures.ResolvableFuture;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.work.ExistingWorkPolicy;
import androidx.work.Operation;
import com.getcapacitor.JSObject;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.AfterClass;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Exercises the completed-ledger terminal lifecycle against real isolated SharedPreferences.
 *
 * <p>It uses FocusRuntimePreferences isolation, so neither the normal native runtime namespace
 * nor an installed user's credential, command queue, or ledger state is read or cleared.
 */
@RunWith(AndroidJUnit4.class)
public class FocusLedgerTerminalLifecycleInstrumentedTest {
    private static final String DEVICE_ID = "terminal-lifecycle-device";
    private static final String FOREIGN_DEVICE_ID = "foreign-terminal-device";

    @BeforeClass
    public static void enableIsolatedPreferences() {
        FocusRuntimePreferences.enableTestIsolation(
            "focus_runtime_instrumentation_" + android.os.Process.myPid() + "_"
        );
    }

    @AfterClass
    public static void disableIsolatedPreferences() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            FocusLedgerSyncWorker.setCloudClientFactoryForTests(null);
            FocusLedgerSyncScheduler.setWorkOperationEnqueuerForTests(null);
            FocusRuntimeConnectionStore.clear(context);
        } finally {
            FocusRuntimePreferences.clearAndDisableTestIsolation(context);
        }
    }

    @Test
    public void keepsTerminalRecordsDurableUntilExplicitWorkerConfirmsAppliedAndDuplicate()
        throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        clearIsolatedLedgerState(context);
        FocusRuntimeConnectionStore.put(
            context,
            BuildConfig.CANONICAL_SYNC_ORIGIN,
            "instrumentation-terminal-ledger-token",
            DEVICE_ID
        );
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(context);
        assertNotNull(connection);
        String lease = FocusRuntimeConnectionStore.leaseFor(connection);
        assertNotNull(FocusRuntimeConnectionStore.connectionForSource(context, DEVICE_ID, lease));
        assertNull(FocusRuntimeConnectionStore.connectionForSource(context, "other-device", lease));
        assertNull(FocusRuntimeConnectionStore.connectionForSource(context, DEVICE_ID, lease + "1"));

        AtomicReference<String> acknowledgement = new AtomicReference<>("conflict");
        AtomicInteger exchangeCalls = new AtomicInteger();
        FocusLedgerSyncWorker.setCloudClientFactoryForTests(
            () -> scriptedClient(acknowledgement, exchangeCalls)
        );
        try {
            assertTerminalThenExplicitRepair(
                context,
                acknowledgement,
                exchangeCalls,
                "session-terminal-conflict",
                "conflict",
                "applied"
            );
            assertTerminalThenExplicitRepair(
                context,
                acknowledgement,
                exchangeCalls,
                "session-terminal-rejected",
                "rejected",
                "duplicate"
            );
            assertMatchedRemovalClearsBothOutboxAndSidecar(context);
            assertOrphanedSidecarIsNotPresentedAsARecheckableRecord(context);
        } finally {
            FocusLedgerSyncWorker.setCloudClientFactoryForTests(null);
            clearIsolatedLedgerState(context);
        }
    }

    @Test
    public void validatedCheckpointClearsHistoricalNetworkErrorBeforeTerminalAttention()
        throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        clearIsolatedLedgerState(context);
        FocusRuntimeConnectionStore.put(
            context,
            BuildConfig.CANONICAL_SYNC_ORIGIN,
            "instrumentation-terminal-recency-token",
            DEVICE_ID
        );
        assertTrue(
            FocusLedgerNativeOutboxStore.enqueue(
                context,
                record("session-terminal-after-network"),
                DEVICE_ID
            )
        );
        FocusAuthorityProjectionStore.recordLedgerFailure(context, "network_error", 1L);

        AtomicReference<String> acknowledgement = new AtomicReference<>("conflict");
        AtomicInteger exchangeCalls = new AtomicInteger();
        FocusLedgerSyncWorker.setCloudClientFactoryForTests(
            () -> scriptedClient(acknowledgement, exchangeCalls)
        );
        try {
            assertFalse(FocusLedgerSyncWorker.run(context));
            assertEquals(1, exchangeCalls.get());

            android.content.SharedPreferences projection = FocusRuntimePreferences.get(
                context,
                "focus_authority_projection_v1"
            );
            assertEquals("", projection.getString("lastErrorCode", ""));
            FocusLedgerNativeOutboxStore.TerminalStatus terminal =
                FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID);
            assertEquals(1, terminal.count);
            assertEquals("conflict_present", terminal.lastErrorCode);

            String errorCode = FocusAuthorityProjectionProvider.terminalAwareError(
                projection.getString("lastErrorCode", ""),
                terminal
            );
            assertEquals("conflict_present", errorCode);
            assertEquals(
                "unknown",
                FocusAuthorityProjectionV1.freshness(
                    true,
                    projection.getLong("lastVerifiedAt", 0L),
                    projection.getLong("lastAttemptAt", 0L),
                    errorCode,
                    System.currentTimeMillis()
                )
            );
        } finally {
            FocusLedgerSyncWorker.setCloudClientFactoryForTests(null);
            clearIsolatedLedgerState(context);
        }
    }

    @Test
    public void preservesTerminalMarkersAcrossFailedEnqueueAndAccountSwitch() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        clearIsolatedLedgerState(context);
        FocusRuntimeConnectionStore.put(
            context,
            BuildConfig.CANONICAL_SYNC_ORIGIN,
            "instrumentation-terminal-requeue-token",
            DEVICE_ID
        );
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(context);
        assertNotNull(connection);
        String lease = FocusRuntimeConnectionStore.leaseFor(connection);
        AtomicReference<ResolvableFuture<Operation.State.SUCCESS>> nextOperation =
            new AtomicReference<>();
        AtomicInteger enqueues = new AtomicInteger();
        FocusLedgerSyncScheduler.setWorkOperationEnqueuerForTests(
            (ignoredContext, workName, policy, request) -> {
                assertEquals(FocusLedgerSyncScheduler.EXPLICIT_RECHECK_WORK_NAME, workName);
                assertEquals(ExistingWorkPolicy.REPLACE, policy);
                assertTrue(
                    request
                        .getWorkSpec()
                        .input
                        .getBoolean(FocusLedgerSyncScheduler.INPUT_EXPLICIT_RECHECK, false)
                );
                assertEquals(
                    DEVICE_ID,
                    request
                        .getWorkSpec()
                        .input
                        .getString(FocusLedgerSyncScheduler.INPUT_EXPECTED_DEVICE_ID)
                );
                ResolvableFuture<Operation.State.SUCCESS> result = nextOperation.get();
                assertNotNull(result);
                enqueues.incrementAndGet();
                return operation(result);
            }
        );
        try {
            RecordingRequeueListener invalid = new RecordingRequeueListener();
            FocusLedgerTerminalRequeue.requeue(
                context,
                "other-device",
                lease,
                Runnable::run,
                invalid
            );
            assertEquals(1, invalid.staleConnections);
            assertEquals(0, enqueues.get());

            String foreignBundle = "session-terminal-foreign";
            assertTrue(
                FocusLedgerNativeOutboxStore.enqueue(
                    context,
                    record(foreignBundle, FOREIGN_DEVICE_ID),
                    FOREIGN_DEVICE_ID
                )
            );
            FocusLedgerNativeOutboxStore.markTerminal(
                context,
                foreignBundle,
                FOREIGN_DEVICE_ID,
                "conflict_present",
                System.currentTimeMillis()
            );

            String terminalBundle = "session-terminal-enqueue-failure";
            assertTrue(FocusLedgerNativeOutboxStore.enqueue(context, record(terminalBundle), DEVICE_ID));
            FocusLedgerNativeOutboxStore.markTerminal(
                context,
                terminalBundle,
                DEVICE_ID,
                "conflict_present",
                System.currentTimeMillis()
            );
            appendRawTerminalMarker(
                context,
                "session-terminal-current-orphan",
                DEVICE_ID,
                "rejected_operation"
            );
            ResolvableFuture<Operation.State.SUCCESS> firstFailure = ResolvableFuture.create();
            nextOperation.set(firstFailure);
            RecordingRequeueListener failed = new RecordingRequeueListener();
            FocusLedgerTerminalRequeue.requeue(
                context,
                DEVICE_ID,
                lease,
                Runnable::run,
                failed
            );
            assertEquals(1, enqueues.get());
            assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
            assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
            assertEquals(
                1,
                FocusLedgerNativeOutboxStore.readTerminalRecordsForDevice(context, DEVICE_ID).size()
            );
            assertEquals(
                1,
                FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, FOREIGN_DEVICE_ID).count
            );
            assertFalse(
                hasTerminalMarker(
                    terminalMarkers(context),
                    "session-terminal-current-orphan",
                    DEVICE_ID
                )
            );
            assertTrue(hasTerminalMarker(terminalMarkers(context), foreignBundle, FOREIGN_DEVICE_ID));
            firstFailure.setException(new IllegalStateException("instrumented enqueue failure"));
            assertEquals(1, failed.failures);
            assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
            assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);

            ResolvableFuture<Operation.State.SUCCESS> staleFailure = ResolvableFuture.create();
            nextOperation.set(staleFailure);
            RecordingRequeueListener stale = new RecordingRequeueListener();
            FocusLedgerTerminalRequeue.requeue(
                context,
                DEVICE_ID,
                lease,
                Runnable::run,
                stale
            );
            FocusRuntimeConnectionStore.put(
                context,
                BuildConfig.CANONICAL_SYNC_ORIGIN,
                "instrumentation-terminal-requeue-new-token",
                FOREIGN_DEVICE_ID
            );
            staleFailure.set(Operation.SUCCESS);
            assertEquals(1, stale.staleConnections);
            assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
            assertFalse(FocusLedgerSyncWork.isCurrentExpectedDevice(context, DEVICE_ID));
            assertFalse(FocusLedgerSyncWorker.runExplicit(context, DEVICE_ID));
            // B's ordinary worker also sees no A terminal record and cannot turn it into a retry.
            assertFalse(FocusLedgerSyncWorker.run(context));
            assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
            assertEquals(
                1,
                FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, FOREIGN_DEVICE_ID).count
            );

            // Returning to A yields a new volatile lease, but the persisted expected device still
            // lets the dedicated worker consume its retained marker. No lease is in Work input.
            FocusRuntimeConnectionStore.put(
                context,
                BuildConfig.CANONICAL_SYNC_ORIGIN,
                "instrumentation-terminal-requeue-original-token",
                DEVICE_ID
            );
            AtomicReference<String> acknowledgement = new AtomicReference<>("applied");
            AtomicInteger exchangeCalls = new AtomicInteger();
            FocusLedgerSyncWorker.setCloudClientFactoryForTests(
                () -> scriptedClient(acknowledgement, exchangeCalls)
            );
            assertTrue(FocusLedgerSyncWork.isCurrentExpectedDevice(context, DEVICE_ID));
            assertFalse(FocusLedgerSyncWorker.run(context));
            assertFalse(FocusLedgerSyncWorker.runExplicit(context, DEVICE_ID));
            assertEquals(1, exchangeCalls.get());
            assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
            assertEquals(0, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
            // The A gesture never clears or rewrites B's terminal state.
            assertEquals(
                1,
                FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, FOREIGN_DEVICE_ID).count
            );
        } finally {
            FocusLedgerSyncWorker.setCloudClientFactoryForTests(null);
            FocusLedgerSyncScheduler.setWorkOperationEnqueuerForTests(null);
            clearIsolatedLedgerState(context);
        }
    }

    @Test
    public void prunesOrphansBeforeTerminalCapacityCheckWithoutRemovingForeignDurableMarker()
        throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        clearIsolatedLedgerState(context);
        try {
            String foreignBundle = "session-terminal-capacity-foreign";
            assertTrue(
                FocusLedgerNativeOutboxStore.enqueue(
                    context,
                    record(foreignBundle, FOREIGN_DEVICE_ID),
                    FOREIGN_DEVICE_ID
                )
            );
            FocusLedgerNativeOutboxStore.markTerminal(
                context,
                foreignBundle,
                FOREIGN_DEVICE_ID,
                "rejected_operation",
                System.currentTimeMillis()
            );
            JSONArray terminals = terminalMarkers(context);
            for (int index = 0; index < 127; index++) {
                terminals.put(
                    new JSONObject()
                        .put("bundleId", "orphan-terminal-" + index)
                        .put("deviceId", "orphan-device-" + index)
                        .put("errorCode", "conflict_present")
                        .put("recordedAtEpochMs", index + 1)
                );
            }
            assertEquals(128, terminals.length());
            assertTrue(
                FocusRuntimePreferences
                    .get(context, "focus_ledger_native_outbox_v1")
                    .edit()
                    .putString("terminals", terminals.toString())
                    .commit()
            );

            String currentBundle = "session-terminal-capacity-current";
            assertTrue(FocusLedgerNativeOutboxStore.enqueue(context, record(currentBundle), DEVICE_ID));
            // markTerminal's explicitly named global orphan-GC makes room before the capacity
            // check, but keeps the foreign marker because its durable foreign record still exists.
            FocusLedgerNativeOutboxStore.markTerminal(
                context,
                currentBundle,
                DEVICE_ID,
                "conflict_present",
                System.currentTimeMillis()
            );
            assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
            assertEquals(
                1,
                FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, FOREIGN_DEVICE_ID).count
            );
            assertEquals(2, terminalMarkers(context).length());
        } finally {
            clearIsolatedLedgerState(context);
        }
    }

    private static void assertTerminalThenExplicitRepair(
        Context context,
        AtomicReference<String> acknowledgement,
        AtomicInteger exchangeCalls,
        String bundleId,
        String terminalStatus,
        String confirmationStatus
    ) throws Exception {
        assertTrue(FocusLedgerNativeOutboxStore.enqueue(context, record(bundleId), DEVICE_ID));
        acknowledgement.set(terminalStatus);
        int callsBefore = exchangeCalls.get();

        assertFalse(FocusLedgerSyncWorker.run(context));
        assertEquals(callsBefore + 1, exchangeCalls.get());
        assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
        assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);

        // A normal worker pass must not re-deliver a terminal record on its own.
        assertFalse(FocusLedgerSyncWorker.run(context));
        assertEquals(callsBefore + 1, exchangeCalls.get());
        assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));

        // The explicit worker reads only terminal records. The marker stays durable until a
        // confirmed acknowledgement removes both the outbox record and the sidecar.
        acknowledgement.set(confirmationStatus);
        assertFalse(FocusLedgerSyncWorker.runExplicit(context, DEVICE_ID));
        assertEquals(callsBefore + 2, exchangeCalls.get());
        assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
        assertEquals(0, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
    }

    private static void assertMatchedRemovalClearsBothOutboxAndSidecar(Context context)
        throws Exception {
        String bundleId = "session-terminal-remove";
        assertTrue(FocusLedgerNativeOutboxStore.enqueue(context, record(bundleId), DEVICE_ID));
        FocusLedgerNativeOutboxStore.markTerminal(
            context,
            bundleId,
            DEVICE_ID,
            "conflict_present",
            System.currentTimeMillis()
        );
        assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
        assertEquals(1, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);

        FocusLedgerNativeOutboxStore.remove(context, bundleId, DEVICE_ID);
        assertEquals(0, FocusLedgerNativeOutboxStore.countForDevice(context, DEVICE_ID));
        assertEquals(0, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
    }

    private static void assertOrphanedSidecarIsNotPresentedAsARecheckableRecord(Context context)
        throws Exception {
        String bundleId = "session-terminal-orphan";
        assertTrue(FocusLedgerNativeOutboxStore.enqueue(context, record(bundleId), DEVICE_ID));
        FocusLedgerNativeOutboxStore.markTerminal(
            context,
            bundleId,
            DEVICE_ID,
            "rejected_operation",
            System.currentTimeMillis()
        );
        // Simulate a process death after the outbox delete commit but before sidecar cleanup.
        assertTrue(
            FocusRuntimePreferences
                .get(context, "focus_ledger_native_outbox_v1")
                .edit()
                .putString("records", "[]")
                .commit()
        );
        assertEquals(0, FocusLedgerNativeOutboxStore.terminalStatusForDevice(context, DEVICE_ID).count);
        assertEquals(
            0,
            FocusLedgerNativeOutboxStore.readTerminalRecordsForDevice(context, DEVICE_ID).size()
        );
        assertEquals(0, terminalMarkers(context).length());
    }

    private static FocusCloudClient scriptedClient(
        AtomicReference<String> acknowledgement,
        AtomicInteger exchangeCalls
    ) {
        return new FocusCloudClient(
            (method, url, token, body) -> {
                try {
                    if (url.endsWith("/sync/v2/status")) return response(status());
                    if (url.endsWith("/sync/v2/exchange")) {
                        exchangeCalls.incrementAndGet();
                        JSONObject request = new JSONObject(
                            new String(body, StandardCharsets.UTF_8)
                        );
                        return response(exchangeResponse(request, acknowledgement.get()));
                    }
                    throw new IOException("unexpected isolated ledger request");
                } catch (JSONException exception) {
                    throw new IOException("isolated ledger fixture is invalid", exception);
                }
            }
        );
    }

    private static FocusCloudClient.Response response(JSONObject value) {
        return new FocusCloudClient.Response(
            200,
            value.toString().getBytes(StandardCharsets.UTF_8)
        );
    }

    private static JSONObject status() throws JSONException {
        return new JSONObject()
            .put("protocolVersion", 2)
            .put("syncEpoch", "isolated-sync-1")
            .put("cursorEpoch", "isolated-cursor-1")
            .put("accountGeneration", 1)
            .put("changeSeq", 1)
            .put("serverTime", System.currentTimeMillis());
    }

    private static JSONObject exchangeResponse(JSONObject request, String status) throws JSONException {
        boolean accepted = "applied".equals(status) || "duplicate".equals(status);
        JSONArray acknowledgements = new JSONArray();
        JSONArray mutations = request.getJSONArray("mutations");
        for (int index = 0; index < mutations.length(); index++) {
            JSONObject mutation = mutations.getJSONObject(index);
            acknowledgements.put(
                new JSONObject()
                    .put("opId", mutation.getString("opId"))
                    .put("entityType", mutation.getString("entityType"))
                    .put("entityId", mutation.getString("entityId"))
                    .put("status", status)
                    .put("revision", accepted ? index + 1 : JSONObject.NULL)
                    .put("fingerprint", accepted ? "a".repeat(32) : JSONObject.NULL)
                    .put("errorCode", accepted ? JSONObject.NULL : "isolated_terminal")
            );
        }
        return new JSONObject()
            .put("protocolVersion", 2)
            .put("syncEpoch", "isolated-sync-1")
            .put("cursorEpoch", "isolated-cursor-1")
            .put("accountGeneration", 1)
            .put("acks", acknowledgements)
            .put("changes", new JSONArray())
            .put("nextCursor", "c1")
            .put("hasMore", false)
            .put("serverTime", System.currentTimeMillis());
    }

    private static JSObject record(String bundleId) throws JSONException {
        return record(bundleId, DEVICE_ID);
    }

    private static JSObject record(String bundleId, String deviceId) throws JSONException {
        JSObject ledger = new JSObject()
            .put("sessionId", bundleId)
            .put("startedAt", 1)
            .put("endedAt", 2)
            .put("status", "finished")
            .put("activeElapsedMs", 1)
            .put("pausedElapsedMs", 0)
            .put("wallElapsedMs", 1)
            .put("originDeviceId", deviceId)
            .put("segments", new JSONArray())
            .put("pauses", new JSONArray());
        JSObject metadata = new JSObject()
            .put("sessionId", bundleId)
            .put("title", "isolated terminal lifecycle")
            .put("note", JSONObject.NULL)
            .put("subject", JSONObject.NULL)
            .put("tags", new JSONArray())
            .put("taskAssociation", JSONObject.NULL)
            .put("updatedAt", 2)
            .put("updatedByDeviceId", deviceId);
        return new JSObject()
            .put("schemaVersion", 1)
            .put("bundleId", bundleId)
            .put("deviceId", deviceId)
            .put(
                "mutations",
                new JSONArray()
                    .put(mutation("ledger-" + bundleId, "focus_ledger_v2", bundleId, ledger))
                    .put(mutation("metadata-" + bundleId, "focus_metadata_v2", bundleId, metadata))
            );
    }

    private static JSONObject mutation(
        String opId,
        String entityType,
        String bundleId,
        JSONObject payload
    ) throws JSONException {
        return new JSONObject()
            .put("opId", opId)
            .put("entityType", entityType)
            .put("entityId", bundleId)
            .put("kind", "put")
            .put("baseRevision", 0)
            .put("baseFingerprint", JSONObject.NULL)
            .put("payload", payload);
    }

    private static void clearIsolatedLedgerState(Context context) {
        FocusRuntimeConnectionStore.clear(context);
        FocusRuntimePreferences
            .get(context, "focus_ledger_native_outbox_v1")
            .edit()
            .clear()
            .commit();
        FocusRuntimePreferences
            .get(context, "focus_authority_projection_v1")
            .edit()
            .clear()
            .commit();
    }

    private static JSONArray terminalMarkers(Context context) throws JSONException {
        String raw = FocusRuntimePreferences
            .get(context, "focus_ledger_native_outbox_v1")
            .getString("terminals", "[]");
        return new JSONArray(raw == null ? "[]" : raw);
    }

    private static void appendRawTerminalMarker(
        Context context,
        String bundleId,
        String deviceId,
        String errorCode
    ) throws JSONException {
        JSONArray terminals = terminalMarkers(context);
        terminals.put(
            new JSONObject()
                .put("bundleId", bundleId)
                .put("deviceId", deviceId)
                .put("errorCode", errorCode)
                .put("recordedAtEpochMs", System.currentTimeMillis())
        );
        assertTrue(
            FocusRuntimePreferences
                .get(context, "focus_ledger_native_outbox_v1")
                .edit()
                .putString("terminals", terminals.toString())
                .commit()
        );
    }

    private static boolean hasTerminalMarker(JSONArray terminals, String bundleId, String deviceId) {
        for (int index = 0; index < terminals.length(); index++) {
            JSONObject terminal = terminals.optJSONObject(index);
            if (
                terminal != null &&
                bundleId.equals(terminal.optString("bundleId", "")) &&
                deviceId.equals(terminal.optString("deviceId", ""))
            ) {
                return true;
            }
        }
        return false;
    }

    private static Operation operation(ResolvableFuture<Operation.State.SUCCESS> result) {
        return new Operation() {
            private final MutableLiveData<Operation.State> state = new MutableLiveData<>(
                Operation.IN_PROGRESS
            );

            @Override
            public LiveData<Operation.State> getState() {
                return state;
            }

            @Override
            public ListenableFuture<Operation.State.SUCCESS> getResult() {
                return result;
            }
        };
    }

    private static final class RecordingRequeueListener implements FocusLedgerTerminalRequeue.Listener {
        int requeued;
        int staleConnections;
        int failures;

        @Override
        public void onRequeued(int count) {
            requeued += 1;
        }

        @Override
        public void onStaleConnection() {
            staleConnections += 1;
        }

        @Override
        public void onFailure() {
            failures += 1;
        }
    }
}
