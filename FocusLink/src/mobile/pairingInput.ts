import {
  isFocusLinkPairingCode,
  normalizeFocusLinkPairingCode,
} from '@shared/sync/pairingProtocol';

/** Human input may contain spaces/newlines from a copied desktop code. */
export function normalizePairingCodeInput(value: string): string {
  return normalizeFocusLinkPairingCode(value);
}

export function isNormalizedPairingCode(value: string): boolean {
  return isFocusLinkPairingCode(value);
}
