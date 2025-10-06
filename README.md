# Flare Data Connector (FDC) Demo

A comprehensive interactive tutorial demonstrating the complete Flare Data Connector (FDC) workflow for XRP Payment Attestation. This demo showcases how to request, verify, and use cross-chain data from external networks on Flare.

## 🚀 What is FDC?

The [Flare Data Connector (FDC)](https://dev.flare.network/fdc/overview) is a decentralized oracle system that allows smart contracts on Flare to securely access data from external networks like XRP Ledger. This demo walks you through the complete process of requesting and verifying XRP payment attestations.

## ✨ Features

### Interactive FDC Workflow Tutorial

- **Step-by-step guidance** through the complete FDC process
- **Real blockchain transactions** using Flare Coston2 testnet
- **Live API interactions** with FDC verifier servers
- **Educational content** explaining what happens behind the scenes
- **Explorer links** to view transactions and voting rounds
- **Error handling** with detailed feedback

### Complete FDC Process Demonstration

1. **Prepare Request** - Generate ABI-encoded attestation request
2. **Submit Request** - Execute `FdcHub.requestAttestation` transaction
3. **Wait for Finalization** - Monitor voting round completion
4. **Retrieve Proof** - Get attestation data from Data Availability Layer
5. **Verify Payment** - Validate the attestation on-chain

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+
- MetaMask wallet extension
- Flare Coston2 testnet configured in MetaMask
- Some FLR tokens for gas fees (get testnet tokens from [Flare Faucet](https://faucet.flare.network/))

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd fdc-demo-dapp
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## 📚 How to Use the Demo

### 1. Connect Your Wallet

- Click "Connect Wallet" to connect MetaMask
- Ensure you're on Flare Coston2 testnet
- Make sure you have some FLR for gas fees

### 2. Enter Transaction ID

- Input a valid XRP transaction ID (or use the provided example)
- The demo will use this transaction to demonstrate the FDC workflow

### 3. Follow the Interactive Tutorial

- Click "Start FDC Workflow" to begin
- Each step will execute real blockchain transactions
- Expand step details to learn about the technical implementation
- Watch as the demo interacts with:
  - FDC verifier servers
  - Flare smart contracts
  - Data Availability Layer
  - Flare Systems Explorer

### 4. Explore the Results

- View transaction hashes with links to Flare explorer
- Check voting round information
- Examine the final verification results

## 🔧 Technical Implementation

### Core Components

#### `Fdc.tsx` - Main FDC Workflow Component

The primary component that orchestrates the entire FDC workflow:

- **Form handling** for transaction ID input
- **Real blockchain interactions** using Wagmi hooks
- **API calls** to FDC verifier servers
- **Step-by-step tutorial** with educational content
- **Error handling** and loading states

### Key Technologies

- **Next.js 14** - React framework
- **Wagmi** - Ethereum library for React
- **Viem** - TypeScript interface for Ethereum
- **Tailwind CSS** - Styling
- **Shadcn/ui** - UI components

### Smart Contracts Used

- **FdcHub** - Main FDC contract for requesting attestations
- **FdcRequestFeeConfigurations** - Fee calculation
- **FdcVerification** - On-chain verification

## 📖 Educational Content

The demo includes comprehensive educational content explaining:

- **What happens** at each step of the FDC process
- **Technical details** about API endpoints and smart contracts
- **Real request/response data** from verifier servers
- **Links to official documentation** for deeper learning

## 🔗 Important Links

- [FDC Overview](https://dev.flare.network/fdc/overview)
- [FDC Implementation Guide](https://dev.flare.network/fdc/guides/fdc-by-hand)
- [FdcHub Contract Reference](https://dev.flare.network/fdc/reference/IFdcHub)
- [FdcVerification Contract Reference](https://dev.flare.network/fdc/reference/IFdcVerification)
- [XRP Payment Attestation](https://dev.flare.network/fdc/attestation-types/payment)

## 🐛 Troubleshooting

### Common Issues

1. **MetaMask not connecting**: Ensure MetaMask is installed and unlocked
2. **Network errors**: Verify you're connected to Flare Coston2 testnet
3. **Transaction failures**: Check your account has sufficient FLR for gas fees
4. **API errors**: The demo uses testnet verifier servers; check network connectivity
5. **Invalid transaction ID**: Use a valid XRP transaction hash

### Getting Testnet Tokens

- Visit [Flare Faucet](https://faucet.flare.network/) to get testnet FLR
- Add Flare Coston2 testnet to MetaMask:
  - Network Name: Flare Coston2
  - RPC URL: https://coston2-api.flare.network/ext/bc/C/rpc
  - Chain ID: 114
  - Currency Symbol: C2FLR

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test the FDC workflow
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🚀 Deployment

The easiest way to deploy this Next.js app is using [Vercel](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

**Note**: This demo uses Flare Coston2 testnet. All transactions and data are for demonstration purposes only.
