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
        try {
            JSONObject status = FocusLedgerSyncProtocol.validateStatus(
                client.fetchSyncV2Status(connection)
            );
            for (FocusLedgerNativeOutboxStore.Record record : pending) {
                JSONObject request = FocusLedgerSyncProtocol.buildExchange(record, status);
                JSONObject response = client.exchangeSyncV2(connection, request);
                FocusLedgerSyncProtocol.validateSuccessfulResponse(record, status, response);
                FocusLedgerNativeOutboxStore.remove(context, record.bundleId, record.deviceId);
            }
            return FocusLedgerNativeOutboxStore.countForDevice(context, connection.deviceId) > 0;
        } catch (Exception exception) {
            // Do not log the exception: transport implementations can carry
            // upstream body details. The durable record remains for backoff.
            return true;
        }
    }
}
