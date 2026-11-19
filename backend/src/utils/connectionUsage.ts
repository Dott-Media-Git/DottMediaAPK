/** Allow an account connection to proceed when only Firestore metering is unavailable. */
export async function meterConnectionUsage(
  consume: () => Promise<unknown>,
  isQuotaError: (error: unknown) => boolean,
  durableFallbackAvailable: boolean,
): Promise<'metered' | 'quota_unavailable'> {
  try {
    await consume();
    return 'metered';
  } catch (error) {
    if (!durableFallbackAvailable || !isQuotaError(error)) throw error;
    return 'quota_unavailable';
  }
}
