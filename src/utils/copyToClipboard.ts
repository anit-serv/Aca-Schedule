/** Mobile in-app browsers may reject the Clipboard API; keep a selection-based fallback. */
export const copyToClipboard = async (value: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Continue with the fallback below.
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.left = '0';
  input.style.top = '0';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, value.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
};
