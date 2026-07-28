package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class FocusAuthorityProjectionV1Test {
    @Test
    public void projectionHasExactPublicTopLevelAndNoCredentialMaterial() throws Exception {
        JSONObject projection = FocusAuthorityProjectionV1.build(
            17L,
            1_000L,
            "fresh",
            "paired",
            "",
            2,
            new JSONObject().put("state", "running").put("title", "复习化学"),
            new JSONArray()
        );
        Set<String> keys = new HashSet<>();
        Iterator<String> iterator = projection.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        assertEquals(
            new HashSet<>(java.util.Arrays.asList(
                "schemaVersion",
                "source",
                "revision",
                "lastVerifiedAt",
                "freshness",
                "payload"
            )),
            keys
        );
        String serialized = projection.toString();
        assertFalse(serialized.contains("fl2_"));
        assertFalse(serialized.contains("Authorization"));
        assertFalse(serialized.contains("deviceId"));
        assertFalse(serialized.contains("cursor"));
        assertFalse(serialized.contains("envelope"));
    }

    @Test
    public void freshnessDistinguishesEveryFailClosedState() {
        assertEquals("blocked", FocusAuthorityProjectionV1.freshness(false, 0, 0, "", 10));
        assertEquals("unknown", FocusAuthorityProjectionV1.freshness(true, 0, 0, "", 10));
        assertEquals("offline", FocusAuthorityProjectionV1.freshness(true, 0, 9, "network_error", 10));
        assertEquals("fresh", FocusAuthorityProjectionV1.freshness(true, 10, 10, "", 11));
        assertEquals(
            "stale",
            FocusAuthorityProjectionV1.freshness(
                true,
                10,
                10,
                "",
                10 + FocusAuthorityProjectionV1.FRESH_AFTER_MS + 1
            )
        );
        assertEquals("offline", FocusAuthorityProjectionV1.freshness(true, 10, 11, "timeout", 12));
        assertTrue(FocusAuthorityProjectionV1.FRESH_AFTER_MS > 0L);
    }

    @Test
    public void providerContractUsesTheVersionedSameSignatureConstants() {
        assertEquals(
            BuildConfig.APPLICATION_ID + ".authority.projection",
            FocusAuthorityProjectionProvider.AUTHORITY
        );
        assertEquals(
            BuildConfig.APPLICATION_ID + ".permission.READ_AUTHORITY_PROJECTION",
            FocusAuthorityProjectionProvider.READ_PERMISSION
        );
        assertEquals("getProjectionV1", FocusAuthorityProjectionProvider.METHOD_GET_V1);
        assertEquals("projection", FocusAuthorityProjectionProvider.RESULT_PROJECTION);
    }
}
