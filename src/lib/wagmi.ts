import { createConfig, http } from 'wagmi';
import { flareTestnet } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

export const config = createConfig({
  chains: [flareTestnet],
  connectors: [
    injected({
      target: 'metaMask',
    }),
  ],
  // Discover browser extension wallets (Chrome MetaMask via EIP-6963)
  multiInjectedProviderDiscovery: true,
  transports: {
    [flareTestnet.id]: http(),
  },
  ssr: true,
});
