package app.focuslink.mobile;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

final class FocusLedgerSyncScheduler {
    static final int JOB_ID = 0x464c3202;

    private FocusLedgerSyncScheduler() {}

    static void schedule(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) throw new IllegalStateException("JobScheduler is unavailable");
        JobInfo job = new JobInfo.Builder(
            JOB_ID,
            new ComponentName(context, FocusLedgerSyncJobService.class)
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build();
        if (scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS) {
            throw new IllegalStateException("unable to schedule completed ledger upload");
        }
    }

    static void cancel(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }
}
