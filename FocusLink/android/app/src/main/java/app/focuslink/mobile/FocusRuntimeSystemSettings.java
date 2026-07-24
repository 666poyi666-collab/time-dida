package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;

final class FocusRuntimeSystemSettings {
    static final int DEFAULT_PAUSE_REMINDER_DELAY_MINUTES = 3;
    static final int MIN_PAUSE_REMINDER_DELAY_MINUTES = 1;
    static final int MAX_PAUSE_REMINDER_DELAY_MINUTES = 240;

    private static final String PREFERENCES_NAME = "focus_runtime_system_settings_v1";
    private static final String KEY_PAUSE_REMINDER_ENABLED = "pauseReminderEnabled";
    private static final String KEY_PAUSE_REMINDER_DELAY_MINUTES = "pauseReminderDelayMinutes";
    private static final String KEY_OVERLAY_ENABLED = "overlayEnabled";
    private static final String KEY_OVERLAY_X_FRACTION = "overlayXFraction";
    private static final String KEY_OVERLAY_Y_FRACTION = "overlayYFraction";

    static final class PauseReminderPreference {
        final boolean enabled;
        final int delayMinutes;

        PauseReminderPreference(boolean enabled, int delayMinutes) {
            this.enabled = enabled;
            this.delayMinutes = delayMinutes;
        }
    }

    static final class OverlayPosition {
        final float xFraction;
        final float yFraction;

        OverlayPosition(float xFraction, float yFraction) {
            this.xFraction = xFraction;
            this.yFraction = yFraction;
        }
    }

    private FocusRuntimeSystemSettings() {}

    static synchronized PauseReminderPreference getPauseReminderPreference(Context context) {
        SharedPreferences preferences = preferences(context);
        boolean enabled = preferences.getBoolean(KEY_PAUSE_REMINDER_ENABLED, true);
        int delayMinutes = readDelayMinutes(preferences);
        return new PauseReminderPreference(enabled, delayMinutes);
    }

    static synchronized PauseReminderPreference setPauseReminderPreference(
        Context context,
        boolean enabled,
        Integer delayMinutes
    ) {
        SharedPreferences preferences = preferences(context);
        int nextDelayMinutes = delayMinutes == null
            ? readDelayMinutes(preferences)
            : validateDelayMinutes(delayMinutes);
        boolean committed = preferences
            .edit()
            .putBoolean(KEY_PAUSE_REMINDER_ENABLED, enabled)
            .putInt(KEY_PAUSE_REMINDER_DELAY_MINUTES, nextDelayMinutes)
            .commit();
        if (!committed) throw new IllegalStateException("unable to save pause reminder preference");
        return new PauseReminderPreference(enabled, nextDelayMinutes);
    }

    static synchronized boolean isOverlayEnabled(Context context) {
        return preferences(context).getBoolean(KEY_OVERLAY_ENABLED, false);
    }

    static synchronized boolean setOverlayEnabled(Context context, boolean enabled) {
        if (!preferences(context).edit().putBoolean(KEY_OVERLAY_ENABLED, enabled).commit()) {
            throw new IllegalStateException("unable to save overlay preference");
        }
        return enabled;
    }

    static synchronized OverlayPosition getOverlayPosition(Context context) {
        SharedPreferences values = preferences(context);
        float x = clampFraction(values.getFloat(KEY_OVERLAY_X_FRACTION, 0.02f));
        float y = clampFraction(values.getFloat(KEY_OVERLAY_Y_FRACTION, 0.02f));
        return new OverlayPosition(x, y);
    }

    static synchronized void setOverlayPosition(Context context, float xFraction, float yFraction) {
        boolean committed = preferences(context)
            .edit()
            .putFloat(KEY_OVERLAY_X_FRACTION, clampFraction(xFraction))
            .putFloat(KEY_OVERLAY_Y_FRACTION, clampFraction(yFraction))
            .commit();
        if (!committed) throw new IllegalStateException("unable to save overlay position");
    }

    static synchronized void clearForTests(Context context) {
        preferences(context).edit().clear().commit();
    }

    private static int readDelayMinutes(SharedPreferences preferences) {
        int value;
        try {
            value = preferences.getInt(
                KEY_PAUSE_REMINDER_DELAY_MINUTES,
                DEFAULT_PAUSE_REMINDER_DELAY_MINUTES
            );
        } catch (ClassCastException ignored) {
            return DEFAULT_PAUSE_REMINDER_DELAY_MINUTES;
        }
        return value >= MIN_PAUSE_REMINDER_DELAY_MINUTES &&
            value <= MAX_PAUSE_REMINDER_DELAY_MINUTES
            ? value
            : DEFAULT_PAUSE_REMINDER_DELAY_MINUTES;
    }

    private static int validateDelayMinutes(int delayMinutes) {
        if (
            delayMinutes < MIN_PAUSE_REMINDER_DELAY_MINUTES ||
            delayMinutes > MAX_PAUSE_REMINDER_DELAY_MINUTES
        ) {
            throw new IllegalArgumentException(
                "delayMinutes must be between " +
                MIN_PAUSE_REMINDER_DELAY_MINUTES +
                " and " +
                MAX_PAUSE_REMINDER_DELAY_MINUTES
            );
        }
        return delayMinutes;
    }

    private static float clampFraction(float value) {
        if (!Float.isFinite(value)) return 0.02f;
        return Math.max(0f, Math.min(1f, value));
    }

    private static SharedPreferences preferences(Context context) {
        return context
            .getApplicationContext()
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }
}
