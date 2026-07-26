package app.focuslink.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FocusRuntimeAuthorityPolicyTest {
    @Test
    public void cloudPollingCannotReplaceLocalAuthoritySnapshot() {
        assertFalse(FocusRuntimeAuthorityPolicy.canApplyCloudSnapshot(true));
    }

    @Test
    public void cloudPollingResumesAfterLocalAuthorityEnds() {
        assertTrue(FocusRuntimeAuthorityPolicy.canApplyCloudSnapshot(false));
    }
}
