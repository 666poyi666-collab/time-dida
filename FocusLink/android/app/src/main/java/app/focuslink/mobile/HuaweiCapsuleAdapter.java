package app.focuslink.mobile;

import android.app.Notification;
import android.os.Bundle;

/** EMUI timer-capsule projection isolated from Xiaomi and standard notification payloads. */
final class HuaweiCapsuleAdapter {
    private HuaweiCapsuleAdapter() {}

    static Notification apply(Notification notification, FocusRuntimeSnapshot snapshot) {
        boolean running = FocusRuntimeContract.STATE_RUNNING.equals(snapshot.state);
        Bundle capsule = new Bundle();
        capsule.putString(
            "notification.live.capsuleContent",
            running ? "专注计时中" : "专注已暂停"
        );
        if (notification.getSmallIcon() != null) {
            capsule.putParcelable("notification.live.capsuleIcon", notification.getSmallIcon());
        }
        capsule.putLong("notification.live.capsuleTime", Math.max(0L, snapshot.primaryElapsedMs));
        capsule.putInt("notification.live.capsuleType", 2);
        capsule.putInt("notification.live.capsuleStatus", 1);
        capsule.putBoolean("notification.live.capsulePause", !snapshot.primaryAdvances);
        capsule.putInt("notification.live.capsuleBgColor", running ? 0xFF6ECCE2 : 0xFFD94B43);
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
        notification.when = Math.max(0L, snapshot.primaryElapsedMs);
        return notification;
    }
}
