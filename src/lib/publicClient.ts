import { flareTestnet } from 'wagmi/chains';

import { createPublicClient, http } from 'viem';

/**
 * Shared public client for Flare Testnet
 * Can be reused across the application for consistent blockchain interactions
 */
export const publicClient = createPublicClient({
  chain: flareTestnet,
  transport: http(),
});
