// FDC contract addresses via Flare Contract Registry
// More info: https://dev.flare.network/fdc/overview
// Registry guide: https://dev.flare.network/network/guides/flare-contracts-registry

import { iFlareContractRegistryAbi } from '@flarenetwork/flare-wagmi-periphery-package/contracts/coston2';
import type { Abi } from 'viem';

import { publicClient } from '@/lib/publicClient';

/** Same address on every Flare-family network */
export const FLARE_CONTRACT_REGISTRY =
  '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019' as const;

export interface FdcContractAddresses {
  fdcHub: `0x${string}`;
  fdcRequestFeeConfigurations: `0x${string}`;
  flareSystemsManager: `0x${string}`;
  fdcVerification: `0x${string}`;
}

const getAddressByName = async (name: string): Promise<`0x${string}`> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const address = await (publicClient as any).readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: iFlareContractRegistryAbi as Abi,
    functionName: 'getContractAddressByName',
    args: [name],
  });

  if (!address || address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Contract registry returned empty address for ${name}`);
  }

  return address as `0x${string}`;
};

export async function getFdcContractAddresses(): Promise<FdcContractAddresses> {
  try {
    const [
      fdcHub,
      fdcRequestFeeConfigurations,
      flareSystemsManager,
      fdcVerification,
    ] = await Promise.all([
      getAddressByName('FdcHub'),
      getAddressByName('FdcRequestFeeConfigurations'),
      getAddressByName('FlareSystemsManager'),
      getAddressByName('FdcVerification'),
    ]);

    return {
      fdcHub,
      fdcRequestFeeConfigurations,
      flareSystemsManager,
      fdcVerification,
    };
  } catch (error) {
    console.error('Error getting FDC contract addresses:', error);
    throw error;
  }
}
