package app.focuslink.mobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

public class FocusGuardRootProtocolTest {
    private static final long CREATED_AT = 1700000000000L;

    @Test
    public void matchesTypeScriptRecoveryGoldenVectorAndRoundTrips() throws Exception {
        FocusGuardRootProtocol.ProvisioningResult result = FocusGuardRootProtocol.provision(
            "account-stage-b",
            7,
            bytes(32, 0),
            bytes(32, 32),
            bytes(12, 64),
            CREATED_AT
        );
        JSONObject envelope = new JSONObject(result.recoveryEnvelope);
        assertEquals("HKDF-SHA256", envelope.getString("kdf"));
        assertEquals("QEFCQ0RFRkdISUpL", envelope.getString("nonce"));
        assertEquals(
            "d0_hUzedn5A_59SdXOIaA1KplhOBezkxLKqx_5_9HwA-TZ30k_QyK2thaL8WXCbl",
            envelope.getString("ciphertext")
        );
        assertEquals(
            "509ae07d59e3a7cad98e307996eee1adf8ba960597b4413de46f1005d8b8e12a",
            envelope.getString("aadHash")
        );
        FocusGuardRootProtocol.RootMaterial recovered = FocusGuardRootProtocol.recover(
            result.recoveryEnvelope,
            bytes(32, 32),
            "account-stage-b",
            7
        );
        assertEquals(result.material.keyId, recovered.keyId);
        assertArrayEquals(result.material.rootKey, recovered.rootKey);
    }

    @Test
    public void matchesTypeScriptRotationGoldenVectorAndRejectsReplay() throws Exception {
        FocusGuardRootProtocol.ProvisioningResult first = FocusGuardRootProtocol.provision(
            "account-stage-b", 1, bytes(32, 0), bytes(32, 32), bytes(12, 64), CREATED_AT
        );
        FocusGuardRootProtocol.RotationResult rotation = FocusGuardRootProtocol.rotate(
            first.material,
            bytes(32, 32),
            bytes(32, 64),
            bytes(12, 80),
            bytes(12, 64),
            CREATED_AT + 1
        );
        JSONObject envelope = new JSONObject(rotation.rotationEnvelope);
        assertEquals("direct-root", envelope.getString("kdf"));
        assertEquals(
            "0mZ0N6AV_6EU_3cugazNmrN-r7h2JMx1fNC6gKwdyytLKaclsisN6fBz3i7NZMUS",
            envelope.getString("ciphertext")
        );
        assertEquals(
            "aa47af9d4514a29ad670ea3cdde96534ce9fad865a9b1f3f8c26e2f5a155df9c",
            envelope.getString("aadHash")
        );
        FocusGuardRootProtocol.RootMaterial applied = FocusGuardRootProtocol.applyRotation(
            rotation.rotationEnvelope,
            first.material
        );
        assertEquals(rotation.material.keyId, applied.keyId);
        try {
            FocusGuardRootProtocol.applyRotation(rotation.rotationEnvelope, rotation.material);
            throw new AssertionError("rotation replay must fail");
        } catch (IllegalStateException expected) {
            assertEquals("Focus Guard root envelope verification failed", expected.getMessage());
        }
    }

    @Test
    public void recoveryHighWaterAdvancesReadySnapshotsButKeepsLostGeneration() {
        FocusGuardRootStore.Snapshot ready = new FocusGuardRootStore.Snapshot(
            FocusGuardRootStore.Status.READY,
            "account-stage-b",
            7,
            "a".repeat(64),
            CREATED_AT
        );
        FocusGuardRootStore.Snapshot lost = new FocusGuardRootStore.Snapshot(
            FocusGuardRootStore.Status.LOST,
            "account-stage-b",
            7,
            null,
            CREATED_AT
        );
        assertEquals(8, FocusGuardRootStore.recoveryHighWater(ready, 1));
        assertEquals(7, FocusGuardRootStore.recoveryHighWater(lost, 1));
        assertEquals(9, FocusGuardRootStore.recoveryHighWater(ready, 9));
    }

    private static byte[] bytes(int length, int start) {
        byte[] result = new byte[length];
        for (int index = 0; index < length; index++) result[index] = (byte) (start + index);
        return result;
    }
}
