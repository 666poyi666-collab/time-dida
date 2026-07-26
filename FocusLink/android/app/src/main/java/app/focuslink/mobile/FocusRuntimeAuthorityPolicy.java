package app.focuslink.mobile;

final class FocusRuntimeAuthorityPolicy {
    private FocusRuntimeAuthorityPolicy() {}

    static boolean canApplyCloudSnapshot(boolean currentHasLocalAuthority) {
        return !currentHasLocalAuthority;
    }
}
