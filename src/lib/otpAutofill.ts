// WebOTP (Android Chrome) + clipboard helpers for the owner OTP entry
// modal. Neither API can see the SMS inbox; both feed matchOtpFromText.

export function listenWebOtp(onCode: (code: string) => void): () => void {
  const creds = navigator.credentials;
  if (!creds?.get || !('OTPCredential' in window)) return () => {};
  const ac = new AbortController();
  void creds
    .get({
      otp: { transport: ['sms'] },
      signal: ac.signal,
    } as CredentialRequestOptions)
    .then((cred) => {
      const code =
        cred && typeof cred === 'object' && 'code' in cred
          ? String((cred as { code: unknown }).code)
          : '';
      if (code) onCode(code);
    })
    .catch(() => {});
  return () => ac.abort();
}

export async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    const text = await navigator.clipboard.readText();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}
