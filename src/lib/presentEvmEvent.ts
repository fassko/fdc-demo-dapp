import { formatUnits, getAddress } from 'viem';

import {
  knownErc20TokenMeta,
  type DecodedEvmEvent,
  type Erc20TokenMeta,
} from '@/lib/decodeEvmEvent';

/** LayerZero V2 endpoint ids used by this demo. 40294 is Coston2. */
const ENDPOINT_NAMES: Record<string, string> = {
  '40294': 'Coston2',
};

export type OftSentPresentation = {
  kind: 'OFTSent';
  headline: string;
  destinationLabel: string;
  amountSentLabel: string;
  amountSentRaw: string;
  amountReceivedLabel: string;
  amountReceivedRaw: string;
  fromAddress: string;
  guid: string;
  emitterLabel: string | null;
};

export type DvnFeeLine = {
  role: 'Required' | 'Optional';
  address: string;
  wei: string;
  weiLabel: string;
  gweiLabel: string;
};

export type DvnFeePaidPresentation = {
  kind: 'DVNFeePaid';
  headline: string;
  lines: DvnFeeLine[];
  /** Fees left over when the fee array is longer than the DVN lists. */
  extraFees: { wei: string; weiLabel: string; gweiLabel: string }[];
  optionalCount: number;
};

export type FeaturedPresentation = OftSentPresentation | DvnFeePaidPresentation;

const argValue = (decoded: DecodedEvmEvent, name: string): string => {
  const found = decoded.args.find(item => item.name === name);
  if (!found) throw new Error(`Missing ${decoded.eventName}.${name}`);
  return found.value;
};

const checksum = (address: string): string => {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
};

const groupInteger = (value: string): string =>
  value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatGwei = (wei: bigint): string => {
  const gwei = formatUnits(wei, 9);
  const trimmed = gwei.includes('.')
    ? gwei.replace(/0+$/, '').replace(/\.$/, '')
    : gwei;
  return `${trimmed} gwei`;
};

const feeDisplay = (wei: bigint) => ({
  wei: wei.toString(),
  weiLabel: `${groupInteger(wei.toString())} wei`,
  gweiLabel: formatGwei(wei),
});

const amountLabel = (
  raw: bigint,
  emitterAddress: string,
  token: Erc20TokenMeta | null | undefined
): { label: string; symbol: string | null } => {
  const known = knownErc20TokenMeta(emitterAddress);
  const resolved = token ?? known;
  if (resolved) {
    return {
      label: `${formatUnits(raw, resolved.decimals)} ${resolved.symbol}`,
      symbol: resolved.symbol,
    };
  }
  if (token === undefined) {
    return { label: 'Resolving token decimals', symbol: null };
  }
  return {
    label: `${groupInteger(raw.toString())} (local decimals)`,
    symbol: null,
  };
};

const presentOftSent = (
  decoded: DecodedEvmEvent,
  emitterAddress: string,
  token: Erc20TokenMeta | null | undefined
): OftSentPresentation => {
  const guid = argValue(decoded, 'guid');
  const fromAddress = checksum(argValue(decoded, 'fromAddress'));
  const endpointId = argValue(decoded, 'dstEid');
  const amountSentRaw = argValue(decoded, 'amountSentLD');
  const amountReceivedRaw = argValue(decoded, 'amountReceivedLD');
  const chainName = ENDPOINT_NAMES[endpointId];
  const destinationLabel = chainName
    ? `${chainName} · endpoint ${endpointId}`
    : `endpoint ${endpointId}`;
  const sent = amountLabel(BigInt(amountSentRaw), emitterAddress, token);
  const received = amountLabel(
    BigInt(amountReceivedRaw),
    emitterAddress,
    token
  );
  const destinationName = chainName ?? `endpoint ${endpointId}`;

  return {
    kind: 'OFTSent',
    headline: `Sent ${sent.label} to ${destinationName}`,
    destinationLabel,
    amountSentLabel: sent.label,
    amountSentRaw,
    amountReceivedLabel: received.label,
    amountReceivedRaw,
    fromAddress,
    guid,
    emitterLabel: sent.symbol ? `${sent.symbol} OFT` : null,
  };
};

const pairedFee = (
  role: DvnFeeLine['role'],
  address: string,
  fee: bigint | undefined
): DvnFeeLine => {
  if (fee === undefined) {
    return {
      role,
      address: checksum(address),
      wei: '',
      weiLabel: 'Fee missing',
      gweiLabel: '—',
    };
  }
  return { role, address: checksum(address), ...feeDisplay(fee) };
};

const presentDvnFeePaid = (
  decoded: DecodedEvmEvent
): DvnFeePaidPresentation => {
  const required = JSON.parse(argValue(decoded, 'requiredDVNs')) as string[];
  const optional = JSON.parse(argValue(decoded, 'optionalDVNs')) as string[];
  const fees = (JSON.parse(argValue(decoded, 'fees')) as string[]).map(value =>
    BigInt(value)
  );

  const lines: DvnFeeLine[] = [
    ...required.map((address, index) =>
      pairedFee('Required', address, fees[index])
    ),
    ...optional.map((address, index) =>
      pairedFee('Optional', address, fees[required.length + index])
    ),
  ];

  const extraFees = fees
    .slice(required.length + optional.length)
    .map(feeDisplay);
  const total = [...lines, ...extraFees].reduce(
    (sum, fee) => sum + (fee.wei ? BigInt(fee.wei) : BigInt(0)),
    BigInt(0)
  );
  const paidCount = lines.filter(line => line.wei).length;
  const headline =
    paidCount === 0
      ? 'DVN fee'
      : `${formatGwei(total)} paid to ${paidCount} DVN${paidCount === 1 ? '' : 's'}`;

  return {
    kind: 'DVNFeePaid',
    headline,
    lines,
    extraFees,
    optionalCount: optional.length,
  };
};

/**
 * Human-readable view for OFTSent and DVNFeePaid.
 * Other events stay on the generic decoded-field list.
 */
export const presentFeaturedEvent = (
  decoded: DecodedEvmEvent,
  emitterAddress: string,
  token: Erc20TokenMeta | null | undefined
): FeaturedPresentation | null => {
  try {
    if (decoded.eventName === 'OFTSent') {
      return presentOftSent(decoded, emitterAddress, token);
    }
    if (decoded.eventName === 'DVNFeePaid') {
      return presentDvnFeePaid(decoded);
    }
    return null;
  } catch {
    return null;
  }
};
