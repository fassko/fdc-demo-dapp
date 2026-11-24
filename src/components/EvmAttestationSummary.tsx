'use client';

import type { ReactNode } from 'react';

import { Check, Copy, ExternalLink } from 'lucide-react';

import { useTransferTokenMeta } from '@/hooks/useTransferTokenMeta';
import { copyToClipboardWithTimeout } from '@/lib/clipboard';
import {
  decodeEvmTransactionEvent,
  lookupTransferToken,
  presentTransferEvent,
} from '@/lib/decodeEvmEvent';
import type { EVMTransactionEvent } from '@/lib/fdcUtils';
import {
  presentFeaturedEvent,
  type DvnFeePaidPresentation,
  type OftSentPresentation,
} from '@/lib/presentEvmEvent';

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

const CopyButton = ({
  value,
  label,
  copiedText,
  setCopiedText,
}: {
  value: string;
  label: string;
  copiedText: string | null;
  setCopiedText: (value: string | null) => void;
}) => (
  <button
    type='button'
    onClick={() => copyToClipboardWithTimeout(value, setCopiedText)}
    className='h-6 w-6 shrink-0 rounded p-0 hover:bg-gray-200'
    aria-label={`Copy ${label}`}
  >
    {copiedText === value ? (
      <Check className='h-3 w-3 text-green-600' />
    ) : (
      <Copy className='h-3 w-3 text-gray-500' />
    )}
  </button>
);

const EventBadge = ({ name }: { name: string }) => (
  <span
    className='rounded px-1.5 py-0.5 text-xs font-semibold'
    style={{ backgroundColor: '#fef7f0', color: '#E62058' }}
  >
    {name}
  </span>
);

const SummaryRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className='grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:items-start sm:gap-3'>
    <span className='text-xs font-medium text-gray-500'>{label}</span>
    <div className='min-w-0 text-xs text-gray-900'>{children}</div>
  </div>
);

const EventCard = ({
  name,
  logIndex,
  emitter,
  extra,
  children,
}: {
  name: string;
  logIndex: string | number;
  emitter: string;
  extra?: string | null;
  children: ReactNode;
}) => (
  <div className='overflow-hidden rounded-md border border-gray-200 bg-white'>
    <div className='flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2'>
      <EventBadge name={name} />
      {extra ? (
        <span className='text-xs font-medium text-gray-700'>{extra}</span>
      ) : null}
      <span className='text-xs text-gray-500'>log #{String(logIndex)}</span>
      <code className='font-mono text-xs text-gray-600'>
        {truncateHex(emitter, 8, 6)}
      </code>
    </div>
    <div className='space-y-2 px-3 py-3'>{children}</div>
  </div>
);

const OftSentCard = ({
  logIndex,
  emitter,
  presentation,
  copiedText,
  setCopiedText,
}: {
  logIndex: string | number;
  emitter: string;
  presentation: OftSentPresentation;
  copiedText: string | null;
  setCopiedText: (value: string | null) => void;
}) => (
  <EventCard
    name='OFTSent'
    logIndex={logIndex}
    emitter={emitter}
    extra={presentation.emitterLabel}
  >
    <p className='text-sm font-medium text-gray-900'>{presentation.headline}</p>
    <SummaryRow label='Amount sent'>
      <span className='inline-flex flex-wrap items-center gap-1'>
        <span className='font-medium'>{presentation.amountSentLabel}</span>
        <span className='text-gray-300'>·</span>
        <span className='font-mono text-gray-500'>
          {presentation.amountSentRaw}
        </span>
        <CopyButton
          value={presentation.amountSentRaw}
          label='amount sent'
          copiedText={copiedText}
          setCopiedText={setCopiedText}
        />
      </span>
    </SummaryRow>
    <SummaryRow label='Amount received'>
      <span className='inline-flex flex-wrap items-center gap-1'>
        <span className='font-medium'>{presentation.amountReceivedLabel}</span>
        <span className='text-gray-300'>·</span>
        <span className='font-mono text-gray-500'>
          {presentation.amountReceivedRaw}
        </span>
        <CopyButton
          value={presentation.amountReceivedRaw}
          label='amount received'
          copiedText={copiedText}
          setCopiedText={setCopiedText}
        />
      </span>
    </SummaryRow>
    <SummaryRow label='Destination'>
      <span>{presentation.destinationLabel}</span>
    </SummaryRow>
    <SummaryRow label='From'>
      <span className='inline-flex items-center gap-1'>
        <SepoliaAddress address={presentation.fromAddress} />
        <CopyButton
          value={presentation.fromAddress}
          label='from address'
          copiedText={copiedText}
          setCopiedText={setCopiedText}
        />
      </span>
    </SummaryRow>
    <SummaryRow label='Message id'>
      <span className='inline-flex items-center gap-1'>
        <code className='break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono'>
          {truncateHex(presentation.guid, 10, 8)}
        </code>
        <CopyButton
          value={presentation.guid}
          label='message id'
          copiedText={copiedText}
          setCopiedText={setCopiedText}
        />
      </span>
    </SummaryRow>
  </EventCard>
);

