import { decodeEventLog, type AbiEvent, type Hex } from 'viem';

import type { EVMTransactionEvent } from '@/lib/fdcUtils';

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

export type DecodedEvmEvent = {
  eventName: string;
  args: DecodedEvmEventArg[];
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
      const decoded = decodeEventLog({
        abi: [abiEvent],
        data: (event.data || '0x') as Hex,
        topics,
        strict: true,
      });

      if (decoded.eventName !== abiEvent.name) continue;

      const argsObj = (decoded.args ?? {}) as Record<string, unknown>;
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
