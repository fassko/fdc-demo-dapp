import { sepolia } from 'viem/chains';

import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';

import type { EVMTransactionEvent } from '@/lib/fdcUtils';

/**
 * EIP-7708 logs native ETH movement as an ERC-20 Transfer from this address.
 * It has no contract code. The amount is wei.
 */
const NATIVE_ETH_TRANSFER_ADDRESS =
  '0xfffffffffffffffffffffffffffffffffffffffe';

/**
 * Demo OFT on Sepolia. Matches on-chain symbol() and decimals().
 * Used when the token read has not returned, and if that read fails.
 */
const KNOWN_ERC20_TOKENS: Record<string, { symbol: string; decimals: number }> =
  {
    '0x81672c5d42f3573ad95a0bdfbe824faac547d4e6': {
      symbol: 'FTestXRP',
      decimals: 6,
    },
  };

/** Sepolia is the FDC testETH source used by this demo. */
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});

/** Known event ABIs used to decode FDC-attested EVM logs (LayerZero OFT + ERC-20). */
const KNOWN_EVENT_ABIS = [
  {
    type: 'event',
    name: 'OFTSent',
    inputs: [
      { name: 'guid', type: 'bytes32', indexed: true },
      { name: 'dstEid', type: 'uint32', indexed: false },
      { name: 'fromAddress', type: 'address', indexed: true },
      { name: 'amountSentLD', type: 'uint256', indexed: false },
      { name: 'amountReceivedLD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OFTReceived',
    inputs: [
      { name: 'guid', type: 'bytes32', indexed: true },
      { name: 'srcEid', type: 'uint32', indexed: false },
      { name: 'toAddress', type: 'address', indexed: true },
      { name: 'amountReceivedLD', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PacketSent',
    inputs: [
      { name: 'encodedPayload', type: 'bytes', indexed: false },
      { name: 'options', type: 'bytes', indexed: false },
      { name: 'sendLibrary', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DVNFeePaid',
    inputs: [
      { name: 'requiredDVNs', type: 'address[]', indexed: false },
      { name: 'optionalDVNs', type: 'address[]', indexed: false },
      { name: 'fees', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const satisfies readonly AbiEvent[];

export type DecodedEvmEventArg = {
  name: string;
  type: string;
  indexed: boolean;
  value: string;
  displayValue: string;
};

export type Erc20TokenMeta = {
  address: Address;
  symbol: string;
  decimals: number;
  isNative: boolean;
};

export type DecodedEvmEvent = {
  eventName: string;
  args: DecodedEvmEventArg[];
  /** Set once a Transfer log's token metadata is known. */
  token?: Erc20TokenMeta;
};

const formatDecodedValue = (value: unknown): string => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(
        value,
        (_key, v) => (typeof v === 'bigint' ? v.toString() : v),
        2
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const toSerializable = (value: unknown): string => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value, (_key, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
  } catch {
    return String(value);
  }
};

/**
 * Decode an FDC EVMTransaction event log against known ABIs (LayerZero OFT, ERC-20 Transfer).
 * Returns null when topic0 does not match a known event or decoding fails.
 */
export const decodeEvmTransactionEvent = (
  event: EVMTransactionEvent
): DecodedEvmEvent | null => {
  if (!event.topics?.length) return null;

  // decodeEventLog expects [signature, ...indexedArgs] as Hex tuples
  const topics = event.topics as [Hex, ...Hex[]];

  for (const abiEvent of KNOWN_EVENT_ABIS) {
    try {
      // Union of known ABIs prevents viem from inferring DecodeEventLogReturnType;
      // we only need eventName + args and map them manually below.
      const decoded = decodeEventLog({
        abi: [abiEvent],
        data: (event.data || '0x') as Hex,
        topics,
        strict: true,
      }) as { eventName: string; args?: Record<string, unknown> };

      if (decoded.eventName !== abiEvent.name) continue;

      const argsObj = decoded.args ?? {};
      const args: DecodedEvmEventArg[] = abiEvent.inputs.map(input => {
        const raw = argsObj[input.name];
        return {
          name: input.name,
          type: input.type,
          indexed: Boolean(input.indexed),
          value: toSerializable(raw),
          displayValue: formatDecodedValue(raw),
        };
      });

      return {
        eventName: decoded.eventName,
        args,
      };
    } catch {
      // Try next known ABI
    }
  }

  return null;
};

export const isNativeEthTransfer = (address: string) =>
  address.toLowerCase() === NATIVE_ETH_TRANSFER_ADDRESS;

export const nativeEthTokenMeta = (address: Address): Erc20TokenMeta => ({
  address,
  symbol: 'ETH',
  decimals: 18,
  isNative: true,
});

const tokenMetaCache = new Map<string, Promise<Erc20TokenMeta | null>>();

const readErc20TokenMeta = async (
  address: Address
): Promise<Erc20TokenMeta | null> => {
  let decimals: number;
  try {
    decimals = await sepoliaClient.readContract({
      address,
      abi: erc20Abi,
      functionName: 'decimals',
    });
  } catch {
    return null;
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return null;
  }

  let symbol = 'TOKEN';
  try {
    const raw = await sepoliaClient.readContract({
      address,
      abi: erc20Abi,
      functionName: 'symbol',
    });
    const trimmed = raw.replace(/\u0000/g, '').trim();
    if (trimmed) symbol = trimmed;
  } catch {
    // Decimals are enough to scale the amount. Keep a generic symbol.
  }

  return { address, symbol, decimals, isNative: false };
};

/** Resolve the ERC-20 (or native ETH) behind a Transfer log's emitter. */
export const loadTransferTokenMeta = (
  emitter: string
): Promise<Erc20TokenMeta | null> => {
  const key = emitter.toLowerCase();
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    let address: Address;
    try {
      address = getAddress(emitter);
    } catch {
      return null;
    }
    if (isNativeEthTransfer(address)) return nativeEthTokenMeta(address);
    return readErc20TokenMeta(address);
  })();

  tokenMetaCache.set(key, pending);
  return pending;
};

/**
 * Lookup helper for a render. Native ETH and the demo OFT are known immediately.
 * `undefined` means an unknown ERC-20 read is still in flight.
 */
export const knownErc20TokenMeta = (emitter: string): Erc20TokenMeta | null => {
  const known = KNOWN_ERC20_TOKENS[emitter.toLowerCase()];
  if (!known) return null;
  try {
    return {
      address: getAddress(emitter),
      symbol: known.symbol,
      decimals: known.decimals,
      isNative: false,
    };
  } catch {
    return null;
  }
};

export const lookupTransferToken = (
  emitter: string,
  loaded: Record<string, Erc20TokenMeta | null>
): Erc20TokenMeta | null | undefined => {
  if (isNativeEthTransfer(emitter)) {
    try {
      return nativeEthTokenMeta(getAddress(emitter));
    } catch {
      return null;
    }
  }
  const key = emitter.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(loaded, key) && loaded[key]) {
    return loaded[key];
  }
  const known = knownErc20TokenMeta(emitter);
  if (known) return known;
  if (Object.prototype.hasOwnProperty.call(loaded, key)) return loaded[key];
  return undefined;
};

const formatTokenAmount = (raw: string, meta: Erc20TokenMeta) => {
  try {
    return `${formatUnits(BigInt(raw), meta.decimals)} ${meta.symbol}`;
  } catch {
    return raw;
  }
};

/**
 * For a Transfer log, surface the token, its decimals, and the value
 * scaled by those decimals. Other events are returned unchanged.
 */
export const presentTransferEvent = (
  decoded: DecodedEvmEvent,
  emitter: string,
  meta: Erc20TokenMeta | null | undefined
): DecodedEvmEvent => {
  if (decoded.eventName !== 'Transfer') return decoded;

  const byName = new Map(decoded.args.map(arg => [arg.name, arg]));
  const from = byName.get('from');
  const to = byName.get('to');
  const value = byName.get('value');

  if (meta && value) {
    const formatted = formatTokenAmount(value.value, meta);
    const tokenArg: DecodedEvmEventArg = {
      name: 'token',
      type: 'address',
      indexed: false,
      value: meta.address,
      displayValue: meta.symbol,
    };
    const decimalsArg: DecodedEvmEventArg = {
      name: 'decimals',
      type: 'uint8',
      indexed: false,
      value: String(meta.decimals),
      displayValue: String(meta.decimals),
    };
    return {
      eventName: decoded.eventName,
      token: meta,
      args: [
        tokenArg,
        decimalsArg,
        ...(from ? [from] : []),
        ...(to ? [to] : []),
        { ...value, value: formatted, displayValue: formatted },
      ],
    };
  }

  const pending = meta === undefined;
  const tokenArg: DecodedEvmEventArg = {
    name: 'token',
    type: 'address',
    indexed: false,
    value: pending ? '' : emitter,
    displayValue: pending ? 'Resolving...' : emitter,
  };
  const decimalsArg: DecodedEvmEventArg = {
    name: 'decimals',
    type: 'uint8',
    indexed: false,
    value: '',
    displayValue: pending ? 'Resolving...' : 'Unavailable',
  };
  const valueArg: DecodedEvmEventArg | undefined = value
    ? pending
      ? { ...value, value: '', displayValue: 'Resolving...' }
      : value
    : undefined;

  return {
    eventName: decoded.eventName,
    args: [
      tokenArg,
      decimalsArg,
      ...(from ? [from] : []),
      ...(to ? [to] : []),
      ...(valueArg ? [valueArg] : []),
    ],
  };
};
