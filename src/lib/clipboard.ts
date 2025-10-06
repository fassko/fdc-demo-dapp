/**
 * Utility functions for clipboard operations
 */

/**
 * Copy text to clipboard with optional callback for state management
 * @param text - The text to copy to clipboard
 * @param onSuccess - Optional callback function to call on successful copy
 * @param onError - Optional callback function to call on error
 */
export const copyToClipboard = async (
  text: string,
  onSuccess?: (value: string) => void,
  onError?: (error: Error) => void
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);

    if (onSuccess) {
      onSuccess(text);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Failed to copy text');
    console.error('Failed to copy text:', error);

    if (onError) {
      onError(error);
    }
  }
};

/**
 * Copy text to clipboard with automatic timeout reset
 * @param text - The text to copy to clipboard
 * @param setter - Function to set the copied state
 * @param timeout - Timeout in milliseconds (default: 2000)
 */
export const copyToClipboardWithTimeout = async (
  text: string,
  setter: (value: string | null) => void,
  timeout: number = 2000
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    setter(text);
    setTimeout(() => setter(null), timeout);
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
};

/**
 * Copy text to clipboard with boolean state management
 * @param text - The text to copy to clipboard
 * @param setter - Function to set boolean copied state
 * @param timeout - Timeout in milliseconds (default: 2000)
 */
export const copyToClipboardWithBooleanState = async (
  text: string,
  setter: (value: boolean) => void,
  timeout: number = 2000
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), timeout);
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
};
