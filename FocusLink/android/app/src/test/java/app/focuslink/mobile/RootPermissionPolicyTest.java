package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class RootPermissionPolicyTest {
    @Test
    public void buildsOnlyFixedCommandsForTheCurrentApplicationPackage() {
        List<RootPermissionPolicy.PermissionPlan> plans = RootPermissionPolicy.plans(
            "app.focuslink.mobile.v130",
            35
        );

        assertEquals(5, plans.size());
        assertEquals(RootPermissionPolicy.NOTIFICATION, plans.get(0).id);
        assertEquals(
            List.of(
                "pm grant app.focuslink.mobile.v130 android.permission.POST_NOTIFICATIONS",
                "cmd appops set app.focuslink.mobile.v130 POST_NOTIFICATION allow"
            ),
            plans.get(0).commands
        );
        assertEquals(
            List.of("cmd appops set app.focuslink.mobile.v130 SYSTEM_ALERT_WINDOW allow"),
            plans.get(1).commands
        );
        assertEquals(
            List.of("cmd deviceidle whitelist +app.focuslink.mobile.v130"),
            plans.get(2).commands
        );
        assertEquals(
            List.of(
                "cmd appops set app.focuslink.mobile.v130 RUN_IN_BACKGROUND allow",
                "cmd appops set app.focuslink.mobile.v130 RUN_ANY_IN_BACKGROUND allow"
            ),
            plans.get(3).commands
        );
        assertTrue(plans.get(4).manualRequired);
        assertTrue(plans.get(4).commands.isEmpty());
    }

    @Test
    public void gatesBackgroundAppOpsByTheAndroidVersionThatIntroducedThem() {
        assertTrue(
            RootPermissionPolicy.plans("app.focuslink.mobile", 24).get(3).commands.isEmpty()
        );
        assertEquals(
            List.of("cmd appops set app.focuslink.mobile RUN_IN_BACKGROUND allow"),
            RootPermissionPolicy.plans("app.focuslink.mobile", 26).get(3).commands
        );
        assertEquals(
            List.of(
                "cmd appops set app.focuslink.mobile RUN_IN_BACKGROUND allow",
                "cmd appops set app.focuslink.mobile RUN_ANY_IN_BACKGROUND allow"
            ),
            RootPermissionPolicy.plans("app.focuslink.mobile", 28).get(3).commands
        );
    }

    @Test
    public void rejectsPackageTextThatCouldBecomeShellInput() {
        assertTrue(RootPermissionPolicy.isValidPackageName("app.focuslink.mobile"));
        assertFalse(RootPermissionPolicy.isValidPackageName("app.focuslink.mobile;id"));
        assertFalse(RootPermissionPolicy.isValidPackageName("app focuslink.mobile"));
        assertThrows(
            IllegalArgumentException.class,
            () -> RootPermissionPolicy.plans("app.focuslink.mobile && id", 35)
        );
    }

    @Test
    public void identifiesRootWithoutTreatingOtherUidOutputAsSuccess() {
        assertTrue(RootPermissionPolicy.hasRootIdentity("0\n"));
        assertFalse(RootPermissionPolicy.hasRootIdentity("2000\n"));
        assertFalse(RootPermissionPolicy.hasRootIdentity("permission denied"));
    }

    @Test
    public void reportsVerifiedFactsBeforeCommandExitCodesAndKeepsAutostartManual() {
        assertEquals(
            "granted",
            RootPermissionPolicy.itemStatus(true, false, true, false)
        );
        assertEquals(
            "manual-required",
            RootPermissionPolicy.itemStatus(false, true, true, true)
        );
        assertEquals(
            "root-unavailable",
            RootPermissionPolicy.itemStatus(false, false, false, false)
        );
        assertEquals(
            "failed",
            RootPermissionPolicy.itemStatus(false, false, true, false)
        );
        assertEquals(
            "not-granted",
            RootPermissionPolicy.itemStatus(false, false, true, true)
        );
    }
}
