'use client';

import { useEffect, useState } from 'react';

import {
  isNativeEthTransfer,
  loadTransferTokenMeta,
  type Erc20TokenMeta,
} from '@/lib/decodeEvmEvent';

/**
 * Reads ERC-20 symbol and decimals for Transfer emitters on Sepolia.
 * Native ETH transfer logs are resolved separately and are not fetched here.
 */
export function useTransferTokenMeta(emitters: string[]) {
  const key = [
    ...new Set(
      emitters
        .map(emitter => emitter.toLowerCase())
        .filter(emitter => !isNativeEthTransfer(emitter))
    ),
  ]
    .sort()
    .join('|');

  const [metaByAddress, setMetaByAddress] = useState<
    Record<string, Erc20TokenMeta | null>
  >({});

  useEffect(() => {
    const unique = key ? key.split('|') : [];
    if (unique.length === 0) return;

    let cancelled = false;

    Promise.all(
      unique.map(
        async emitter =>
          [emitter, await loadTransferTokenMeta(emitter)] as const
      )
    ).then(entries => {
      if (cancelled) return;
      setMetaByAddress(current => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return metaByAddress;
}
