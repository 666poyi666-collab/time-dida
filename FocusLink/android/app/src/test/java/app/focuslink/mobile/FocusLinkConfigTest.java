package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class FocusLinkConfigTest {
    @Test
    public void buildVariantKeepsItsExpectedIdentityAndEndpoint() {
        if (BuildConfig.APPLICATION_ID.endsWith(".staging")) {
            assertEquals("app.focuslink.mobile.staging", BuildConfig.APPLICATION_ID);
            assertEquals("0.12.68-staging", BuildConfig.VERSION_NAME);
            assertEquals(
                "https://foxlink-mcp-staging.focuslink-poyi-6465e9.workers.dev",
                BuildConfig.DEFAULT_SYNC_ENDPOINT
            );
        } else {
            assertEquals("app.focuslink.mobile", BuildConfig.APPLICATION_ID);
            assertEquals("0.12.68", BuildConfig.VERSION_NAME);
            assertEquals("", BuildConfig.DEFAULT_SYNC_ENDPOINT);
        }
    }
}
