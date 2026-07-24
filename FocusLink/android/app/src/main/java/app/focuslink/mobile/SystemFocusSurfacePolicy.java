package app.focuslink.mobile;

/** Pure capability policy kept free of Android runtime dependencies for local tests. */
final class SystemFocusSurfacePolicy {
    static final String HUAWEI_LIVE_CAPSULE = "huawei-live-capsule";
    static final String XIAOMI_ISLAND = "xiaomi-island";
    static final String ANDROID_LIVE_UPDATE = "android-live-update";
    static final String ONGOING_NOTIFICATION = "ongoing-notification";

    private SystemFocusSurfacePolicy() {}

    static String select(
        boolean huaweiLiveCandidate,
        int xiaomiProtocol,
        boolean xiaomiPermission,
        boolean promotedAllowed
    ) {
        if (xiaomiProtocol >= 3 && xiaomiPermission) return XIAOMI_ISLAND;
        if (huaweiLiveCandidate) return HUAWEI_LIVE_CAPSULE;
        if (promotedAllowed) return ANDROID_LIVE_UPDATE;
        return ONGOING_NOTIFICATION;
    }
}
