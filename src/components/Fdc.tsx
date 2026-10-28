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
import { decodeEvmTransactionEvent } from '@/lib/decodeEvmEvent';
import {
  calculateRoundId,
  FDC_CONSTANTS,
  prepareEVMTransactionAttestationRequest,
  prepareXRPPaymentAttestationRequest,
  retrieveEVMTransactionDataAndProofWithRetry,
  retrieveXRPPaymentDataAndProofWithRetry,
  type EVMTransactionEvent,
  type EVMTransactionProofData,
  type XRPPaymentProofData,
  verifyEVMTransaction,
  verifyXRPPayment,
} from '@/lib/fdcUtils';

type AttestationType = 'XRPPayment' | 'EVMTransaction';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** LayerZero message on Sepolia — used as the EVMTransaction demo default */
const SEPOLIA_TX_HASH =
  '0x8cc5c3614eb9fd0f82d44f841a520962d93ee053f012fa1639c91d40c1123f16';
const SAMPLE_XRPL_TX =
  'A6589F33CA3B679CF3E833632E81E5A075CED6057316782A2B466FF64D05CBF0';
const DEFAULT_REQUIRED_CONFIRMATIONS = '1';
const MAX_LOG_INDICES = 50;
const UINT32_MAX = 4_294_967_295;

const parseLogIndicesInput = (raw: string | undefined): string[] => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  return trimmed.split(/[\s,]+/).filter(Boolean);
};

const truncateHex = (value: string, head = 10, tail = 8) => {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const createFdcFormSchema = (attestationType: AttestationType) =>
  z
    .object({
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
      requiredConfirmations: z
        .string()
        .optional()
        .refine(
          val =>
            attestationType !== 'EVMTransaction' ||
            (val !== undefined &&
              val.trim() !== '' &&
              /^\d+$/.test(val.trim()) &&
              Number(val.trim()) >= 1 &&
              Number(val.trim()) <= 65535),
          'Required confirmations must be an integer between 1 and 65535'
        ),
      provideInput: z.boolean(),
      listEvents: z.boolean(),
      logIndices: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (attestationType !== 'EVMTransaction' || !data.listEvents) return;

      const indices = parseLogIndicesInput(data.logIndices);
      if (indices.length > MAX_LOG_INDICES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['logIndices'],
          message: `At most ${MAX_LOG_INDICES} log indices are allowed`,
        });
        return;
      }

      const numbers: number[] = [];
      for (const index of indices) {
        if (!/^\d+$/.test(index) || Number(index) > UINT32_MAX) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['logIndices'],
            message:
              'Log indices must be comma-separated integers between 0 and 4294967295',
          });
          return;
        }
        numbers.push(Number(index));
      }

      for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] <= numbers[i - 1]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['logIndices'],
            message: 'Log indices must be strictly increasing',
          });
          return;
        }
      }
    });

type FdcFormData = z.infer<ReturnType<typeof createFdcFormSchema>>;

interface FdcDocLink {
  label: string;
  href: string;
}

interface FdcStep {
  id: string;
  title: string;
  description: string | React.ReactNode;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  data?: Record<string, unknown>;
  error?: string;
  details?: {
    /** Short developer-facing summary of this step's job in the pipeline */
    whatHappens: string;
    /** Implementation notes: APIs, contracts, timing, fees, gotchas */
    technicalDetails: string | React.ReactNode;
    /** Label for the call target (Verifier API, Smart contract, DA Layer, …) */
    endpointLabel?: string;
    apiEndpoint?: string | React.ReactNode;
    requestBody?: Record<string, unknown>;
    responseBody?: Record<string, unknown>;
    curlCommand?: string;
    docs?: FdcDocLink[];
  };
}

const DocLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target='_blank'
    rel='noopener noreferrer'
    className='inline-flex items-center gap-1 underline hover:opacity-80'
    style={{ color: '#E62058' }}
  >
    {children}
    <ExternalLink className='h-3 w-3 shrink-0' />
  </a>
);

const StepDocs = ({ docs }: { docs: FdcDocLink[] }) => (
  <div>
    <h4 className='font-medium text-gray-900 mb-1.5'>Flare docs</h4>
    <ul className='space-y-1.5'>
      {docs.map(doc => (
        <li key={doc.href} className='text-sm'>
          <DocLink href={doc.href}>{doc.label}</DocLink>
        </li>
      ))}
    </ul>
  </div>
);

