package app.focuslink.mobile;

import android.content.Context;
import java.util.List;
import org.json.JSONObject;

final class FocusLedgerSyncWorker {
    private FocusLedgerSyncWorker() {}

    /** Returns true when Android should retry after a transport or contract failure. */
    static boolean run(Context context) {
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(context);
        if (connection == null) return false;
        List<FocusLedgerNativeOutboxStore.Record> pending =
            FocusLedgerNativeOutboxStore.readForDevice(context, connection.deviceId);
        if (pending.isEmpty()) return false;
        FocusCloudClient client = FocusCloudClient.createDefault();
        long attemptedAt = System.currentTimeMillis();
        try {
            FocusAuthorityProjectionStore.recordLedgerAttempt(context, attemptedAt);
            JSONObject status = FocusLedgerSyncProtocol.validateStatus(
                client.fetchSyncV2Status(connection)
            );
            FocusAuthorityProjectionStore.recordLedgerCheckpoint(context, status);
            for (FocusLedgerNativeOutboxStore.Record record : pending) {
                JSONObject request = FocusLedgerSyncProtocol.buildExchange(record, status);
                JSONObject response = client.exchangeSyncV2(connection, request);
                FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status, response);
                // Persist the credential-free confirmed projection before removing the
                // delivery record. A crash between these commits safely replays a duplicate.
                FocusAuthorityProjectionStore.confirmCompletedRecord(
                    context,
                    record,
                    System.currentTimeMillis()
                );
                FocusLedgerNativeOutboxStore.remove(context, record.bundleId, record.deviceId);
            }
            return FocusLedgerNativeOutboxStore.countForDevice(context, connection.deviceId) > 0;
        } catch (FocusCloudClient.CloudException exception) {
            String code = exception.isAuthenticationFailure()
                ? "authentication_failed"
                : exception.isAuthorizationFailure()
                    ? "authorization_failed"
                    : FocusNotificationService.pollErrorCode(exception);
            recordFailure(context, code);
            // Revocation and scope denial require explicit repair. Retrying the same
            // credential would only create a background request storm.
            return !exception.isAuthenticationFailure() && !exception.isAuthorizationFailure();
        } catch (Exception exception) {
            // Do not log the exception: transport implementations can carry
            // upstream body details. The durable record remains for backoff.
            String code = FocusNotificationService.pollErrorCode(exception);
            recordFailure(context, code);
            return !FocusAuthorityProjectionV1.isBlockingError(code);
        }
    }

    private static void recordFailure(Context context, String errorCode) {
        try {
            FocusAuthorityProjectionStore.recordLedgerFailure(
                context,
                errorCode,
                System.currentTimeMillis()
            );
        } catch (RuntimeException ignored) {
            // The delivery record is still durable. Do not replace the original
            // safe error classification with persistence details.
        }
    }
}
