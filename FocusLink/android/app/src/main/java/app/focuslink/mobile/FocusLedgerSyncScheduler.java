package app.focuslink.mobile;

import android.content.Context;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

final class FocusLedgerSyncScheduler {
    static final String UNIQUE_WORK_NAME = "focuslink-ledger-sync-v2";
    static final String WORK_TAG = "focuslink-ledger-sync";

    private FocusLedgerSyncScheduler() {}

    static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FocusLedgerSyncWork.class)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .addTag(WORK_TAG)
            .build();
        WorkManager
            .getInstance(context.getApplicationContext())
            .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }

    static void cancel(Context context) {
        WorkManager
            .getInstance(context.getApplicationContext())
            .cancelUniqueWork(UNIQUE_WORK_NAME);
    }
}
