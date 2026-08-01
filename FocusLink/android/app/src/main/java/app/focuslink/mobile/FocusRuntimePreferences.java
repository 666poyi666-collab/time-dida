package app.focuslink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.LinkedHashSet;
import java.util.Set;

/** Resolves app-private runtime preferences and provides one process-local test namespace. */
final class FocusRuntimePreferences {
    private static final Object LOCK = new Object();
    private static String testPrefix;
    private static final Set<String> TEST_PREFERENCES = new LinkedHashSet<>();

    private FocusRuntimePreferences() {}

    static SharedPreferences get(Context context, String name) {
        if (context == null || name == null || name.isEmpty()) {
            throw new IllegalArgumentException("runtime preference context and name are required");
        }
        Context applicationContext = context.getApplicationContext();
        Context owner = applicationContext == null ? context : applicationContext;
        String resolvedName = name;
        synchronized (LOCK) {
            if (testPrefix != null) {
                resolvedName = testPrefix + name;
                TEST_PREFERENCES.add(resolvedName);
            }
        }
        return owner.getSharedPreferences(resolvedName, Context.MODE_PRIVATE);
    }

    static void enableTestIsolation(String prefix) {
        if (prefix == null || !prefix.matches("focus_runtime_instrumentation_[0-9]+_")) {
            throw new IllegalArgumentException("test preference prefix is invalid");
        }
        synchronized (LOCK) {
            if (testPrefix != null) throw new IllegalStateException("test isolation is already active");
            testPrefix = prefix;
            TEST_PREFERENCES.clear();
        }
    }

    static void clearAndDisableTestIsolation(Context context) {
        Set<String> names;
        synchronized (LOCK) {
            if (testPrefix == null) return;
            names = new LinkedHashSet<>(TEST_PREFERENCES);
            TEST_PREFERENCES.clear();
            testPrefix = null;
        }
        Context applicationContext = context.getApplicationContext();
        Context owner = applicationContext == null ? context : applicationContext;
        for (String name : names) {
            if (!owner.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()) {
                throw new IllegalStateException("unable to clear isolated test preferences");
            }
        }
    }
}
