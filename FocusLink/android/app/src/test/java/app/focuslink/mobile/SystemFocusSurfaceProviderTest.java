package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SystemFocusSurfaceProviderTest {
    @Test
    public void selectsXiaomiIslandOnlyForProtocolThreeWithPermission() {
        assertEquals(
            SystemFocusSurfacePolicy.ONGOING_NOTIFICATION,
            SystemFocusSurfacePolicy.select(false, 0, false, false)
        );
        assertEquals(
            SystemFocusSurfacePolicy.ONGOING_NOTIFICATION,
            SystemFocusSurfacePolicy.select(false, 2, true, false)
        );
        assertEquals(
            SystemFocusSurfacePolicy.ONGOING_NOTIFICATION,
            SystemFocusSurfacePolicy.select(false, 3, false, false)
        );
        assertEquals(
            SystemFocusSurfacePolicy.XIAOMI_ISLAND,
            SystemFocusSurfacePolicy.select(false, 3, true, false)
        );
    }

    @Test
    public void fallsBackToPromotedOrStandardOngoingNotification() {
        assertEquals(
            SystemFocusSurfacePolicy.ANDROID_LIVE_UPDATE,
            SystemFocusSurfacePolicy.select(false, 0, false, true)
        );
        assertEquals(
            SystemFocusSurfacePolicy.XIAOMI_ISLAND,
            SystemFocusSurfacePolicy.select(false, 3, true, true)
        );
        assertEquals(
            SystemFocusSurfacePolicy.ONGOING_NOTIFICATION,
            SystemFocusSurfacePolicy.select(false, 2, false, false)
        );
    }

    @Test
    public void selectsHuaweiCapsuleBeforeGenericPromotedNotification() {
        assertEquals(
            SystemFocusSurfacePolicy.HUAWEI_LIVE_CAPSULE,
            SystemFocusSurfacePolicy.select(true, 0, false, false)
        );
        assertEquals(
            SystemFocusSurfacePolicy.HUAWEI_LIVE_CAPSULE,
            SystemFocusSurfacePolicy.select(true, 0, false, true)
        );
        assertEquals(
            SystemFocusSurfacePolicy.XIAOMI_ISLAND,
            SystemFocusSurfacePolicy.select(true, 3, true, true)
        );
    }
}
