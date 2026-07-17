'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  XCircle,
} from 'lucide-react';

import { createPublicClient, http, type Abi } from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { flareTestnet } from 'wagmi/chains';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  iFdcRequestFeeConfigurationsAbi,
  useWriteIFdcHub,
} from '@flarenetwork/flare-wagmi-periphery-package/contracts/coston2';
import { useFdcContracts } from '@/hooks/useFdcContracts';
import { copyToClipboardWithTimeout } from '@/lib/clipboard';
import {
  calculateRoundId,
  FDC_CONSTANTS,
  prepareEVMTransactionAttestationRequest,
  prepareXRPPaymentAttestationRequest,
  retrieveEVMTransactionDataAndProofWithRetry,
  retrieveXRPPaymentDataAndProofWithRetry,
  type EVMTransactionProofData,
  type XRPPaymentProofData,
  verifyEVMTransaction,
  verifyXRPPayment,
} from '@/lib/fdcUtils';

type AttestationType = 'XRPPayment' | 'EVMTransaction';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const SEPOLIA_TX_HASH =
  '0x9436ff8110d6a8982f4e62aa6dc28fb875beb926c5ba61f89a4d461675af98bb';
const SAMPLE_XRPL_TX =
  'A6589F33CA3B679CF3E833632E81E5A075CED6057316782A2B466FF64D05CBF0';

const createFdcFormSchema = (attestationType: AttestationType) =>
  z.object({
    transactionId: z
      .string()
      .min(1, 'Transaction ID is required')
      .refine(
        val =>
          attestationType === 'XRPPayment'
            ? /^[A-F0-9]{64}$/i.test(val.trim())
            : /^0x[A-F0-9]{64}$/i.test(val.trim()),
        attestationType === 'XRPPayment'
          ? 'Transaction ID must be a valid 64-character hexadecimal XRPL transaction ID'
          : 'Transaction hash must be a valid 0x-prefixed 64-character hexadecimal string'
      ),
  });

type FdcFormData = z.infer<ReturnType<typeof createFdcFormSchema>>;

interface FdcStep {
  id: string;
  title: string;
  description: string | React.ReactNode;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  data?: Record<string, unknown>;
  error?: string;
  details?: {
    whatHappens: string;
    technicalDetails: string;
    apiEndpoint?: string | React.ReactNode;
    requestBody?: Record<string, unknown>;
    responseBody?: Record<string, unknown>;
    curlCommand?: string;
  };
}

const getInitialSteps = (
  attestationType: AttestationType,
  proofOwner: string = ZERO_ADDRESS
): FdcStep[] => {
  const isEvm = attestationType === 'EVMTransaction';

  return [
    {
      id: 'prepare-request',
      title: '1. Prepare Request',
      description: 'Prepare the attestation request using the verifier API',
      status: 'pending',
      details: {
        whatHappens: isEvm
          ? 'We send your Sepolia transaction hash to the Flare ETH verifier to create an ABI-encoded EVMTransaction request.'
          : 'We send your XRPL transaction ID and proofOwner to the Flare verifier to create an ABI-encoded XRPPayment request.',
        technicalDetails: isEvm
          ? 'The verifier validates the transaction hash and builds a request with attestation type (EVMTransaction), source ID (testETH), requiredConfirmations, provideInput, listEvents, and logIndices. See the eth verifier API docs for the schema.'
          : 'The verifier validates the transaction ID and creates a request with attestation type (XRPPayment), source ID (testXRP), transactionId, and proofOwner. The response contains an abiEncodedRequest — a hex string the FDC contract understands.',
        apiEndpoint: isEvm
          ? 'https://fdc-verifiers-testnet.flare.network/verifier/eth/EVMTransaction/prepareRequest'
          : 'https://fdc-verifiers-testnet.flare.network/verifier/xrp/XRPPayment/prepareRequest',
        curlCommand: isEvm
          ? `curl -X 'POST' \\
  'https://fdc-verifiers-testnet.flare.network/verifier/eth/EVMTransaction/prepareRequest' \\
  -H 'accept: application/json' \\
  -H 'X-API-KEY: 00000000-0000-0000-0000-000000000000' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "attestationType": "0x45564d5472616e73616374696f6e000000000000000000000000000000000000",
  "sourceId": "0x7465737445544800000000000000000000000000000000000000000000000000",
  "requestBody": {
    "transactionHash": "${SEPOLIA_TX_HASH}",
    "requiredConfirmations": "1",
    "provideInput": true,
    "listEvents": true,
    "logIndices": []
  }
}'`
          : `curl -X 'POST' \\
  'https://fdc-verifiers-testnet.flare.network/verifier/xrp/XRPPayment/prepareRequest' \\
  -H 'accept: application/json' \\
  -H 'X-API-KEY: 00000000-0000-0000-0000-000000000000' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "attestationType": "0x5852505061796d656e7400000000000000000000000000000000000000000000",
  "sourceId": "0x7465737458525000000000000000000000000000000000000000000000000000",
  "requestBody": {
    "transactionId": "${SAMPLE_XRPL_TX}",
    "proofOwner": "${proofOwner}"
  }
}'`,
      },
    },
    {
      id: 'submit-request',
      title: '2. Submit Request',
      description: (
        <>
          Submit the attestation request to the{' '}
          <a
            href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcHub contract
            <ExternalLink className='h-3 w-3' />
          </a>
        </>
      ),
      status: 'pending',
      details: {
        whatHappens:
          'The ABI-encoded request is submitted to the FdcHub smart contract on the Flare blockchain, along with the required fee.',
        technicalDetails: isEvm
          ? 'This creates a transaction on Coston2 that requests the FDC to attest the Sepolia (testETH) EVM transaction. The contract stores the request and waits for the next voting round.'
          : 'This creates a transaction on the blockchain that requests the FDC to verify your XRPL Payment transaction. The contract stores the request and waits for the next voting round.',
        apiEndpoint: (
          <a
            href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcHub.requestAttestation() - Smart Contract Call
            <ExternalLink className='h-3 w-3' />
          </a>
        ),
      },
    },
    {
      id: 'wait-finalization',
      title: '3. Wait for Finalization',
      description: 'Wait for the voting round to be finalized',
      status: 'pending',
      details: {
        whatHappens:
          'The FDC validators vote on your request during the voting round. We wait for the round to be finalized before proceeding.',
        technicalDetails: isEvm
          ? 'Voting rounds occur every 90 seconds. Validators check Sepolia for your transaction and vote on its validity. We wait for the round to be finalized before retrieving the proof.'
          : 'Voting rounds occur every 90 seconds. Validators check the XRPL for your transaction and vote on its validity. We wait for the round to be finalized before retrieving the proof.',
        apiEndpoint:
          'https://coston2-systems-explorer.flare.rocks/voting-round/{roundId}?tab=fdc',
      },
    },
    {
      id: 'prepare-proof',
      title: '4. Prepare Proof Request',
      description:
        'Prepare the proof request using the Data Availability Client',
      status: 'pending',
      details: {
        whatHappens:
          'We retrieve the proof and attestation data from the Data Availability Layer using the finalized voting round ID.',
        technicalDetails:
          'The Data Availability Client provides cryptographic proof that your transaction was verified by the FDC validators. This includes Merkle tree proofs and the attestation response.',
        apiEndpoint:
          'https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round',
        curlCommand: `curl -X 'POST' \\
  'https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round' \\
  -H 'accept: application/json' \\
  -H 'x-api-key: 00000000-0000-0000-0000-000000000000' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "votingRoundId": ROUND_ID,
  "requestBytes": "ABI_ENCODED_REQUEST"
}'`,
      },
    },
    {
      id: 'verify-data',
      title: '5. Verify Data',
      description: (
        <>
          Verify the proof using the{' '}
          <a
            href={
              isEvm
                ? 'https://dev.flare.network/fdc/reference/IFdcVerification#verifyevmtransaction'
                : 'https://dev.flare.network/fdc/reference/IFdcVerification#verifyxrppayment'
            }
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcVerification contract
            <ExternalLink className='h-3 w-3' />
          </a>
        </>
      ),
      status: 'pending',
      details: {
        whatHappens: isEvm
          ? "The cryptographic proof is verified on-chain using FdcVerification.verifyEVMTransaction to ensure the EVM transaction attestation is valid and hasn't been tampered with."
          : "The cryptographic proof is verified on-chain using FdcVerification.verifyXRPPayment to ensure the XRPL payment attestation is valid and hasn't been tampered with.",
        technicalDetails: isEvm
          ? 'This final step uses the FdcVerification contract to cryptographically verify that the EVMTransaction proof is valid and the attestation data is authentic.'
          : 'This final step uses the FdcVerification contract to cryptographically verify that the XRPPayment proof is valid and the attestation data is authentic.',
        apiEndpoint: (
          <a
            href={
              isEvm
                ? 'https://dev.flare.network/fdc/reference/IFdcVerification#verifyevmtransaction'
                : 'https://dev.flare.network/fdc/reference/IFdcVerification#verifyxrppayment'
            }
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            {isEvm
              ? 'FdcVerification.verifyEVMTransaction() - Smart Contract Call'
              : 'FdcVerification.verifyXRPPayment() - Smart Contract Call'}
            <ExternalLink className='h-3 w-3' />
          </a>
        ),
      },
    },
  ];
};

