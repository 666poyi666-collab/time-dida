package app.focuslink.mobile;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import androidx.core.app.NotificationCompat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Selects and decorates the best truthful system-owned focus surface. */
final class SystemFocusSurfaceProvider {
    static final String SURFACE_HUAWEI_LIVE_CAPSULE = SystemFocusSurfacePolicy.HUAWEI_LIVE_CAPSULE;
    static final String SURFACE_XIAOMI_ISLAND = SystemFocusSurfacePolicy.XIAOMI_ISLAND;
    static final String SURFACE_ANDROID_LIVE_UPDATE = SystemFocusSurfacePolicy.ANDROID_LIVE_UPDATE;
    static final String SURFACE_ONGOING_NOTIFICATION = SystemFocusSurfacePolicy.ONGOING_NOTIFICATION;

    private static final String XIAOMI_FOCUS_PROTOCOL = "notification_focus_protocol";
    private static final Uri XIAOMI_FOCUS_PROVIDER = Uri.parse(
        "content://miui.statusbar.notification.public"
    );

    private SystemFocusSurfaceProvider() {}

    static Notification apply(
        Context context,
        Notification notification,
        FocusRuntimeSnapshot snapshot,
        String displayTitle,
        String displayContent
    ) {
        String surface = selectedSurface(context);
        notification.flags |= Notification.FLAG_ONGOING_EVENT;
        notification.extras.putString("focuslink.systemSurface", surface);
        if (SURFACE_XIAOMI_ISLAND.equals(surface)) {
            applyXiaomiIsland(notification, snapshot, displayTitle, displayContent);
        } else if (SURFACE_HUAWEI_LIVE_CAPSULE.equals(surface)) {
            applyHuaweiLiveCapsule(notification, snapshot);
        }
        return notification;
    }

    static void configureBuilder(Context context, NotificationCompat.Builder builder) {
        if (SURFACE_ANDROID_LIVE_UPDATE.equals(selectedSurface(context))) {
            builder.setRequestPromotedOngoing(true);
        }
    }

    static boolean usesHuaweiLiveCapsule(Context context) {
        return SURFACE_HUAWEI_LIVE_CAPSULE.equals(selectedSurface(context));
    }

    static JSObject capabilities(Context context) {
        int xiaomiProtocol = xiaomiFocusProtocol(context);
        boolean xiaomiPermission = xiaomiProtocol > 0 && hasXiaomiFocusPermission(context);
        boolean promotedSupported = Build.VERSION.SDK_INT >= 36;
        boolean promotedAllowed = promotedSupported && Api36.canPostPromoted(context);
        return new JSObject()
            .put("selected", selectedSurface(context))
            .put("huaweiLiveCandidate", isHuaweiOrHonor())
            .put("xiaomiFocusProtocol", xiaomiProtocol)
            .put("xiaomiFocusPermission", xiaomiPermission)
            .put("androidLiveUpdateSupported", promotedSupported)
            .put("androidLiveUpdateAllowed", promotedAllowed)
            .put("standardNotificationAvailable", FocusNotificationPermission.canPost(context))
            .put("overlayEnabled", FocusRuntimeSystemSettings.isOverlayEnabled(context))
            .put("overlayPermissionGranted", FocusDesktopOverlayController.canDraw(context));
    }

    static String selectedSurface(Context context) {
        int protocol = xiaomiFocusProtocol(context);
        boolean promotedAllowed = Build.VERSION.SDK_INT >= 36 && Api36.canPostPromoted(context);
        return SystemFocusSurfacePolicy.select(
            isHuaweiOrHonor(),
            protocol,
            hasXiaomiFocusPermission(context),
            promotedAllowed
        );
    }

    static int xiaomiFocusProtocol(Context context) {
        if (!isXiaomi()) return 0;
        try {
            return Math.max(
                0,
                Settings.System.getInt(context.getContentResolver(), XIAOMI_FOCUS_PROTOCOL, 0)
            );
        } catch (RuntimeException ignored) {
            return 0;
        }
    }

