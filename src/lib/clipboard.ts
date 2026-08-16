// Copy secrets to the clipboard, then clear them so they don't linger in
// clipboard history or other apps' paste targets.

const CLIPBOARD_CLEAR_MS = 30_000;

/** Write `text` to the clipboard and wipe it after 30s if it is still there. */
export function copySecret(text: string): void {
  if (!navigator.clipboard?.writeText) return;
  void navigator.clipboard.writeText(text).then(() => {
    window.setTimeout(() => {
      void (async () => {
        try {
          if (navigator.clipboard.readText) {
            const current = await navigator.clipboard.readText();
            if (current !== text) return;
          }
          await navigator.clipboard.writeText('');
        } catch {
          // Permission denied or document unfocused: leave whatever is there.
        }
      })();
    }, CLIPBOARD_CLEAR_MS);
  }).catch(() => {});
}
