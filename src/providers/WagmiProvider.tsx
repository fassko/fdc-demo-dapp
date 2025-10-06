'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { WagmiProvider as WagmiProviderBase } from 'wagmi';

import { config } from '@/lib/wagmi';

// Create a client
const queryClient = new QueryClient();

export function WagmiProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProviderBase config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProviderBase>
  );
}
