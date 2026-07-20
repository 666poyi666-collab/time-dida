package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.Arrays;
import java.util.List;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    @Test
    public void usesFocusLinkApplicationContext() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("app.focuslink.mobile", appContext.getPackageName());
        assertEquals(
            "0.12.16",
            appContext
                .getPackageManager()
                .getPackageInfo(appContext.getPackageName(), 0)
                .versionName
        );
    }

    @Test
    public void declaresPrivateForegroundRuntimeAndExportedQuickSettingsTile() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PackageInfo packageInfo = context
            .getPackageManager()
            .getPackageInfo(
                context.getPackageName(),
                PackageManager.GET_PERMISSIONS | PackageManager.GET_SERVICES
            );
        List<String> permissions = Arrays.asList(packageInfo.requestedPermissions);
        assertTrue(permissions.contains(Manifest.permission.POST_NOTIFICATIONS));
        assertTrue(permissions.contains(Manifest.permission.FOREGROUND_SERVICE));
        assertTrue(
            permissions.contains("android.permission.FOREGROUND_SERVICE_SPECIAL_USE")
        );

        ServiceInfo notification = findService(
            packageInfo.services,
            FocusNotificationService.class.getName()
        );
        assertFalse(notification.exported);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            assertTrue(
                (notification.getForegroundServiceType() &
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) !=
                0
            );
        }

        ServiceInfo tile = findService(
            packageInfo.services,
            FocusRuntimeTileService.class.getName()
        );
        assertTrue(tile.exported);
        assertEquals("android.permission.BIND_QUICK_SETTINGS_TILE", tile.permission);
    }

    @Test
    public void persistsNativeCommandsUntilTheWebLayerAcknowledgesThem() {
        Context context = isolatedRuntimeContext();
        FocusRuntimeStore.clearForTests(context);
        try {
            long now = System.currentTimeMillis();
            FocusRuntimeSnapshot snapshot = FocusRuntimeSnapshot.fromPlugin(
                context,
                new JSObject()
                    .put("state", "running")
                    .put("sessionId", "instrumented-live-session")
                    .put("stateRevision", 7)
                    .put("title", "双机通知控制")
                    .put("timeLabel", "00:42")
                    .put("detail", "专注中")
                    .put("primaryElapsedMs", 42_000)
                    .put("primaryAdvances", true)
                    .put("controlsEnabled", true)
                    .put("validUntilEpochMs", now + 60_000)
            );
            FocusRuntimeStore.putSnapshot(context, snapshot);
            assertTrue(FocusRuntimeStore.getSnapshot(context).allowsCommands(context));

            Intent action = notificationCommandIntent(
                context,
                FocusRuntimeContract.COMMAND_PAUSE,
                7
            );
            FocusRuntimeCommand command = MainActivity.enqueueNotificationCommand(
                context,
                action
            );
            assertNotNull(command);
            assertEquals(FocusRuntimeContract.SOURCE_NOTIFICATION, command.source);
            assertNull(MainActivity.enqueueNotificationCommand(context, action));
            assertNull(
                MainActivity.enqueueNotificationCommand(
                    context,
                    notificationCommandIntent(
                        context,
                        FocusRuntimeContract.COMMAND_PAUSE,
                        6
                    )
                )
            );

            List<FocusRuntimeCommand> drained = FocusRuntimeStore.drainPendingCommands(context);
            assertEquals(1, drained.size());
            assertEquals(command.id, drained.get(0).id);
            JSArray completed = new JSArray();
            completed.put(command.id);
            assertEquals(1, FocusRuntimeStore.completeCommands(context, completed));
            assertEquals(0, FocusRuntimeStore.pendingCount(context));
        } finally {
            FocusRuntimeStore.clearForTests(context);
        }
    }

    private static Intent notificationCommandIntent(
        Context context,
        String commandType,
        long revision
    ) {
        return new Intent(context, MainActivity.class)
            .setAction(FocusRuntimeContract.ACTION_NOTIFICATION_COMMAND)
            .putExtra(FocusRuntimeContract.EXTRA_COMMAND_TYPE, commandType)
            .putExtra(
                FocusRuntimeContract.EXTRA_SESSION_ID,
                "instrumented-live-session"
            )
            .putExtra(FocusRuntimeContract.EXTRA_STATE_REVISION, revision);
    }

    private static Context isolatedRuntimeContext() {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String prefix = "focus_runtime_instrumentation_" + android.os.Process.myPid() + "_";
        return new ContextWrapper(target) {
            @Override
            public Context getApplicationContext() {
                return this;
            }

            @Override
            public SharedPreferences getSharedPreferences(String name, int mode) {
                return super.getSharedPreferences(prefix + name, mode);
            }
        };
    }

    private static ServiceInfo findService(ServiceInfo[] services, String className) {
        assertNotNull(services);
        for (ServiceInfo service : services) {
            if (className.equals(service.name)) {
                return service;
            }
        }
        throw new AssertionError("Missing Android service " + className);
    }
}
