package app.focuslink.mobile;

import android.Manifest;
import android.app.StatusBarManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
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
import java.util.List;

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
            FocusRuntimeSnapshot snapshot = FocusRuntimeSnapshot.fromPlugin(
                getContext(),
                call.getObject("snapshot")
            );
            FocusRuntimeStore.putSnapshot(getContext(), snapshot);
            FocusNotificationService.synchronize(getContext());
            FocusRuntimeTileService.requestRefresh(getContext());
            call.resolve(nativeStatus(snapshot));
        } catch (IllegalArgumentException exception) {
            call.reject(exception.getMessage(), "invalid_snapshot");
        }
    }

    @PluginMethod
    public void drainPendingCommands(PluginCall call) {
        List<FocusRuntimeCommand> pending = FocusRuntimeStore.drainPendingCommands(
            getContext()
        );
        JSArray commands = new JSArray();
        for (FocusRuntimeCommand command : pending) {
            commands.put(command.toJson());
        }
        call.resolve(new JSObject().put("commands", commands));
    }

    @PluginMethod
    public void completeCommands(PluginCall call) {
        try {
            int completed = FocusRuntimeStore.completeCommands(
                getContext(),
                call.getArray("ids")
            );
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
        return new JSObject()
            .put("notificationPermission", FocusNotificationPermission.status(getContext()))
            .put("canPostNotification", FocusNotificationPermission.canPost(getContext()))
            .put("quickSettingsSupported", true)
            .put("controlsAvailable", snapshot.allowsCommands(getContext()))
            .put("pendingCommandCount", FocusRuntimeStore.pendingCount(getContext()))
            .put("snapshot", snapshot.toPublicJson());
    }

    private JSObject notificationPermissionResult() {
        return new JSObject()
            .put("notificationPermission", FocusNotificationPermission.status(getContext()))
            .put("canPostNotification", FocusNotificationPermission.canPost(getContext()));
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
}
