package app.focuslink.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

public final class FocusNotificationService extends Service {
    interface CloudClientFactory {
        FocusCloudClient create();
    }

    private static final String TAG = "FocusRuntime";
    private static final String CHANNEL_ID = "focus_runtime_v1";
    private static final String HUAWEI_LIVE_CHANNEL_ID = "focus_runtime_huawei_live_v1";
    private static final String PAUSE_REMINDER_CHANNEL_ID = "focus_pause_reminder_v1";
    private static final int NOTIFICATION_ID = 1214;
    private static final int HUAWEI_CAPSULE_NOTIFICATION_ID = 1216;
    private static final int PAUSE_REMINDER_NOTIFICATION_ID = 1215;
    private static final int CONTENT_REQUEST_CODE = 1200;
    private static final int PAUSE_REQUEST_CODE = 1201;
    private static final int RESUME_REQUEST_CODE = 1202;
    private static final int FINISH_REQUEST_CODE = 1203;
    private static final long CLOUD_POLL_INTERVAL_MS = 20_000L;
    private static final String DIAGNOSTICS_PREFERENCES = "focus_runtime_poll_v1";
    private static final String PAUSE_REMINDER_PREFERENCES = "focus_runtime_pause_reminder_v1";
    private static final String PAUSE_REMINDER_SESSION_ID_KEY = "notifiedSessionId";
    private static final String PAUSE_REMINDER_REVISION_KEY = "notifiedRevision";
    private static volatile CloudClientFactory cloudClientFactory =
        FocusCloudClient::createDefault;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable expirationRunnable;
    private Runnable pauseReminderRunnable;
    private final Runnable cloudPollRunnable = this::dispatchCloudPoll;
    private ExecutorService cloudExecutor;
    private boolean cloudPolling;
    private boolean cloudPollInFlight;
    private PowerManager.WakeLock wakeLock;
    private FocusCloudClient cloudClient;
    private FocusDesktopOverlayController desktopOverlay;

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
            clearPauseReminder(applicationContext);
            clearHuaweiCapsule(applicationContext);
            applicationContext.stopService(
                new Intent(applicationContext, FocusNotificationService.class)
            );
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannel(this);
        cloudExecutor = Executors.newSingleThreadExecutor();
        cloudClient = cloudClientFactory.create();
        desktopOverlay = new FocusDesktopOverlayController(this, handler);
    }

    static void setCloudClientFactoryForTests(CloudClientFactory factory) {
        cloudClientFactory = factory == null ? FocusCloudClient::createDefault : factory;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        FocusRuntimeSnapshot snapshot = FocusRuntimeStore.getSnapshot(this);
        int foregroundType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            : 0;
        // startForegroundService may race with a newer idle snapshot. Always satisfy the platform
        // foreground deadline first, then remove the transient notification when state is stale.
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(snapshot),
            foregroundType
        );
        if (
            !snapshot.isFresh(this, System.currentTimeMillis(), android.os.SystemClock.elapsedRealtime()) ||
            !FocusNotificationPermission.canPost(this)
        ) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            clearHuaweiCapsule(this);
            stopSelf();
            FocusRuntimeTileService.requestRefresh(this);
            return START_NOT_STICKY;
        }

        postHuaweiCapsule(snapshot);

        scheduleExpiration(snapshot);
        schedulePauseReminder(snapshot);
        desktopOverlay.update(snapshot);
        refreshWakeLock();
        startCloudPolling();
        if (FocusRuntimeStore.pendingCount(this) > 0) scheduleImmediateCloudPoll();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        cancelExpiration();
        cancelPauseReminderSchedule();
        clearHuaweiCapsule(this);
        if (desktopOverlay != null) desktopOverlay.hide();
        stopCloudPolling();
        releaseWakeLock();
        FocusRuntimeTileService.requestRefresh(this);
        super.onDestroy();
    }

    private void startCloudPolling() {
        if (cloudPolling) return;
        cloudPolling = true;
        Log.i(TAG, "Starting background cloud focus polling");
        handler.postDelayed(cloudPollRunnable, 2_000L);
    }

    private void scheduleImmediateCloudPoll() {
        if (!cloudPolling || cloudPollInFlight) return;
        handler.removeCallbacks(cloudPollRunnable);
        handler.post(cloudPollRunnable);
    }

    private void stopCloudPolling() {
        cloudPolling = false;
        handler.removeCallbacks(cloudPollRunnable);
        if (cloudExecutor != null) cloudExecutor.shutdownNow();
    }

    private void dispatchCloudPoll() {
        if (!cloudPolling || cloudPollInFlight) return;
        cloudPollInFlight = true;
        recordPollAttempt();
        try {
            cloudExecutor.execute(() -> {
                try {
                    pollCloudSnapshot();
                } catch (Throwable throwable) {
                    recordPollFailure(throwable.getClass().getSimpleName() + ": " + safeMessage(throwable));
                    Log.e(TAG, "Background cloud focus poll terminated unexpectedly", throwable);
                } finally {
                    handler.post(() -> {
                        cloudPollInFlight = false;
                        if (cloudPolling) {
                            handler.postDelayed(cloudPollRunnable, CLOUD_POLL_INTERVAL_MS);
                        }
                    });
                }
            });
        } catch (RuntimeException exception) {
            cloudPollInFlight = false;
            recordPollFailure(exception.getClass().getSimpleName() + ": " + safeMessage(exception));
            if (cloudPolling) handler.postDelayed(cloudPollRunnable, CLOUD_POLL_INTERVAL_MS);
        }
    }

    private void pollCloudSnapshot() {
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(this);
        if (connection == null) {
            recordPollFailure("connection-not-configured");
            return;
        }
        uploadPendingCommand(connection);
        try {
            FocusRuntimeSnapshot snapshot = FocusRuntimeSnapshot.fromCloudResponse(
                this,
                cloudClient.fetchLive(connection)
            );
            FocusRuntimeStore.putSnapshot(this, snapshot);
            recordPollSuccess(snapshot.stateRevision);
            Log.i(TAG, "Background cloud focus snapshot confirmed at revision " + snapshot.stateRevision);
            handler.post(() -> applyCloudSnapshot(snapshot));
        } catch (Throwable exception) {
            recordPollFailure(exception.getClass().getSimpleName() + ": " + safeMessage(exception));
            Log.w(TAG, "Unable to refresh focus state in background", exception);
        }
    }

    private void uploadPendingCommand(FocusRuntimeConnectionStore.Connection connection) {
        java.util.List<FocusRuntimeCommand> pending = FocusRuntimeStore.drainPendingCommands(this);
        if (pending.isEmpty()) return;
        FocusRuntimeCommand command = pending.get(0);
        try {
            JSONObject response = cloudClient.sendCommand(connection, command);
            FocusRuntimeSnapshot snapshot = FocusRuntimeSnapshot.fromCloudResponse(this, response);
            FocusRuntimeStore.putSnapshot(this, snapshot);
            FocusRuntimeStore.completeCommand(this, command.id);
            handler.post(() -> applyCloudSnapshot(snapshot));
        } catch (Throwable exception) {
            recordPollFailure("command " + exception.getClass().getSimpleName() + ": " + safeMessage(exception));
            Log.w(TAG, "Unable to upload pending native focus command", exception);
        }
    }

    static JSONObject pollDiagnostics(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(
            DIAGNOSTICS_PREFERENCES,
            Context.MODE_PRIVATE
        );
        try {
            return new JSONObject()
                .put("attemptCount", preferences.getLong("attemptCount", 0L))
                .put("lastAttemptAtEpochMs", preferences.getLong("lastAttemptAtEpochMs", 0L))
                .put("lastSuccessAtEpochMs", preferences.getLong("lastSuccessAtEpochMs", 0L))
                .put("lastRevision", preferences.getLong("lastRevision", -1L))
                .put("lastError", preferences.getString("lastError", ""));
        } catch (JSONException exception) {
            return new JSONObject();
        }
    }

    private void recordPollAttempt() {
        SharedPreferences preferences = getSharedPreferences(
            DIAGNOSTICS_PREFERENCES,
            Context.MODE_PRIVATE
        );
        preferences
            .edit()
            .putLong("attemptCount", preferences.getLong("attemptCount", 0L) + 1L)
            .putLong("lastAttemptAtEpochMs", System.currentTimeMillis())
            .apply();
    }

    private void recordPollSuccess(long revision) {
        getSharedPreferences(DIAGNOSTICS_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putLong("lastSuccessAtEpochMs", System.currentTimeMillis())
            .putLong("lastRevision", revision)
            .putString("lastError", "")
            .apply();
    }

    private void recordPollFailure(String message) {
        getSharedPreferences(DIAGNOSTICS_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString("lastError", message)
            .apply();
    }

    private static String safeMessage(Throwable throwable) {
        String message = throwable.getMessage();
        if (message == null || message.isEmpty()) return "unknown";
        return message.length() <= 240 ? message : message.substring(0, 240);
    }

    private void applyCloudSnapshot(FocusRuntimeSnapshot snapshot) {
        if (!snapshot.isActive() || !FocusNotificationPermission.canPost(this)) {
            clearPauseReminder(this);
            clearHuaweiCapsule(this);
            if (desktopOverlay != null) desktopOverlay.hide();
            releaseWakeLock();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            FocusRuntimeTileService.requestRefresh(this);
            return;
        }
        int foregroundType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(snapshot), foregroundType);
        postHuaweiCapsule(snapshot);
        scheduleExpiration(snapshot);
        schedulePauseReminder(snapshot);
        if (desktopOverlay != null) desktopOverlay.update(snapshot);
        refreshWakeLock();
        FocusRuntimeTileService.requestRefresh(this);
    }

    private void refreshWakeLock() {
        if (wakeLock == null) {
            PowerManager manager = getSystemService(PowerManager.class);
            if (manager == null) return;
            wakeLock = manager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                getPackageName() + ":FocusRuntime"
            );
            wakeLock.setReferenceCounted(false);
        }
        if (wakeLock.isHeld()) wakeLock.release();
        wakeLock.acquire(FocusRuntimeContract.MAX_NATIVE_SNAPSHOT_AGE_MS + 5L * 60L * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            this,
            runtimeChannelId(this)
        )
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
            .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
            .setShowWhen(snapshot.primaryAdvances)
            .setUsesChronometer(snapshot.primaryAdvances);

        if (snapshot.primaryAdvances) {
            applyChronometer(builder, snapshot);
        }
        SystemFocusSurfaceProvider.configureBuilder(this, builder);

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
        builder.setPublicVersion(buildLockScreenNotification(snapshot));
        Notification notification = builder.build();
        // EMUI accepts a single capsule candidate per package. Keep the foreground-service
        // carrier plain and project the reference-compatible flags=0x2 capsule via 1216.
        if (SystemFocusSurfaceProvider.usesHuaweiLiveCapsule(this)) return notification;
        return SystemFocusSurfaceProvider.apply(this, notification, snapshot, title, content);
    }

    private Notification buildLockScreenNotification(FocusRuntimeSnapshot snapshot) {
        String genericTitle = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state)
            ? getString(R.string.focus_runtime_paused)
            : getString(R.string.focus_runtime_running);
        String genericContent = snapshot.timeLabel.isEmpty()
            ? getString(R.string.focus_runtime_lock_screen_active)
            : snapshot.timeLabel;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            this,
            runtimeChannelId(this)
        )
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(genericTitle)
            .setContentText(genericContent)
            .setContentIntent(openAppPendingIntent())
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(true)
            .setShowWhen(snapshot.primaryAdvances)
            .setUsesChronometer(snapshot.primaryAdvances);
        if (snapshot.primaryAdvances) applyChronometer(builder, snapshot);
        return builder.build();
    }

    private void postHuaweiCapsule(FocusRuntimeSnapshot snapshot) {
        boolean huaweiCandidate = SystemFocusSurfaceProvider.usesHuaweiLiveCapsule(this);
        Log.i(
            TAG,
            "Huawei capsule post entered: sdk=" + Build.VERSION.SDK_INT +
            ", candidate=" + huaweiCandidate +
            ", state=" + snapshot.state
        );
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            !huaweiCandidate
        ) {
            clearHuaweiCapsule(this);
            return;
        }
        String title = snapshot.title.isEmpty()
            ? getString(R.string.focus_runtime_running)
            : snapshot.title;
        String content = snapshot.timeLabel;
        if (!snapshot.detail.isEmpty()) {
            content = content.isEmpty() ? snapshot.detail : content + " · " + snapshot.detail;
        }
        Notification base = new Notification.Builder(this, HUAWEI_LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(title)
            .setContentText(content)
            .setContentIntent(openAppPendingIntent())
            .setOngoing(true)
            .setShowWhen(snapshot.primaryAdvances)
            .setUsesChronometer(snapshot.primaryAdvances)
            .setWhen(chronometerWhen(snapshot))
            .build();
        Notification capsule = SystemFocusSurfaceProvider.apply(
            this,
            base,
            snapshot,
            title,
            content
        );
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.e(TAG, "Huawei capsule post skipped: NotificationManager unavailable");
            return;
        }
        try {
            Log.i(
                TAG,
                "Huawei capsule notify begin: id=" + HUAWEI_CAPSULE_NOTIFICATION_ID +
                ", when=" + capsule.when +
                ", flags=0x" + Integer.toHexString(capsule.flags)
            );
            manager.notify(HUAWEI_CAPSULE_NOTIFICATION_ID, capsule);
            StringBuilder ids = new StringBuilder();
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (ids.length() > 0) ids.append(',');
                ids.append(active.getId());
            }
            Log.i(TAG, "Huawei capsule notify returned; activeIds=" + ids);
        } catch (RuntimeException exception) {
            Log.e(TAG, "Huawei capsule notify failed", exception);
        }
    }

    private static void clearHuaweiCapsule(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(HUAWEI_CAPSULE_NOTIFICATION_ID);
    }

    private static void applyChronometer(
        NotificationCompat.Builder builder,
        FocusRuntimeSnapshot snapshot
    ) {
        long chronometerBaseElapsed = SystemClock.elapsedRealtime() - snapshot.primaryElapsedMs;
        long chronometerWhen = System.currentTimeMillis() -
        (SystemClock.elapsedRealtime() - chronometerBaseElapsed);
        builder.setWhen(chronometerWhen);
    }

    private static long chronometerWhen(FocusRuntimeSnapshot snapshot) {
        return System.currentTimeMillis() - Math.max(0L, snapshot.primaryElapsedMs);
    }

    private void schedulePauseReminder(FocusRuntimeSnapshot snapshot) {
        cancelPauseReminderSchedule();
        if (!FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state) || !snapshot.isFresh(
            this,
            System.currentTimeMillis(),
            SystemClock.elapsedRealtime()
        )) {
            clearPauseReminder(this);
            return;
        }

        FocusRuntimeSystemSettings.PauseReminderPreference preference =
            FocusRuntimeSystemSettings.getPauseReminderPreference(this);
        if (!preference.enabled) {
            clearPauseReminder(this);
            return;
        }
        if (hasPostedPauseReminder(snapshot)) return;

        long reminderAtMs = preference.delayMinutes * 60_000L;
        long delayMs = Math.max(0L, reminderAtMs - snapshot.primaryElapsedMs);
        pauseReminderRunnable = () -> {
            FocusRuntimeSnapshot current = FocusRuntimeStore.getSnapshot(this);
            if (
                FocusRuntimeContract.STATE_PAUSED.equals(current.state) &&
                current.matches(snapshot.sessionId, snapshot.stateRevision) &&
                current.isFresh(this, System.currentTimeMillis(), SystemClock.elapsedRealtime()) &&
                FocusRuntimeSystemSettings.getPauseReminderPreference(this).enabled
            ) {
                postPauseReminder(current);
            }
        };
        handler.postDelayed(pauseReminderRunnable, delayMs);
    }

    private void postPauseReminder(FocusRuntimeSnapshot snapshot) {
        if (hasPostedPauseReminder(snapshot)) return;
        boolean controlsAvailable = snapshot.allowsCommands(this) &&
            !FocusRuntimeStore.hasPendingFor(this, snapshot);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            this,
            PAUSE_REMINDER_CHANNEL_ID
        )
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle(getString(R.string.focus_runtime_pause_reminder_title))
            .setContentText(getString(R.string.focus_runtime_pause_reminder_content))
            .setContentIntent(openAppPendingIntent())
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true);
        if (controlsAvailable) {
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
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            markPauseReminderPosted(snapshot);
            manager.notify(PAUSE_REMINDER_NOTIFICATION_ID, builder.build());
        }
    }

    private void cancelPauseReminderSchedule() {
        if (pauseReminderRunnable != null) {
            handler.removeCallbacks(pauseReminderRunnable);
            pauseReminderRunnable = null;
        }
    }

    private boolean hasPostedPauseReminder(FocusRuntimeSnapshot snapshot) {
        SharedPreferences preferences = getSharedPreferences(
            PAUSE_REMINDER_PREFERENCES,
            Context.MODE_PRIVATE
        );
        return snapshot.sessionId.equals(preferences.getString(PAUSE_REMINDER_SESSION_ID_KEY, "")) &&
            snapshot.stateRevision == preferences.getLong(PAUSE_REMINDER_REVISION_KEY, -1L);
    }

    private void markPauseReminderPosted(FocusRuntimeSnapshot snapshot) {
        getSharedPreferences(PAUSE_REMINDER_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(PAUSE_REMINDER_SESSION_ID_KEY, snapshot.sessionId)
            .putLong(PAUSE_REMINDER_REVISION_KEY, snapshot.stateRevision)
            .apply();
    }

    static void clearPauseReminder(Context context) {
        Context applicationContext = context.getApplicationContext();
        applicationContext
            .getSharedPreferences(PAUSE_REMINDER_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();
        NotificationManager manager = applicationContext.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(PAUSE_REMINDER_NOTIFICATION_ID);
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
        NotificationChannel huaweiLiveChannel = new NotificationChannel(
            HUAWEI_LIVE_CHANNEL_ID,
            context.getString(R.string.focus_runtime_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        huaweiLiveChannel.setDescription(
            context.getString(R.string.focus_runtime_channel_description)
        );
        huaweiLiveChannel.setShowBadge(true);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
            manager.createNotificationChannel(huaweiLiveChannel);
            NotificationChannel pauseReminderChannel = new NotificationChannel(
                PAUSE_REMINDER_CHANNEL_ID,
                context.getString(R.string.focus_runtime_pause_reminder_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            pauseReminderChannel.setDescription(
                context.getString(R.string.focus_runtime_pause_reminder_channel_description)
            );
            pauseReminderChannel.setShowBadge(true);
            manager.createNotificationChannel(pauseReminderChannel);
        }
    }

    private static String runtimeChannelId(Context context) {
        return SystemFocusSurfaceProvider.usesHuaweiLiveCapsule(context)
            ? HUAWEI_LIVE_CHANNEL_ID
            : CHANNEL_ID;
    }

    private void scheduleExpiration(FocusRuntimeSnapshot snapshot) {
        cancelExpiration();
        long delayMs = snapshot.remainingFreshnessMs();
        expirationRunnable = () -> {
            if (desktopOverlay != null) desktopOverlay.hide();
            clearHuaweiCapsule(this);
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
