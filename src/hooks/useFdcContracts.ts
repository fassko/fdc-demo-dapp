// Hook to get the FDC contract addresses
// https://dev.flare.network/fdc/guides/fdc-by-hand

import { useEffect, useState } from 'react';

import {
  FdcContractAddresses,
  getFdcContractAddresses,
} from '@/lib/fdcContracts';

export function useFdcContracts() {
  const [addresses, setAddresses] = useState<FdcContractAddresses | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Get FDC contract addresses
  useEffect(() => {
    const fetchAddresses = async () => {
      setIsLoading(true);
      try {
        const contractAddresses = await getFdcContractAddresses();
        setAddresses(contractAddresses);
        setError(null);
      } catch (error) {
        console.error('Error fetching FDC contract addresses:', error);
        setError('Failed to fetch FDC contract addresses');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAddresses();
  }, []);

  return {
    addresses,
    isLoading,
    error,
  };
}
