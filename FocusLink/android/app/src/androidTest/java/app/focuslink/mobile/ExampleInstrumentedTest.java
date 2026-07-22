package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;

@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    @Test
    public void usesFocusLinkApplicationContext() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("app.focuslink.mobile", appContext.getPackageName());
        assertEquals(
            "0.12.21",
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
        assertTrue(permissions.contains(Manifest.permission.WAKE_LOCK));
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
            JSObject cloudRequest = command.toCloudRequest("android-device");
            assertEquals(1, cloudRequest.optInt("protocolVersion"));
            assertEquals("android-device", cloudRequest.optString("deviceId"));
            assertEquals(
                command.id,
                cloudRequest.optJSONObject("command").optString("commandId")
            );
            assertEquals(
                FocusRuntimeContract.COMMAND_PAUSE,
                cloudRequest.optJSONObject("command").optString("action")
            );
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

    @Test
    public void rejectsStaleWebSnapshotsAfterANewerCloudRevision() {
        Context context = isolatedRuntimeContext();
        FocusRuntimeStore.clearForTests(context);
        try {
            long now = System.currentTimeMillis();
            FocusRuntimeSnapshot current = FocusRuntimeSnapshot.fromPlugin(
                context,
                activeSnapshot(now, 12, "current-session")
            );
            FocusRuntimeSnapshot stale = FocusRuntimeSnapshot.fromPlugin(
                context,
                activeSnapshot(now, 6, "stale-session")
            );
            assertTrue(FocusRuntimeStore.putSnapshot(context, current));
            assertFalse(FocusRuntimeStore.putSnapshot(context, stale));
            assertEquals(12L, FocusRuntimeStore.getSnapshot(context).stateRevision);

            FocusRuntimeSnapshot completed = FocusRuntimeSnapshot.fromPlugin(
                context,
                new JSObject()
                    .put("state", "idle")
                    .put("stateRevision", 13)
                    .put("primaryAdvances", false)
                    .put("controlsEnabled", false)
            );
            assertTrue(FocusRuntimeStore.putSnapshot(context, completed));
            assertFalse(FocusRuntimeStore.getSnapshot(context).isActive());
            assertEquals(13L, FocusRuntimeStore.getSnapshot(context).stateRevision);
            assertFalse(FocusRuntimeStore.putSnapshot(context, current));
        } finally {
            FocusRuntimeStore.clearForTests(context);
        }
    }

    @Test
    public void alwaysProvidesAnAppDetailsFallbackForOemBackgroundSettings() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        List<Intent> candidates = FocusRuntimePlugin.autoStartSettingsCandidates(context);
        assertFalse(candidates.isEmpty());
        Intent fallback = candidates.get(candidates.size() - 1);
        assertEquals(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, fallback.getAction());
        assertEquals("package:" + context.getPackageName(), fallback.getDataString());
    }

    @Test
    public void encryptsNativeConnectionAndRejectsRemoteCleartext() {
        Context context = isolatedRuntimeContext();
        FocusRuntimeConnectionStore.clear(context);
        String token = "instrumentation-native-token";
        try {
            FocusRuntimeConnectionStore.put(
                context,
                "http://127.0.0.1:8787/",
                token,
                "instrumentation-device"
            );
            FocusRuntimeConnectionStore.Connection connection =
                FocusRuntimeConnectionStore.get(context);
            assertNotNull(connection);
            assertEquals("http://127.0.0.1:8787", connection.endpoint);
            assertEquals(token, connection.accessToken);
            assertEquals("instrumentation-device", connection.deviceId);

            String storedToken = context
                .getSharedPreferences("focus_runtime_connection_v1", Context.MODE_PRIVATE)
                .getString("token", "");
            assertFalse(storedToken.isEmpty());
            assertFalse(storedToken.contains(token));

            try {
                FocusRuntimeConnectionStore.put(
                    context,
                    "http://192.168.1.20:8787",
                    token,
                    "instrumentation-device"
                );
                throw new AssertionError("Remote cleartext endpoint must be rejected");
            } catch (IllegalArgumentException expected) {
                assertTrue(expected.getMessage().contains("endpoint"));
            }
        } finally {
            FocusRuntimeConnectionStore.clear(context);
        }
    }

    @Test
    public void backgroundServiceUploadsCommandsWithoutWebView() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        String endpoint = arguments.getString("focuslinkEndpoint", "");
        String token = arguments.getString("focuslinkToken", "");
        assumeTrue("real cloud arguments were not supplied", !endpoint.isEmpty() && !token.isEmpty());

        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        grantNotificationPermissionForTest(context);
        FocusRuntimeStore.clearForTests(context);
        FocusRuntimeConnectionStore.clear(context);
        try {
            FocusRuntimeConnectionStore.put(
                context,
                endpoint,
                token,
                "xiaomi-native-service-validation"
            );
            FocusRuntimeConnectionStore.Connection connection =
                FocusRuntimeConnectionStore.get(context);
            assertNotNull(connection);
            FocusCloudClient client = FocusCloudClient.createDefault();
            FocusRuntimeSnapshot initial = FocusRuntimeSnapshot.fromCloudResponse(
                context,
                client.fetchLive(connection)
            );
            assertEquals(FocusRuntimeContract.STATE_RUNNING, initial.state);
            assertTrue(FocusRuntimeStore.putSnapshot(context, initial));
            FocusNotificationService.synchronize(context);

            FocusRuntimeSnapshot paused = issueAndAwaitNativeCommand(
                context,
                client,
                connection,
                FocusRuntimeContract.COMMAND_PAUSE,
                FocusRuntimeContract.STATE_PAUSED
            );
            assertTrue(paused.stateRevision > initial.stateRevision);

            FocusRuntimeSnapshot resumed = issueAndAwaitNativeCommand(
                context,
                client,
                connection,
                FocusRuntimeContract.COMMAND_RESUME,
                FocusRuntimeContract.STATE_RUNNING
            );
            assertTrue(resumed.stateRevision > paused.stateRevision);

            FocusRuntimeSnapshot finished = issueAndAwaitNativeCommand(
                context,
                client,
                connection,
                FocusRuntimeContract.COMMAND_FINISH,
                FocusRuntimeContract.STATE_IDLE
            );
            assertTrue(finished.stateRevision > resumed.stateRevision);
            assertEquals(0, FocusRuntimeStore.pendingCount(context));
        } finally {
            context.stopService(new Intent(context, FocusNotificationService.class));
            FocusRuntimeConnectionStore.clear(context);
            FocusRuntimeStore.clearForTests(context);
        }
    }

    @Test
    public void backgroundServiceRetriesAfterConnectionRecovery() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        String endpoint = arguments.getString("focuslinkEndpoint", "");
        String token = arguments.getString("focuslinkToken", "");
        assumeTrue("real cloud arguments were not supplied", !endpoint.isEmpty() && !token.isEmpty());

        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        grantNotificationPermissionForTest(context);
        FocusRuntimeStore.clearForTests(context);
        FocusRuntimeConnectionStore.clear(context);
        FocusRuntimeConnectionStore.Connection reachable =
            new FocusRuntimeConnectionStore.Connection(
                endpoint,
                token,
                "xiaomi-native-recovery-validation"
            );
        FocusCloudClient client = FocusCloudClient.createDefault();
        try {
            FocusRuntimeSnapshot initial = FocusRuntimeSnapshot.fromCloudResponse(
                context,
                client.fetchLive(reachable)
            );
            assertEquals(FocusRuntimeContract.STATE_RUNNING, initial.state);
            assertTrue(FocusRuntimeStore.putSnapshot(context, initial));
            FocusRuntimeConnectionStore.put(
                context,
                "http://127.0.0.1:18789",
                token,
                "xiaomi-native-recovery-validation"
            );

            FocusRuntimeCommand command = MainActivity.enqueueNotificationCommand(
                context,
                notificationCommandIntent(
                    context,
                    FocusRuntimeContract.COMMAND_PAUSE,
                    initial.sessionId,
                    initial.stateRevision
                )
            );
            assertNotNull(command);
            FocusNotificationService.synchronize(context);
            SystemClock.sleep(3_000L);
            assertEquals(1, FocusRuntimeStore.pendingCount(context));
            FocusRuntimeSnapshot stillRunning = FocusRuntimeSnapshot.fromCloudResponse(
                context,
                client.fetchLive(reachable)
            );
            assertEquals(FocusRuntimeContract.STATE_RUNNING, stillRunning.state);
            assertEquals(initial.stateRevision, stillRunning.stateRevision);

            FocusRuntimeConnectionStore.put(
                context,
                endpoint,
                token,
                "xiaomi-native-recovery-validation"
            );
            FocusNotificationService.synchronize(context);
            FocusRuntimeSnapshot paused = awaitNativeState(
                context,
                client,
                reachable,
                FocusRuntimeContract.STATE_PAUSED
            );
            assertEquals(initial.stateRevision + 1, paused.stateRevision);

            issueAndAwaitNativeCommand(
                context,
                client,
                reachable,
                FocusRuntimeContract.COMMAND_FINISH,
                FocusRuntimeContract.STATE_IDLE
            );
        } finally {
            context.stopService(new Intent(context, FocusNotificationService.class));
            FocusRuntimeConnectionStore.clear(context);
            FocusRuntimeStore.clearForTests(context);
        }
    }

    @Test
    public void webViewReadsTasksAndStartsLinkedAndFreeFocus() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        String endpoint = arguments.getString("focuslinkEndpoint", "");
        String token = arguments.getString("focuslinkToken", "");
        assumeTrue("real cloud arguments were not supplied", !endpoint.isEmpty() && !token.isEmpty());
        assumeTrue(
            "WebView interaction requires an unlocked device",
            "true".equalsIgnoreCase(arguments.getString("focuslinkRunWebView", "false"))
        );

        android.app.Instrumentation instrumentation =
            InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        assertNotNull(launch);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(launch);
        MainActivity activity = awaitMainActivity(instrumentation);
        assertNotNull(activity);
        try {
            String configure =
                "localStorage.setItem('focuslink.mobile.endpoint'," + JSONObject.quote(endpoint) +
                ");localStorage.setItem('focuslink.mobile.remember-token','true');" +
                "localStorage.setItem('focuslink.mobile.token.local'," + JSONObject.quote(token) +
                ");sessionStorage.removeItem('focuslink.mobile.token.session');true";
            assertEquals("true", evaluateJavascript(instrumentation, activity, configure));
            instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().reload());

            awaitJavascript(
                instrumentation,
                activity,
                "(()=>{const select=document.querySelector('#focus-task');" +
                "const option=Array.from(select?.options??[]).find((item)=>" +
                "item.textContent.includes('手机跨设备验收'));" +
                "return Boolean(option)})()"
            );
            String selectedTaskId = evaluateJavascript(
                instrumentation,
                activity,
                "(()=>{const select=document.querySelector('#focus-task');" +
                "const option=Array.from(select.options).find((item)=>" +
                "item.textContent.includes('手机跨设备验收'));" +
                "if(!option)return null;" +
                "Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(" +
                "select,option.value);select.dispatchEvent(new Event('change',{bubbles:true}));" +
                "return option.value})()"
            );
            assertFalse("null".equals(selectedTaskId));
            selectedTaskId = new org.json.JSONTokener(selectedTaskId).nextValue().toString();
            awaitJavascript(
                instrumentation,
                activity,
                "document.querySelector('#focus-title').value==='手机跨设备验收'&&" +
                "Array.from(document.querySelectorAll('button')).some((button)=>" +
                "button.textContent.includes('开始专注')&&!button.disabled)"
            );
            clickButton(instrumentation, activity, "开始专注");

            FocusCloudClient client = FocusCloudClient.createDefault();
            FocusRuntimeConnectionStore.Connection connection =
                new FocusRuntimeConnectionStore.Connection(
                    endpoint,
                    token,
                    "xiaomi-webview-validation"
                );
            JSONObject linked = awaitCloudState(client, connection, FocusRuntimeContract.STATE_RUNNING);
            JSONObject linkedTask = linked
                .getJSONObject("snapshot")
                .getJSONObject("session")
                .getJSONObject("task");
            assertEquals(selectedTaskId, linkedTask.getString("taskId"));
            awaitEnabledButton(instrumentation, activity, "结束本轮");
            clickButtonWithConfirm(instrumentation, activity, "结束本轮");
            awaitCloudState(client, connection, FocusRuntimeContract.STATE_IDLE);

            assertEquals(
                "true",
                evaluateJavascript(
                    instrumentation,
                    activity,
                    "(()=>{const select=document.querySelector('#focus-task');" +
                    "select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));" +
                    "const input=document.querySelector('#focus-title');" +
                    "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(" +
                    "input,'模拟器自由专注');input.dispatchEvent(new Event('input',{bubbles:true}));" +
                    "return true})()"
                )
            );
            awaitJavascript(
                instrumentation,
                activity,
                "document.querySelector('#focus-title').value==='模拟器自由专注'&&" +
                "Array.from(document.querySelectorAll('button')).some((button)=>" +
                "button.textContent.includes('开始专注')&&!button.disabled)"
            );
            clickButton(instrumentation, activity, "开始专注");
            JSONObject free = awaitCloudState(client, connection, FocusRuntimeContract.STATE_RUNNING);
            JSONObject freeSession = free.getJSONObject("snapshot").getJSONObject("session");
            assertEquals("模拟器自由专注", freeSession.getString("title"));
            assertTrue(freeSession.isNull("task"));
            awaitEnabledButton(instrumentation, activity, "结束本轮");
            clickButtonWithConfirm(instrumentation, activity, "结束本轮");
            awaitCloudState(client, connection, FocusRuntimeContract.STATE_IDLE);
        } finally {
            try {
                evaluateJavascript(
                    instrumentation,
                    activity,
                    "localStorage.clear();sessionStorage.clear();true"
                );
            } finally {
                activity.finish();
                FocusRuntimeConnectionStore.clear(context);
                FocusRuntimeStore.clearForTests(context);
            }
        }
    }

    private static void clickButton(
        android.app.Instrumentation instrumentation,
        MainActivity activity,
        String text
    ) throws Exception {
        String expression =
            "(()=>{const button=Array.from(document.querySelectorAll('button')).find(" +
            "item=>item.textContent.includes(" + JSONObject.quote(text) + ")&&!item.disabled);" +
            "if(!button)return false;button.click();return true})()";
        assertEquals("true", evaluateJavascript(instrumentation, activity, expression));
    }

    private static MainActivity awaitMainActivity(
        android.app.Instrumentation instrumentation
    ) {
        long deadline = SystemClock.elapsedRealtime() + 15_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicReference<MainActivity> result = new AtomicReference<>();
            instrumentation.runOnMainSync(() -> {
                for (
                    Stage stage : new Stage[] {
                        Stage.RESUMED,
                        Stage.STARTED,
                        Stage.PAUSED,
                        Stage.STOPPED,
                        Stage.CREATED,
                    }
                ) {
                    for (
                        android.app.Activity candidate : ActivityLifecycleMonitorRegistry
                            .getInstance()
                            .getActivitiesInStage(stage)
                    ) {
                        if (candidate instanceof MainActivity) {
                            result.set((MainActivity) candidate);
                            return;
                        }
                    }
                }
            });
            if (result.get() != null) return result.get();
            SystemClock.sleep(100L);
        }
        throw new AssertionError("MainActivity did not start");
    }

    private static void clickButtonWithConfirm(
        android.app.Instrumentation instrumentation,
        MainActivity activity,
        String text
    ) throws Exception {
        assertEquals(
            "true",
            evaluateJavascript(
                instrumentation,
                activity,
                "window.confirm=()=>true;" +
                "(()=>{const button=Array.from(document.querySelectorAll('button')).find(" +
                "item=>item.textContent.includes(" + JSONObject.quote(text) + ")&&!item.disabled);" +
                "if(!button)return false;button.click();return true})()"
            )
        );
    }

    private static void awaitEnabledButton(
        android.app.Instrumentation instrumentation,
        MainActivity activity,
        String text
    ) throws Exception {
        awaitJavascript(
            instrumentation,
            activity,
            "Array.from(document.querySelectorAll('button')).some((button)=>" +
            "button.textContent.includes(" + JSONObject.quote(text) + ")&&!button.disabled)"
        );
    }

    private static void grantNotificationPermissionForTest(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        InstrumentationRegistry
            .getInstrumentation()
            .getUiAutomation()
            .grantRuntimePermission(
                context.getPackageName(),
                Manifest.permission.POST_NOTIFICATIONS
            );
    }

    private static void awaitJavascript(
        android.app.Instrumentation instrumentation,
        MainActivity activity,
        String expression
    ) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluateJavascript(instrumentation, activity, expression))) return;
            SystemClock.sleep(250L);
        }
        String diagnostic = evaluateJavascript(
            instrumentation,
            activity,
            "JSON.stringify({href:location.href,origin:location.origin,ready:document.readyState," +
            "body:document.body?.innerText?.slice(0,1200)," +
            "taskOptions:Array.from(document.querySelector('#focus-task')?.options??[]).map(" +
            "option=>({value:option.value,text:option.textContent}))," +
            "startButtons:Array.from(document.querySelectorAll('button')).filter(button=>" +
            "button.textContent.includes('开始专注')).map(button=>" +
            "({text:button.textContent,disabled:button.disabled}))," +
            "endpoint:localStorage.getItem('focuslink.mobile.endpoint')," +
            "remember:localStorage.getItem('focuslink.mobile.remember-token')," +
            "hasToken:Boolean(localStorage.getItem('focuslink.mobile.token.local'))})"
        );
        throw new AssertionError(
            "WebView condition did not become true: " + expression + "; state=" + diagnostic
        );
    }

    private static String evaluateJavascript(
        android.app.Instrumentation instrumentation,
        MainActivity activity,
        String expression
    ) throws Exception {
        WebView webView = activity.getBridge().getWebView();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(
            () -> webView.evaluateJavascript(
                expression,
                value -> {
                    result.set(value);
                    latch.countDown();
                }
            )
        );
        assertTrue("WebView evaluation timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private static JSONObject awaitCloudState(
        FocusCloudClient client,
        FocusRuntimeConnectionStore.Connection connection,
        String state
    ) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            JSONObject response = client.fetchLive(connection);
            JSONObject session = response.getJSONObject("snapshot").optJSONObject("session");
            String current = session == null ? FocusRuntimeContract.STATE_IDLE : session.getString("state");
            if (state.equals(current)) return response;
            SystemClock.sleep(250L);
        }
        throw new AssertionError("Cloud did not reach " + state);
    }

    private static FocusRuntimeSnapshot issueAndAwaitNativeCommand(
        Context context,
        FocusCloudClient client,
        FocusRuntimeConnectionStore.Connection connection,
        String commandType,
        String expectedState
    ) throws Exception {
        FocusRuntimeSnapshot before = FocusRuntimeStore.getSnapshot(context);
        FocusRuntimeCommand command = MainActivity.enqueueNotificationCommand(
            context,
            notificationCommandIntent(
                context,
                commandType,
                before.sessionId,
                before.stateRevision
            )
        );
        assertNotNull(command);
        FocusNotificationService.synchronize(context);

        return awaitNativeState(context, client, connection, expectedState);
    }

    private static FocusRuntimeSnapshot awaitNativeState(
        Context context,
        FocusCloudClient client,
        FocusRuntimeConnectionStore.Connection connection,
        String expectedState
    ) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            FocusRuntimeSnapshot local = FocusRuntimeStore.getSnapshot(context);
            JSONObject cloud = client.fetchLive(connection);
            FocusRuntimeSnapshot remote = FocusRuntimeSnapshot.fromCloudResponse(context, cloud);
            if (
                expectedState.equals(remote.state) &&
                local.stateRevision >= remote.stateRevision &&
                FocusRuntimeStore.pendingCount(context) == 0
            ) {
                return remote;
            }
            SystemClock.sleep(250L);
        }
        throw new AssertionError("Native service did not reach " + expectedState);
    }

    private static JSObject activeSnapshot(long now, long revision, String sessionId) {
        return new JSObject()
            .put("state", "running")
            .put("sessionId", sessionId)
            .put("stateRevision", revision)
            .put("title", "revision guard")
            .put("timeLabel", "00:01")
            .put("detail", "专注中")
            .put("primaryElapsedMs", 1_000)
            .put("primaryAdvances", true)
            .put("controlsEnabled", true)
            .put("validUntilEpochMs", now + 60_000);
    }

    private static Intent notificationCommandIntent(
        Context context,
        String commandType,
        long revision
    ) {
        return notificationCommandIntent(
            context,
            commandType,
            "instrumented-live-session",
            revision
        );
    }

    private static Intent notificationCommandIntent(
        Context context,
        String commandType,
        String sessionId,
        long revision
    ) {
        return new Intent(context, MainActivity.class)
            .setAction(FocusRuntimeContract.ACTION_NOTIFICATION_COMMAND)
            .putExtra(FocusRuntimeContract.EXTRA_COMMAND_TYPE, commandType)
            .putExtra(
                FocusRuntimeContract.EXTRA_SESSION_ID,
                sessionId
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
