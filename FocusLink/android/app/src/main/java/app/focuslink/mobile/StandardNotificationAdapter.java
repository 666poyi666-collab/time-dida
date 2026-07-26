package app.focuslink.mobile;

import android.app.Notification;
import androidx.core.app.NotificationCompat;

/** Standard ongoing-notification behavior shared by every system-surface path. */
final class StandardNotificationAdapter {
    private StandardNotificationAdapter() {}

    static Notification apply(Notification notification, String selectedSurface) {
        notification.flags |= Notification.FLAG_ONGOING_EVENT;
        notification.extras.putString("focuslink.systemSurface", selectedSurface);
        return notification;
    }

    static void configureBuilder(NotificationCompat.Builder builder, boolean promotedOngoing) {
        if (promotedOngoing) builder.setRequestPromotedOngoing(true);
    }
}
