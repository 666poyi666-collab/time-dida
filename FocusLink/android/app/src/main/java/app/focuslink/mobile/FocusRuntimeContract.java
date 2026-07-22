package app.focuslink.mobile;

final class FocusRuntimeContract {
    static final String PLUGIN_NAME = "FocusRuntime";
    static final String EVENT_NATIVE_COMMAND = "nativeCommand";

    static final String ACTION_NOTIFICATION_COMMAND =
        "app.focuslink.mobile.action.FOCUS_COMMAND";
    static final String EXTRA_COMMAND_TYPE =
        "app.focuslink.mobile.extra.COMMAND_TYPE";
    static final String EXTRA_SESSION_ID =
        "app.focuslink.mobile.extra.SESSION_ID";
    static final String EXTRA_STATE_REVISION =
        "app.focuslink.mobile.extra.STATE_REVISION";

    static final String STATE_IDLE = "idle";
    static final String STATE_RUNNING = "running";
    static final String STATE_PAUSED = "paused";

    static final String COMMAND_PAUSE = "pause";
    static final String COMMAND_RESUME = "resume";
    static final String COMMAND_FINISH = "finish";

    static final String SOURCE_NOTIFICATION = "notification";
    static final String SOURCE_QUICK_SETTINGS = "quick-settings";

    static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    static final long MAX_NATIVE_SNAPSHOT_AGE_MS = 30L * 60L * 1000L;
    static final long MAX_COMMAND_AGE_MS = 24L * 60L * 60L * 1000L;
    static final int MAX_QUEUED_COMMANDS = 32;

    private FocusRuntimeContract() {}

    static boolean isActiveState(String state) {
        return STATE_RUNNING.equals(state) || STATE_PAUSED.equals(state);
    }

    static boolean isCommandAllowedForState(String state, String command) {
        if (COMMAND_FINISH.equals(command)) {
            return isActiveState(state);
        }
        if (COMMAND_PAUSE.equals(command)) {
            return STATE_RUNNING.equals(state);
        }
        return COMMAND_RESUME.equals(command) && STATE_PAUSED.equals(state);
    }
}
