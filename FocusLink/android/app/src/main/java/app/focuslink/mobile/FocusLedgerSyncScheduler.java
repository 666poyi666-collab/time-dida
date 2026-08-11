package app.focuslink.mobile;

import android.content.Context;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.Operation;
import androidx.work.WorkManager;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.concurrent.TimeUnit;

final class FocusLedgerSyncScheduler {
    static final String UNIQUE_WORK_NAME = "focuslink-ledger-sync-v2";
    static final String EXPLICIT_RECHECK_WORK_NAME = "focuslink-ledger-terminal-recheck-v2";
    static final String WORK_TAG = "focuslink-ledger-sync";
    static final String INPUT_EXPLICIT_RECHECK = "focuslink.explicitTerminalRecheck";
    static final String INPUT_EXPECTED_DEVICE_ID = "focuslink.expectedDeviceId";

    interface WorkOperationEnqueuer {
        Operation enqueue(
            Context context,
            String workName,
            ExistingWorkPolicy policy,
            OneTimeWorkRequest request
        );
    }

    private static final WorkOperationEnqueuer DEFAULT_WORK_OPERATION_ENQUEUER =
        (context, workName, policy, request) -> WorkManager
            .getInstance(context)
            .enqueueUniqueWork(workName, policy, request);
    private static volatile WorkOperationEnqueuer workOperationEnqueuer =
        DEFAULT_WORK_OPERATION_ENQUEUER;

    private FocusLedgerSyncScheduler() {}

    static void schedule(Context context) {
        enqueue(context, UNIQUE_WORK_NAME, ordinaryPolicy(), Data.EMPTY);
    }

    /**
     * Schedules a single foreground-requested recheck without releasing terminal markers. The
     * durable expected device binding survives process restart and makes a switched account fail
     * closed instead of turning a terminal record into ordinary background work.
     */
    static ListenableFuture<Operation.State.SUCCESS> scheduleExplicitTerminalRecheck(
        Context context,
        String expectedDeviceId
    ) {
        if (!isValidDeviceId(expectedDeviceId)) {
            throw new IllegalArgumentException("expected deviceId is invalid");
        }
        Operation operation = enqueue(
            context,
            EXPLICIT_RECHECK_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            new Data.Builder()
                .putBoolean(INPUT_EXPLICIT_RECHECK, true)
                .putString(INPUT_EXPECTED_DEVICE_ID, expectedDeviceId)
                .build()
        );
        ListenableFuture<Operation.State.SUCCESS> result = operation == null
            ? null
            : operation.getResult();
        if (result == null) {
            throw new IllegalStateException("unable to enqueue explicit terminal recheck");
        }
        // WorkManager accepts enqueues asynchronously. The user action observes this future so a
        // false success cannot be reported when WorkManager rejects the request.
        return result;
    }

    static ExistingWorkPolicy explicitTerminalRecheckPolicy() {
        return ExistingWorkPolicy.REPLACE;
    }

    static ExistingWorkPolicy ordinaryPolicy() {
        return ExistingWorkPolicy.KEEP;
    }

    static void setWorkOperationEnqueuerForTests(WorkOperationEnqueuer enqueuer) {
        workOperationEnqueuer = enqueuer == null ? DEFAULT_WORK_OPERATION_ENQUEUER : enqueuer;
    }

    static String explicitExpectedDeviceId(Data input) {
        if (input == null || !input.getBoolean(INPUT_EXPLICIT_RECHECK, false)) return null;
        String expectedDeviceId = input.getString(INPUT_EXPECTED_DEVICE_ID);
        return isValidDeviceId(expectedDeviceId) ? expectedDeviceId : "";
    }

    private static boolean isValidDeviceId(String value) {
        return value != null && !value.isEmpty() && value.length() <= 200;
    }

    private static Operation enqueue(
        Context context,
        String workName,
        ExistingWorkPolicy policy,
        Data input
    ) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FocusLedgerSyncWork.class)
            .setConstraints(constraints)
            .setInputData(input)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .addTag(WORK_TAG)
            .build();
        return workOperationEnqueuer.enqueue(
            context.getApplicationContext(),
            workName,
            policy,
            request
        );
    }

    static void cancel(Context context) {
        WorkManager manager = WorkManager.getInstance(context.getApplicationContext());
        manager.cancelUniqueWork(UNIQUE_WORK_NAME);
        manager.cancelUniqueWork(EXPLICIT_RECHECK_WORK_NAME);
    }
}
