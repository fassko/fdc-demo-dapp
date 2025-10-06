import { Geist, Geist_Mono } from 'next/font/google';

import type { Metadata } from 'next';

import { WagmiProvider } from '@/providers/WagmiProvider';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'FDC Demo',
  description: 'FDC Demo',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WagmiProvider>{children}</WagmiProvider>
      </body>
    </html>
  );
}
