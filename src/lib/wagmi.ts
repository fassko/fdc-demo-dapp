import { flareTestnet } from 'wagmi/chains';
import { injected, metaMask, walletConnect } from 'wagmi/connectors';

import { createConfig, http } from 'wagmi';

export const config = createConfig({
  chains: [flareTestnet],
  connectors: [
    injected(),
    metaMask(),
    walletConnect({ projectId: 'YOUR_WALLET_CONNECT_PROJECT_ID' }),
  ],
  transports: {
    [flareTestnet.id]: http(),
  },
});