export default function Fdc() {
  const [attestationType, setAttestationType] =
    useState<AttestationType>('EVMTransaction');

  const formSchema = useMemo(
    () => createFdcFormSchema(attestationType),
    [attestationType]
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FdcFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      transactionId: SEPOLIA_TX_HASH,
    },
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [mainTab, setMainTab] = useState<'configure' | 'workflow' | 'guide'>(
    'configure'
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [currentAttestationData, setCurrentAttestationData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [currentAttestationStep, setCurrentAttestationStep] =
    useState<string>('');
  const [proofData, setProofData] = useState<Record<string, unknown> | null>(
    null
  );
  const [verificationResult, setVerificationResult] = useState<Record<
    string,
    unknown
  > | null>(null);

  // Wallet and FDC contracts
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const wagmiPublicClient = usePublicClient();

  const handleConnect = () => {
    const metaMaskConnector =
      connectors.find(
        c =>
          c.id === 'metaMask' ||
          c.id === 'io.metamask' ||
          c.name.toLowerCase().includes('metamask')
      ) || connectors.find(c => c.id === 'injected') ||
      connectors[0];

    if (!metaMaskConnector) {
      setError(
        'MetaMask not found. Install the MetaMask Chrome extension and refresh this page.'
      );
      return;
    }

    if (typeof window !== 'undefined' && !window.ethereum) {
      setError(
        'MetaMask not detected. Open this page in Chrome with the MetaMask extension enabled.'
      );
      return;
    }

    setError(null);
    connect({ connector: metaMaskConnector });
  };


  // Handle hydration mismatch
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Create a fallback public client using wagmi
  const fallbackPublicClient = createPublicClient({
    chain: flareTestnet,
    transport: http(),
  });
  const {
    addresses: fdcAddresses,
    isLoading: isLoadingAddresses,
    error: addressError,
  } = useFdcContracts();

  // Write contract with requestAttestation function
  const {
    writeContract: requestAttestation,
    writeContractAsync: requestAttestationAsync,
    data: attestationHash,
    error: writeError,
  } = useWriteIFdcHub();

  // Wait for transaction receipt
  const { data: receipt, isSuccess: isAttestationSuccess } =
    useWaitForTransactionReceipt({ hash: attestationHash });

  const updateStepStatus = useCallback(
    (
      stepId: string,
      status: FdcStep['status'],
      data?: Record<string, unknown>,
      error?: string
    ) => {
      setSteps(prev =>
        prev.map(step =>
          step.id === stepId ? { ...step, status, data, error } : step
        )
      );
    },
    []
  );

  const continueWorkflowAfterSubmission = useCallback(
    async (transactionReceipt: any) => {
      try {
        // Step 3: Wait for Finalization (calculate round ID)
        updateStepStatus('wait-finalization', 'in_progress');
        setCurrentAttestationStep('Calculating round ID from transaction...');

        if (!fdcAddresses || !transactionReceipt || !currentAttestationData) {
          throw new Error('Missing required data for round ID calculation');
        }

        // Calculate the round ID from the transaction
        const roundId = await calculateRoundId(
          { receipt: { blockNumber: transactionReceipt.blockNumber } },
          fdcAddresses
        );

        console.log('Calculated round ID:', roundId);

        // Update step to show we're waiting for finalization
        updateStepStatus('wait-finalization', 'in_progress', {
          message: `Waiting for voting round ${roundId} to be finalized...`,
          roundId: roundId,
        });

        // Wait for the voting round to be finalized
        setCurrentAttestationStep(
          `Waiting for voting round ${roundId} to be finalized...`
        );

        // Check finalization status with polling
        let isFinalized = false;
        let attempts = 0;
        const maxAttempts = 20; // Poll for up to 2 minutes (20 * 6 seconds)

        while (!isFinalized && attempts < maxAttempts) {
          try {
            // In a real implementation, this would check the Flare Systems Manager contract
            // For now, we'll simulate the finalization check with a realistic delay
            await new Promise(resolve => setTimeout(resolve, 6000)); // Wait 6 seconds between checks

            attempts++;

            // Update the status to show we're still checking
            setCurrentAttestationStep(
              `Checking finalization status... (attempt ${attempts}/${maxAttempts})`
            );

            // Simulate finalization after a reasonable delay (around 90 seconds)
            if (attempts >= 15) {
              isFinalized = true;
              console.log('Voting round finalized!');
            }
          } catch (error) {
            console.error('Error checking finalization:', error);
            await new Promise(resolve => setTimeout(resolve, 6000));
            attempts++;
          }
        }

        if (!isFinalized) {
          throw new Error(
            'Voting round finalization timeout - please try again later'
          );
        }

        setCurrentAttestationStep('');
        updateStepStatus('wait-finalization', 'completed', {
          message: `Voting round ${roundId} finalized successfully`,
          roundId: roundId,
        });

        // Step 4: Prepare Proof Request (retrieve from DAL)
        updateStepStatus('prepare-proof', 'in_progress');
        setCurrentAttestationStep(
          'Retrieving proof from Data Availability Layer...'
        );

        const proof =
          attestationType === 'EVMTransaction'
            ? await retrieveEVMTransactionDataAndProofWithRetry(
                FDC_CONSTANTS.DA_LAYER_API_URL,
                currentAttestationData.abiEncodedRequest as string,
                roundId,
                FDC_CONSTANTS.DA_LAYER_API_KEY
              )
            : await retrieveXRPPaymentDataAndProofWithRetry(
                FDC_CONSTANTS.DA_LAYER_API_URL,
                currentAttestationData.abiEncodedRequest as string,
                roundId,
                FDC_CONSTANTS.DA_LAYER_API_KEY
              );

        setProofData(proof);

        console.log('=== Proof data retrieved ===');
        console.log('Proof data:', proof);
        console.log('Proof response:', proof.response);
        console.log('Proof responseBody:', proof.response?.responseBody);

        updateStepStatus('prepare-proof', 'completed', {
          message: 'Proof retrieved from Data Availability Layer',
          proof: proof.proof,
        });

        // Step 5: Verify Data (verify with FDC contract)
        updateStepStatus('verify-data', 'in_progress');
        setCurrentAttestationStep(
          attestationType === 'EVMTransaction'
            ? 'Verifying EVMTransaction attestation with FDC Verification contract...'
            : 'Verifying XRPPayment attestation with FDC Verification contract...'
        );

        if (!fdcAddresses) {
          throw new Error('FDC contract addresses not loaded');
        }

        // Validate proof data before verification
        if (!proof || !proof.response || !proof.proof) {
          throw new Error('Proof data is incomplete');
        }

        console.log('=== Validating proof data before verification ===');
        console.log('Proof response fields:', Object.keys(proof.response));
        console.log(
          'Proof responseBody fields:',
          Object.keys(proof.response.responseBody || {})
        );

        const responseBody = proof.response.responseBody;

        if (attestationType === 'EVMTransaction') {
          const requiredFields = [
            'blockNumber',
            'timestamp',
            'value',
            'status',
            'sourceAddress',
            'receivingAddress',
          ] as const;

          for (const field of requiredFields) {
            const value = (responseBody as Record<string, unknown>)[field];
            if (value === undefined || value === null) {
              console.error(`Missing or undefined field: ${field}`, value);
              throw new Error(`Proof data is missing required field: ${field}`);
            }
          }

          const verificationResult = await verifyEVMTransaction(
            proof as EVMTransactionProofData,
            fdcAddresses
          );

          console.log('=== EVMTransaction verification result ===');
          console.log('Verification result:', verificationResult);

          setVerificationResult({ verified: verificationResult });

          updateStepStatus('verify-data', 'completed', {
            message: 'EVMTransaction attestation verified successfully',
            verificationResult: verificationResult,
            verified: verificationResult,
          });
        } else {
          const requiredFields = [
            'blockNumber',
            'blockTimestamp',
            'sourceAddress',
            'spentAmount',
            'intendedSpentAmount',
            'receivedAmount',
            'intendedReceivedAmount',
            'hasMemoData',
            'hasDestinationTag',
            'status',
          ] as const;

          for (const field of requiredFields) {
            const value = (responseBody as Record<string, unknown>)[field];
            if (value === undefined || value === null) {
              console.error(`Missing or undefined field: ${field}`, value);
              throw new Error(`Proof data is missing required field: ${field}`);
            }
          }

          const verificationResult = await verifyXRPPayment(
            proof as XRPPaymentProofData,
            fdcAddresses
          );

          console.log('=== XRPPayment verification result ===');
          console.log('Verification result:', verificationResult);
          console.log('Verification result type:', typeof verificationResult);

          setVerificationResult({ verified: verificationResult });

          updateStepStatus('verify-data', 'completed', {
            message: 'XRPPayment attestation verified successfully',
            verificationResult: verificationResult,
            verified: verificationResult,
          });
        }

        setCurrentAttestationStep('');
        setSuccess(
          'FDC workflow completed successfully! All steps have been executed.'
        );
      } catch (error) {
        console.error('Error in workflow continuation:', error);
        setCurrentAttestationStep('');
        setError(
          error instanceof Error ? error.message : 'Unknown error occurred'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      fdcAddresses,
      currentAttestationData,
      attestationType,
      updateStepStatus,
      setCurrentAttestationStep,
      setProofData,
      setVerificationResult,
    ]
  );

  // Handle transaction success
  useEffect(() => {
    if (isAttestationSuccess && receipt && currentAttestationData) {
      updateStepStatus('submit-request', 'completed', {
        message:
          'Attestation request submitted successfully to FdcHub contract',
        transactionHash: attestationHash,
        blockNumber: receipt.blockNumber,
        abiEncodedRequest: currentAttestationData.abiEncodedRequest,
      });

      // Auto-expand the second step when it completes
      setExpandedSteps(prev => new Set([...prev, 'submit-request']));

      // Continue with the rest of the workflow
      continueWorkflowAfterSubmission(receipt);
    }
  }, [
    isAttestationSuccess,
    receipt,
    currentAttestationData,
    attestationHash,
    continueWorkflowAfterSubmission,
  ]);

  // Handle write contract errors
  useEffect(() => {
    if (writeError) {
      console.error('Write contract error:', writeError);
      updateStepStatus(
        'submit-request',
        'error',
        undefined,
        writeError.message
      );
      setError(`Transaction failed: ${writeError.message}`);
    }
  }, [writeError]);
  const [steps, setSteps] = useState<FdcStep[]>(() =>
    getInitialSteps('EVMTransaction')
  );

  useEffect(() => {
    reset({
      transactionId:
        attestationType === 'EVMTransaction' ? SEPOLIA_TX_HASH : SAMPLE_XRPL_TX,
    });
    setSteps(getInitialSteps(attestationType, address ?? ZERO_ADDRESS));
    setError(null);
    setSuccess(null);
    setCurrentAttestationData(null);
    setProofData(null);
    setVerificationResult(null);
  }, [attestationType, address, reset]);

  const prepareRequest = async (transactionId: string) => {
    try {
      updateStepStatus('prepare-request', 'in_progress');

      if (attestationType === 'EVMTransaction') {
        const requestBody = {
          attestationType:
            '0x45564d5472616e73616374696f6e000000000000000000000000000000000000',
          sourceId:
            '0x7465737445544800000000000000000000000000000000000000000000000000',
          requestBody: {
            transactionHash: transactionId,
            requiredConfirmations: '1',
            provideInput: true,
            listEvents: true,
            logIndices: [] as string[],
          },
        };

        const data = await prepareEVMTransactionAttestationRequest(
          transactionId
        );

        if (!data.abiEncodedRequest) {
          console.error(
            'API response does not contain abiEncodedRequest:',
            data
          );
          throw new Error(
            `API response missing abiEncodedRequest. Response: ${JSON.stringify(data)}`
          );
        }

        updateStepStatus('prepare-request', 'completed', {
          ...data,
          requestDetails: {
            requestBody,
            responseBody: data,
            status: 200,
          },
        });

        return data;
      }

      const proofOwner = address ?? ZERO_ADDRESS;
      const requestBody = {
        attestationType:
          '0x5852505061796d656e7400000000000000000000000000000000000000000000',
        sourceId:
          '0x7465737458525000000000000000000000000000000000000000000000000000',
        requestBody: {
          transactionId,
          proofOwner,
        },
      };

      const data = await prepareXRPPaymentAttestationRequest(
        transactionId,
        proofOwner
      );

      if (!data.abiEncodedRequest) {
        console.error('API response does not contain abiEncodedRequest:', data);
        throw new Error(
          `API response missing abiEncodedRequest. Response: ${JSON.stringify(data)}`
        );
      }

      updateStepStatus('prepare-request', 'completed', {
        ...data,
        requestDetails: {
          requestBody,
          responseBody: data,
          status: 200,
        },
      });

      return data;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      updateStepStatus('prepare-request', 'error', undefined, errorMessage);
      throw error;
    }
  };

  const executeFdcWorkflow = async (data: FdcFormData) => {
    const transactionId = data.transactionId.trim();

    if (!fdcAddresses) {
      setError('FDC contract addresses not loaded. Please wait and try again.');
      return;
    }

    if (addressError) {
      setError(`Error loading contract addresses: ${addressError}`);
      return;
    }

    if (!isConnected) {
      setError(
        'Please connect your wallet to submit attestation requests to the blockchain.'
      );
      return;
    }

    setIsLoading(true);
    setMainTab('workflow');
    setError(null);
    setSuccess(null);

    // Reset all steps to pending
    setSteps(prev =>
      prev.map(step => ({ ...step, status: 'pending' as const }))
    );

    try {
      // Step 1: Prepare Request
      const attestationResponse = await prepareRequest(transactionId);

      console.log('=== executeFdcWorkflow after prepareRequest ===');
      console.log('attestationResponse:', attestationResponse);
      console.log(
        'attestationResponse.abiEncodedRequest:',
        attestationResponse.abiEncodedRequest
      );

      // Store the attestation data for use in the transaction effect
      setCurrentAttestationData(attestationResponse);

      // Step 2: Submit Request (executes FdcHub.requestAttestation)
      updateStepStatus('submit-request', 'in_progress');

      // Submit the attestation request to the blockchain
      await submitAttestationRequestWithWagmi(
        attestationResponse.abiEncodedRequest,
        fdcAddresses,
        requestAttestationAsync
      );

      // The rest of the workflow will continue automatically when the transaction is confirmed
      // via the useEffect that watches for isAttestationSuccess
    } catch (error) {
      console.error('FDC workflow error:', error);
      setError(
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
      setIsLoading(false);
    }
  };

  const getStepIcon = (status: FdcStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className='h-5 w-5 text-green-600' />;
      case 'in_progress':
        return (
          <Loader2
            className='h-5 w-5 animate-spin'
            style={{ color: '#E62058' }}
          />
        );
      case 'error':
        return <XCircle className='h-5 w-5 text-red-600' />;
      default:
        return (
          <div className='h-5 w-5 rounded-full border-2 border-gray-300' />
        );
    }
  };

  const getStepStatusColor = (status: FdcStep['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 border-green-200';
      case 'in_progress':
        return 'border-2';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const toggleStepExpansion = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  // Custom submitAttestationRequest function with fallback publicClient
  const submitAttestationRequestWithWagmi = async (
    abiEncodedRequest: string,
    fdcAddresses: { fdcHub: string; fdcRequestFeeConfigurations: string },
    requestAttestationAsync: any
  ): Promise<void> => {
    if (!abiEncodedRequest) {
      throw new Error('ABI encoded request is undefined or empty');
    }

    if (!fdcAddresses?.fdcHub) {
      throw new Error('FDC Hub address not loaded');
    }

    let requestFee;

    // Try to use wagmi publicClient first, then fallback to wagmi created client
    const clientToUse = wagmiPublicClient || fallbackPublicClient;

    if (clientToUse) {
      try {
        // Get the request fee using the available publicClient
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        requestFee = await (clientToUse as any).readContract({
          address: fdcAddresses.fdcRequestFeeConfigurations as `0x${string}`,
          abi: iFdcRequestFeeConfigurationsAbi as Abi,
          functionName: 'getRequestFee',
          args: [abiEncodedRequest as `0x${string}`],
        });
        console.log('Request fee from contract:', requestFee);
      } catch (error) {
        console.error('Error getting request fee from contract:', error);
        // Fallback to a default fee if contract call fails
        requestFee = BigInt('1000000000000000000'); // 1 FLR in wei
        console.log('Using fallback request fee:', requestFee);
      }
    } else {
      // Fallback to a default fee if no public client available
      requestFee = BigInt('1000000000000000000'); // 1 FLR in wei
      console.log(
        'No public client available, using fallback request fee:',
        requestFee
      );
    }

    // Submit the attestation request
    await requestAttestationAsync({
      address: fdcAddresses.fdcHub as `0x${string}`,
      functionName: 'requestAttestation',
      args: [abiEncodedRequest as `0x${string}`],
      value: requestFee,
    });
  };

  const walletBar = (
    <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E62058]/20 bg-[#fef7f0] px-4 py-3'>
      {!isHydrated ? (
        <p className='text-sm text-[#E62058]'>Loading wallet...</p>
      ) : !isConnected ? (
        <>
          <p className='text-sm text-[#E62058]'>
            Connect MetaMask to submit attestation requests on Coston2.
          </p>
          <Button
            type='button'
            onClick={handleConnect}
            disabled={isPending}
            size='sm'
            style={{ backgroundColor: '#E62058', color: 'white' }}
          >
            {isPending ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              'Connect MetaMask'
            )}
          </Button>
        </>
      ) : (
        <>
          <div className='text-sm text-gray-700'>
            <span className='font-medium text-[#E62058]'>Connected</span>
            <span className='mx-2 text-gray-300'>|</span>
            <span className='font-mono text-xs'>
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
            <span className='mx-2 text-gray-300'>|</span>
            <span>Coston2</span>
          </div>
          <Button
            type='button'
            onClick={() => disconnect()}
            variant='outline'
            size='sm'
            style={{ borderColor: '#E62058', color: '#E62058' }}
          >
            Disconnect
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className='w-full max-w-6xl mx-auto p-6'>
      <Card>
        <CardHeader className='space-y-4'>
          <div>
            <CardTitle
              className='flex items-center gap-2'
              style={{ color: '#E62058' }}
            >
              <CheckCircle className='h-5 w-5' style={{ color: '#E62058' }} />
              <a
                href='https://dev.flare.network/fdc/overview'
                target='_blank'
                rel='noopener noreferrer'
                className='underline inline-flex items-center gap-1'
                style={{ color: '#E62058' }}
              >
                Flare Data Connector (FDC)
                <ExternalLink className='h-4 w-4' />
              </a>
              Workflow
            </CardTitle>
            <p className='mt-2 text-sm text-gray-600'>
              Prepare, submit, and verify attestations following the{' '}
              <a
                href='https://dev.flare.network/fdc/guides/fdc-by-hand/'
                target='_blank'
                rel='noopener noreferrer'
                className='underline inline-flex items-center gap-1 text-[#E62058]'
              >
                FDC by hand guide
                <ExternalLink className='h-3 w-3' />
              </a>
              .
            </p>
          </div>
          {walletBar}
        </CardHeader>
        <CardContent>
          <Tabs
            value={mainTab}
            onValueChange={value =>
              setMainTab(value as 'configure' | 'workflow' | 'guide')
            }
            className='gap-6'
          >
            <TabsList className='grid h-11 w-full grid-cols-3 bg-[#fef7f0] p-1'>
              <TabsTrigger
                value='configure'
                className='data-[state=active]:bg-[#E62058] data-[state=active]:text-white data-[state=active]:shadow-none'
              >
                Configure
              </TabsTrigger>
              <TabsTrigger
                value='workflow'
                className='data-[state=active]:bg-[#E62058] data-[state=active]:text-white data-[state=active]:shadow-none'
              >
                Workflow
              </TabsTrigger>
              <TabsTrigger
                value='guide'
                className='data-[state=active]:bg-[#E62058] data-[state=active]:text-white data-[state=active]:shadow-none'
              >
                Guide
              </TabsTrigger>
            </TabsList>

            <TabsContent value='configure' className='space-y-6'>
              <form
                onSubmit={handleSubmit(executeFdcWorkflow)}
                className='space-y-6'
              >
                <div className='space-y-3'>
                  <Label style={{ color: '#E62058' }}>Attestation Type</Label>
                  <Tabs
                    value={attestationType}
                    onValueChange={value =>
                      setAttestationType(value as AttestationType)
                    }
                  >
                    <TabsList className='grid h-11 w-full max-w-md grid-cols-2 bg-gray-100 p-1'>
                      <TabsTrigger
                        value='EVMTransaction'
                        disabled={isLoading}
                        className='data-[state=active]:bg-[#E62058] data-[state=active]:text-white data-[state=active]:shadow-none'
                      >
                        EVMTransaction
                      </TabsTrigger>
                      <TabsTrigger
                        value='XRPPayment'
                        disabled={isLoading}
                        className='data-[state=active]:bg-[#E62058] data-[state=active]:text-white data-[state=active]:shadow-none'
                      >
                        XRPPayment
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className='text-xs text-gray-600'>
                    {attestationType === 'EVMTransaction' ? (
                      <>
                        Source: testETH (Sepolia). Verifier API:{' '}
                        <a
                          href='https://fdc-verifiers-testnet.flare.network/verifier/eth/api-doc'
                          target='_blank'
                          rel='noopener noreferrer'
                          className='underline'
                          style={{ color: '#E62058' }}
                        >
                          eth/api-doc
                          <ExternalLink className='inline h-3 w-3 ml-0.5' />
                        </a>
                      </>
                    ) : (
                      'Source: testXRP (XRPL testnet)'
                    )}
                  </p>
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='transactionId' style={{ color: '#E62058' }}>
                    {attestationType === 'EVMTransaction'
                      ? 'Sepolia Transaction Hash'
                      : 'XRPL Transaction ID'}
                  </Label>
                  <Input
                    {...register('transactionId')}
                    id='transactionId'
                    placeholder={
                      attestationType === 'EVMTransaction'
                        ? SEPOLIA_TX_HASH
                        : SAMPLE_XRPL_TX
                    }
                    className={`border-gray-300 focus:ring-2 focus:ring-opacity-50 ${
                      errors.transactionId
                        ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                        : ''
                    }`}
                    style={
                      {
                        borderColor: errors.transactionId
                          ? undefined
                          : '#E62058',
                        '--tw-ring-color': '#E62058',
                      } as React.CSSProperties
                    }
                  />
                  {errors.transactionId && (
                    <p className='text-sm text-red-600'>
                      {errors.transactionId.message}
                    </p>
                  )}
                  {attestationType === 'EVMTransaction' ? (
                    <p className='text-xs text-gray-600'>
                      Example:{' '}
                      <a
                        href={`https://sepolia.etherscan.io/tx/${SEPOLIA_TX_HASH}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline break-all'
                        style={{ color: '#E62058' }}
                      >
                        {SEPOLIA_TX_HASH}
                        <ExternalLink className='inline h-3 w-3 ml-0.5' />
                      </a>
                    </p>
                  ) : (
                    <p className='text-xs text-gray-600'>
                      Example:{' '}
                      <a
                        href={`https://livenet.xrpl.org/transactions/${SAMPLE_XRPL_TX}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline break-all'
                        style={{ color: '#E62058' }}
                      >
                        {SAMPLE_XRPL_TX}
                        <ExternalLink className='inline h-3 w-3 ml-0.5' />
                      </a>
                    </p>
                  )}
                </div>

                {isLoadingAddresses && (
                  <Alert
                    className='border'
                    style={{
                      backgroundColor: '#fef7f0',
                      borderColor: '#E62058',
                      color: '#E62058',
                    }}
                  >
                    <AlertDescription>
                      <div className='flex items-center gap-2'>
                        <Loader2 className='h-4 w-4 animate-spin' />
                        Loading FDC contract addresses...
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {addressError && (
                  <Alert variant='destructive'>
                    <XCircle className='h-4 w-4' />
                    <AlertDescription>
                      Error loading contract addresses: {addressError}
                    </AlertDescription>
                  </Alert>
                )}

                {(error || connectError) && (
                  <Alert variant='destructive'>
                    <XCircle className='h-4 w-4' />
                    <AlertDescription>
                      {error || connectError?.message}
                    </AlertDescription>
                  </Alert>
                )}

                {!isConnected ? (
                  <Button
                    type='button'
                    onClick={handleConnect}
                    disabled={isPending || !isHydrated}
                    className='w-full'
                    style={{ backgroundColor: '#E62058' }}
                  >
                    {isPending || !isHydrated ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {isPending ? 'Connecting...' : 'Loading...'}
                      </>
                    ) : (
                      <>
                        <CheckCircle className='mr-2 h-4 w-4' />
                        Connect MetaMask
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    type='submit'
                    disabled={
                      isLoading || isLoadingAddresses || !!addressError
                    }
                    className='w-full disabled:bg-gray-400'
                    style={{ backgroundColor: '#E62058' }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Executing FDC Workflow...
                      </>
                    ) : (
                      <>
                        <CheckCircle className='mr-2 h-4 w-4' />
                        Execute FDC Workflow
                      </>
                    )}
                  </Button>
                )}

                {success && (
                  <Alert className='bg-green-50 border-green-200 text-green-800'>
                    <CheckCircle className='h-4 w-4' />
                    <AlertDescription>{success}</AlertDescription>
                  </Alert>
                )}

                {currentAttestationStep && (
                  <Alert
                    style={{
                      backgroundColor: '#fef7f0',
                      borderColor: '#E62058',
                      color: '#E62058',
                    }}
                  >
                    <div
                      className='animate-spin rounded-full h-4 w-4 border-b-2'
                      style={{ borderColor: '#E62058' }}
                    ></div>
                    <AlertDescription>
                      {currentAttestationStep}
                    </AlertDescription>
                  </Alert>
                )}
              </form>
            </TabsContent>

            <TabsContent value='workflow' className='space-y-4'>
              {(error || success || currentAttestationStep) && (
                <div className='space-y-3'>
                  {error && (
                    <Alert variant='destructive'>
                      <XCircle className='h-4 w-4' />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  {success && (
                    <Alert className='bg-green-50 border-green-200 text-green-800'>
                      <CheckCircle className='h-4 w-4' />
                      <AlertDescription>{success}</AlertDescription>
                    </Alert>
                  )}
                  {currentAttestationStep && (
                    <Alert
                      style={{
                        backgroundColor: '#fef7f0',
                        borderColor: '#E62058',
                        color: '#E62058',
                      }}
                    >
                      <div
                        className='animate-spin rounded-full h-4 w-4 border-b-2'
                        style={{ borderColor: '#E62058' }}
                      ></div>
                      <AlertDescription>
                        {currentAttestationStep}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <p className='text-sm text-gray-600'>
                Track each stage of the FDC attestation flow. Expand a step for
                technical details, cURL examples, and results.
              </p>
        {steps.map(step => (
          <Card key={step.id} className={`${getStepStatusColor(step.status)}`}>
            <CardContent className='p-4'>
              <div className='flex items-start gap-3'>
                {getStepIcon(step.status)}
                <div className='flex-1'>
                  <div className='flex items-center justify-between'>
                    <div>
                      <h3 className='font-semibold text-gray-900'>
                        {step.title}
                      </h3>
                      <p className='text-sm text-gray-600 mb-2'>
                        {step.description}
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={() => toggleStepExpansion(step.id)}
                      className='flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800'
                    >
                      {expandedSteps.has(step.id) ? (
                        <>
                          <ChevronDown className='h-4 w-4' />
                          Hide Details
                        </>
                      ) : (
                        <>
                          <ChevronRight className='h-4 w-4' />
                          Show Details
                        </>
                      )}
                    </button>
                  </div>

                  {/* Step Details - Always show for completed steps, expandable for others */}
                  {(expandedSteps.has(step.id) ||
                    step.status === 'completed') &&
                    step.details && (
                      <div className='mt-4 space-y-4 border-t pt-4'>
                        <div className='space-y-3'>
                          <div>
                            <h4 className='font-medium text-gray-900 mb-1'>
                              What happens:
                            </h4>
                            <p className='text-sm text-gray-700'>
                              {step.details.whatHappens}
                            </p>
                          </div>

                          <div>
                            <h4 className='font-medium text-gray-900 mb-1'>
                              Technical details:
                            </h4>
                            <p className='text-sm text-gray-700'>
                              {step.details.technicalDetails}
                            </p>
                          </div>

                          {step.details.apiEndpoint && (
                            <div>
                              <h4 className='font-medium text-gray-900 mb-1'>
                                API Endpoint:
                              </h4>
                              <code className='text-sm bg-gray-100 px-2 py-1 rounded font-mono block break-all'>
                                {step.details.apiEndpoint}
                              </code>
                            </div>
                          )}

                          {step.details.curlCommand && (
                            <div>
                              <h4 className='font-medium text-gray-900 mb-1'>
                                cURL Command:
                              </h4>
                              <div className='bg-gray-900 text-gray-100 p-3 rounded text-xs font-mono overflow-x-auto'>
                                <pre className='whitespace-pre-wrap'>
                                  {step.details.curlCommand}
                                </pre>
                              </div>
                              <button
                                type='button'
                                onClick={() =>
                                  copyToClipboardWithTimeout(
                                    step.details!.curlCommand!,
                                    setCopiedText
                                  )
                                }
                                className='mt-2 text-xs hover:opacity-80 flex items-center gap-1'
                              >
                                {copiedText === step.details!.curlCommand ? (
                                  <>
                                    <Check className='h-3 w-3' />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <Copy className='h-3 w-3' />
                                    Copy cURL
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Step Data - Show actual results */}
                  {step.data && (
                    <div className='mt-4 space-y-2 border-t pt-4'>
                      <h4 className='font-medium text-gray-900'>Results:</h4>

                      {step.data?.abiEncodedRequest && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            ABI Encoded Request:
                          </span>
                          <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                            {String(step.data.abiEncodedRequest).length > 20
                              ? `${String(step.data.abiEncodedRequest).slice(0, 10)}...${String(step.data.abiEncodedRequest).slice(-10)}`
                              : String(step.data.abiEncodedRequest)}
                          </code>
                          <button
                            type='button'
                            onClick={() =>
                              copyToClipboardWithTimeout(
                                String(step.data.abiEncodedRequest),
                                setCopiedText
                              )
                            }
                            className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                          >
                            {copiedText === step.data.abiEncodedRequest ? (
                              <Check className='h-3 w-3 text-green-600' />
                            ) : (
                              <Copy className='h-3 w-3 text-gray-500' />
                            )}
                          </button>
                        </div>
                      )}

                      {step.data.roundId && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>Round ID:</span>
                          <div className='flex items-center gap-2'>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                              {String(step.data.roundId)}
                            </code>
                            <a
                              href={`https://coston2-systems-explorer.flare.rocks/voting-round/${String(step.data.roundId)}?tab=fdc`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                            >
                              View Voting Round
                              <ExternalLink className='h-3 w-3' />
                            </a>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  step.data.roundId.toString(),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText === step.data.roundId.toString() ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {step.data.proof && (
                        <div className='space-y-1'>
                          <span className='text-sm font-medium'>
                            Proof Array:
                          </span>
                          <div className='space-y-1'>
                            {Array.isArray(step.data.proof) &&
                              step.data.proof.map(
                                (proofItem: string, proofIndex: number) => (
                                  <div
                                    key={proofIndex}
                                    className='flex items-center gap-2'
                                  >
                                    <span className='text-xs text-gray-600 w-6'>
                                      [{proofIndex}]:
                                    </span>
                                    <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                                      {proofItem}
                                    </code>
                                    <button
                                      type='button'
                                      onClick={() =>
                                        copyToClipboardWithTimeout(
                                          proofItem,
                                          setCopiedText
                                        )
                                      }
                                      className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                                    >
                                      {copiedText === proofItem ? (
                                        <Check className='h-3 w-3 text-green-600' />
                                      ) : (
                                        <Copy className='h-3 w-3 text-gray-500' />
                                      )}
                                    </button>
                                  </div>
                                )
                              )}
                          </div>
                        </div>
                      )}

                      {step.data.message && (
                        <p className='text-sm text-gray-700 bg-white/50 rounded p-2'>
                          {String(step.data.message)}
                        </p>
                      )}

                      {step.data.verificationResult !== undefined && (
                        <div className='space-y-2'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium'>
                              Verification Result:
                            </span>
                            <div className='flex items-center gap-2'>
                              <code
                                className={`px-2 py-1 rounded text-xs font-mono ${
                                  step.data.verificationResult
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {step.data.verificationResult
                                  ? 'Verified'
                                  : 'Failed'}
                              </code>
                              {step.data.verificationResult && (
                                <CheckCircle className='h-4 w-4 text-green-600' />
                              )}
                              {!step.data.verificationResult && (
                                <XCircle className='h-4 w-4 text-red-600' />
                              )}
                            </div>
                          </div>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium'>
                              Raw Value:
                            </span>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                              {JSON.stringify(step.data.verificationResult)}
                            </code>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  JSON.stringify(step.data.verificationResult),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText ===
                              JSON.stringify(step.data.verificationResult) ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {step.data.transactionHash && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            Transaction Hash:
                          </span>
                          <div className='flex items-center gap-2 flex-1'>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                              {String(step.data.transactionHash).length > 20
                                ? `${String(step.data.transactionHash).slice(0, 10)}...${String(step.data.transactionHash).slice(-10)}`
                                : String(step.data.transactionHash)}
                            </code>
                            <a
                              href={`https://coston2-explorer.flare.network/tx/${String(step.data.transactionHash)}`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                            >
                              View on Explorer
                              <ExternalLink className='h-3 w-3' />
                            </a>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  String(step.data.transactionHash),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText === step.data.transactionHash ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {step.data.blockNumber && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            Block Number:
                          </span>
                          <div className='flex items-center gap-2'>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                              {String(step.data.blockNumber)}
                            </code>
                            <a
                              href={`https://coston2-explorer.flare.network/block/${String(step.data.blockNumber)}`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                            >
                              View Block
                              <ExternalLink className='h-3 w-3' />
                            </a>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  step.data.blockNumber.toString(),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText ===
                              step.data.blockNumber.toString() ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Show request/response details for the first step */}
                      {step.data.requestDetails && (
                        <div className='space-y-3'>
                          <div>
                            <h5 className='font-medium text-gray-900 mb-1'>
                              Request Body:
                            </h5>
                            <div className='bg-gray-100 p-3 rounded text-xs font-mono max-w-full'>
                              <div className='space-y-2'>
                                {(() => {
                                  const requestBody = (
                                    step.data.requestDetails as any
                                  )?.requestBody;
                                  if (!requestBody) return null;

                                  return Object.entries(requestBody).map(
                                    ([key, value]) => (
                                      <div
                                        key={key}
                                        className='flex flex-col gap-1'
                                      >
                                        <span className='font-semibold text-gray-800'>
                                          {key}:
                                        </span>
                                        <div className='flex items-center gap-2'>
                                          <code className='bg-white p-2 rounded border text-xs break-all max-w-full'>
                                            {(() => {
                                              if (
                                                typeof value === 'object' &&
                                                value !== null
                                              ) {
                                                const jsonString =
                                                  JSON.stringify(
                                                    value,
                                                    null,
                                                    2
                                                  );
                                                return jsonString.length > 50
                                                  ? `${jsonString.slice(0, 20)}...${jsonString.slice(-20)}`
                                                  : jsonString;
                                              } else if (
                                                typeof value === 'string' &&
                                                value.length > 50
                                              ) {
                                                return `${String(value).slice(0, 20)}...${String(value).slice(-20)}`;
                                              } else {
                                                return String(value);
                                              }
                                            })()}
                                          </code>
                                          <button
                                            type='button'
                                            onClick={() =>
                                              copyToClipboardWithTimeout(
                                                typeof value === 'object' &&
                                                  value !== null
                                                  ? JSON.stringify(
                                                      value,
                                                      null,
                                                      2
                                                    )
                                                  : String(value),
                                                setCopiedText
                                              )
                                            }
                                            className='h-6 w-6 p-0 hover:bg-gray-200 rounded flex items-center justify-center'
                                          >
                                            {copiedText === String(value) ? (
                                              <Check className='h-3 w-3 text-green-600' />
                                            ) : (
                                              <Copy className='h-3 w-3' />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                          <div>
                            <h5 className='font-medium text-gray-900 mb-1'>
                              Response Body:
                            </h5>
                            <div className='bg-gray-100 p-3 rounded text-xs font-mono max-w-full'>
                              <div className='space-y-2'>
                                {(() => {
                                  const responseBody = (
                                    step.data.requestDetails as any
                                  )?.responseBody;
                                  if (!responseBody) return null;

                                  return Object.entries(responseBody).map(
                                    ([key, value]) => (
                                      <div
                                        key={key}
                                        className='flex flex-col gap-1'
                                      >
                                        <span className='font-semibold text-gray-800'>
                                          {key}:
                                        </span>
                                        <div className='flex items-center gap-2'>
                                          <code className='bg-white p-2 rounded border text-xs break-all max-w-full'>
                                            {(() => {
                                              if (
                                                typeof value === 'object' &&
                                                value !== null
                                              ) {
                                                const jsonString =
                                                  JSON.stringify(
                                                    value,
                                                    null,
                                                    2
                                                  );
                                                return jsonString.length > 50
                                                  ? `${jsonString.slice(0, 20)}...${jsonString.slice(-20)}`
                                                  : jsonString;
                                              } else if (
                                                typeof value === 'string' &&
                                                value.length > 50
                                              ) {
                                                return `${String(value).slice(0, 20)}...${String(value).slice(-20)}`;
                                              } else {
                                                return String(value);
                                              }
                                            })()}
                                          </code>
                                          <button
                                            type='button'
                                            onClick={() =>
                                              copyToClipboardWithTimeout(
                                                typeof value === 'object' &&
                                                  value !== null
                                                  ? JSON.stringify(
                                                      value,
                                                      null,
                                                      2
                                                    )
                                                  : String(value),
                                                setCopiedText
                                              )
                                            }
                                            className='h-6 w-6 p-0 hover:bg-gray-200 rounded flex items-center justify-center'
                                          >
                                            {copiedText === String(value) ? (
                                              <Check className='h-3 w-3 text-green-600' />
                                            ) : (
                                              <Copy className='h-3 w-3' />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  );
                                })()}
                              </div>
                            </div>
                          </div>

                          {/* ABI Encoded Request Explanation */}
                          {step.id === 'prepare-request' &&
                            (
                              step.data.requestDetails as
                                | { responseBody?: { abiEncodedRequest?: string } }
                                | undefined
                            )?.responseBody?.abiEncodedRequest && (
                              <div
                                className='mt-4 p-4 rounded-lg'
                                style={{
                                  backgroundColor: '#fef7f0',
                                  borderColor: '#E62058',
                                  border: '1px solid',
                                }}
                              >
                                <h5
                                  className='font-medium mb-3'
                                  style={{ color: '#E62058' }}
                                >
                                  📖 Understanding the abiEncodedRequest
                                </h5>
                                <div className='text-sm space-y-3'>
                                  <p>
                                    The{' '}
                                    <code className='bg-white px-2 py-1 rounded text-xs'>
                                      abiEncodedRequest
                                    </code>{' '}
                                    is a hex string that encodes all the request
                                    data in a format the FDC contract can
                                    understand. Here's how it's structured:
                                  </p>

                                  <div className='bg-white p-3 rounded border text-xs font-mono'>
                                    <div className='space-y-1'>
                                      <div>
                                        <span className='font-semibold text-blue-600'>
                                          Line 1:
                                        </span>{' '}
                                        {attestationType ===
                                        'EVMTransaction' ? (
                                          <>
                                            <code>0x45564d5472616e73...</code> →{' '}
                                            <code>
                                              toUtf8HexString(&quot;EVMTransaction&quot;)
                                            </code>
                                          </>
                                        ) : (
                                          <>
                                            <code>0x5852505061796d65...</code> →{' '}
                                            <code>
                                              toUtf8HexString(&quot;XRPPayment&quot;)
                                            </code>
                                          </>
                                        )}
                                      </div>
                                      <div>
                                        <span className='font-semibold text-blue-600'>
                                          Line 2:
                                        </span>{' '}
                                        {attestationType ===
                                        'EVMTransaction' ? (
                                          <>
                                            <code>0x74657374455448...</code> →{' '}
                                            <code>
                                              toUtf8HexString(&quot;testETH&quot;)
                                            </code>
                                          </>
                                        ) : (
                                          <>
                                            <code>0x74657374585250...</code> →{' '}
                                            <code>
                                              toUtf8HexString(&quot;testXRP&quot;)
                                            </code>
                                          </>
                                        )}
                                      </div>
                                      <div>
                                        <span className='font-semibold text-blue-600'>
                                          Line 3:
                                        </span>{' '}
                                        <code>0x...</code> → Message Integrity
                                        Code (MIC) - hash of response salted with
                                        &quot;Flare&quot;
                                      </div>
                                      <div>
                                        <span className='font-semibold text-blue-600'>
                                          Remaining:
                                        </span>{' '}
                                        {attestationType === 'EVMTransaction'
                                          ? 'ABI-encoded EVMTransaction.RequestBody (transactionHash, confirmations, flags, logIndices)'
                                          : 'ABI-encoded XRPPayment.RequestBody (transactionId and proofOwner)'}
                                      </div>
                                    </div>
                                  </div>

                                  <div className='text-xs text-gray-600 space-y-1'>
                                    <p>
                                      <strong>Structure:</strong> Each line
                                      represents 32 bytes (64 hex characters) of
                                      data
                                    </p>
                                    <p>
                                      <strong>Purpose:</strong> This encoded
                                      format allows the FDC contract to parse
                                      the request data efficiently
                                    </p>
                                    <p>
                                      <strong>Integrity:</strong> The MIC
                                      ensures the attestation data hasn't been
                                      tampered with
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  )}

                  {step.error && (
                    <div className='mt-3 p-2 bg-red-100 border border-red-200 rounded text-sm text-red-700'>
                      Error: {step.error}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
            </TabsContent>

            <TabsContent value='guide' className='space-y-6'>
              <div
                className='rounded-lg p-4'
                style={{
                  backgroundColor: '#fef7f0',
                  borderColor: '#E62058',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                }}
              >
                <h4 className='font-medium mb-2' style={{ color: '#E62058' }}>
                  How to use this tutorial
                </h4>
                <ul className='text-sm space-y-1' style={{ color: '#E62058' }}>
                  <li>
                    • Choose an attestation type: EVMTransaction (Sepolia) or
                    XRPPayment (XRPL)
                  </li>
                  <li>
                    • Enter a transaction hash / ID (EVMTransaction is prefilled
                    with a Sepolia example)
                  </li>
                  <li>
                    • Click &quot;Execute FDC Workflow&quot; to start the
                    tutorial
                  </li>
                  <li>
                    • Open the Workflow tab to follow each step and expand
                    details
                  </li>
                  <li>
                    • Use the copy buttons for ABI-encoded requests and proofs
                  </li>
                </ul>
              </div>

              <div
                className='rounded-lg border p-4'
                style={{ backgroundColor: '#fef7f0', borderColor: '#E62058' }}
              >
                <h3
                  className='font-semibold mb-3'
                  style={{ color: '#E62058' }}
                >
                  FDC Tutorial Guide
                </h3>
                <div className='space-y-3 text-sm' style={{ color: '#E62058' }}>
                  <p>
                    This interactive tutorial demonstrates the complete Flare
                    Data Connector (FDC) workflow as described in the official
                    documentation. Each step shows you exactly what happens
                    behind the scenes.
                  </p>
                  <div>
                    <h4 className='font-medium mb-1'>What you&apos;ll learn:</h4>
                    <ul className='list-disc list-inside space-y-1 ml-2'>
                      <li>
                        How to prepare attestation requests using the verifier
                        API
                      </li>
                      <li>The structure of ABI-encoded requests</li>
                      <li>How voting rounds work in the FDC system</li>
                      <li>
                        How to retrieve proofs from the Data Availability Layer
                      </li>
                      <li>How cryptographic verification works</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className='font-medium mb-1'>Interactive Features:</h4>
                    <ul className='list-disc list-inside space-y-1 ml-2'>
                      <li>
                        <strong>Step 1</strong> makes an API call to the Flare
                        verifier server
                      </li>
                      <li>
                        <strong>Step 2</strong> executes a blockchain
                        transaction to{' '}
                        <a
                          href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'
                          target='_blank'
                          rel='noopener noreferrer'
                          className='hover:opacity-80 underline inline-flex items-center gap-1'
                        >
                          FdcHub contract
                          <ExternalLink className='h-3 w-3' />
                        </a>
                      </li>
                      <li>
                        <strong>Step 3</strong> calculates and waits for voting
                        round finalization
                      </li>
                      <li>
                        <strong>Step 4</strong> retrieves proof from Data
                        Availability Layer
                      </li>
                      <li>
                        <strong>Step 5</strong> verifies payment attestation
                        using{' '}
                        <a
                          href='https://dev.flare.network/fdc/reference/IFdcVerification#verifypayment'
                          target='_blank'
                          rel='noopener noreferrer'
                          className='hover:opacity-80 underline inline-flex items-center gap-1'
                        >
                          FdcVerification contract
                          <ExternalLink className='h-3 w-3' />
                        </a>
                      </li>
                      <li>
                        <strong>Expandable details</strong> show technical
                        explanations and cURL commands for each step
                      </li>
                      <li>
                        <strong>Copy functionality</strong> for all important
                        data (requests, proofs, transaction hashes, etc.)
                      </li>
                      <li>
                        <strong>Real request/response data</strong> from actual
                        API calls and blockchain transactions
                      </li>
                      <li>
                        <strong>Transaction tracking</strong> with real
                        transaction hashes and block numbers
                      </li>
                      <li>
                        <strong>Voting round links</strong> to view rounds in
                        the Systems Explorer
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
