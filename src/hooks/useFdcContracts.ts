// Hook to get the FDC contract addresses via Flare Contract Registry
// https://dev.flare.network/fdc/guides/fdc-by-hand
// Uses @flarenetwork/flare-wagmi-periphery-package ABIs

import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';

import { iFlareContractRegistryAbi } from '@flarenetwork/flare-wagmi-periphery-package/contracts/coston2';

import {
  FLARE_CONTRACT_REGISTRY,
  type FdcContractAddresses,
} from '@/lib/fdcContracts';

const CONTRACT_NAMES = [
  'FdcHub',
  'FdcRequestFeeConfigurations',
  'FlareSystemsManager',
  'FdcVerification',
] as const;

export function useFdcContracts() {
  const { data, isLoading, error } = useReadContracts({
    contracts: CONTRACT_NAMES.map(name => ({
      address: FLARE_CONTRACT_REGISTRY,
      abi: iFlareContractRegistryAbi,
      functionName: 'getContractAddressByName' as const,
      args: [name] as const,
    })),
  });

  const addresses = useMemo((): FdcContractAddresses | null => {
    if (!data || data.some(result => result.status !== 'success')) {
      return null;
    }

    return {
      fdcHub: data[0].result as `0x${string}`,
      fdcRequestFeeConfigurations: data[1].result as `0x${string}`,
      flareSystemsManager: data[2].result as `0x${string}`,
      fdcVerification: data[3].result as `0x${string}`,
    };
  }, [data]);

  return {
    addresses,
    isLoading,
    error: error
      ? error.message
      : data?.some(result => result.status === 'failure')
        ? 'Failed to fetch FDC contract addresses'
        : null,
  };
}
