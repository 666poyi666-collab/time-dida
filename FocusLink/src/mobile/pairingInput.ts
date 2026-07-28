/** Pairing nonces are base64url and therefore case-sensitive. */
export function normalizePairingCodeInput(value: string): string {
  return value.trim();
}
