// Shared test data: a DexScreener-shaped response and a market built from it.
export const PAIRS = [
  { baseToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: '100', liquidity: { usd: 28e6 }, priceChange: { m5: 0, h1: 0.4, h6: -1, h24: -1 }, volume: { h24: 8e7 }, txns: { h1: { buys: 2100, sells: 1900 } } },
  { baseToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: '999', liquidity: { usd: 5e3 }, priceChange: {}, volume: {}, txns: {} },
  { baseToken: { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' }, priceUsd: '0.28', liquidity: { usd: 690e3 }, priceChange: { m5: 0.1, h1: 0.5, h6: -2, h24: -3 }, volume: { h24: 6e5 }, txns: { h1: { buys: 150, sells: 100 } } },
  { baseToken: { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' }, priceUsd: '0.19', liquidity: { usd: 60e3 }, priceChange: { m5: 0.5, h1: 2, h6: 1, h24: 1 }, volume: { h24: 2e5 }, txns: { h1: { buys: 300, sells: 100 } } },
  { baseToken: { address: 'NotOnWatchlist111111111111111111111111111111' }, priceUsd: '1', liquidity: { usd: 1e9 } },
];
