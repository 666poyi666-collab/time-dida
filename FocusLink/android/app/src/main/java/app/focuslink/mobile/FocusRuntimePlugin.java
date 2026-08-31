package app.focuslink.mobile;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.StatusBarManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = FocusRuntimeContract.PLUGIN_NAME,
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        ),
    }
)
public final class FocusRuntimePlugin extends Plugin {
    private static final long ROOT_COMMAND_TIMEOUT_MS = 5_000L;
    private static final int ROOT_OUTPUT_LIMIT = 4_096;
    private static final String APP_OP_RUN_IN_BACKGROUND = "android:run_in_background";
    private static final String APP_OP_RUN_ANY_IN_BACKGROUND = "android:run_any_in_background";
    private static final ExecutorService ROOT_EXECUTOR = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "focuslink-root-permissions");
        thread.setDaemon(true);
        return thread;
    });
    private static final Object INSTANCE_LOCK = new Object();
    private static WeakReference<FocusRuntimePlugin> activeInstance = new WeakReference<>(
        null
    );
    private static boolean runtimeForeground;

    @Override
    public void load() {
        synchronized (INSTANCE_LOCK) {
            activeInstance = new WeakReference<>(this);
        }
    }

    @Override
    protected void handleOnResume() {
        synchronized (INSTANCE_LOCK) {
            activeInstance = new WeakReference<>(this);
            runtimeForeground = true;
        }
        FocusNotificationService.synchronize(getContext());
    }

    @Override
    protected void handleOnPause() {
        synchronized (INSTANCE_LOCK) {
            if (activeInstance.get() == this) {
                runtimeForeground = false;
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (INSTANCE_LOCK) {
            if (activeInstance.get() == this) {
                runtimeForeground = false;
                activeInstance.clear();
            }
        }
    }

    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        try {
            FocusRuntimeConnectionStore.Connection connection = connectionForSourceDevice(
                call.getString("deviceId"),
                call.getString("connectionLease")
            );
            if (connection == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            FocusRuntimeSnapshot snapshot = FocusRuntimeSnapshot.fromPlugin(
                getContext(),
                call.getObject("snapshot")
            );
            Boolean stored = FocusRuntimeConnectionStore.runIfCurrent(
                getContext(),
                connection,
                () -> FocusRuntimeStore.putSnapshot(getContext(), snapshot)
            );
            if (stored == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            FocusNotificationService.synchronize(getContext());
            FocusRuntimeTileService.requestRefresh(getContext());
            call.resolve(nativeStatus(FocusRuntimeStore.getSnapshot(getContext())));
        } catch (IllegalArgumentException exception) {
            call.reject(exception.getMessage(), "invalid_snapshot");
        }
    }

    @PluginMethod
    public void configureConnection(PluginCall call) {
        try {
            FocusRuntimeConnectionStore.Connection configured =
                FocusRuntimeConnectionStore.replaceAndClearAccountStateIfCurrent(
                    getContext(),
                    call.getString("expectedConnectionLease"),
                    call.getString("endpoint"),
                    call.getString("accessToken"),
                    call.getString("deviceId")
            );
            if (
                configured != null &&
                FocusLedgerNativeOutboxStore.countForDevice(
                    getContext(),
                    configured.deviceId
                ) > 0
            ) {
                FocusLedgerSyncScheduler.schedule(getContext());
            }
            FocusNotificationService.synchronize(getContext());
            call.resolve(
                new JSObject().put(
                    "connectionLease",
                    FocusRuntimeConnectionStore.currentLease()
                )
            );
        } catch (IllegalArgumentException | IllegalStateException exception) {
            call.reject(exception.getMessage(), "invalid_connection");
        }
    }

    @PluginMethod
    public void clearConnection(PluginCall call) {
        try {
            FocusRuntimeConnectionStore.clearConnectionAndAccountStateIfCurrent(
                getContext(),
                call.getString("expectedConnectionLease")
            );
            FocusLedgerSyncScheduler.cancel(getContext());
            FocusNotificationService.synchronize(getContext());
            call.resolve(
                new JSObject().put(
                    "connectionLease",
                    FocusRuntimeConnectionStore.currentLease()
                )
            );
        } catch (IllegalStateException exception) {
            call.reject(exception.getMessage(), "clear_connection_failed");
        }
    }

    @PluginMethod
    public void getConnection(PluginCall call) {
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(
            getContext()
        );
        JSObject value = new JSObject().put(
            "connectionLease",
            FocusRuntimeConnectionStore.currentLease()
        );
        if (connection == null) {
            call.resolve(value.put("configured", false));
            return;
        }
        // The token crosses into trusted renderer memory for foreground HTTPS
        // calls, but is never persisted by the WebView.  Its at-rest copy stays
        // exclusively under Android Keystore.
        value.put("configured", true);
        value.put("endpoint", connection.endpoint);
        value.put("accessToken", connection.accessToken);
        value.put("deviceId", connection.deviceId);
        call.resolve(value);
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String rawUrl = call.getString("url");
        try {
            Uri url = Uri.parse(rawUrl == null ? "" : rawUrl);
            if (!"https".equalsIgnoreCase(url.getScheme()) || url.getHost() == null) {
                call.reject("login URL must use HTTPS", "invalid_url");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                call.resolve(new JSObject().put("opened", false));
                return;
            }
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (RuntimeException exception) {
            call.reject("unable to open login URL", "open_url_failed", exception);
        }
    }

    @PluginMethod
    public void enqueueCompletedLedgerBundle(PluginCall call) {
        FocusRuntimeConnectionStore.Connection connection = connectionForSourceDevice(
            call.getString("deviceId"),
            call.getString("connectionLease")
        );
        if (connection == null) {
            call.resolve(
                new JSObject()
                    .put("queued", false)
                    .put("pending", 0)
            );
            return;
        }
        try {
            JSObject record = call.getObject("record");
            JSObject result = FocusRuntimeConnectionStore.runIfCurrent(
                getContext(),
                connection,
                () -> {
                    boolean queued = FocusLedgerNativeOutboxStore.enqueue(
                        getContext(),
                        record,
                        connection.deviceId
                    );
                    FocusLedgerSyncScheduler.schedule(getContext());
                    return new JSObject()
                        .put("queued", queued)
                        .put(
                            "pending",
                            FocusLedgerNativeOutboxStore.countForDevice(
                                getContext(),
                                connection.deviceId
                            )
                        );
                }
            );
            if (result == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            call.resolve(result);
        } catch (IllegalArgumentException | IllegalStateException exception) {
            call.reject(exception.getMessage(), "invalid_completed_ledger");
        }
    }

    /**
     * Releases only the current device's terminal completed-ledger markers after an explicit
     * foreground user action. Terminal markers stay intact; the dedicated worker can read them
     * only when its persisted expected device still matches the current connection.
     */
    @PluginMethod
    public void requeueTerminalLedger(PluginCall call) {
        FocusLedgerTerminalRequeue.requeue(
            getContext(),
            call.getString("deviceId"),
            call.getString("connectionLease"),
            ContextCompat.getMainExecutor(getContext()),
            new FocusLedgerTerminalRequeue.Listener() {
                @Override
                public void onRequeued(int requeued) {
                    call.resolve(new JSObject().put("requeued", requeued));
                }

                @Override
                public void onStaleConnection() {
                    call.reject("账号连接已变化，请重新打开设置后重试", "stale_connection");
                }

                @Override
                public void onFailure() {
                    call.reject(
                        "暂时无法重新检查已结束专注，请稍后重试",
                        "terminal_ledger_requeue_failed"
                    );
                }
            }
        );
    }

    @PluginMethod
    public void updateAuthorityProjectionHistory(PluginCall call) {
        try {
            FocusRuntimeConnectionStore.Connection connection = connectionForSourceDevice(
                call.getString("deviceId"),
                call.getString("connectionLease")
            );
            if (connection == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            JSArray history = call.getArray("history");
            Integer pendingCount = call.getInt("pendingCount");
            if (history == null || pendingCount == null) {
                throw new IllegalArgumentException("history and pendingCount are required");
            }
            Boolean committed = FocusRuntimeConnectionStore.runIfCurrent(
                getContext(),
                connection,
                () -> {
                    FocusAuthorityProjectionStore.updateHistory(
                        getContext(),
                        history,
                        safeTimestamp(call, "lastVerifiedAt"),
                        safeTimestamp(call, "lastAttemptAt"),
                        pendingCount,
                        call.getString("lastErrorCode", "")
                    );
                    return true;
                }
            );
            if (committed == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            call.resolve(
                new JSObject()
                    .put("accepted", history.length())
                    .put("pending", Math.max(0, pendingCount))
            );
        } catch (IllegalArgumentException | IllegalStateException exception) {
            call.reject(exception.getMessage(), "invalid_authority_projection");
        }
    }

    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        List<Intent> candidates = new ArrayList<>();
        candidates.add(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        candidates.add(applicationDetailsIntent());
        boolean opened = startFirstResolvable(candidates);
        call.resolve(new JSObject().put("opened", opened).put("target", "battery"));
    }

    @PluginMethod
    public void openAutoStartSettings(PluginCall call) {
        boolean opened = startFirstResolvable(autoStartSettingsCandidates(getContext()));
        call.resolve(new JSObject().put("opened", opened).put("target", "autostart"));
    }

    @PluginMethod
    public void openOverlayPermissionSettings(PluginCall call) {
        boolean opened;
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            opened = true;
        } catch (RuntimeException exception) {
            opened = false;
        }
        call.resolve(
            new JSObject()
                .put("opened", opened)
                .put("granted", FocusDesktopOverlayController.canDraw(getContext()))
        );
    }

    @PluginMethod
    public void setOverlayEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required", "invalid_overlay_preference");
            return;
        }
        try {
            FocusRuntimeSystemSettings.setOverlayEnabled(getContext(), enabled);
            FocusNotificationService.synchronize(getContext());
            call.resolve(
                new JSObject()
                    .put("enabled", enabled)
                    .put("granted", FocusDesktopOverlayController.canDraw(getContext()))
            );
        } catch (IllegalStateException exception) {
            call.reject(exception.getMessage(), "invalid_overlay_preference");
        }
    }

    @PluginMethod
    public void setImmersiveSystemBars(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required", "invalid_system_bars");
            return;
        }
        MainActivity activity = mainActivity();
        if (activity == null) {
            call.resolve(new JSObject().put("enabled", false).put("supported", false));
            return;
        }
        activity.runOnUiThread(() -> {
            activity.setFocusImmersiveSystemBars(enabled);
            call.resolve(new JSObject().put("enabled", enabled).put("supported", true));
        });
    }

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        JSObject aspectRatio = call.getObject("aspectRatio");
        Integer width = null;
        Integer height = null;
        if (aspectRatio != null) {
            width = aspectRatio.getInteger("width");
            height = aspectRatio.getInteger("height");
            if (width == null || height == null || width <= 0 || height <= 0) {
                call.reject("aspectRatio must contain positive width and height", "invalid_picture_in_picture");
                return;
            }
        }

        MainActivity activity = mainActivity();
        if (activity == null) {
            call.resolve(
                new JSObject()
                    .put("entered", false)
                    .put("supported", false)
                    .put("active", false)
            );
            return;
        }
        Integer requestedWidth = width;
        Integer requestedHeight = height;
        activity.runOnUiThread(() -> {
            boolean supported = activity.supportsFocusPictureInPicture();
            boolean entered = activity.enterFocusPictureInPicture(
                requestedWidth,
                requestedHeight
            );
            call.resolve(
                new JSObject()
                    .put("entered", entered)
                    .put("supported", supported)
                    .put("active", entered || activity.isFocusPictureInPictureActive())
            );
        });
    }

    @PluginMethod
    public void getPauseReminderPreference(PluginCall call) {
        call.resolve(
            pauseReminderPreferenceJson(
                FocusRuntimeSystemSettings.getPauseReminderPreference(getContext())
            )
        );
    }

    @PluginMethod
    public void setPauseReminderPreference(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required", "invalid_pause_reminder");
            return;
        }
        Integer delayMinutes = call.getInt("delayMinutes");
        if (call.getData().has("delayMinutes") && delayMinutes == null) {
            call.reject("delayMinutes must be an integer", "invalid_pause_reminder");
            return;
        }
        try {
            FocusRuntimeSystemSettings.PauseReminderPreference preference =
                FocusRuntimeSystemSettings.setPauseReminderPreference(
                    getContext(),
                    enabled,
                    delayMinutes
                );
            FocusNotificationService.synchronize(getContext());
            call.resolve(pauseReminderPreferenceJson(preference));
        } catch (IllegalArgumentException | IllegalStateException exception) {
            call.reject(exception.getMessage(), "invalid_pause_reminder");
        }
    }

    @PluginMethod
    public void drainPendingCommands(PluginCall call) {
        FocusRuntimeConnectionStore.Connection connection = connectionForSourceDevice(
            call.getString("deviceId"),
            call.getString("connectionLease")
        );
        if (connection == null) {
            call.reject("account connection changed", "stale_connection");
            return;
        }
        List<FocusRuntimeCommand> pending = FocusRuntimeConnectionStore.runIfCurrent(
            getContext(),
            connection,
            () -> FocusRuntimeStore.drainPendingCommands(getContext())
        );
        if (pending == null) {
            call.reject("account connection changed", "stale_connection");
            return;
        }
        JSArray commands = new JSArray();
        for (FocusRuntimeCommand command : pending) {
            commands.put(command.toJson());
        }
        call.resolve(new JSObject().put("commands", commands));
    }

    @PluginMethod
    public void completeCommands(PluginCall call) {
        try {
            FocusRuntimeConnectionStore.Connection connection = connectionForSourceDevice(
                call.getString("deviceId"),
                call.getString("connectionLease")
            );
            if (connection == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            Integer completed = FocusRuntimeConnectionStore.runIfCurrent(
                getContext(),
                connection,
                () -> FocusRuntimeStore.completeCommands(getContext(), call.getArray("ids"))
            );
            if (completed == null) {
                call.reject("account connection changed", "stale_connection");
                return;
            }
            FocusNotificationService.synchronize(getContext());
            FocusRuntimeTileService.requestRefresh(getContext());
            call.resolve(new JSObject().put("completed", completed));
        } catch (IllegalArgumentException exception) {
            call.reject(exception.getMessage(), "invalid_command_ids");
        }
    }

    @PluginMethod
    public void getNativeStatus(PluginCall call) {
        call.resolve(nativeStatus(FocusRuntimeStore.getSnapshot(getContext())));
    }

    @PluginMethod
    public void requestAllPermissions(PluginCall call) {
        ROOT_EXECUTOR.execute(() -> {
            try {
                JSObject result = requestAllPermissionsResult();
                call.resolve(result);
                try {
                    FocusNotificationService.synchronize(getContext());
                } catch (RuntimeException ignored) {
                    // Permission readback is authoritative even if the optional surface refresh fails.
                }
            } catch (RuntimeException exception) {
                call.reject("permission batch failed", "permission_batch_failed");
            }
        });
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        FocusNotificationService.ensureNotificationChannel(getContext());
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            boolean openedSettings = false;
            if (!FocusNotificationPermission.canPost(getContext())) {
                openedSettings = openNotificationSettings();
            }
            call.resolve(notificationPermissionResult().put("settingsOpened", openedSettings));
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(notificationPermissionResult());
            return;
        }
        requestPermissionForAlias(
            "notifications",
            call,
            "notificationPermissionCallback"
        );
    }

    @PluginMethod
    public void requestQuickSettingsTile(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(
                new JSObject()
                    .put("status", "manual-required")
                    .put("manualRequired", true)
            );
            return;
        }

        StatusBarManager statusBarManager = getContext().getSystemService(
            StatusBarManager.class
        );
        if (statusBarManager == null) {
            call.resolve(
                new JSObject().put("status", "error").put("manualRequired", false)
            );
            return;
        }

        try {
            statusBarManager.requestAddTileService(
                new ComponentName(getContext(), FocusRuntimeTileService.class),
                getContext().getString(R.string.app_name),
                Icon.createWithResource(getContext(), R.drawable.ic_stat_focus),
                getContext().getMainExecutor(),
                result -> call.resolve(quickSettingsRequestResult(result))
            );
        } catch (RuntimeException exception) {
            call.resolve(
                new JSObject().put("status", "error").put("manualRequired", false)
            );
        }
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        FocusNotificationService.synchronize(getContext());
        call.resolve(notificationPermissionResult());
    }

    static boolean publishNativeCommand(FocusRuntimeCommand command) {
        FocusRuntimePlugin plugin;
        synchronized (INSTANCE_LOCK) {
            plugin = activeInstance.get();
            if (
                plugin == null ||
                !runtimeForeground ||
                !plugin.hasListeners(FocusRuntimeContract.EVENT_NATIVE_COMMAND)
            ) {
                return false;
            }
        }

        Runnable delivery = () -> {
            synchronized (INSTANCE_LOCK) {
                if (
                    activeInstance.get() != plugin ||
                    !runtimeForeground ||
                    !plugin.hasListeners(FocusRuntimeContract.EVENT_NATIVE_COMMAND)
                ) {
                    return;
                }
                plugin.notifyListeners(
                    FocusRuntimeContract.EVENT_NATIVE_COMMAND,
                    command.toJson(),
                    true
                );
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            delivery.run();
        } else {
            new Handler(Looper.getMainLooper()).post(delivery);
        }
        return true;
    }

    private JSObject nativeStatus(FocusRuntimeSnapshot snapshot) {
        PowerManager powerManager = getContext().getSystemService(PowerManager.class);
        ActivityManager activityManager = getContext().getSystemService(ActivityManager.class);
        MainActivity activity = mainActivity();
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(
            getContext()
        );
        boolean batteryOptimizationExempt = powerManager != null &&
        powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
        boolean backgroundRestricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
        activityManager != null &&
        activityManager.isBackgroundRestricted();
        JSObject result = new JSObject()
            .put("notificationPermission", FocusNotificationPermission.status(getContext()))
            .put("canPostNotification", FocusNotificationPermission.canPost(getContext()))
            .put("quickSettingsSupported", true)
            .put("manufacturer", Build.MANUFACTURER)
            .put("batteryOptimizationExempt", batteryOptimizationExempt)
            .put("backgroundRestricted", backgroundRestricted)
            .put("backgroundAppOpsAllowed", backgroundAppOpsAllowed())
            .put("overlayPermissionGranted", FocusDesktopOverlayController.canDraw(getContext()))
            .put("overlayEnabled", FocusRuntimeSystemSettings.isOverlayEnabled(getContext()))
            .put("systemSurface", SystemFocusSurfaceProvider.capabilities(getContext()))
            .put(
                "pictureInPictureSupported",
                activity != null && activity.supportsFocusPictureInPicture()
            )
            .put(
                "pictureInPictureActive",
                activity != null && activity.isFocusPictureInPictureActive()
            )
            .put(
                "immersiveSystemBars",
                activity != null && activity.isFocusImmersiveSystemBarsEnabled()
            )
            .put("nativeConnectionConfigured", connection != null)
            .put("controlsAvailable", snapshot.allowsCommands(getContext()))
            .put("pendingCommandCount", FocusRuntimeStore.pendingCount(getContext()))
            .put("cloudPoll", FocusNotificationService.pollDiagnostics(getContext()))
            .put("snapshot", snapshot.toPublicJson());
        if (connection != null) {
            result.put("nativeConnectionDeviceId", connection.deviceId);
            result.put("nativeConnectionLease", FocusRuntimeConnectionStore.leaseFor(connection));
        }
        return result;
    }

    private JSObject requestAllPermissionsResult() {
        String packageName = getContext().getPackageName();
        List<RootPermissionPolicy.PermissionPlan> plans = RootPermissionPolicy.plans(
            packageName,
            Build.VERSION.SDK_INT
        );
        RootCommandResult probe = runRootCommand("id -u");
        boolean rootAvailable = probe.succeeded && RootPermissionPolicy.hasRootIdentity(probe.output);
        JSArray items = new JSArray();
        for (RootPermissionPolicy.PermissionPlan plan : plans) {
            boolean commandAttempted =
                rootAvailable && !plan.manualRequired && !plan.commands.isEmpty();
            boolean commandSucceeded = commandAttempted;
            if (commandAttempted) {
                for (String command : plan.commands) {
                    RootCommandResult result = runRootCommand(command);
                    if (!result.succeeded) commandSucceeded = false;
                }
            }
            boolean verified = permissionVerified(plan.id);
            String state = RootPermissionPolicy.itemStatus(
                verified,
                plan.manualRequired,
                rootAvailable,
                commandSucceeded
            );
            items.put(
                new JSObject()
                    .put("id", plan.id)
                    .put("state", state)
                    .put("verified", verified)
                    .put("commandAttempted", commandAttempted)
                    .put("commandSucceeded", commandSucceeded)
            );
        }
        return new JSObject()
            .put("rootAvailable", rootAvailable)
            .put("attemptedAtEpochMs", System.currentTimeMillis())
            .put("items", items);
    }

    private boolean permissionVerified(String id) {
        if (RootPermissionPolicy.NOTIFICATION.equals(id)) {
            return FocusNotificationPermission.canPost(getContext());
        }
        if (RootPermissionPolicy.OVERLAY.equals(id)) {
            return FocusDesktopOverlayController.canDraw(getContext());
        }
        if (RootPermissionPolicy.BATTERY.equals(id)) {
            PowerManager powerManager = getContext().getSystemService(PowerManager.class);
            return powerManager != null &&
            powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        if (RootPermissionPolicy.BACKGROUND.equals(id)) {
            return backgroundAppOpsAllowed();
        }
        return false;
    }

    private boolean backgroundAppOpsAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        ActivityManager activityManager = getContext().getSystemService(ActivityManager.class);
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            activityManager != null &&
            activityManager.isBackgroundRestricted()
        ) {
            return false;
        }
        if (!appOpAllowed(APP_OP_RUN_IN_BACKGROUND)) return false;
        return (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.P ||
            appOpAllowed(APP_OP_RUN_ANY_IN_BACKGROUND)
        );
    }

    private boolean appOpAllowed(String operation) {
        AppOpsManager manager = getContext().getSystemService(AppOpsManager.class);
        if (manager == null) return false;
        try {
            return manager.checkOpNoThrow(
                operation,
                getContext().getApplicationInfo().uid,
                getContext().getPackageName()
            ) == AppOpsManager.MODE_ALLOWED;
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private static RootCommandResult runRootCommand(String command) {
        Process process = null;
        Thread outputReader = null;
        BoundedOutput output = null;
        try {
            process = new ProcessBuilder("su", "-c", command).redirectErrorStream(true).start();
            output = new BoundedOutput(process.getInputStream());
            outputReader = new Thread(output, "focuslink-root-output");
            outputReader.setDaemon(true);
            outputReader.start();
            long deadline = System.nanoTime() + ROOT_COMMAND_TIMEOUT_MS * 1_000_000L;
            while (true) {
                try {
                    int exitCode = process.exitValue();
                    outputReader.join(250L);
                    return new RootCommandResult(exitCode == 0, output.value());
                } catch (IllegalThreadStateException stillRunning) {
                    if (System.nanoTime() >= deadline) {
                        process.destroy();
                        outputReader.join(250L);
                        return new RootCommandResult(false, "");
                    }
                    Thread.sleep(25L);
                }
            }
        } catch (IOException exception) {
            return new RootCommandResult(false, "");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new RootCommandResult(false, "");
        } finally {
            if (process != null) {
                try {
                    process.exitValue();
                } catch (IllegalThreadStateException stillRunning) {
                    process.destroy();
                }
            }
        }
    }

    private static final class BoundedOutput implements Runnable {
        private final InputStream input;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();

        BoundedOutput(InputStream input) {
            this.input = input;
        }

        @Override
        public void run() {
            try (InputStream stream = input) {
                byte[] buffer = new byte[512];
                int read;
                while ((read = stream.read(buffer)) >= 0) {
                    append(buffer, read);
                }
            } catch (IOException ignored) {
                // A timeout destroys the process and closes its stream; the command is failed above.
            }
        }

        private synchronized void append(byte[] buffer, int read) {
            int remaining = ROOT_OUTPUT_LIMIT - output.size();
            if (remaining > 0) output.write(buffer, 0, Math.min(read, remaining));
        }

        synchronized String value() {
            return new String(output.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    private static final class RootCommandResult {
        final boolean succeeded;
        final String output;

        RootCommandResult(boolean succeeded, String output) {
            this.succeeded = succeeded;
            this.output = output;
        }
    }

    private JSObject notificationPermissionResult() {
        return new JSObject()
            .put("notificationPermission", FocusNotificationPermission.status(getContext()))
            .put("canPostNotification", FocusNotificationPermission.canPost(getContext()));
    }

    private static JSObject pauseReminderPreferenceJson(
        FocusRuntimeSystemSettings.PauseReminderPreference preference
    ) {
        return new JSObject()
            .put("enabled", preference.enabled)
            .put("delayMinutes", preference.delayMinutes);
    }

    private MainActivity mainActivity() {
        return getActivity() instanceof MainActivity ? (MainActivity) getActivity() : null;
    }

    private boolean openNotificationSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private static JSObject quickSettingsRequestResult(int result) {
        String status;
        if (result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED) {
            status = "added";
        } else if (result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED) {
            status = "already-added";
        } else if (result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED) {
            status = "not-added";
        } else {
            status = "error";
        }
        return new JSObject().put("status", status).put("manualRequired", false);
    }

    private FocusRuntimeConnectionStore.Connection connectionForSourceDevice(
        String deviceId,
        String connectionLease
    ) {
        return FocusRuntimeConnectionStore.connectionForSource(
            getContext(),
            deviceId,
            connectionLease
        );
    }

    private static long safeTimestamp(PluginCall call, String key) {
        Object raw = call.getData().opt(key);
        if (!(raw instanceof Number)) {
            throw new IllegalArgumentException(key + " must be a safe integer");
        }
        Number number = (Number) raw;
        long value = number.longValue();
        if (
            number.doubleValue() != (double) value ||
            value < 0L ||
            value > FocusRuntimeContract.MAX_SAFE_INTEGER
        ) {
            throw new IllegalArgumentException(key + " must be a safe integer");
        }
        return value;
    }

    static List<Intent> autoStartSettingsCandidates(Context context) {
        List<Intent> candidates = new ArrayList<>();
        for (String key : autoStartSettingsCandidateKeys(Build.MANUFACTURER)) {
            if (key.startsWith("action:")) {
                candidates.add(new Intent(key.substring("action:".length())));
                continue;
            }
            if (key.startsWith("component:")) {
                String[] parts = key.substring("component:".length()).split("/", 2);
                candidates.add(explicitIntent(parts[0], parts[1]));
            }
        }
        candidates.add(
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(
                Uri.parse("package:" + context.getPackageName())
            )
        );
        return candidates;
    }

    static List<String> autoStartSettingsCandidateKeys(String rawManufacturer) {
        String manufacturer = rawManufacturer == null
            ? ""
            : rawManufacturer.toLowerCase(Locale.ROOT);
        List<String> candidates = new ArrayList<>();
        if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
            candidates.add(
                "component:com.huawei.systemmanager/" +
                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
            );
            candidates.add(
                "component:com.huawei.systemmanager/" +
                "com.huawei.systemmanager.optimize.process.ProtectActivity"
            );
            candidates.add("action:huawei.intent.action.HSM_STARTUPAPP_MANAGER");
        }
        if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi")) {
            candidates.add(
                "component:com.miui.securitycenter/" +
                "com.miui.permcenter.autostart.AutoStartManagementActivity"
            );
        }
        return candidates;
    }

    private boolean startFirstResolvable(List<Intent> candidates) {
        for (Intent candidate : candidates) {
            candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                if (candidate.resolveActivity(getContext().getPackageManager()) == null) continue;
                getContext().startActivity(candidate);
                return true;
            } catch (RuntimeException ignored) {
                // OEM settings components vary by system release; continue to the safe fallback.
            }
        }
        return false;
    }

    private Intent applicationDetailsIntent() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(
            Uri.parse("package:" + getContext().getPackageName())
        );
    }

    private static Intent explicitIntent(String packageName, String className) {
        return new Intent().setComponent(new ComponentName(packageName, className));
    }
}
