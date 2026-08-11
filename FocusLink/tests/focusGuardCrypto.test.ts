import { describe, expect, it } from 'vitest';
import {
  decryptFocusGuardPayload,
  encryptFocusGuardPayload,
  focusGuardAad,
} from '../shared/sync/focusGuardCrypto';
import { provisionFocusGuardRoot } from '../shared/sync/focusGuardRootProtocol';

const ROOT = Uint8Array.from({ length: 32 }, (_, index) => index);
const OTHER_ROOT = Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index);
const RECOVERY = Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index);
const NONCE = Uint8Array.from({ length: 12 }, (_, index) => 0x60 + index);
const CREATED_AT = 1_700_000_000_000;

async function contexts() {
  const [one, two] = await Promise.all([
    provisionFocusGuardRoot({
      accountPublicId: 'account-stage-b',
      generation: 7,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      createdAt: CREATED_AT,
    }),
    provisionFocusGuardRoot({
      accountPublicId: 'account-stage-c',
      generation: 7,
      rootKey: OTHER_ROOT,
      recoverySecret: RECOVERY,
      createdAt: CREATED_AT,
    }),
  ]);
  return {
    one: {
      accountPublicId: one.material.accountPublicId,
      generation: one.material.generation,
      root: one.material,
    },
    two: {
      accountPublicId: two.material.accountPublicId,
      generation: two.material.generation,
      root: two.material,
    },
  };
}

