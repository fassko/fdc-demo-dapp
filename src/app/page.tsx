'use client';

import Fdc from '@/components/Fdc';

export default function Home() {
  return (
    <div className='flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,_#fff5f8_0%,_#ffffff_55%)] font-sans'>
      <main className='mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10'>
        <Fdc />
      </main>
      <footer className='border-t border-gray-200/80 px-4 py-6 sm:px-6'>
        <div className='mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-600'>
          <a
            href='https://dev.flare.network/'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-[#E62058] hover:underline'
          >
            Flare Developer Hub
          </a>
          <a
            href='https://x.com/FlareDevHub'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-[#E62058] hover:underline'
          >
            @FlareDevHub
          </a>
          <a
            href='https://github.com/fassko/fdc-demo-dapp'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-[#E62058] hover:underline'
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
