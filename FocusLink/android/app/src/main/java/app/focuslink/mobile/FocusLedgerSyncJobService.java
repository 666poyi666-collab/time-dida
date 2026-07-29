package app.focuslink.mobile;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class FocusLedgerSyncJobService extends JobService {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public boolean onStartJob(JobParameters parameters) {
        executor.execute(() -> {
            boolean retry = FocusLedgerSyncWorker.run(getApplicationContext());
            jobFinished(parameters, retry);
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters parameters) {
        return true;
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