describe('Focus Guard V1 payload crypto', () => {
  it('round-trips rule/state/completion/config without changing V1 envelope fields', async () => {
    const { one } = await contexts();
    const fixtures = [
      ['focus_guard_rule_v1', 'rule-1', { enabled: true, intervals: [25, 5], title: '学习' }],
      ['focus_guard_state_v1', 'state-1', { state: 'paused', sessionId: 'session-1', revision: 4 }],
      [
        'focus_guard_completion_v1',
        'completion-1',
        { completedAt: CREATED_AT, status: 'finished' },
      ],
      ['focus_guard_config_v1', 'config-1', { theme: 'light', reminders: false }],
    ] as const;
    for (const [entityType, entityId, plaintext] of fixtures) {
      const envelope = await encryptFocusGuardPayload({
        context: one,
        entityType,
        entityId,
        baseRevision: 7,
        plaintext,
        nonce: NONCE,
        createdAt: CREATED_AT,
      });
      expect(Object.keys(envelope).sort()).toEqual([
        'aadBaseRevision',
        'aadHash',
        'algorithm',
        'ciphertext',
        'createdAt',
        'entityKind',
        'nonce',
        'operation',
        'product',
        'version',
      ]);
      await expect(
        decryptFocusGuardPayload({
          context: one,
          entityType,
          entityId,
          baseRevision: 7,
          operation: 'put',
          envelope,
        }),
      ).resolves.toEqual(plaintext);
      expect(JSON.stringify(envelope)).not.toMatch(/root|recovery|session-1/);
    }
    expect(focusGuardAad('focus_guard_rule_v1', 'rule-1', 7, 'put')).toBe(
      'focus-guard|focus_guard_rule_v1|rule-1|7|put',
    );
  });

  it('rejects wrong root/account/entity/AAD/revision/operation and every tamper class', async () => {
    const { one, two } = await contexts();
    const envelope = await encryptFocusGuardPayload({
      context: one,
      entityType: 'focus_guard_rule_v1',
      entityId: 'rule-1',
      baseRevision: 7,
      plaintext: { enabled: true },
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    const decode = (
      context = one,
      overrides: Partial<Parameters<typeof decryptFocusGuardPayload>[0]> = {},
    ) =>
      decryptFocusGuardPayload({
        context,
        entityType: 'focus_guard_rule_v1',
        entityId: 'rule-1',
        baseRevision: 7,
        operation: 'put',
        envelope,
        ...overrides,
      });
    await expect(decode(two)).rejects.toThrow('verification failed');
    await expect(decode(one, { entityId: 'rule-2' })).rejects.toThrow('verification failed');
    await expect(decode(one, { baseRevision: 8 })).rejects.toThrow('verification failed');
    await expect(decode(one, { operation: 'restore' })).rejects.toThrow('verification failed');
    await expect(decode(one, { entityType: 'focus_guard_config_v1' })).rejects.toThrow(
      'verification failed',
    );
    await expect(
      decode(one, { envelope: { ...envelope, aadHash: '0'.repeat(64) } }),
    ).rejects.toThrow('verification failed');
    await expect(
      decode(one, { envelope: { ...envelope, nonce: envelope.nonce.slice(0, -1) } }),
    ).rejects.toThrow('verification failed');
    await expect(
      decode(one, {
        envelope: { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}A` },
      }),
    ).rejects.toThrow('verification failed');
    await expect(
      decode(one, { envelope: { ...envelope, plaintext: { leakedRoot: true } } }),
    ).rejects.toThrow('verification failed');
  });

  it('derives distinct payload keys for each account root generation', async () => {
    const [generationOne, generationTwo, otherAccount] = await Promise.all([
      provisionFocusGuardRoot({
        accountPublicId: 'account-generation-bound',
        generation: 1,
        rootKey: ROOT,
        recoverySecret: RECOVERY,
        createdAt: CREATED_AT,
      }),
      provisionFocusGuardRoot({
        accountPublicId: 'account-generation-bound',
        generation: 2,
        rootKey: ROOT,
        recoverySecret: RECOVERY,
        createdAt: CREATED_AT + 1,
      }),
      provisionFocusGuardRoot({
        accountPublicId: 'account-generation-other',
        generation: 1,
        rootKey: ROOT,
        recoverySecret: RECOVERY,
        createdAt: CREATED_AT,
      }),
    ]);
    const contextOne = {
      accountPublicId: generationOne.material.accountPublicId,
      generation: generationOne.material.generation,
      root: generationOne.material,
    };
    const contextTwo = {
      accountPublicId: generationTwo.material.accountPublicId,
      generation: generationTwo.material.generation,
      root: generationTwo.material,
    };
    const otherAccountContext = {
      accountPublicId: otherAccount.material.accountPublicId,
      generation: otherAccount.material.generation,
      root: otherAccount.material,
    };
    const envelope = await encryptFocusGuardPayload({
      context: contextOne,
      entityType: 'focus_guard_config_v1',
      entityId: 'config-generation-bound',
      baseRevision: 0,
      plaintext: { enabled: true },
      nonce: NONCE,
      createdAt: CREATED_AT,
    });

    await expect(
      decryptFocusGuardPayload({
        context: contextTwo,
        entityType: 'focus_guard_config_v1',
        entityId: 'config-generation-bound',
        baseRevision: 0,
        operation: 'put',
        envelope,
      }),
    ).rejects.toThrow('verification failed');
    await expect(
      decryptFocusGuardPayload({
        context: otherAccountContext,
        entityType: 'focus_guard_config_v1',
        entityId: 'config-generation-bound',
        baseRevision: 0,
        operation: 'put',
        envelope,
      }),
    ).rejects.toThrow('verification failed');
  });

  it('rejects non-canonical JSON and unsafe plaintext values before encryption', async () => {
    const { one } = await contexts();
    await expect(
      encryptFocusGuardPayload({
        context: one,
        entityType: 'focus_guard_rule_v1',
        entityId: 'rule-1',
        baseRevision: 0,
        plaintext: { bad: Number.NaN },
      }),
    ).rejects.toThrow('verification failed');
    await expect(
      encryptFocusGuardPayload({
        context: one,
        entityType: 'focus_guard_rule_v1',
        entityId: 'rule|ambiguous',
        baseRevision: 0,
        plaintext: { ok: true },
      }),
    ).rejects.toThrow('verification failed');
  });
});