    static boolean hasXiaomiFocusPermission(Context context) {
        if (!isXiaomi()) return false;
        try {
            Bundle request = new Bundle();
            request.putString("package", context.getPackageName());
            Bundle response = context
                .getContentResolver()
                .call(XIAOMI_FOCUS_PROVIDER, "canShowFocus", null, request);
            return response != null && response.getBoolean("canShowFocus", false);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static boolean isXiaomi() {
        String manufacturer = Build.MANUFACTURER == null
            ? ""
            : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        return manufacturer.contains("xiaomi") || manufacturer.contains("redmi");
    }

    private static boolean isHuaweiOrHonor() {
        String manufacturer = Build.MANUFACTURER == null
            ? ""
            : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        return manufacturer.contains("huawei") || manufacturer.contains("honor");
    }

    /**
     * EMUI 14.2 consumes this timer capsule projection from an otherwise standard notification.
     * Unknown Huawei/Honor builds simply ignore the extras and keep the ongoing notification.
     */
    private static void applyHuaweiLiveCapsule(
        Notification notification,
        FocusRuntimeSnapshot snapshot
    ) {
        boolean running = FocusRuntimeContract.STATE_RUNNING.equals(snapshot.state);
        Bundle capsule = new Bundle();
        capsule.putString(
            "notification.live.capsuleContent",
            running ? "专注计时中" : "专注已暂停"
        );
        if (notification.getSmallIcon() != null) {
            capsule.putParcelable(
                "notification.live.capsuleIcon",
                notification.getSmallIcon()
            );
        }
        capsule.putLong(
            "notification.live.capsuleTime",
            Math.max(0L, snapshot.primaryElapsedMs)
        );
        capsule.putInt("notification.live.capsuleType", 2);
        // EMUI 14.2 accepts only status=1 (active) and status=-1 (ended). Pausing is
        // represented by capsulePause; using status=2 makes SystemUI drop the capsule.
        capsule.putInt("notification.live.capsuleStatus", 1);
        capsule.putBoolean("notification.live.capsulePause", !snapshot.primaryAdvances);
        capsule.putInt(
            "notification.live.capsuleBgColor",
            running ? 0xFF6ECCE2 : 0xFFD94B43
        );
        // Keep both historical EMUI spellings aligned. FocusLink projects elapsed time,
        // so the SystemUI timer advances forward rather than counting down.
        capsule.putBoolean("notification.live.capsuleCountDown", false);
        capsule.putBoolean("notification.live.capsuleCountdown", false);

        Bundle feature = new Bundle();
        feature.putInt("notification.live.feature.extendType", 0);
        feature.putCharSequence(
            "notification.live.feature.extendText",
            running ? "专注计时中" : "专注已暂停"
        );
        feature.putBoolean("notification.live.feature.hideProgress", true);
        feature.putInt("notification.live.feature.chronometerPosition", 0);
        notification.extras.putInt("notification.live.operation", 0);
        notification.extras.putBundle("notification.live.feature", feature);
        notification.extras.putInt("notification.live.type", 1);
        notification.extras.putString("notification.live.event", "TIMER");
        notification.extras.putBundle("notification.live.capsule", capsule);
        notification.extras.putBoolean("CapsuleEnabled", true);
        notification.extras.putString("specialType", "floating_window_notification");
        notification.extras.putBoolean("android.chronometerCountDown", false);
        notification.extras.putBoolean("android.showChronometer", true);
        notification.extras.putBoolean("android.showWhen", true);
        notification.extras.putBoolean("notification_should_ringtone", false);
        notification.extras.putInt("externalChannelType", 3);
        notification.extras.putBoolean("PopupBackgroundWindowPrevilege", false);
        notification.extras.putBoolean("topFullscreen", false);
        notification.extras.putBoolean("isRequestSingleLine", false);
        notification.extras.putBoolean("gameDndOn", false);
        // EMUI's TIMER contract uses the elapsed timer value in both locations.
        // Keeping these values identical mirrors the device-captured reference notification.
        notification.when = Math.max(0L, snapshot.primaryElapsedMs);
    }

    private static void applyXiaomiIsland(
        Notification notification,
        FocusRuntimeSnapshot snapshot,
        String displayTitle,
        String displayContent
    ) {
        try {
            String stateLabel = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state)
                ? "暂停"
                : "专注";
            JSONObject textInfo = new JSONObject()
                .put("frontTitle", stateLabel)
                .put("title", snapshot.timeLabel)
                .put("content", displayTitle)
                .put("useHighLight", false);
            JSONObject paramV2 = new JSONObject()
                .put("protocol", 1)
                .put("enableFloat", true)
                .put("updatable", true)
                .put("ticker", stateLabel + " " + snapshot.timeLabel)
                .put(
                    "baseInfo",
                    new JSONObject()
                        .put("title", displayTitle)
                        .put("content", displayContent)
                        .put("type", 2)
                )
                .put(
                    "hintInfo",
                    new JSONObject().put("type", 1).put("title", snapshot.timeLabel)
                )
                .put(
                    "param_island",
                    new JSONObject()
                        .put("islandProperty", 1)
                        .put(
                            "bigIslandArea",
                            new JSONObject().put(
                                "imageTextInfoLeft",
                                new JSONObject().put("type", 1).put("textInfo", textInfo)
                            )
                        )
                        .put(
                            "smallIslandArea",
                            new JSONObject().put("textInfo", new JSONObject().put("title", snapshot.timeLabel))
                        )
                );

            Bundle actionBundle = new Bundle();
            JSONArray actionDescriptors = new JSONArray();
            if (notification.actions != null) {
                for (int index = 0; index < notification.actions.length; index++) {
                    String key = "focuslink_action_" + index;
                    actionBundle.putParcelable(key, notification.actions[index]);
                    actionDescriptors.put(new JSONObject().put("action", key));
                }
            }
            if (actionDescriptors.length() > 0) {
                paramV2.put("actions", actionDescriptors);
                notification.extras.putBundle("miui.focus.actions", actionBundle);
            }
            notification.extras.putString(
                "miui.focus.param",
                new JSONObject().put("param_v2", paramV2).toString()
            );
        } catch (JSONException ignored) {
            // All values are locally constructed; a standard ongoing notification remains valid.
        }
    }

    @TargetApi(36)
    private static final class Api36 {
        private Api36() {}

        static boolean canPostPromoted(Context context) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            try {
                return manager != null && manager.canPostPromotedNotifications();
            } catch (RuntimeException ignored) {
                return false;
            }
        }
    }
}
