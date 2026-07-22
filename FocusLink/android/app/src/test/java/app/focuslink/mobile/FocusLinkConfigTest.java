package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class FocusLinkConfigTest {
    @Test
    public void previewBuildKeepsTheFocusLinkIdentity() {
        assertEquals("app.focuslink.mobile", BuildConfig.APPLICATION_ID);
        assertEquals("0.12.26", BuildConfig.VERSION_NAME);
    }
}
