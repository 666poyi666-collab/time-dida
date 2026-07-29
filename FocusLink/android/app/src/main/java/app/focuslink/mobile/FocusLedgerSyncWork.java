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
        return FocusLedgerSyncWorker.run(getApplicationContext())
            ? Result.retry()
            : Result.success();
    }
}
