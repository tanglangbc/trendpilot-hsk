// HSK Chain network + HSKSwap addresses.
// Sources (all verified 2026-11-24):
// - Chain IDs / RPCs: docs.hskchain.net "RPC & Node Provider" (mainnet 177, testnet 133);
//   verified live via eth_chainId on https://mainnet.hsk.xyz (0xb1) and
//   https://testnet.hsk.xyz (0x85).
// - HSKSwap contract addresses: read from the official @hskswap/sdk-core@1.0.3 npm
//   package (CHAIN_TO_ADDRESSES_MAP); testnet router bytecode confirmed on-chain.
// - Explorers: https://hashkey.blockscout.com (mainnet),
//   https://testnet-explorer.hsk.xyz (testnet).
// - One stale doc page lists chain ID 1719 / hsk-mainnet.hashkey.com — DO NOT USE;
//   the current docs and live RPCs agree on 177/133.
module.exports = {
  testnet: {
    chainId: 133,
    name: 'HSK Chain Testnet',
    rpc: 'https://testnet.hsk.xyz',
    explorer: 'https://testnet-explorer.hsk.xyz',
    faucet: 'thirdweb universal faucet (0.01 tHSK/day, wallet connect + click): https://thirdweb.com — search "HashKey Chain Testnet"',
    hskswap: {
      factory: '0x2dC2c21D1049F786C535bF9d45F999dB5474f3A0',
      router02: '0xa6914E66690c6794244B5f66a09eAEbf66254237',
      quoterV2: '0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC',
      positionManager: '0x73dEc6bfa6751509b08480bd97f54b874E3b20e8',
      multicall: '0x47F625Ec29637445AA1570d7008Cf78692CdA096',
      whsk: '0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6',
      // Testnet USDT from the live USDT/WHSK pool (fee 500):
      // pool 0xff2b7e501c870980bf5641b4a70d0f9fb0f6f6ab
      usdt: '0x98b6173a8b7dfc52ce8bc88f1184a918a1ccaa4f',
      subgraph: 'https://graphnode-testnet.hashkeychain.net/subgraphs/name/uniswap-v3/hsk-test',
    },
  },
  mainnet: {
    chainId: 177,
    name: 'HSK Chain Mainnet',
    rpc: 'https://mainnet.hsk.xyz',
    explorer: 'https://hashkey.blockscout.com',
    hskswap: {
      factory: '0x972cA9D1662F5e029cD18327D29026532E84c742',
      router02: '0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3',
      quoterV2: '0x603f70466fDdbE3F238220B9a74FFF419a2BbFDD',
      positionManager: '0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5',
      multicall: '0x7D0CBa43EbDD69ec2CE3B5AeAD3b0FbC796c565B',
      whsk: '0xB210D2120d57b758EE163cFfb43e73728c471Cf1',
      // Mainnet tokens from live HSKSwap pools (verified via subgraph):
      usdt: '0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029', // 6 decimals
      wbtc: '0x6119ca49a79f5825c8b345f8d7ac36b272565b14', // 8 decimals, pool 0xd9ea2ce468957ba49ccc38c4758ed6ecd561449a (fee 3000)
      weth: '0xefd4bc9afd210517803f293ababd701caeecdfd0', // 18 decimals, pool 0xb92b79ed6b370d5cfee2e14b1d0983c258304c16 (fee 3000)
      subgraph: 'https://graphnode.hashkeychain.net/subgraphs/name/hskswap',
    },
  },
};