const DvnFeeCard = ({
  logIndex,
  emitter,
  presentation,
  copiedText,
  setCopiedText,
}: {
  logIndex: string | number;
  emitter: string;
  presentation: DvnFeePaidPresentation;
  copiedText: string | null;
  setCopiedText: (value: string | null) => void;
}) => (
  <EventCard name='DVNFeePaid' logIndex={logIndex} emitter={emitter}>
    <p className='text-sm font-medium text-gray-900'>{presentation.headline}</p>
    {presentation.lines.map((line, index) => (
      <SummaryRow
        key={`${line.role}-${line.address}-${index}`}
        label={line.role}
      >
        <div className='space-y-1'>
          <div className='flex items-center gap-1'>
            <SepoliaAddress address={line.address} />
            <CopyButton
              value={line.address}
              label={`${line.role} DVN`}
              copiedText={copiedText}
              setCopiedText={setCopiedText}
            />
          </div>
          <div className='flex flex-wrap items-center gap-1'>
            <span className='font-medium'>{line.gweiLabel}</span>
            <span className='font-mono text-gray-500'>{line.weiLabel}</span>
            {line.wei ? (
              <CopyButton
                value={line.wei}
                label={`${line.role} fee`}
                copiedText={copiedText}
                setCopiedText={setCopiedText}
              />
            ) : null}
          </div>
        </div>
      </SummaryRow>
    ))}
    {presentation.optionalCount === 0 ? (
      <SummaryRow label='Optional'>None</SummaryRow>
    ) : null}
    {presentation.extraFees.map((fee, index) => (
      <SummaryRow key={`extra-${fee.wei}-${index}`} label='Unassigned'>
        <span className='inline-flex flex-wrap items-center gap-1'>
          <span className='font-medium'>{fee.gweiLabel}</span>
          <span className='font-mono text-gray-500'>{fee.weiLabel}</span>
          <CopyButton
            value={fee.wei}
            label='unassigned fee'
            copiedText={copiedText}
            setCopiedText={setCopiedText}
          />
        </span>
      </SummaryRow>
    ))}
  </EventCard>
);

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
  const tokenMeta = useTransferTokenMeta(
    annotatedEvents
      .filter(
        item =>
          item.decoded?.eventName === 'Transfer' ||
          item.decoded?.eventName === 'OFTSent'
      )
      .map(item => item.event.emitterAddress)
  );
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
        <h5 className='font-medium text-gray-900'>
          Attested Sepolia transaction
        </h5>
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
            No known events decoded (LayerZero OFT, DVN fee, or ERC-20
            Transfer). Raw logs are under technical details.
          </p>
        ) : (
          <div className='space-y-2'>
            {decodedEvents.map(({ event, index, decoded }) => {
              const token = lookupTransferToken(
                event.emitterAddress,
                tokenMeta
              );
              const featured = presentFeaturedEvent(
                decoded!,
                event.emitterAddress,
                token
              );
              if (featured?.kind === 'OFTSent') {
                return (
                  <OftSentCard
                    key={`${event.logIndex}-${index}`}
                    logIndex={event.logIndex}
                    emitter={event.emitterAddress}
                    presentation={featured}
                    copiedText={copiedText}
                    setCopiedText={setCopiedText}
                  />
                );
              }
              if (featured?.kind === 'DVNFeePaid') {
                return (
                  <DvnFeeCard
                    key={`${event.logIndex}-${index}`}
                    logIndex={event.logIndex}
                    emitter={event.emitterAddress}
                    presentation={featured}
                    copiedText={copiedText}
                    setCopiedText={setCopiedText}
                  />
                );
              }
              const shown = presentTransferEvent(
                decoded!,
                event.emitterAddress,
                token
              );
              return (
                <div
                  key={`${event.logIndex}-${index}`}
                  className='rounded-md border border-gray-200 bg-white overflow-hidden'
                >
                  <div className='flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50'>
                    <span
                      className='rounded px-1.5 py-0.5 text-xs font-semibold'
                      style={{ backgroundColor: '#fef7f0', color: '#E62058' }}
                    >
                      {shown.eventName}
                      {shown.token ? ` · ${shown.token.symbol}` : ''}
                    </span>
                    <span className='text-xs text-gray-500'>
                      log #{String(event.logIndex)}
                    </span>
                    <code className='text-xs font-mono text-gray-600'>
                      {truncateHex(String(event.emitterAddress), 8, 6)}
                    </code>
                  </div>
                  <ul className='px-3 py-2 space-y-1.5 text-xs'>
                    {shown.args.map(arg => (
                      <li
                        key={`${index}-${arg.name}`}
                        className='flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3'
                      >
                        <span className='shrink-0 font-medium text-gray-700 sm:w-36'>
                          {arg.name}
                        </span>
                        <div className='flex min-w-0 flex-1 items-start gap-1'>
                          {arg.name === 'token' && shown.token ? (
                            <span className='inline-flex flex-wrap items-center gap-2'>
                              <span className='font-medium text-gray-900'>
                                {shown.token.symbol}
                              </span>
                              <SepoliaAddress address={shown.token.address} />
                            </span>
                          ) : (
                            <code className='break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono'>
                              {arg.displayValue.length > 80
                                ? truncateHex(arg.displayValue, 20, 16)
                                : arg.displayValue}
                            </code>
                          )}
                          {arg.value ? (
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  arg.value,
                                  setCopiedText
                                )
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
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
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
