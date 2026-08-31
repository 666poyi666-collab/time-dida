package app.focuslink.mobile;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

final class RootPermissionPolicy {
    static final String NOTIFICATION = "notification";
    static final String OVERLAY = "overlay";
    static final String BATTERY = "battery";
    static final String BACKGROUND = "background";
    static final String AUTOSTART = "autostart";

    private static final Pattern PACKAGE_NAME = Pattern.compile(
        "[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+"
    );
    private static final Pattern ROOT_UID = Pattern.compile("(?:^|\\s)uid=0(?:\\D|$)");

    private RootPermissionPolicy() {}

    static List<PermissionPlan> plans(String packageName, int sdkInt) {
        if (!isValidPackageName(packageName)) {
            throw new IllegalArgumentException("invalid application package");
        }

        List<PermissionPlan> plans = new ArrayList<>();
        List<String> notificationCommands = new ArrayList<>();
        if (sdkInt >= 33) {
            notificationCommands.add(
                "pm grant " + packageName + " android.permission.POST_NOTIFICATIONS"
            );
        }
        notificationCommands.add(
            "cmd appops set " + packageName + " POST_NOTIFICATION allow"
        );
        plans.add(new PermissionPlan(NOTIFICATION, notificationCommands, false));
        plans.add(
            new PermissionPlan(
                OVERLAY,
                Collections.singletonList(
                    "cmd appops set " + packageName + " SYSTEM_ALERT_WINDOW allow"
                ),
                false
            )
        );
        plans.add(
            new PermissionPlan(
                BATTERY,
                Collections.singletonList("cmd deviceidle whitelist +" + packageName),
                false
            )
        );

        List<String> backgroundCommands = new ArrayList<>();
        if (sdkInt >= 26) {
            backgroundCommands.add(
                "cmd appops set " + packageName + " RUN_IN_BACKGROUND allow"
            );
        }
        if (sdkInt >= 28) {
            backgroundCommands.add(
                "cmd appops set " + packageName + " RUN_ANY_IN_BACKGROUND allow"
            );
        }
        plans.add(new PermissionPlan(BACKGROUND, backgroundCommands, false));
        plans.add(new PermissionPlan(AUTOSTART, Collections.emptyList(), true));
        return Collections.unmodifiableList(plans);
    }

    static boolean isValidPackageName(String packageName) {
        return packageName != null && PACKAGE_NAME.matcher(packageName).matches();
    }

    static boolean hasRootIdentity(String output) {
        if (output == null) return false;
        for (String line : output.split("\\R")) {
            String trimmed = line.trim();
            if ("0".equals(trimmed) || ROOT_UID.matcher(trimmed).find()) return true;
        }
        return false;
    }

    static String itemStatus(
        boolean verified,
        boolean manualRequired,
        boolean rootGranted,
        boolean commandSucceeded
    ) {
        if (verified) return "granted";
        if (manualRequired) return "manual-required";
        if (!rootGranted) return "root-unavailable";
        return commandSucceeded ? "not-granted" : "failed";
    }

    static final class PermissionPlan {
        final String id;
        final List<String> commands;
        final boolean manualRequired;

        PermissionPlan(String id, List<String> commands, boolean manualRequired) {
            this.id = id;
            this.commands = Collections.unmodifiableList(new ArrayList<>(commands));
            this.manualRequired = manualRequired;
        }
    }
}
