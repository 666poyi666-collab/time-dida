package app.focuslink.mobile;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Durable completed-ledger delivery owned by WorkManager.
 *
 * <p>WorkManager persists this request across process death and boot, waits for a connected
 * network, and resumes after Doze. Authentication/authorization failures return success to stop
 * automatic retry storms; the outbox remains durable until an explicit credential repair
 * schedules the unique work again.
 */
public final class FocusLedgerSyncWork extends Worker {
    public FocusLedgerSyncWork(
        @NonNull Context applicationContext,
        @NonNull WorkerParameters parameters
    ) {
        super(applicationContext, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        String expectedDeviceId = FocusLedgerSyncScheduler.explicitExpectedDeviceId(getInputData());
        if (expectedDeviceId != null) {
            // A missing/malformed binding or an account/device switch is intentionally success:
            // terminal markers remain durable and an old explicit user gesture must never retry
            // against whichever account happens to be configured later.
            if (expectedDeviceId.isEmpty() || !isCurrentExpectedDevice(getApplicationContext(), expectedDeviceId)) {
                return Result.success();
            }
            FocusLedgerSyncWorker.runExplicit(getApplicationContext(), expectedDeviceId);
            // Terminal records are intentionally one-shot. Transport failures and a repeated
            // conflict/rejection retain their marker for the next explicit user gesture.
            return Result.success();
        }
        return FocusLedgerSyncWorker.run(getApplicationContext())
            ? Result.retry()
            : Result.success();
    }

    static boolean isCurrentExpectedDevice(Context context, String expectedDeviceId) {
        if (context == null || expectedDeviceId == null || expectedDeviceId.isEmpty()) return false;
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(context);
        return connection != null && expectedDeviceId.equals(connection.deviceId);
    }
}