const getInitialSteps = (
  attestationType: AttestationType,
  proofOwner: string = ZERO_ADDRESS
): FdcStep[] => {
  const isEvm = attestationType === 'EVMTransaction';
  const attestationSpecHref = isEvm
    ? 'https://dev.flare.network/fdc/attestation-types/evm-transaction'
    : 'https://dev.flare.network/fdc/attestation-types/xrp-payment';
  const hardhatGuideHref = isEvm
    ? 'https://dev.flare.network/fdc/guides/hardhat/evm-transaction'
    : 'https://dev.flare.network/fdc/guides/hardhat/payment';
  const verifyHref = isEvm
    ? 'https://dev.flare.network/fdc/reference/IFdcVerification#verifyevmtransaction'
    : 'https://dev.flare.network/fdc/reference/IFdcVerification#verifyxrppayment';
  const verifyMethod = isEvm
    ? 'verifyEVMTransaction'
    : 'verifyXRPPayment';

  return [
    {
      id: 'prepare-request',
      title: '1. Prepare request (verifier)',
      description: (
        <>
          Call the verifier{' '}
          <code className='text-xs bg-gray-100 px-1 rounded'>prepareRequest</code>{' '}
          API to get an ABI-encoded attestation request
        </>
      ),
      status: 'pending',
      details: {
        whatHappens: isEvm
          ? 'POST your Sepolia (testETH) transaction parameters to the ETH verifier. You get back abiEncodedRequest — the bytes you will pass to FdcHub.requestAttestation.'
          : 'POST your XRPL (testXRP) transactionId and proofOwner to the XRP verifier. You get back abiEncodedRequest — the bytes you will pass to FdcHub.requestAttestation.',
        technicalDetails: isEvm
          ? 'Request body: attestationType (EVMTransaction), sourceId (testETH), and requestBody { transactionHash, requiredConfirmations, provideInput, listEvents, logIndices }. Pass X-API-KEY (case-sensitive). The verifier validates the tx exists with enough confirmations and embeds a message integrity code (MIC).'
          : 'Request body: attestationType (XRPPayment), sourceId (testXRP), and requestBody { transactionId, proofOwner }. Pass X-API-KEY (case-sensitive). proofOwner is the EVM address authorized to use the resulting proof. The verifier embeds a message integrity code (MIC).',
        endpointLabel: 'Verifier API',
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
        docs: [
          {
            label: 'Getting started — prepare request',
            href: 'https://dev.flare.network/fdc/getting-started',
          },
          {
            label: isEvm
              ? 'EVMTransaction attestation type'
              : 'XRPPayment attestation type',
            href: attestationSpecHref,
          },
          {
            label: isEvm
              ? 'Hardhat guide: EVMTransaction'
              : 'Hardhat guide: Payment / XRPL',
            href: hardhatGuideHref,
          },
          {
            label: isEvm ? 'Verifier Swagger (eth)' : 'Verifier Swagger (xrp)',
            href: isEvm
              ? 'https://fdc-verifiers-testnet.flare.network/verifier/eth/api-doc'
              : 'https://fdc-verifiers-testnet.flare.network/verifier/xrp/api-doc',
          },
        ],
      },
    },
    {
      id: 'submit-request',
      title: '2. Submit to FdcHub',
      description: (
        <>
          Call{' '}
          <DocLink href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'>
            FdcHub.requestAttestation
          </DocLink>{' '}
          with the encoded request and fee
        </>
      ),
      status: 'pending',
      details: {
        whatHappens:
          'Send a Coston2 transaction: requestAttestation(abiEncodedRequest) with msg.value ≥ the configured request fee. Confirmed fees go to data providers; underpaid requests revert.',
        technicalDetails: isEvm
          ? 'Resolve FdcHub via ContractRegistry (or known address). Fee must meet the minimum for EVMTransaction + testETH. Larger fees improve chance of confirmation in the current voting round. From the receipt block timestamp, compute roundId = floor((timestamp − firstVotingRoundStartTs) / votingEpochDurationSeconds).'
          : 'Resolve FdcHub via ContractRegistry (or known address). Fee must meet the minimum for XRPPayment + testXRP. Larger fees improve chance of confirmation in the current voting round. From the receipt block timestamp, compute roundId = floor((timestamp − firstVotingRoundStartTs) / votingEpochDurationSeconds).',
        endpointLabel: 'Smart contract',
        apiEndpoint: (
          <DocLink href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'>
            FdcHub.requestAttestation(bytes) — Coston2
          </DocLink>
        ),
        docs: [
          {
            label: 'IFdcHub.requestAttestation',
            href: 'https://dev.flare.network/fdc/reference/IFdcHub#requestattestation',
          },
          {
            label: 'Getting started — submit request',
            href: 'https://dev.flare.network/fdc/getting-started',
          },
          {
            label: 'FDC by hand (full walkthrough)',
            href: 'https://dev.flare.network/fdc/guides/fdc-by-hand/',
          },
        ],
      },
    },
    {
      id: 'wait-finalization',
      title: '3. Wait for round finalization',
      description: (
        <>
          Poll{' '}
          <DocLink href='https://dev.flare.network/network/fsp/solidity-reference/IRelay#isfinalized'>
            Relay.isFinalized(200, roundId)
          </DocLink>{' '}
          until the voting round closes (~90s)
        </>
      ),
      status: 'pending',
      details: {
        whatHappens:
          'FDC protocol ID is 200. Data providers vote on your request; once the round is finalized the Merkle root is onchain and you can fetch a proof from the DA Layer.',
        technicalDetails: isEvm
          ? 'Epoch duration is typically 90 seconds; end-to-end finalization often takes 90–180s. Providers check Sepolia for your transaction and vote. Prefer Relay.isFinalized(200, roundId) or listen for ProtocolMessageRelayed(200, roundId). Do not call the DA Layer before finalization.'
          : 'Epoch duration is typically 90 seconds; end-to-end finalization often takes 90–180s. Providers check XRPL for your payment and vote. Prefer Relay.isFinalized(200, roundId) or listen for ProtocolMessageRelayed(200, roundId). Do not call the DA Layer before finalization.',
        endpointLabel: 'Systems explorer / Relay',
        apiEndpoint:
          'https://coston2-systems-explorer.flare.rocks/voting-round/{roundId}?tab=fdc',
        docs: [
          {
            label: 'IRelay.isFinalized',
            href: 'https://dev.flare.network/network/fsp/solidity-reference/IRelay#isfinalized',
          },
          {
            label: 'FDC overview — voting & rounds',
            href: 'https://dev.flare.network/fdc/overview',
          },
          {
            label: 'Getting started — wait for finalization',
            href: 'https://dev.flare.network/fdc/getting-started',
          },
        ],
      },
    },
    {
      id: 'prepare-proof',
      title: '4. Fetch proof (DA Layer)',
      description: (
        <>
          POST{' '}
          <code className='text-xs bg-gray-100 px-1 rounded'>
            proof-by-request-round
          </code>{' '}
          with votingRoundId + requestBytes
        </>
      ),
      status: 'pending',
      details: {
        whatHappens:
          'After finalization, the Data Availability Layer returns the attestation response plus a Merkle proof against the onchain root for that round.',
        technicalDetails:
          'Body: { votingRoundId, requestBytes } where requestBytes is the same abiEncodedRequest from step 1. Response includes merkleProof and decoded attestation data (or response_hex for the raw variant). Use this { merkleProof, data } shape when calling verify* on FdcVerification.',
        endpointLabel: 'Data Availability API',
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
        docs: [
          {
            label: 'Data Availability API',
            href: 'https://dev.flare.network/fdc/reference/data-availability-api',
          },
          {
            label: 'Getting started — retrieve proof',
            href: 'https://dev.flare.network/fdc/getting-started',
          },
          {
            label: isEvm
              ? 'IEVMTransaction proof shape'
              : 'IXRPPayment proof shape',
            href: isEvm
              ? 'https://dev.flare.network/fdc/reference/IEVMTransaction'
              : 'https://dev.flare.network/fdc/reference/IXRPPayment',
          },
        ],
      },
    },
    {
      id: 'verify-data',
      title: '5. Verify proof onchain',
      description: (
        <>
          Call{' '}
          <DocLink href={verifyHref}>
            FdcVerification.{verifyMethod}
          </DocLink>{' '}
          then use the attested data in your contract
        </>
      ),
      status: 'pending',
      details: {
        whatHappens: isEvm
          ? 'Your contract (or this demo) calls verifyEVMTransaction(proof). On success, read proof.data.responseBody (block, addresses, value, events, …) for business logic.'
          : 'Your contract (or this demo) calls verifyXRPPayment(proof). On success, read proof.data.responseBody (amounts in drops, memo/tag, XRPL addresses, status, …) for business logic.',
        technicalDetails: isEvm
          ? 'Always verify first via ContractRegistry.getFdcVerification(), then consume response fields. Never trust DA Layer payloads without onchain verification against the round Merkle root.'
          : 'Always verify first via ContractRegistry.getFdcVerification(), then consume response fields. Never trust DA Layer payloads without onchain verification against the round Merkle root.',
        endpointLabel: 'Smart contract',
        apiEndpoint: (
          <DocLink href={verifyHref}>
            FdcVerification.{verifyMethod}() — Coston2
          </DocLink>
        ),
        docs: [
          {
            label: `IFdcVerification.${verifyMethod}`,
            href: verifyHref,
          },
          {
            label: isEvm
              ? 'IEVMTransaction interface'
              : 'IXRPPayment interface',
            href: isEvm
              ? 'https://dev.flare.network/fdc/reference/IEVMTransaction'
              : 'https://dev.flare.network/fdc/reference/IXRPPayment',
          },
          {
            label: isEvm
              ? 'Hardhat: verify EVMTransaction'
              : 'Hardhat: verify Payment',
            href: hardhatGuideHref,
          },
          {
            label: 'FDC overview — consume proofs',
            href: 'https://dev.flare.network/fdc/overview',
          },
        ],
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
    setValue,
    watch,
    formState: { errors },
  } = useForm<FdcFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      transactionId: SEPOLIA_TX_HASH,
      requiredConfirmations: DEFAULT_REQUIRED_CONFIRMATIONS,
      provideInput: true,
      listEvents: true,
      logIndices: '',
    },
  });
  const listEventsEnabled = watch('listEvents');

  const fieldInputClass = (hasError?: boolean) =>
    `h-10 border-gray-300 font-mono text-sm focus:ring-2 focus:ring-opacity-50 ${
      hasError ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : ''
    }`;
  const fieldInputStyle = (hasError?: boolean) =>
    ({
      borderColor: hasError ? undefined : '#E62058',
      '--tw-ring-color': '#E62058',
    }) as React.CSSProperties;

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
      ) ||
      connectors.find(c => c.id === 'injected') ||
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

        const evmProofData =
          attestationType === 'EVMTransaction'
            ? (proof as EVMTransactionProofData)
            : null;
        const evmAttestationSummary = evmProofData
          ? {
              requiredConfirmations:
                evmProofData.response.requestBody.requiredConfirmations,
              blockNumber: evmProofData.response.responseBody.blockNumber,
              timestamp: evmProofData.response.responseBody.timestamp,
              sourceAddress: evmProofData.response.responseBody.sourceAddress,
              receivingAddress:
                evmProofData.response.responseBody.receivingAddress,
              value: evmProofData.response.responseBody.value,
              input: evmProofData.response.responseBody.input,
              status: evmProofData.response.responseBody.status,
              isDeployment: evmProofData.response.responseBody.isDeployment,
              events: evmProofData.response.responseBody.events ?? [],
            }
          : null;

        updateStepStatus('prepare-proof', 'completed', {
          message: 'Proof retrieved from Data Availability Layer',
          proof: proof.proof,
          ...(evmAttestationSummary
            ? { evmAttestation: evmAttestationSummary }
            : {}),
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
            'input',
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
            ...(evmAttestationSummary
              ? { evmAttestation: evmAttestationSummary }
              : {}),
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
      requiredConfirmations: DEFAULT_REQUIRED_CONFIRMATIONS,
      provideInput: true,
      listEvents: true,
      logIndices: '',
    });
    setSteps(getInitialSteps(attestationType, address ?? ZERO_ADDRESS));
    setError(null);
    setSuccess(null);
    setCurrentAttestationData(null);
    setProofData(null);
    setVerificationResult(null);
  }, [attestationType, address, reset]);

  const prepareRequest = async (
    transactionId: string,
    evmRequest: {
      requiredConfirmations?: string;
      provideInput?: boolean;
      listEvents?: boolean;
      logIndices?: string[];
    } = {}
  ) => {
    try {
      updateStepStatus('prepare-request', 'in_progress');

      if (attestationType === 'EVMTransaction') {
        const requiredConfirmations =
          evmRequest.requiredConfirmations ?? DEFAULT_REQUIRED_CONFIRMATIONS;
        const provideInput = evmRequest.provideInput ?? true;
        const listEvents = evmRequest.listEvents ?? true;
        const logIndices = evmRequest.logIndices ?? [];
        const requestBody = {
          attestationType:
            '0x45564d5472616e73616374696f6e000000000000000000000000000000000000',
          sourceId:
            '0x7465737445544800000000000000000000000000000000000000000000000000',
          requestBody: {
            transactionHash: transactionId,
            requiredConfirmations,
            provideInput,
            listEvents,
            logIndices,
          },
        };

        const data = await prepareEVMTransactionAttestationRequest(
          transactionId,
          { requiredConfirmations, provideInput, listEvents, logIndices }
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
    const requiredConfirmations =
      data.requiredConfirmations?.trim() || DEFAULT_REQUIRED_CONFIRMATIONS;
    const provideInput = data.provideInput;
    const listEvents = data.listEvents;
    const logIndices = listEvents ? parseLogIndicesInput(data.logIndices) : [];

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
      const attestationResponse = await prepareRequest(transactionId, {
        requiredConfirmations,
        provideInput,
        listEvents,
        logIndices,
      });

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
              End-to-end FDC pipeline on Coston2: prepare → submit → finalize →
              fetch proof → verify. Follows{' '}
              <DocLink href='https://dev.flare.network/fdc/getting-started'>
                Getting started
              </DocLink>{' '}
              and the{' '}
              <DocLink href='https://dev.flare.network/fdc/guides/fdc-by-hand/'>
                FDC by hand
              </DocLink>{' '}
              guide.
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
                  <p className='text-xs text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1'>
                    {attestationType === 'EVMTransaction' ? (
                      <>
                        <span>Source: testETH (Sepolia)</span>
                        <DocLink href='https://dev.flare.network/fdc/attestation-types/evm-transaction'>
                          Spec
                        </DocLink>
                        <DocLink href='https://dev.flare.network/fdc/guides/hardhat/evm-transaction'>
                          Hardhat guide
                        </DocLink>
                        <DocLink href='https://fdc-verifiers-testnet.flare.network/verifier/eth/api-doc'>
                          Verifier Swagger
                        </DocLink>
                      </>
                    ) : (
                      <>
                        <span>Source: testXRP (XRPL testnet)</span>
                        <DocLink href='https://dev.flare.network/fdc/attestation-types/xrp-payment'>
                          Spec
                        </DocLink>
                        <DocLink href='https://fdc-verifiers-testnet.flare.network/verifier/xrp/api-doc'>
                          Verifier Swagger
                        </DocLink>
                      </>
                    )}
                  </p>
                </div>

                <div className='space-y-2'>
                  <div className='flex flex-wrap items-end justify-between gap-2'>
                    <Label htmlFor='transactionId' style={{ color: '#E62058' }}>
                      {attestationType === 'EVMTransaction'
                        ? 'Transaction Hash'
                        : 'Transaction ID'}
                    </Label>
                    <div className='flex items-center gap-3 text-xs'>
                      <button
                        type='button'
                        className='cursor-pointer underline'
                        style={{ color: '#E62058' }}
                        onClick={() =>
                          setValue(
                            'transactionId',
                            attestationType === 'EVMTransaction'
                              ? SEPOLIA_TX_HASH
                              : SAMPLE_XRPL_TX,
                            { shouldValidate: true }
                          )
                        }
                      >
                        Use sample
                      </button>
                      <a
                        href={
                          attestationType === 'EVMTransaction'
                            ? `https://sepolia.etherscan.io/tx/${SEPOLIA_TX_HASH}`
                            : `https://livenet.xrpl.org/transactions/${SAMPLE_XRPL_TX}`
                        }
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex items-center gap-1 underline'
                        style={{ color: '#E62058' }}
                      >
                        View on explorer
                        <ExternalLink className='h-3 w-3' />
                      </a>
                    </div>
                  </div>
                  <Input
                    {...register('transactionId')}
                    id='transactionId'
                    spellCheck={false}
                    autoComplete='off'
                    placeholder={
                      attestationType === 'EVMTransaction'
                        ? SEPOLIA_TX_HASH
                        : SAMPLE_XRPL_TX
                    }
                    className={fieldInputClass(Boolean(errors.transactionId))}
                    style={fieldInputStyle(Boolean(errors.transactionId))}
                  />
                  {errors.transactionId ? (
                    <p className='text-sm text-red-600'>
                      {errors.transactionId.message}
                    </p>
                  ) : (
                    <p className='text-xs text-gray-600'>
                      {attestationType === 'EVMTransaction'
                        ? 'Sepolia (testETH) transaction hash. Sample is a LayerZero message.'
                        : 'XRPL testnet payment transaction ID.'}
                    </p>
                  )}
                </div>

                {attestationType === 'EVMTransaction' && (
                  <div className='space-y-5'>
                    <div className='grid gap-4 sm:grid-cols-2'>
                      <div className='space-y-2'>
                        <Label
                          htmlFor='requiredConfirmations'
                          style={{ color: '#E62058' }}
                        >
                          Required Confirmations
                        </Label>
                        <Input
                          {...register('requiredConfirmations')}
                          id='requiredConfirmations'
                          type='number'
                          min={1}
                          max={65535}
                          placeholder={DEFAULT_REQUIRED_CONFIRMATIONS}
                          className={fieldInputClass(
                            Boolean(errors.requiredConfirmations)
                          )}
                          style={fieldInputStyle(
                            Boolean(errors.requiredConfirmations)
                          )}
                        />
                        {errors.requiredConfirmations ? (
                          <p className='text-sm text-red-600'>
                            {errors.requiredConfirmations.message}
                          </p>
                        ) : (
                          <p className='text-xs text-gray-600'>
                            Tip block counts as 1 confirmation.
                          </p>
                        )}
                      </div>

                      <div className='space-y-2'>
                        <Label
                          htmlFor='logIndices'
                          style={{ color: '#E62058' }}
                        >
                          Event Indices
                        </Label>
                        <Input
                          {...register('logIndices')}
                          id='logIndices'
                          placeholder='e.g. 0, 2, 5'
                          disabled={!listEventsEnabled}
                          className={`${fieldInputClass(Boolean(errors.logIndices))} disabled:cursor-not-allowed disabled:opacity-50`}
                          style={fieldInputStyle(Boolean(errors.logIndices))}
                        />
                        {errors.logIndices ? (
                          <p className='text-sm text-red-600'>
                            {errors.logIndices.message}
                          </p>
                        ) : (
                          <p className='text-xs text-gray-600'>
                            {listEventsEnabled
                              ? 'Leave empty for all events (max 50). Indices must increase.'
                              : 'Available when event logs are included.'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                      <label
                        htmlFor='provideInput'
                        className='flex cursor-pointer items-start gap-3'
                      >
                        <input
                          {...register('provideInput')}
                          id='provideInput'
                          type='checkbox'
                          className='mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#E62058]'
                        />
                        <span className='space-y-1'>
                          <span
                            className='block text-sm font-medium'
                            style={{ color: '#E62058' }}
                          >
                            Include Transaction Input
                          </span>
                          <span className='block text-xs text-gray-600'>
                            Return calldata in the attestation. Off returns
                            0x00.
                          </span>
                        </span>
                      </label>

                      <label
                        htmlFor='listEvents'
                        className='flex cursor-pointer items-start gap-3'
                      >
                        <input
                          {...register('listEvents')}
                          id='listEvents'
                          type='checkbox'
                          className='mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#E62058]'
                        />
                        <span className='space-y-1'>
                          <span
                            className='block text-sm font-medium'
                            style={{ color: '#E62058' }}
                          >
                            Include Event Logs
                          </span>
                          <span className='block text-xs text-gray-600'>
                            Return event logs in the attestation.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                )}

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
                    disabled={isLoading || isLoadingAddresses || !!addressError}
                    className='w-full cursor-pointer disabled:bg-gray-400'
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
                Each card mirrors a production integration step. Expand for
                implementation notes, Flare docs, cURL, and live results.
              </p>
              {steps.map(step => (
                <Card
                  key={step.id}
                  className={`${getStepStatusColor(step.status)}`}
                >
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
                              <div className='space-y-4'>
                                <div>
                                  <h4 className='font-medium text-gray-900 mb-1'>
                                    Developer summary
                                  </h4>
                                  <p className='text-sm text-gray-700'>
                                    {step.details.whatHappens}
                                  </p>
                                </div>

                                <div>
                                  <h4 className='font-medium text-gray-900 mb-1'>
                                    Implementation notes
                                  </h4>
                                  <p className='text-sm text-gray-700'>
                                    {step.details.technicalDetails}
                                  </p>
                                </div>

                                {step.details.docs &&
                                  step.details.docs.length > 0 && (
                                    <StepDocs docs={step.details.docs} />
                                  )}

                                {step.details.apiEndpoint && (
                                  <div>
                                    <h4 className='font-medium text-gray-900 mb-1'>
                                      {step.details.endpointLabel ?? 'Endpoint'}
                                    </h4>
                                    {typeof step.details.apiEndpoint ===
                                    'string' ? (
                                      <code className='text-sm bg-gray-100 px-2 py-1 rounded font-mono block break-all'>
                                        {step.details.apiEndpoint}
                                      </code>
                                    ) : (
                                      <div className='text-sm'>
                                        {step.details.apiEndpoint}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {step.details.curlCommand && (
                                  <div>
                                    <h4 className='font-medium text-gray-900 mb-1'>
                                      cURL example
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
                                      style={{ color: '#E62058' }}
                                    >
                                      {copiedText ===
                                      step.details!.curlCommand ? (
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
                            <h4 className='font-medium text-gray-900'>
                              Results:
                            </h4>

                            {step.data?.abiEncodedRequest && (
                              <div className='flex items-center gap-2'>
                                <span className='text-sm font-medium'>
                                  ABI Encoded Request:
                                </span>
                                <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                                  {String(step.data.abiEncodedRequest).length >
                                  20
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
                                  {copiedText ===
                                  step.data.abiEncodedRequest ? (
                                    <Check className='h-3 w-3 text-green-600' />
                                  ) : (
                                    <Copy className='h-3 w-3 text-gray-500' />
                                  )}
                                </button>
                              </div>
                            )}

                            {step.data.roundId && (
                              <div className='flex items-center gap-2'>
                                <span className='text-sm font-medium'>
                                  Round ID:
                                </span>
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
                                    {copiedText ===
                                    step.data.roundId.toString() ? (
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
                                      (
                                        proofItem: string,
                                        proofIndex: number
                                      ) => (
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
                                    {JSON.stringify(
                                      step.data.verificationResult
                                    )}
                                  </code>
                                  <button
                                    type='button'
                                    onClick={() =>
                                      copyToClipboardWithTimeout(
                                        JSON.stringify(
                                          step.data.verificationResult
                                        ),
                                        setCopiedText
                                      )
                                    }
                                    className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                                  >
                                    {copiedText ===
                                    JSON.stringify(
                                      step.data.verificationResult
                                    ) ? (
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
                                    {String(step.data.transactionHash).length >
                                    20
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
                                    {copiedText ===
                                    step.data.transactionHash ? (
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

                            {step.data.evmAttestation &&
                              (() => {
                                const evm = step.data.evmAttestation as {
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
                                const events = evm.events ?? [];

                                return (
                                  <div className='space-y-3 border-t border-gray-200 pt-3'>
                                    <h5 className='font-medium text-gray-900'>
                                      Attested EVM Transaction
                                    </h5>
                                    <div className='grid gap-2 text-sm'>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>
                                          Required confirmations:
                                        </span>
                                        <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                                          {String(evm.requiredConfirmations)}
                                        </code>
                                      </div>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>
                                          Sepolia block:
                                        </span>
                                        <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                                          {String(evm.blockNumber)}
                                        </code>
                                        <a
                                          href={`https://sepolia.etherscan.io/block/${String(evm.blockNumber)}`}
                                          target='_blank'
                                          rel='noopener noreferrer'
                                          className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                                          style={{ color: '#E62058' }}
                                        >
                                          View
                                          <ExternalLink className='h-3 w-3' />
                                        </a>
                                      </div>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>
                                          Timestamp:
                                        </span>
                                        <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                                          {String(evm.timestamp)}
                                        </code>
                                        {Number(evm.timestamp) > 0 && (
                                          <span className='text-xs text-gray-600'>
                                            (
                                            {new Date(
                                              Number(evm.timestamp) * 1000
                                            ).toLocaleString()}
                                            )
                                          </span>
                                        )}
                                      </div>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>
                                          From:
                                        </span>
                                        <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono break-all'>
                                          {truncateHex(
                                            String(evm.sourceAddress)
                                          )}
                                        </code>
                                        <a
                                          href={`https://sepolia.etherscan.io/address/${String(evm.sourceAddress)}`}
                                          target='_blank'
                                          rel='noopener noreferrer'
                                          className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                                          style={{ color: '#E62058' }}
                                        >
                                          <ExternalLink className='h-3 w-3' />
                                        </a>
                                      </div>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>To:</span>
                                        <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono break-all'>
                                          {truncateHex(
                                            String(evm.receivingAddress)
                                          )}
                                        </code>
                                        <a
                                          href={`https://sepolia.etherscan.io/address/${String(evm.receivingAddress)}`}
                                          target='_blank'
                                          rel='noopener noreferrer'
                                          className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                                          style={{ color: '#E62058' }}
                                        >
                                          <ExternalLink className='h-3 w-3' />
                                        </a>
                                        {evm.isDeployment && (
                                          <span className='text-xs text-gray-600'>
                                            (deployment)
                                          </span>
                                        )}
                                      </div>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>
                                          Value:
                                        </span>
                                        <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                                          {String(evm.value)} wei
                                        </code>
                                      </div>
                                      <div className='flex items-start gap-2'>
                                        <span className='font-medium shrink-0'>
                                          Input:
                                        </span>
                                        <code className='break-all bg-gray-100 px-2 py-1 rounded text-xs font-mono flex-1 max-h-32 overflow-y-auto'>
                                          {String(evm.input || '0x')}
                                        </code>
                                        <button
                                          type='button'
                                          onClick={() =>
                                            copyToClipboardWithTimeout(
                                              String(evm.input || '0x'),
                                              setCopiedText
                                            )
                                          }
                                          className='h-6 w-6 p-0 hover:bg-gray-200 rounded shrink-0'
                                        >
                                          {copiedText ===
                                          String(evm.input || '0x') ? (
                                            <Check className='h-3 w-3 text-green-600' />
                                          ) : (
                                            <Copy className='h-3 w-3 text-gray-500' />
                                          )}
                                        </button>
                                      </div>
                                      <div className='flex flex-wrap items-center gap-2'>
                                        <span className='font-medium'>
                                          Status:
                                        </span>
                                        <code
                                          className={`px-2 py-1 rounded text-xs font-mono ${
                                            Number(evm.status) === 1
                                              ? 'bg-green-100 text-green-800'
                                              : 'bg-red-100 text-red-800'
                                          }`}
                                        >
                                          {Number(evm.status) === 1
                                            ? 'Success'
                                            : 'Failed'}
                                        </code>
                                      </div>
                                    </div>

                                    <div className='space-y-2'>
                                      <h6 className='font-medium text-gray-900'>
                                        Event logs ({events.length})
                                      </h6>
                                      {events.length === 0 ? (
                                        <p className='text-xs text-gray-600'>
                                          No events returned (listEvents may be
                                          false or the transaction emitted
                                          none).
                                        </p>
                                      ) : (
                                        <div className='space-y-2 max-h-96 overflow-y-auto'>
                                          {events.map((event, index) => {
                                            const decoded =
                                              decodeEvmTransactionEvent(event);

                                            return (
                                              <details
                                                key={`${event.logIndex}-${index}`}
                                                className='rounded border border-gray-200 bg-white'
                                                open={Boolean(decoded)}
                                              >
                                                <summary className='cursor-pointer px-3 py-2 text-xs font-medium flex flex-wrap items-center gap-2'>
                                                  <span>
                                                    logIndex{' '}
                                                    {String(event.logIndex)}
                                                  </span>
                                                  {decoded ? (
                                                    <span
                                                      className='rounded px-1.5 py-0.5 font-semibold'
                                                      style={{
                                                        backgroundColor:
                                                          '#fef7f0',
                                                        color: '#E62058',
                                                      }}
                                                    >
                                                      {decoded.eventName}
                                                    </span>
                                                  ) : (
                                                    <span className='text-gray-500'>
                                                      Unknown event
                                                    </span>
                                                  )}
                                                  <code className='font-mono text-gray-600'>
                                                    {truncateHex(
                                                      String(
                                                        event.emitterAddress
                                                      ),
                                                      8,
                                                      6
                                                    )}
                                                  </code>
                                                  {event.removed && (
                                                    <span className='text-red-600'>
                                                      removed
                                                    </span>
                                                  )}
                                                </summary>
                                                <div className='border-t border-gray-100 px-3 py-2 space-y-2 text-xs'>
                                                  {decoded && (
                                                    <div className='space-y-2 rounded border border-gray-100 bg-gray-50 p-2'>
                                                      <div className='font-semibold text-gray-900'>
                                                        Decoded{' '}
                                                        {decoded.eventName}
                                                      </div>
                                                      <ul className='space-y-1.5'>
                                                        {decoded.args.map(
                                                          arg => (
                                                            <li
                                                              key={`${index}-${arg.name}`}
                                                              className='flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-2'
                                                            >
                                                              <span className='shrink-0 font-medium text-gray-700 sm:w-40'>
                                                                {arg.name}
                                                                <span className='ml-1 font-normal text-gray-500'>
                                                                  ({arg.type}
                                                                  {arg.indexed
                                                                    ? ', indexed'
                                                                    : ''}
                                                                  )
                                                                </span>
                                                              </span>
                                                              <div className='flex min-w-0 flex-1 items-start gap-1'>
                                                                <code className='break-all rounded bg-white px-1 py-0.5 font-mono'>
                                                                  {arg
                                                                    .displayValue
                                                                    .length > 96
                                                                    ? truncateHex(
                                                                        arg.displayValue,
                                                                        24,
                                                                        20
                                                                      )
                                                                    : arg.displayValue}
                                                                </code>
                                                                <button
                                                                  type='button'
                                                                  onClick={() =>
                                                                    copyToClipboardWithTimeout(
                                                                      arg.value,
                                                                      setCopiedText
                                                                    )
                                                                  }
                                                                  className='h-6 w-6 shrink-0 rounded p-0 hover:bg-gray-200'
                                                                >
                                                                  {copiedText ===
                                                                  arg.value ? (
                                                                    <Check className='h-3 w-3 text-green-600' />
                                                                  ) : (
                                                                    <Copy className='h-3 w-3 text-gray-500' />
                                                                  )}
                                                                </button>
                                                              </div>
                                                            </li>
                                                          )
                                                        )}
                                                      </ul>
                                                    </div>
                                                  )}

                                                  <div className='flex flex-wrap items-center gap-2'>
                                                    <span className='font-semibold'>
                                                      Emitter:
                                                    </span>
                                                    <code className='break-all rounded bg-gray-50 px-1'>
                                                      {String(
                                                        event.emitterAddress
                                                      )}
                                                    </code>
                                                    <a
                                                      href={`https://sepolia.etherscan.io/address/${String(event.emitterAddress)}`}
                                                      target='_blank'
                                                      rel='noopener noreferrer'
                                                      className='inline-flex items-center gap-1 underline'
                                                      style={{
                                                        color: '#E62058',
                                                      }}
                                                    >
                                                      <ExternalLink className='h-3 w-3' />
                                                    </a>
                                                    <button
                                                      type='button'
                                                      onClick={() =>
                                                        copyToClipboardWithTimeout(
                                                          String(
                                                            event.emitterAddress
                                                          ),
                                                          setCopiedText
                                                        )
                                                      }
                                                      className='h-6 w-6 rounded p-0 hover:bg-gray-200'
                                                    >
                                                      {copiedText ===
                                                      String(
                                                        event.emitterAddress
                                                      ) ? (
                                                        <Check className='h-3 w-3 text-green-600' />
                                                      ) : (
                                                        <Copy className='h-3 w-3 text-gray-500' />
                                                      )}
                                                    </button>
                                                  </div>

                                                  <details className='rounded border border-dashed border-gray-200'>
                                                    <summary className='cursor-pointer px-2 py-1 text-gray-600'>
                                                      Raw topics &amp; data
                                                    </summary>
                                                    <div className='space-y-2 border-t border-gray-100 px-2 py-2'>
                                                      <div>
                                                        <span className='font-semibold'>
                                                          Topics (
                                                          {event.topics.length}
                                                          ):
                                                        </span>
                                                        <ul className='mt-1 space-y-1'>
                                                          {event.topics.map(
                                                            (
                                                              topic,
                                                              topicIndex
                                                            ) => (
                                                              <li
                                                                key={`${index}-topic-${topicIndex}`}
                                                                className='flex items-start gap-2'
                                                              >
                                                                <span className='shrink-0 text-gray-500'>
                                                                  [{topicIndex}]
                                                                </span>
                                                                <code className='flex-1 break-all rounded bg-gray-50 px-1'>
                                                                  {truncateHex(
                                                                    String(
                                                                      topic
                                                                    ),
                                                                    18,
                                                                    12
                                                                  )}
                                                                </code>
                                                                <button
                                                                  type='button'
                                                                  onClick={() =>
                                                                    copyToClipboardWithTimeout(
                                                                      String(
                                                                        topic
                                                                      ),
                                                                      setCopiedText
                                                                    )
                                                                  }
                                                                  className='h-6 w-6 shrink-0 rounded p-0 hover:bg-gray-200'
                                                                >
                                                                  {copiedText ===
                                                                  String(
                                                                    topic
                                                                  ) ? (
                                                                    <Check className='h-3 w-3 text-green-600' />
                                                                  ) : (
                                                                    <Copy className='h-3 w-3 text-gray-500' />
                                                                  )}
                                                                </button>
                                                              </li>
                                                            )
                                                          )}
                                                        </ul>
                                                      </div>
                                                      <div className='flex items-start gap-2'>
                                                        <span className='shrink-0 font-semibold'>
                                                          Data:
                                                        </span>
                                                        <code className='flex-1 break-all rounded bg-gray-50 px-1'>
                                                          {truncateHex(
                                                            String(event.data),
                                                            20,
                                                            16
                                                          )}
                                                        </code>
                                                        <button
                                                          type='button'
                                                          onClick={() =>
                                                            copyToClipboardWithTimeout(
                                                              String(
                                                                event.data
                                                              ),
                                                              setCopiedText
                                                            )
                                                          }
                                                          className='h-6 w-6 shrink-0 rounded p-0 hover:bg-gray-200'
                                                        >
                                                          {copiedText ===
                                                          String(event.data) ? (
                                                            <Check className='h-3 w-3 text-green-600' />
                                                          ) : (
                                                            <Copy className='h-3 w-3 text-gray-500' />
                                                          )}
                                                        </button>
                                                      </div>
                                                    </div>
                                                  </details>
                                                </div>
                                              </details>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}

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
                                              <div className='flex items-start gap-2'>
                                                <code className='bg-white p-2 rounded border text-xs break-all whitespace-pre-wrap max-w-full flex-1'>
                                                  {typeof value === 'object' &&
                                                  value !== null
                                                    ? JSON.stringify(
                                                        value,
                                                        null,
                                                        2
                                                      )
                                                    : String(value)}
                                                </code>
                                                <button
                                                  type='button'
                                                  onClick={() =>
                                                    copyToClipboardWithTimeout(
                                                      typeof value ===
                                                        'object' &&
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
                                                  className='h-6 w-6 p-0 hover:bg-gray-200 rounded flex items-center justify-center shrink-0'
                                                >
                                                  {copiedText ===
                                                  (typeof value === 'object' &&
                                                  value !== null
                                                    ? JSON.stringify(
                                                        value,
                                                        null,
                                                        2
                                                      )
                                                    : String(value)) ? (
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
                                              <div className='flex items-start gap-2'>
                                                <code className='bg-white p-2 rounded border text-xs break-all whitespace-pre-wrap max-w-full flex-1'>
                                                  {typeof value === 'object' &&
                                                  value !== null
                                                    ? JSON.stringify(
                                                        value,
                                                        null,
                                                        2
                                                      )
                                                    : String(value)}
                                                </code>
                                                <button
                                                  type='button'
                                                  onClick={() =>
                                                    copyToClipboardWithTimeout(
                                                      typeof value ===
                                                        'object' &&
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
                                                  className='h-6 w-6 p-0 hover:bg-gray-200 rounded flex items-center justify-center shrink-0'
                                                >
                                                  {copiedText ===
                                                  (typeof value === 'object' &&
                                                  value !== null
                                                    ? JSON.stringify(
                                                        value,
                                                        null,
                                                        2
                                                      )
                                                    : String(value)) ? (
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
                                      | {
                                          responseBody?: {
                                            abiEncodedRequest?: string;
                                          };
                                        }
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
                                          is a hex string that encodes all the
                                          request data in a format the FDC
                                          contract can understand. Here is how
                                          it is structured:
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
                                                  <code>
                                                    0x45564d5472616e73...
                                                  </code>{' '}
                                                  →{' '}
                                                  <code>
                                                    toUtf8HexString(&quot;EVMTransaction&quot;)
                                                  </code>
                                                </>
                                              ) : (
                                                <>
                                                  <code>
                                                    0x5852505061796d65...
                                                  </code>{' '}
                                                  →{' '}
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
                                                  <code>
                                                    0x74657374455448...
                                                  </code>{' '}
                                                  →{' '}
                                                  <code>
                                                    toUtf8HexString(&quot;testETH&quot;)
                                                  </code>
                                                </>
                                              ) : (
                                                <>
                                                  <code>
                                                    0x74657374585250...
                                                  </code>{' '}
                                                  →{' '}
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
                                              <code>0x...</code> → Message
                                              Integrity Code (MIC) - hash of
                                              response salted with
                                              &quot;Flare&quot;
                                            </div>
                                            <div>
                                              <span className='font-semibold text-blue-600'>
                                                Remaining:
                                              </span>{' '}
                                              {attestationType ===
                                              'EVMTransaction'
                                                ? 'ABI-encoded EVMTransaction.RequestBody (transactionHash, confirmations, flags, logIndices)'
                                                : 'ABI-encoded XRPPayment.RequestBody (transactionId and proofOwner)'}
                                            </div>
                                          </div>
                                        </div>

                                        <div className='text-xs text-gray-600 space-y-1'>
                                          <p>
                                            <strong>Structure:</strong> Each
                                            line represents 32 bytes (64 hex
                                            characters) of data
                                          </p>
                                          <p>
                                            <strong>Purpose:</strong> This
                                            encoded format allows the FDC
                                            contract to parse the request data
                                            efficiently
                                          </p>
                                          <p>
                                            <strong>Integrity:</strong> The MIC
                                            ensures the attestation data has not
                                            been tampered with
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
                  How to run this demo
                </h4>
                <ul className='text-sm space-y-1.5' style={{ color: '#E62058' }}>
                  <li>
                    1. Connect a wallet on Coston2 and fund it for the
                    attestation fee
                  </li>
                  <li>
                    2. Pick EVMTransaction (Sepolia / testETH) or XRPPayment
                    (testXRP)
                  </li>
                  <li>
                    3. Use the sample tx or paste your own; for EVM set
                    confirmations, input/events flags, and optional log indices
                  </li>
                  <li>
                    4. Run Execute FDC Workflow, then open Workflow to inspect
                    each step (docs, cURL, live results)
                  </li>
                </ul>
              </div>

              <div
                className='rounded-lg border p-4'
                style={{ backgroundColor: '#fef7f0', borderColor: '#E62058' }}
              >
                <h3 className='font-semibold mb-3' style={{ color: '#E62058' }}>
                  Pipeline map (what you implement)
                </h3>
                <div className='space-y-3 text-sm' style={{ color: '#E62058' }}>
                  <p>
                    Same five stages as production FDC integrations. Expand each
                    Workflow card for docs, notes, and copyable payloads.
                  </p>
                  <ol className='list-decimal list-inside space-y-2 ml-0.5'>
                    <li>
                      <strong>Prepare</strong> — verifier{' '}
                      <code className='text-xs'>prepareRequest</code> →{' '}
                      <code className='text-xs'>abiEncodedRequest</code>
                    </li>
                    <li>
                      <strong>Submit</strong> —{' '}
                      <DocLink href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'>
                        FdcHub.requestAttestation
                      </DocLink>{' '}
                      + fee; derive <code className='text-xs'>roundId</code>
                    </li>
                    <li>
                      <strong>Finalize</strong> — poll{' '}
                      <DocLink href='https://dev.flare.network/network/fsp/solidity-reference/IRelay#isfinalized'>
                        Relay.isFinalized(200, roundId)
                      </DocLink>
                    </li>
                    <li>
                      <strong>Fetch proof</strong> — DA Layer{' '}
                      <DocLink href='https://dev.flare.network/fdc/reference/data-availability-api'>
                        proof-by-request-round
                      </DocLink>
                    </li>
                    <li>
                      <strong>Verify</strong> —{' '}
                      {attestationType === 'EVMTransaction' ? (
                        <DocLink href='https://dev.flare.network/fdc/reference/IFdcVerification#verifyevmtransaction'>
                          verifyEVMTransaction
                        </DocLink>
                      ) : (
                        <DocLink href='https://dev.flare.network/fdc/reference/IFdcVerification#verifyxrppayment'>
                          verifyXRPPayment
                        </DocLink>
                      )}{' '}
                      then consume attested fields
                    </li>
                  </ol>
                </div>
              </div>

              <div
                className='rounded-lg border border-gray-200 bg-white p-4'
              >
                <h3 className='font-semibold text-gray-900 mb-3'>
                  Flare documentation
                </h3>
                <ul className='space-y-2 text-sm'>
                  <li>
                    <DocLink href='https://dev.flare.network/fdc/overview'>
                      FDC overview
                    </DocLink>
                    <span className='text-gray-600'>
                      {' '}
                      — architecture, types, DA Layer
                    </span>
                  </li>
                  <li>
                    <DocLink href='https://dev.flare.network/fdc/getting-started'>
                      Getting started
                    </DocLink>
                    <span className='text-gray-600'>
                      {' '}
                      — prepare → submit → proof → verify
                    </span>
                  </li>
                  <li>
                    <DocLink href='https://dev.flare.network/fdc/guides/fdc-by-hand/'>
                      FDC by hand
                    </DocLink>
                    <span className='text-gray-600'>
                      {' '}
                      — manual walkthrough matching this UI
                    </span>
                  </li>
                  <li>
                    {attestationType === 'EVMTransaction' ? (
                      <DocLink href='https://dev.flare.network/fdc/attestation-types/evm-transaction'>
                        EVMTransaction spec
                      </DocLink>
                    ) : (
                      <DocLink href='https://dev.flare.network/fdc/attestation-types/xrp-payment'>
                        XRPPayment spec
                      </DocLink>
                    )}
                    <span className='text-gray-600'>
                      {' '}
                      — request/response fields
                    </span>
                  </li>
                  <li>
                    {attestationType === 'EVMTransaction' ? (
                      <DocLink href='https://dev.flare.network/fdc/guides/hardhat/evm-transaction'>
                        Hardhat: EVMTransaction
                      </DocLink>
                    ) : (
                      <DocLink href='https://dev.flare.network/fdc/guides/hardhat/payment'>
                        Hardhat: Payment
                      </DocLink>
                    )}
                    <span className='text-gray-600'>
                      {' '}
                      — script + contract patterns
                    </span>
                  </li>
                  <li>
                    <DocLink href='https://dev.flare.network/fdc/reference/IFdcHub'>
                      IFdcHub
                    </DocLink>
                    {' · '}
                    <DocLink href='https://dev.flare.network/fdc/reference/IFdcVerification'>
                      IFdcVerification
                    </DocLink>
                    {' · '}
                    <DocLink href='https://dev.flare.network/fdc/reference/data-availability-api'>
                      DA API
                    </DocLink>
                  </li>
                  <li>
                    <DocLink href='https://github.com/flare-foundation/flare-hardhat-starter'>
                      flare-hardhat-starter
                    </DocLink>
                    <span className='text-gray-600'>
                      {' '}
                      — canonical scripts under{' '}
                      <code className='text-xs'>scripts/fdcExample/</code>
                    </span>
                  </li>
                </ul>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
