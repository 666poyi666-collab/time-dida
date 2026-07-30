package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class FocusLinkConfigTest {
    @Test
    public void buildVariantKeepsItsExpectedIdentityAndEndpoint() {
        assertEquals("app.focuslink.mobile", BuildConfig.APPLICATION_ID);
        assertEquals("0.12.73", BuildConfig.VERSION_NAME);
        assertEquals("", BuildConfig.DEFAULT_SYNC_ENDPOINT);
        assertEquals(
            "https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev",
            BuildConfig.CANONICAL_SYNC_ORIGIN
        );
    }
}
