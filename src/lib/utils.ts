import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Converts a string to a hex representation padded to 64 characters
 * @param data - The string to convert to hex
 * @returns A hex string prefixed with "0x" and padded to 64 characters
 */
export function toHex(data: string): string {
  let result = '';
  for (let i = 0; i < data.length; i++) {
    result += data.charCodeAt(i).toString(16);
  }
  return '0x' + result.padEnd(64, '0');
}

/**
 * Truncates an address string for display purposes
 * @param address - The address string to truncate
 * @returns The truncated address (e.g., "0x1234...5678" for long addresses, or the original address if 12 characters or less)
 */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Truncates a string with customizable start and end lengths
 * @param text - The string to truncate
 * @param startLength - Number of characters to show at the start (default: 10)
 * @param endLength - Number of characters to show at the end (default: 10)
 * @param minLength - Minimum length before truncation (default: 20)
 * @returns The truncated string or original if shorter than minLength
 */
export function truncateString(
  text: string,
  startLength: number = 10,
  endLength: number = 10,
  minLength: number = 20
): string {
  if (text.length <= minLength) return text;
  return `${text.slice(0, startLength)}...${text.slice(-endLength)}`;
}
