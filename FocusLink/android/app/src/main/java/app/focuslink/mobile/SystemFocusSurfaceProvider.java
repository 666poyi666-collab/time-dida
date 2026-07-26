package app.focuslink.mobile;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.JSObject;
import androidx.core.app.NotificationCompat;
import java.util.Locale;

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
        StandardNotificationAdapter.apply(notification, surface);
        if (SURFACE_XIAOMI_ISLAND.equals(surface)) {
            XiaomiIslandAdapter.apply(notification, snapshot, displayTitle, displayContent);
        } else if (SURFACE_HUAWEI_LIVE_CAPSULE.equals(surface)) {
            HuaweiCapsuleAdapter.apply(notification, snapshot);
        }
        return notification;
    }

    static void configureBuilder(Context context, NotificationCompat.Builder builder) {
        StandardNotificationAdapter.configureBuilder(
            builder,
            SURFACE_ANDROID_LIVE_UPDATE.equals(selectedSurface(context))
        );
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
            .put("xiaomiEvidenceLevel", evidenceLevel(context))
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

    static String evidenceLevel(Context context) {
        if (!SURFACE_XIAOMI_ISLAND.equals(selectedSurface(context))) {
            return XiaomiIslandAdapter.EVIDENCE_UNSUPPORTED;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            try {
                for (StatusBarNotification item : manager.getActiveNotifications()) {
                    Notification active = item.getNotification();
                    if (
                        active != null &&
                        SURFACE_XIAOMI_ISLAND.equals(
                            active.extras.getString("focuslink.systemSurface")
                        ) &&
                        active.extras.getString("miui.focus.param") != null
                    ) {
                        return XiaomiIslandAdapter.EVIDENCE_SYSTEMUI_ACCEPTED;
                    }
                }
            } catch (RuntimeException ignored) {
                // Protocol selection remains the truthful lower evidence level.
            }
        }
        return XiaomiIslandAdapter.EVIDENCE_PROTOCOL_SELECTED;
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
