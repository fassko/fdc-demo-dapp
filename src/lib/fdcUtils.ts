// FDC (Flare Data Connector) utility functions
// Taken from the this guide https://dev.flare.network/fdc/guides/fdc-by-hand

import {
  iFdcRequestFeeConfigurationsAbi,
  iFlareSystemsManagerAbi,
  ievmTransactionVerificationAbi,
  iReferencedPaymentNonexistenceVerificationAbi,
  ixrpPaymentVerificationAbi,
} from '@flarenetwork/flare-wagmi-periphery-package/contracts/coston2';
import type { Abi } from 'viem';
import { publicClient } from '@/lib/publicClient';
import { toHex } from '@/lib/utils';

/**
 * Thin wrapper around publicClient.readContract.
 * Needed because flare-wagmi-periphery-package ABI const types can collide with
 * the app's viem ReadContractParameters (authorizationList required incorrectly).
 */
const readContract = async <T>(params: {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Promise<T> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (publicClient as any).readContract(params) as Promise<T>;
};

// Type definitions based on generated ABI structures
export type XRPPaymentRequestBody = {
  transactionId: string;
  proofOwner: string;
};

export type ReferencedPaymentNonexistenceRequestBody = {
  minimalBlockNumber: string;
  deadlineBlockNumber: string;
  deadlineTimestamp: string;
  destinationAddressHash: string;
  amount: string;
  standardPaymentReference: string;
  checkSourceAddresses: boolean;
  sourceAddressesRoot: string;
};

export type EVMTransactionRequestBody = {
  transactionHash: string;
  requiredConfirmations: string;
  provideInput: boolean;
  listEvents: boolean;
  logIndices: string[];
};

// Proof data types for each attestation type
export type XRPPaymentProofData = {
  response: {
    attestationType: `0x${string}`;
    sourceId: `0x${string}`;
    votingRound: string;
    lowestUsedTimestamp: string;
    requestBody: {
      transactionId: `0x${string}`;
      proofOwner: `0x${string}`;
    };
    responseBody: {
      blockNumber: string;
      blockTimestamp: string;
      sourceAddress: string;
      sourceAddressHash: `0x${string}`;
      receivingAddressHash: `0x${string}`;
      intendedReceivingAddressHash: `0x${string}`;
      spentAmount: string;
      intendedSpentAmount: string;
      receivedAmount: string;
      intendedReceivedAmount: string;
      hasMemoData: boolean;
      firstMemoData: `0x${string}`;
      hasDestinationTag: boolean;
      destinationTag: string;
      status: number;
    };
  };
  proof: `0x${string}`[];
};

export type ReferencedPaymentNonexistenceProofData = {
  response: {
    attestationType: `0x${string}`;
    sourceId: `0x${string}`;
    votingRound: string;
    lowestUsedTimestamp: string;
    requestBody: {
      minimalBlockNumber: string;
      deadlineBlockNumber: string;
      deadlineTimestamp: string;
      destinationAddressHash: `0x${string}`;
      amount: string;
      standardPaymentReference: `0x${string}`;
      checkSourceAddresses: boolean;
      sourceAddressesRoot: `0x${string}`;
    };
    responseBody: {
      minimalBlockTimestamp: string;
      firstOverflowBlockNumber: string;
      firstOverflowBlockTimestamp: string;
    };
  };
  proof: `0x${string}`[];
};

export type EVMTransactionEvent = {
  logIndex: string | number;
  emitterAddress: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
  removed: boolean;
};

export type EVMTransactionProofData = {
  response: {
    attestationType: `0x${string}`;
    sourceId: `0x${string}`;
    votingRound: string;
    lowestUsedTimestamp: string;
    requestBody: {
      transactionHash: `0x${string}`;
      requiredConfirmations: string | number;
      provideInput: boolean;
      listEvents: boolean;
      logIndices: (string | number)[];
    };
    responseBody: {
      blockNumber: string;
      timestamp: string;
      sourceAddress: `0x${string}`;
      isDeployment: boolean;
      receivingAddress: `0x${string}`;
      value: string;
      input: `0x${string}`;
      status: number;
      events: EVMTransactionEvent[];
    };
  };
  proof: `0x${string}`[];
};

// Sleep utility function
export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

// Post request to DA Layer
export const postRequestToDALayer = async (
  url: string,
  request: Record<string, unknown>,
  apiKey: string
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      `DA Layer request failed: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
};

// Generic function to retrieve data and proof for any attestation type
export const retrieveDataAndProof = async <
  T extends
    | XRPPaymentProofData
    | ReferencedPaymentNonexistenceProofData
    | EVMTransactionProofData,
>(
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<T> => {
  console.log('Waiting for the round to finalize...');

  // Wait for round finalization (simplified - just wait a bit)
  await sleep(30000);
  console.log('Round finalized!\n');

  const request = {
    votingRoundId: roundId,
    requestBytes: abiEncodedRequest,
  };
  console.log('Prepared request:\n', request, '\n');

  await sleep(10000);
  let proof = await postRequestToDALayer(url, request, apiKey);
  console.log('Waiting for the DA Layer to generate the proof...');

  // If we get a successful response with proof data, return immediately
  if (proof.response && proof.proof && Array.isArray(proof.proof)) {
    console.log('Proof generated on first attempt!\n');
    console.log('Proof:', proof, '\n');
    return proof as T;
  }

  // Only retry if we don't have the proof data yet
  while (!proof.response || !proof.proof || !Array.isArray(proof.proof)) {
    await sleep(10000);
    proof = await postRequestToDALayer(url, request, apiKey);

    // If we get a successful response with proof data, break out of the loop
    if (proof.response && proof.proof && Array.isArray(proof.proof)) {
      break;
    }
  }
  console.log('Proof generated!\n');

  console.log('Proof:', proof, '\n');
  return proof as T;
};

// Type-safe wrapper functions for specific attestation types
export const retrieveXRPPaymentDataAndProof = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<XRPPaymentProofData> => {
  return retrieveDataAndProof<XRPPaymentProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey
  );
};

export const retrieveReferencedPaymentNonexistenceDataAndProof = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<ReferencedPaymentNonexistenceProofData> => {
  return retrieveDataAndProof<ReferencedPaymentNonexistenceProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey
  );
};

export const retrieveEVMTransactionDataAndProof = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<EVMTransactionProofData> => {
  return retrieveDataAndProof<EVMTransactionProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey
  );
};

// Generic retry wrapper function
export const retrieveDataAndProofWithRetry = async <
  T extends
    | XRPPaymentProofData
    | ReferencedPaymentNonexistenceProofData
    | EVMTransactionProofData,
>(
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string,
  attempts: number = 10
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await retrieveDataAndProof<T>(
        url,
        abiEncodedRequest,
        roundId,
        apiKey
      );
    } catch (error) {
      console.log(error, '\n', 'Remaining attempts:', attempts - i, '\n');
      await sleep(20000);
    }
  }
  throw new Error(
    `Failed to retrieve data and proofs after ${attempts} attempts`
  );
};

// Type-safe retry wrapper functions for specific attestation types
export const retrieveXRPPaymentDataAndProofWithRetry = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string,
  attempts: number = 10
): Promise<XRPPaymentProofData> => {
  return retrieveDataAndProofWithRetry<XRPPaymentProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey,
    attempts
  );
};

export const retrieveReferencedPaymentNonexistenceDataAndProofWithRetry =
  async (
    url: string,
    abiEncodedRequest: string,
    roundId: number,
    apiKey: string,
    attempts: number = 10
  ): Promise<ReferencedPaymentNonexistenceProofData> => {
    return retrieveDataAndProofWithRetry<ReferencedPaymentNonexistenceProofData>(
      url,
      abiEncodedRequest,
      roundId,
      apiKey,
      attempts
    );
  };

export const retrieveEVMTransactionDataAndProofWithRetry = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string,
  attempts: number = 10
): Promise<EVMTransactionProofData> => {
  return retrieveDataAndProofWithRetry<EVMTransactionProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey,
    attempts
  );
};

// Calculate round ID from transaction
export const calculateRoundId = async (
  transaction: { receipt: { blockNumber: bigint } },
  fdcAddresses: { flareSystemsManager: string }
) => {
  if (!fdcAddresses?.flareSystemsManager) {
    throw new Error('Flare Systems Manager address not loaded');
  }

  const blockNumber = transaction.receipt.blockNumber;
  const block = await publicClient.getBlock({ blockNumber });
  const blockTimestamp = BigInt(block.timestamp);

  const firsVotingRoundStartTs = BigInt(
    await readContract<bigint>({
      address: fdcAddresses.flareSystemsManager as `0x${string}`,
      abi: iFlareSystemsManagerAbi as Abi,
      functionName: 'firstVotingRoundStartTs',
    })
  );

  const votingEpochDurationSeconds = BigInt(
    await readContract<bigint>({
      address: fdcAddresses.flareSystemsManager as `0x${string}`,
      abi: iFlareSystemsManagerAbi as Abi,
      functionName: 'votingEpochDurationSeconds',
    })
  );

  console.log('Block timestamp:', blockTimestamp, '\n');
  console.log('First voting round start ts:', firsVotingRoundStartTs, '\n');
  console.log(
    'Voting epoch duration seconds:',
    votingEpochDurationSeconds,
    '\n'
  );

  const roundId = Number(
    (blockTimestamp - firsVotingRoundStartTs) / votingEpochDurationSeconds
  );
  console.log('Calculated round id:', roundId, '\n');

  const currentVotingEpochId = Number(
    await readContract<bigint>({
      address: fdcAddresses.flareSystemsManager as `0x${string}`,
      abi: iFlareSystemsManagerAbi as Abi,
      functionName: 'getCurrentVotingEpochId',
    })
  );
  console.log('Received round id:', currentVotingEpochId, '\n');

  return roundId;
};

// Get FDC request fee
export const getFdcRequestFee = async (
  abiEncodedRequest: string,
  fdcAddresses: { fdcRequestFeeConfigurations: string }
) => {
  if (!fdcAddresses?.fdcRequestFeeConfigurations) {
    throw new Error('FDC Request Fee Configurations address not loaded');
  }

  return await readContract<bigint>({
    address: fdcAddresses.fdcRequestFeeConfigurations as `0x${string}`,
    abi: iFdcRequestFeeConfigurationsAbi as Abi,
    functionName: 'getRequestFee',
    args: [abiEncodedRequest as `0x${string}`],
  });
};

// FDC constants
export const FDC_CONSTANTS = {
  VERIFIER_URL_TESTNET: 'https://fdc-verifiers-testnet.flare.network/',
  VERIFIER_API_KEY_TESTNET: '00000000-0000-0000-0000-000000000000',
  DA_LAYER_API_KEY: '00000000-0000-0000-0000-000000000000',
  DA_LAYER_API_URL: `/api/proof-request`,
  URL_TYPE_BASE: 'xrp',
  SOURCE_ID_BASE: 'testXRP',
  URL_TYPE_ETH: 'eth',
  SOURCE_ID_ETH: 'testETH',
} as const;

// Base function to prepare attestation request
export const prepareAttestationRequestBase = async (
  url: string,
  apiKey: string,
  attestationTypeBase: string,
  sourceIdBase: string,
  requestBody:
    | XRPPaymentRequestBody
    | ReferencedPaymentNonexistenceRequestBody
    | EVMTransactionRequestBody
) => {
  console.log('Url:', url, '\n');
  const attestationType = toHex(attestationTypeBase);
  const sourceId = toHex(sourceIdBase);

  const request = {
    attestationType: attestationType,
    sourceId: sourceId,
    requestBody: requestBody,
  };
  console.log('Prepared request:\n', request, '\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (response.status != 200) {
    throw new Error(
      `Response status is not OK, status ${response.status} ${response.statusText}\n`
    );
  }
  console.log('Response status is OK\n');

  return await response.json();
};

// Prepare XRPPayment attestation request
export const prepareXRPPaymentAttestationRequest = async (
  transactionId: string,
  proofOwner: string = '0x0000000000000000000000000000000000000000'
) => {
  const requestBody: XRPPaymentRequestBody = {
    transactionId,
    proofOwner,
  };

  const url = `${FDC_CONSTANTS.VERIFIER_URL_TESTNET}verifier/${FDC_CONSTANTS.URL_TYPE_BASE}/XRPPayment/prepareRequest`;
  const apiKey = FDC_CONSTANTS.VERIFIER_API_KEY_TESTNET ?? '';

  return await prepareAttestationRequestBase(
    url,
    apiKey,
    'XRPPayment',
    FDC_CONSTANTS.SOURCE_ID_BASE,
    requestBody
  );
};

// Prepare ReferencedPaymentNonexistence attestation request
export const prepareReferencedPaymentNonexistenceAttestationRequest = async (
  data: ReferencedPaymentNonexistenceRequestBody
) => {
  const requestBody: ReferencedPaymentNonexistenceRequestBody = {
    minimalBlockNumber: data.minimalBlockNumber,
    deadlineBlockNumber: data.deadlineBlockNumber,
    deadlineTimestamp: data.deadlineTimestamp,
    destinationAddressHash: data.destinationAddressHash,
    amount: data.amount,
    standardPaymentReference: data.standardPaymentReference,
    checkSourceAddresses: data.checkSourceAddresses,
    sourceAddressesRoot: data.sourceAddressesRoot,
  };

  const url = `${FDC_CONSTANTS.VERIFIER_URL_TESTNET}verifier/${FDC_CONSTANTS.URL_TYPE_BASE}/ReferencedPaymentNonexistence/prepareRequest`;
  const apiKey = FDC_CONSTANTS.VERIFIER_API_KEY_TESTNET ?? '';

  return await prepareAttestationRequestBase(
    url,
    apiKey,
    'ReferencedPaymentNonexistence',
    FDC_CONSTANTS.SOURCE_ID_BASE,
    requestBody
  );
};

// Prepare EVMTransaction attestation request (Sepolia / testETH)
export const prepareEVMTransactionAttestationRequest = async (
  transactionHash: string,
  opts?: {
    requiredConfirmations?: string;
    provideInput?: boolean;
    listEvents?: boolean;
    logIndices?: string[];
  }
) => {
  const requestBody: EVMTransactionRequestBody = {
    transactionHash,
    requiredConfirmations: opts?.requiredConfirmations ?? '1',
    provideInput: opts?.provideInput ?? true,
    listEvents: opts?.listEvents ?? true,
    logIndices: opts?.logIndices ?? [],
  };

  const url = `${FDC_CONSTANTS.VERIFIER_URL_TESTNET}verifier/${FDC_CONSTANTS.URL_TYPE_ETH}/EVMTransaction/prepareRequest`;
  const apiKey = FDC_CONSTANTS.VERIFIER_API_KEY_TESTNET ?? '';

  return await prepareAttestationRequestBase(
    url,
    apiKey,
    'EVMTransaction',
    FDC_CONSTANTS.SOURCE_ID_ETH,
    requestBody
  );
};

// Verify XRPPayment using FDC Verification contract
export const verifyXRPPayment = async (
  proofData: XRPPaymentProofData,
  fdcAddresses: { fdcVerification: string }
) => {
  if (!fdcAddresses?.fdcVerification) {
    throw new Error('FDC Verification address not loaded');
  }

  if (!proofData.response || !proofData.proof) {
    throw new Error('Proof data is incomplete');
  }

  const response = proofData.response;
  const proof = proofData.proof;

  const result = await readContract<boolean>({
    address: fdcAddresses.fdcVerification as `0x${string}`,
    abi: ixrpPaymentVerificationAbi as Abi,
    functionName: 'verifyXRPPayment',
    args: [
      {
        merkleProof: proof,
        data: {
          attestationType: response.attestationType,
          sourceId: response.sourceId,
          votingRound: BigInt(response.votingRound),
          lowestUsedTimestamp: BigInt(response.lowestUsedTimestamp),
          requestBody: {
            transactionId: response.requestBody.transactionId,
            proofOwner: response.requestBody.proofOwner,
          },
          responseBody: {
            blockNumber: BigInt(response.responseBody.blockNumber),
            blockTimestamp: BigInt(response.responseBody.blockTimestamp),
            sourceAddress: response.responseBody.sourceAddress,
            sourceAddressHash: response.responseBody.sourceAddressHash,
            receivingAddressHash: response.responseBody.receivingAddressHash,
            intendedReceivingAddressHash:
              response.responseBody.intendedReceivingAddressHash,
            spentAmount: BigInt(response.responseBody.spentAmount),
            intendedSpentAmount: BigInt(
              response.responseBody.intendedSpentAmount
            ),
            receivedAmount: BigInt(response.responseBody.receivedAmount),
            intendedReceivedAmount: BigInt(
              response.responseBody.intendedReceivedAmount
            ),
            hasMemoData: response.responseBody.hasMemoData,
            firstMemoData: response.responseBody.firstMemoData,
            hasDestinationTag: response.responseBody.hasDestinationTag,
            destinationTag: BigInt(response.responseBody.destinationTag),
            status: response.responseBody.status,
          },
        },
      },
    ],
  });

  console.log('XRPPayment verification result:', result);
  return result;
};

// Verify ReferencedPaymentNonexistence using FDC Verification contract
export const verifyReferencedPaymentNonexistence = async (
  proofData: ReferencedPaymentNonexistenceProofData,
  fdcAddresses: { fdcVerification: string }
) => {
  if (!fdcAddresses?.fdcVerification) {
    throw new Error('FDC Verification address not loaded');
  }

  if (!proofData.response || !proofData.proof) {
    throw new Error('Proof data is incomplete');
  }

  // Extract data from proof response
  const response = proofData.response;
  const proof = proofData.proof;

  // Call verifyReferencedPaymentNonexistence function
  const result = await readContract<boolean>({
    address: fdcAddresses.fdcVerification as `0x${string}`,
    abi: iReferencedPaymentNonexistenceVerificationAbi as Abi,
    functionName: 'verifyReferencedPaymentNonexistence',
    args: [
      {
        merkleProof: proof,
        data: {
          attestationType: response.attestationType,
          sourceId: response.sourceId,
          votingRound: BigInt(response.votingRound),
          lowestUsedTimestamp: BigInt(response.lowestUsedTimestamp),
          requestBody: {
            minimalBlockNumber: BigInt(response.requestBody.minimalBlockNumber),
            deadlineBlockNumber: BigInt(
              response.requestBody.deadlineBlockNumber
            ),
            deadlineTimestamp: BigInt(response.requestBody.deadlineTimestamp),
            destinationAddressHash: response.requestBody.destinationAddressHash,
            amount: BigInt(response.requestBody.amount),
            standardPaymentReference:
              response.requestBody.standardPaymentReference,
            checkSourceAddresses: response.requestBody.checkSourceAddresses,
            sourceAddressesRoot: response.requestBody.sourceAddressesRoot,
          },
          responseBody: {
            minimalBlockTimestamp: BigInt(
              response.responseBody.minimalBlockTimestamp
            ),
            firstOverflowBlockNumber: BigInt(
              response.responseBody.firstOverflowBlockNumber
            ),
            firstOverflowBlockTimestamp: BigInt(
              response.responseBody.firstOverflowBlockTimestamp
            ),
          },
        },
      },
    ],
  });

  console.log('ReferencedPaymentNonexistence verification result:', result);
  return result;
};

// Verify EVMTransaction using FDC Verification contract
export const verifyEVMTransaction = async (
  proofData: EVMTransactionProofData,
  fdcAddresses: { fdcVerification: string }
) => {
  if (!fdcAddresses?.fdcVerification) {
    throw new Error('FDC Verification address not loaded');
  }

  if (!proofData.response || !proofData.proof) {
    throw new Error('Proof data is incomplete');
  }

  const response = proofData.response;
  const proof = proofData.proof;

  const result = await readContract<boolean>({
    address: fdcAddresses.fdcVerification as `0x${string}`,
    abi: ievmTransactionVerificationAbi as Abi,
    functionName: 'verifyEVMTransaction',
    args: [
      {
        merkleProof: proof,
        data: {
          attestationType: response.attestationType,
          sourceId: response.sourceId,
          votingRound: BigInt(response.votingRound),
          lowestUsedTimestamp: BigInt(response.lowestUsedTimestamp),
          requestBody: {
            transactionHash: response.requestBody.transactionHash,
            requiredConfirmations: Number(
              response.requestBody.requiredConfirmations
            ),
            provideInput: response.requestBody.provideInput,
            listEvents: response.requestBody.listEvents,
            logIndices: response.requestBody.logIndices.map(i => Number(i)),
          },
          responseBody: {
            blockNumber: BigInt(response.responseBody.blockNumber),
            timestamp: BigInt(response.responseBody.timestamp),
            sourceAddress: response.responseBody.sourceAddress,
            isDeployment: response.responseBody.isDeployment,
            receivingAddress: response.responseBody.receivingAddress,
            value: BigInt(response.responseBody.value),
            input: response.responseBody.input,
            status: response.responseBody.status,
            events: (response.responseBody.events ?? []).map(event => ({
              logIndex: Number(event.logIndex),
              emitterAddress: event.emitterAddress,
              topics: event.topics,
              data: event.data,
              removed: event.removed,
            })),
          },
        },
      },
    ],
  });

  console.log('EVMTransaction verification result:', result);
  return result;
};

// Submit attestation request to FDC Hub
export const submitAttestationRequest = async (
  abiEncodedRequest: string,
  fdcAddresses: { fdcHub: string; fdcRequestFeeConfigurations: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestAttestation: any
): Promise<void> => {
  if (!fdcAddresses?.fdcHub) {
    throw new Error('FDC Hub address not loaded');
  }

  console.log('Submitting attestation request:', abiEncodedRequest);

  // Get the request fee
  const requestFee = await getFdcRequestFee(abiEncodedRequest, fdcAddresses);
  console.log('Request fee:', requestFee);

  // Submit the attestation request
  requestAttestation({
    address: fdcAddresses.fdcHub as `0x${string}`,
    functionName: 'requestAttestation',
    args: [abiEncodedRequest as `0x${string}`],
    value: requestFee,
  });
};
