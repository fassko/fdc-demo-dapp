'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';

import { decodeEvmTransactionEvent } from '@/lib/decodeEvmEvent';
import { copyToClipboardWithTimeout } from '@/lib/clipboard';
import type { EVMTransactionEvent } from '@/lib/fdcUtils';

export type EvmAttestationView = {
  requiredConfirmations: string | number;
  blockNumber: string;
  timestamp: string;
  sourceAddress: string;
  receivingAddress: string;
  value: string;
  input: string;
  status: number;
  isDeployment: boolean;
  events: EVMTransactionEvent[];
};

const truncateHex = (value: string, head = 10, tail = 8) => {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const SepoliaAddress = ({ address }: { address: string }) => (
  <span className='inline-flex items-center gap-1.5 min-w-0'>
    <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono break-all'>
      {truncateHex(address)}
    </code>
    <a
      href={`https://sepolia.etherscan.io/address/${address}`}
      target='_blank'
      rel='noopener noreferrer'
      className='inline-flex hover:opacity-80'
      style={{ color: '#E62058' }}
      aria-label='View address on Sepolia explorer'
    >
      <ExternalLink className='h-3 w-3' />
    </a>
  </span>
);

type Props = {
  evm: EvmAttestationView;
  copiedText: string | null;
  setCopiedText: (value: string | null) => void;
};

/**
 * Presentation-friendly view of an FDC-attested EVM transaction:
 * compact summary first, decoded events next, raw hex tucked away.
 */
export function EvmAttestationSummary({
  evm,
  copiedText,
  setCopiedText,
}: Props) {
  const events = evm.events ?? [];
  const annotatedEvents = events.map((event, index) => ({
    event,
    index,
    decoded: decodeEvmTransactionEvent(event),
  }));
  const decodedEvents = annotatedEvents.filter(item => item.decoded);
  const otherEvents = annotatedEvents
    .filter(item => !item.decoded)
    .map(item => item.event);
  const succeeded = Number(evm.status) === 1;
  const timestampLabel =
    Number(evm.timestamp) > 0
      ? new Date(Number(evm.timestamp) * 1000).toLocaleString()
      : null;

  return (
    <div className='space-y-4 border-t border-gray-200 pt-3'>
      <div className='space-y-1'>
        <h5 className='font-medium text-gray-900'>Attested Sepolia transaction</h5>
        <p className='text-xs text-gray-600'>
          FDC verified this external EVM transaction. The decoded events below
          are what a Flare contract can act on after{' '}
          <code className='bg-gray-100 px-1 rounded'>verifyEVMTransaction</code>
          .
        </p>
      </div>

      <div className='rounded-md border border-gray-200 bg-white px-3 py-3 space-y-3 text-sm'>
        <div className='flex flex-wrap items-center gap-2'>
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold ${
              succeeded
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {succeeded ? 'Success' : 'Failed'}
          </span>
          {evm.isDeployment && (
            <span className='text-xs text-gray-600'>Contract deployment</span>
          )}
          <span className='text-xs text-gray-500'>
            Block {String(evm.blockNumber)}
            {timestampLabel ? ` · ${timestampLabel}` : ''}
          </span>
          <a
            href={`https://sepolia.etherscan.io/block/${String(evm.blockNumber)}`}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1 text-xs underline hover:opacity-80'
            style={{ color: '#E62058' }}
          >
            Explorer
            <ExternalLink className='h-3 w-3' />
          </a>
        </div>

        <div className='grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center'>
          <span className='text-xs font-medium text-gray-500 uppercase tracking-wide'>
            From
          </span>
          <SepoliaAddress address={String(evm.sourceAddress)} />
          <span className='text-xs font-medium text-gray-500 uppercase tracking-wide'>
            To
          </span>
          <SepoliaAddress address={String(evm.receivingAddress)} />
          <span className='text-xs font-medium text-gray-500 uppercase tracking-wide'>
            Value
          </span>
          <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono w-fit'>
            {String(evm.value)} wei
          </code>
        </div>
      </div>

      <div className='space-y-2'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h6 className='font-medium text-gray-900'>
            Decoded events ({decodedEvents.length})
          </h6>
          <span className='text-xs text-gray-500'>
            {events.length} log{events.length === 1 ? '' : 's'} attested
          </span>
        </div>

        {decodedEvents.length === 0 ? (
          <p className='text-xs text-gray-600'>
            No known events decoded (LayerZero OFT / ERC-20 Transfer). Raw logs
            are under technical details.
          </p>
        ) : (
          <div className='space-y-2'>
            {decodedEvents.map(({ event, index, decoded }) => (
              <div
                key={`${event.logIndex}-${index}`}
                className='rounded-md border border-gray-200 bg-white overflow-hidden'
              >
                <div className='flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50'>
                  <span
                    className='rounded px-1.5 py-0.5 text-xs font-semibold'
                    style={{ backgroundColor: '#fef7f0', color: '#E62058' }}
                  >
                    {decoded!.eventName}
                  </span>
                  <span className='text-xs text-gray-500'>
                    log #{String(event.logIndex)}
                  </span>
                  <code className='text-xs font-mono text-gray-600'>
                    {truncateHex(String(event.emitterAddress), 8, 6)}
                  </code>
                </div>
                <ul className='px-3 py-2 space-y-1.5 text-xs'>
                  {decoded!.args.map(arg => (
                    <li
                      key={`${index}-${arg.name}`}
                      className='flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3'
                    >
                      <span className='shrink-0 font-medium text-gray-700 sm:w-36'>
                        {arg.name}
                      </span>
                      <div className='flex min-w-0 flex-1 items-start gap-1'>
                        <code className='break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono'>
                          {arg.displayValue.length > 80
                            ? truncateHex(arg.displayValue, 20, 16)
                            : arg.displayValue}
                        </code>
                        <button
                          type='button'
                          onClick={() =>
                            copyToClipboardWithTimeout(arg.value, setCopiedText)
                          }
                          className='h-6 w-6 shrink-0 rounded p-0 hover:bg-gray-200'
                          aria-label={`Copy ${arg.name}`}
                        >
                          {copiedText === arg.value ? (
                            <Check className='h-3 w-3 text-green-600' />
                          ) : (
                            <Copy className='h-3 w-3 text-gray-500' />
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className='rounded-md border border-dashed border-gray-300'>
        <summary className='cursor-pointer px-3 py-2 text-xs font-medium text-gray-700'>
          Technical details
          {otherEvents.length > 0
            ? ` · ${otherEvents.length} undecoded log${otherEvents.length === 1 ? '' : 's'}`
            : ''}
        </summary>
        <div className='space-y-3 border-t border-gray-200 px-3 py-3 text-xs'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium text-gray-700'>Confirmations:</span>
            <code className='px-1.5 py-0.5 bg-gray-100 rounded font-mono'>
              {String(evm.requiredConfirmations)}
            </code>
          </div>

          <div className='space-y-1'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-medium text-gray-700'>Calldata</span>
              <button
                type='button'
                onClick={() =>
                  copyToClipboardWithTimeout(
                    String(evm.input || '0x'),
                    setCopiedText
                  )
                }
                className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                aria-label='Copy calldata'
              >
                {copiedText === String(evm.input || '0x') ? (
                  <Check className='h-3 w-3 text-green-600' />
                ) : (
                  <Copy className='h-3 w-3 text-gray-500' />
                )}
              </button>
            </div>
            <code className='block break-all rounded bg-gray-50 px-2 py-1 font-mono max-h-24 overflow-y-auto'>
              {truncateHex(String(evm.input || '0x'), 24, 20)}
            </code>
          </div>

          {otherEvents.length > 0 && (
            <div className='space-y-2'>
              <span className='font-medium text-gray-700'>Undecoded logs</span>
              {otherEvents.map((event, index) => (
                <div
                  key={`other-${event.logIndex}-${index}`}
                  className='rounded border border-gray-200 bg-gray-50 px-2 py-1.5 space-y-1'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span>log #{String(event.logIndex)}</span>
                    <code className='font-mono text-gray-600'>
                      {truncateHex(String(event.emitterAddress), 8, 6)}
                    </code>
                  </div>
                  <code className='block break-all font-mono text-gray-500'>
                    topic0{' '}
                    {truncateHex(String(event.topics[0] ?? '0x'), 14, 10)}
                  </code>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
