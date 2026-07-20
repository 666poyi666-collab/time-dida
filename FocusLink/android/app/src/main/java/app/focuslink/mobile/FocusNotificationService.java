package app.focuslink.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

public final class FocusNotificationService extends Service {
    private static final String TAG = "FocusRuntime";
    private static final String CHANNEL_ID = "focus_runtime_v1";
    private static final int NOTIFICATION_ID = 1214;
    private static final int CONTENT_REQUEST_CODE = 1200;
    private static final int PAUSE_REQUEST_CODE = 1201;
    private static final int RESUME_REQUEST_CODE = 1202;
    private static final int FINISH_REQUEST_CODE = 1203;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable expirationRunnable;

    static void synchronize(Context context) {
        Context applicationContext = context.getApplicationContext();
        ensureNotificationChannel(applicationContext);
        FocusRuntimeSnapshot snapshot = FocusRuntimeStore.getSnapshot(applicationContext);
        if (
            snapshot.isFresh(
                applicationContext,
                System.currentTimeMillis(),
                android.os.SystemClock.elapsedRealtime()
            ) &&
            FocusNotificationPermission.canPost(applicationContext)
        ) {
            try {
                ContextCompat.startForegroundService(
                    applicationContext,
                    new Intent(applicationContext, FocusNotificationService.class)
                );
            } catch (RuntimeException exception) {
                Log.w(TAG, "Unable to start focus notification service", exception);
            }
        } else {
            applicationContext.stopService(
                new Intent(applicationContext, FocusNotificationService.class)
            );
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        FocusRuntimeSnapshot snapshot = FocusRuntimeStore.getSnapshot(this);
        if (
            !snapshot.isFresh(this, System.currentTimeMillis(), android.os.SystemClock.elapsedRealtime()) ||
            !FocusNotificationPermission.canPost(this)
        ) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            FocusRuntimeTileService.requestRefresh(this);
            return START_NOT_STICKY;
        }

        int foregroundType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            : 0;
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(snapshot),
            foregroundType
        );
        scheduleExpiration(snapshot);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        cancelExpiration();
        FocusRuntimeTileService.requestRefresh(this);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification(FocusRuntimeSnapshot snapshot) {
        boolean pending = FocusRuntimeStore.hasPendingFor(this, snapshot);
        boolean controlsAvailable = snapshot.allowsCommands(this) && !pending;
        String defaultTitle = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state)
            ? getString(R.string.focus_runtime_paused)
            : getString(R.string.focus_runtime_running);
        String title = snapshot.title.isEmpty() ? defaultTitle : snapshot.title;
        String content = snapshot.timeLabel;
        if (!snapshot.detail.isEmpty()) {
            content = content.isEmpty() ? snapshot.detail : content + " · " + snapshot.detail;
        }
        if (pending) {
            content = getString(R.string.focus_runtime_waiting);
        } else if (!snapshot.allowsCommands(this)) {
            content = getString(R.string.focus_runtime_open_app);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(title)
            .setContentText(content)
            .setContentIntent(openAppPendingIntent())
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(true)
            .setShowWhen(snapshot.primaryAdvances)
            .setUsesChronometer(snapshot.primaryAdvances);

        if (snapshot.primaryAdvances) {
            long chronometerBaseElapsed = SystemClock.elapsedRealtime() - snapshot.primaryElapsedMs;
            long chronometerWhen = System.currentTimeMillis() -
            (SystemClock.elapsedRealtime() - chronometerBaseElapsed);
            builder.setWhen(chronometerWhen);
        }

        if (controlsAvailable) {
            if (FocusRuntimeContract.STATE_RUNNING.equals(snapshot.state)) {
                builder.addAction(
                    R.drawable.ic_stat_focus,
                    getString(R.string.focus_runtime_pause),
                    commandPendingIntent(
                        FocusRuntimeContract.COMMAND_PAUSE,
                        snapshot,
                        PAUSE_REQUEST_CODE
                    )
                );
            } else {
                builder.addAction(
                    R.drawable.ic_stat_focus,
                    getString(R.string.focus_runtime_resume),
                    commandPendingIntent(
                        FocusRuntimeContract.COMMAND_RESUME,
                        snapshot,
                        RESUME_REQUEST_CODE
                    )
                );
            }
            builder.addAction(
                R.drawable.ic_stat_focus,
                getString(R.string.focus_runtime_finish),
                commandPendingIntent(
                    FocusRuntimeContract.COMMAND_FINISH,
                    snapshot,
                    FINISH_REQUEST_CODE
                )
            );
        }
        return builder.build();
    }

    private PendingIntent commandPendingIntent(
        String command,
        FocusRuntimeSnapshot snapshot,
        int requestCode
    ) {
        Intent intent = new Intent(this, MainActivity.class)
            .setAction(FocusRuntimeContract.ACTION_NOTIFICATION_COMMAND)
            .putExtra(FocusRuntimeContract.EXTRA_COMMAND_TYPE, command)
            .putExtra(FocusRuntimeContract.EXTRA_SESSION_ID, snapshot.sessionId)
            .putExtra(
                FocusRuntimeContract.EXTRA_STATE_REVISION,
                snapshot.stateRevision
            )
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent openAppPendingIntent() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) {
            launchIntent = new Intent(this, MainActivity.class);
        }
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            this,
            CONTENT_REQUEST_CODE,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.focus_runtime_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(
            context.getString(R.string.focus_runtime_channel_description)
        );
        channel.setShowBadge(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private void scheduleExpiration(FocusRuntimeSnapshot snapshot) {
        cancelExpiration();
        long delayMs = snapshot.remainingFreshnessMs();
        expirationRunnable = () -> {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            FocusRuntimeTileService.requestRefresh(this);
        };
        handler.postDelayed(expirationRunnable, Math.max(1L, delayMs));
    }

    private void cancelExpiration() {
        if (expirationRunnable != null) {
            handler.removeCallbacks(expirationRunnable);
            expirationRunnable = null;
        }
    }
}
