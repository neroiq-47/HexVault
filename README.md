# HexVault

Four cooperating AI agents (Scout, Analyst, Risk Manager, Trader) watch live Solana prices and trade from an agent wallet, sweeping profit to `5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA`.

| `TRADING_MODE` | What happens | Real funds |
| --- | --- | --- |
| `paper` (default) | Simulated fills at market price plus 0.3% | No |
| `shadow` | Real Jupiter quotes on mainnet; fills are booked at the quoted amounts but nothing is sent | No |
| `live` | Jupiter swaps signed by the agent wallet and sent on mainnet | **Yes** |

**Live trading can lose money.** The most you can lose is what is in the agent wallet, so fund it only with a float you can afford to lose.

```
DexScreener prices ─▶ Scout ─▶ Analyst ─▶ Risk Manager ─▶ hard limits (code) ─▶ Trader (paper, shadow or Jupiter swap)
                                                                                     │
                                         daily: profit above float + 0.02 SOL ─▶ SOL sent to the profit address
```

- **Agents** ask Claude (`ANTHROPIC_API_KEY`). Without a key, or if a reply is not valid JSON, each agent falls back to built-in rules.
- **Hard limits** run after the Risk agent, so nothing an agent says can bypass them: pools under $100k liquidity are refused, each buy is capped (5/10/15% of equity for low/med/high risk), open positions are capped (2/3/4), and buys stop for the day after a 3/5/8% loss.
- **Paper fills** pay 0.3% on every trade, so results are not flattered.
- **Profit sweep** runs at most once a day. Only cash above the starting float plus a 0.02 SOL reserve leaves, and only to the allow-listed address (`src/config.js`). In paper mode with a devnet wallet it sends the matching devnet SOL; in shadow mode it is a record only. If a send fails, the profit stays in the book.
- **Kill switch** closes every position, stops trading and sweeps any profit.
- **Drawdown stop:** when equity falls `MAX_DRAWDOWN` (default 20%) below the float, the bot closes everything and halts. In live mode equity is the wallet's on-chain value.
- **Live swaps** (`src/jupiter.js`, `src/live.js`): only the six watchlist tokens, SOL to token and back, slippage capped at 1%, quotes over 0.5% price impact are refused. A fill is booked only after the transaction confirms. In live mode the daily sweep sends only free SOL above the float plus reserve, and never more than the wallet's gain.
- **Trust in Jupiter:** live mode signs the transaction Jupiter's API returns. Keep only the trading float in the agent wallet.

## Quick start

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
npm run wallet:new        # prints a new agent wallet; put the secret in AGENT_WALLET_SECRET
npm run airdrop           # 1 free devnet SOL for the agent wallet
npm test
npm start                 # http://127.0.0.1:3000/api/state
```

## API

| Route | What it does |
| --- | --- |
| `GET /health` | Liveness check |
| `GET /api/state` | Prices, last round of agent messages, paper book, sweeps (never the wallet secret) |
| `POST /api/kill` | Kill switch. Needs `Authorization: Bearer <ADMIN_SECRET>` |
| `POST /api/resume` | Resume trading after a kill. Same header |

## Railway

The Dockerfile is used automatically.

| Setting | Value | Why |
| --- | --- | --- |
| Variables | `AGENT_WALLET_SECRET`, `ADMIN_SECRET` (24+ chars), `ANTHROPIC_API_KEY` | wallet, kill switch, agent brains |
| | `TRADING_MODE`, `FLOAT_SOL`, `JUPITER_API_KEY` | shadow and live need all three, plus `AGENT_WALLET_SECRET` |
| | `SOLANA_RPC_URL` | a Helius mainnet URL for shadow and live |
| | `DATA_PATH=/data/state.json`, `RAILWAY_RUN_UID=0` | keep the paper book on a volume; the image runs as non-root |
| Volume | mounted at `/data` | the book survives redeploys |
| Healthcheck | `/health` | a deploy that never becomes healthy is marked failed |
| Replicas | 1 | the JSON store is single-process |

Logs are one JSON object per line with a `level` field.

## Going live

1. Create a new wallet on your own machine with `npm run wallet:new`, and put the secret only in Railway's `AGENT_WALLET_SECRET`.
2. Run `TRADING_MODE=shadow` for a day and read the logs and `/api/state`.
3. Send the float to the agent wallet, set `FLOAT_SOL` to it, and set `TRADING_MODE=live`.

## Dashboard

`dashboard/index.html` is the HexVault dashboard: a single page that paper-trades in the browser with the same four agents and limits. It holds no keys. Open it in a browser to see the DexScreener snapshot; live prices and Claude-run agents work when it is opened as a claude.ai artifact.
