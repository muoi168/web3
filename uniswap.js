const constants = require('./constants')
const ethers = require("ethers");
const provider = new ethers.providers.JsonRpcProvider(constants.OPTIMISM_NODE_URL)
const { TradeType, Token, CurrencyAmount, Percent } = require('@uniswap/sdk-core')
const { AlphaRouter } = require('@uniswap/smart-order-router')
const { BigNumber } = require('@ethersproject/bignumber')

const erc20_abi = require('../abi/erc20.json')
const { timeout } = require('./timeout')

async function getTokenAndBalance(chainId, contract, walletAddress) {
  let [dec, symbol, name, balance] = await Promise.all(
      [
        contract.decimals(),
        contract.symbol(),
        contract.name(),
        contract.balanceOf(walletAddress)
      ]);
  return [new Token(chainId, contract.address, dec, symbol, name), balance];
}

async function swap_on_uniswap(account, chainId, token_in, token_out, amount) {
  // ============= connect to blockchain and get token balances
  console.log("Connecting to blockchain, loading token balances...");
  console.log('');

  const walletAddress = account.address
  const signer = new ethers.Wallet(account.privateKey, provider);

  const contractIn = new ethers.Contract(token_in.address, erc20_abi, signer);
  const contractOut = new ethers.Contract(token_out.address, erc20_abi, signer);

  const [tokenIn, balanceTokenIn] = await getTokenAndBalance(chainId, contractIn, account.address);
  const [tokenOut, balanceTokenOut] = await getTokenAndBalance(chainId, contractOut, account.address);

  console.log(`Wallet ${account.address} balances:`);
  console.log(`   Input: ${tokenIn.symbol} (${tokenIn.name}): ${ethers.utils.formatUnits(balanceTokenIn, tokenIn.decimals)}`);
  console.log(`   Output: ${tokenOut.symbol} (${tokenOut.name}): ${ethers.utils.formatUnits(balanceTokenOut, tokenOut.decimals)}`);
  console.log("");

  const amountIn = ethers.utils.parseUnits(amount, tokenIn.decimals);

  // ============= Loading a swap route
  console.log('');
  console.log("Loading a swap route...");

  const inAmount = CurrencyAmount.fromRawAmount(tokenIn, amountIn.toString());

  const router = new AlphaRouter({ chainId: tokenIn.chainId, provider: provider });
  const route = await router.route(
      inAmount,
      tokenOut,
      TradeType.EXACT_INPUT,
      {
        recipient: account.address,
        slippageTolerance: new Percent(1, 1000), // 0.1% slippage
        deadline: Math.floor(Date.now() / 1000 + 1800) // add 1800 seconds – 30 mins deadline
      },
      {
        maxSwapsPerPath: 1 // remove this if you want multi-hop swaps as well.
      }
  );

  if (route == null || route.methodParameters === undefined)
    throw "No route loaded";

  console.log(`   You'll get ${route.quote.toFixed()} of ${tokenOut.symbol}`);

  // output quote minus gas fees
  console.log(`   Gas Adjusted Quote: ${route.quoteGasAdjusted.toFixed()}`);
  console.log(`   Gas Used Quote Token: ${route.estimatedGasUsedQuoteToken.toFixed()}`);
  console.log(`   Gas Used USD: ${route.estimatedGasUsedUSD.toFixed()}`);
  console.log(`   Gas Used: ${route.estimatedGasUsed.toString()}`);
  console.log(`   Gas Price Wei: ${route.gasPriceWei}`);
  console.log('');

  console.log("Making a swap...");
  const value = BigNumber.from(route.methodParameters.value);

  const transaction = {
    data: route.methodParameters.calldata,
    to: constants.UNI_V3_SWAP_ROUTER_ADDRESS,
    value: value,
    from: walletAddress,
    gasPrice: route.gasPriceWei,

    // route.estimatedGasUsed might be too low!
    // most of swaps I tested fit into 300,000 but for some complex swaps this gas is not enough.
    // Loot at etherscan/polygonscan past results.
    gasLimit: BigNumber.from("800000")
  };

  const tx = await signer.sendTransaction(transaction);
  const receipt = await tx.wait();
  if (receipt.status === 0) {
    throw new Error("Swap transaction failed");
  }

  // ============= Final part --- printing results
  const [newBalanceIn, newBalanceOut] = await Promise.all([
    contractIn.balanceOf(walletAddress),
    contractOut.balanceOf(walletAddress)
  ]);

  console.log('');
  console.log('Swap completed successfully! ');
  console.log('');
  console.log('Updated balances:');
  console.log(`   ${tokenIn.symbol}: ${ethers.utils.formatUnits(newBalanceIn, tokenIn.decimals)}`);
  console.log(`   ${tokenOut.symbol}: ${ethers.utils.formatUnits(newBalanceOut, tokenOut.decimals)}`);
}

module.exports = {
  swap_on_uniswap
}


