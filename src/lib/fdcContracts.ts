// FDC contract addresses
// More info: https://dev.flare.network/fdc/overview

import { ethers } from 'ethers';

import { coston2 } from '@flarenetwork/flare-periphery-contract-artifacts';

// Helper function to extract contract address from result
function extractContractAddress(result: any): `0x${string}` {
  return result.address || result;
}

export interface FdcContractAddresses {
  fdcHub: `0x${string}`;
  fdcRequestFeeConfigurations: `0x${string}`;
  flareSystemsManager: `0x${string}`;
  fdcVerification: `0x${string}`;
}

export async function getFdcContractAddresses(): Promise<FdcContractAddresses> {
  try {
    if (typeof window !== 'undefined' && window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);

      // Get FDC Hub address from Flare Contracts Registry
      // https://dev.flare.network/network/guides/flare-contracts-registry
      const fdcHub = coston2.products.FdcHub;
      const fdcHubAddressResult = await fdcHub.getAddress(provider);

      // Get FDC Request Fee Configurations address from Flare Contracts Registry
      // https://dev.flare.network/network/guides/flare-contracts-registry
      const fdcRequestFeeConfigurations =
        coston2.products.FdcRequestFeeConfigurations;
      const fdcRequestFeeConfigurationsAddressResult =
        await fdcRequestFeeConfigurations.getAddress(provider);

      // Get Flare Systems Manager address from Flare Contracts Registry
      // https://dev.flare.network/network/guides/flare-contracts-registry
      const flareSystemsManager = coston2.products.FlareSystemsManager;
      const flareSystemsManagerAddressResult =
        await flareSystemsManager.getAddress(provider);

      // Get FDC Verification address from Flare Contracts Registry
      // https://dev.flare.network/network/guides/flare-contracts-registry
      const fdcVerification = coston2.products.FdcVerification;
      const fdcVerificationAddressResult =
        await fdcVerification.getAddress(provider);

      return {
        fdcHub: extractContractAddress(fdcHubAddressResult),
        fdcRequestFeeConfigurations: extractContractAddress(
          fdcRequestFeeConfigurationsAddressResult
        ),
        flareSystemsManager: extractContractAddress(
          flareSystemsManagerAddressResult
        ),
        fdcVerification: extractContractAddress(fdcVerificationAddressResult),
      };
    } else {
      throw new Error(
        'MetaMask is not installed. Please install MetaMask to use this feature.'
      );
    }
  } catch (error) {
    console.error('Error getting FDC contract addresses:', error);
    throw error;
  }
}
