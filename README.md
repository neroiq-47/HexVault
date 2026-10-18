# HexVault

Four cooperating AI agents (Scout, Analyst, Risk Manager, Trader) watch live Solana prices and trade a **paper** portfolio. An agent wallet on **devnet** tests the profit sweep to `5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA`. No real funds are used: this version refuses mainnet.

```
DexScreener prices ─▶ Scout ─▶ Analyst ─▶ Risk Manager ─▶ hard limits (code) ─▶ Trader (paper fill)
                                                                                     │
                                         daily: profit above float + 0.02 SOL ─▶ devnet SOL sent to the profit address
```

- **Agents** ask Claude (`ANTHROPIC_API_KEY`). Without a key, or if a reply is not valid JSON, each agent falls back to built-in rules.
- **Hard limits** run after the Risk agent, so nothing an agent says can bypass them: pools under $100k liquidity are refused, each buy is capped (5/10/15% of equity for low/med/high risk), open positions are capped (2/3/4), and buys stop for the day after a 3/5/8% loss.
- **Paper fills** pay 0.3% on every trade, so results are not flattered.
- **Profit sweep** runs at most once a day. Only cash above the starting float plus a 0.02 SOL reserve leaves, and only to the allow-listed address (`src/config.js`). On devnet the bot sends the matching amount of devnet SOL from the agent wallet. If the send fails, the profit stays in the book.
- **Kill switch** closes every position, stops trading and sweeps any profit.

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
| | `SOLANA_CLUSTER=devnet` | the only clusters accepted are devnet and testnet |
| | `SOLANA_RPC_URL` (optional) | a Helius devnet URL is more reliable than the public RPC |
| | `DATA_PATH=/data/state.json`, `RAILWAY_RUN_UID=0` | keep the paper book on a volume; the image runs as non-root |
| Volume | mounted at `/data` | the book survives redeploys |
| Healthcheck | `/health` | a deploy that never becomes healthy is marked failed |
| Replicas | 1 | the JSON store is single-process |

Logs are one JSON object per line with a `level` field.

## Not in this version

Mainnet trading and real Jupiter swaps. Those come in phase 3, only after paper results beat holding SOL and the owner approves live trading and a starting float.
