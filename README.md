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

- **Method library** (`src/methods.js`): every round pulls 15-minute candles per pool from GeckoTerminal (free, no key, cached 10 min) and runs them through the `trading-signals` indicators (EMA 9/21, RSI 14, MACD, ATR 14, Bollinger 20/2, ADX 14). A regime-aware playbook (trend breakout when ADX>25, mean reversion when ADX<20, ATR stop, RSI exits, no chasing) is given to every agent with each token's reading, and the rule fallback trades the same playbook.
- **Agents** ask Claude (`ANTHROPIC_API_KEY`). If Claude fails (no credits, outage, bad JSON) they try free backups in order: Google Gemini 2.5 Flash (`GEMINI_API_KEY`, free key at aistudio.google.com/apikey) then Groq GPT-OSS 120B (`GROQ_API_KEY`, free key at console.groq.com/keys). A provider that fails sits out for 10 minutes. If every provider fails, each agent uses built-in rules. Override models with `GEMINI_MODEL` / `GROQ_MODEL`.
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

## Live switch

The bot serves the HexVault console at `/` on its Railway domain. It shows the agents, positions, trades and sweeps, and holds a Live on/off switch.

- `TRADING_MODE=live` only **arms** the switch. The bot still starts in shadow mode until someone turns the switch on.
- **On** needs the admin secret, starts a fresh book from the agent wallet, and refuses if the wallet holds less than `FLOAT_SOL` minus the drawdown limit.
- **Off** sells every live position back to SOL and returns to shadow mode.
- The switch position survives redeploys. With any other `TRADING_MODE` the switch is locked.

## Donations

With `DONATIONS=on`, the console shows a "Support the agent team" panel. Visitors send 0.5 to 10 SOL from their own browser wallet, or scan a Solana Pay QR code, straight to the agent wallet.

- The page states that a donation buys no share, return, profit or refund.
- A donation made with the button is checked on chain before it counts. Counted donations raise the live baseline, so they are traded as float instead of being swept as profit.
- SOL sent any other way (QR code, wallet app, a plain transfer) is not counted, so in live mode it is treated as profit and swept to the profit address.
- Leave donations off until the agent wallet's secret has only ever been in Railway.

## API

| Route | What it does |
| --- | --- |
| `GET /health` | Liveness check |
| `GET /api/state` | Prices, last round of agent messages, paper book, sweeps (never the wallet secret) |
| `POST /api/kill` | Kill switch. Needs `Authorization: Bearer <ADMIN_SECRET>` |
| `POST /api/resume` | Resume trading after a kill. Same header |
| `POST /api/live` | Live switch: body `{"on": true}` or `{"on": false}`. Same header |
| `GET /api/blockhash`, `POST /api/donation` | Donation flow, only with `DONATIONS=on`. The POST takes `{"signature"}` and checks it on chain |
| `GET /` | The HexVault console |

## Railway

The Dockerfile is used automatically.

| Setting | Value | Why |
| --- | --- | --- |
| Variables | `AGENT_WALLET_SECRET`, `ADMIN_SECRET` (24+ chars), `ANTHROPIC_API_KEY`, optional `GEMINI_API_KEY`, `GROQ_API_KEY` | wallet, kill switch, agent brains and free backups |
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
3. Send the float to the agent wallet, set `FLOAT_SOL` to it, and set `TRADING_MODE=live` to arm the switch.
4. Open the console and turn Live on.

## Dashboard

`dashboard/index.html` is the HexVault dashboard: a single page that paper-trades in the browser with the same four agents and limits. It holds no keys. Open it in a browser to see the DexScreener snapshot; live prices and Claude-run agents work when it is opened as a claude.ai artifact.

## Axiom Degen scanner

`/degen` is a memecoin scanner and social sentiment agent that runs inside the same service on its own loop (`src/degen/`). It only paper-trades and raises alerts; it never signs or sends a transaction. Every core feature runs on free, keyless sources.

| Need | Source (free) | Notes |
|---|---|---|
| New launches, trending pairs, unique buyers/sellers, 5m candles, holder count, dev wallet | GeckoTerminal public API | about 25 calls/min budget |
| Prices, liquidity, volume, socials, paid boosts and profiles | DexScreener public API | about 55 calls/min budget |
| Mint and freeze authority, Token-2022 extensions, top holders, wallet swaps | Solana JSON-RPC (`DEGEN_RPC_URL`, defaults to the public mainnet RPC) | a free Helius or similar key helps under load |
| Extra risk flags | RugCheck public summary | optional; skipped when it does not answer |
| Social posts | Reddit public JSON (r/solana, r/SolanaMemeCoins, r/memecoins, r/CryptoMoonShots) and the 4chan `/biz/` catalog | Reddit often blocks cloud IPs; add a free Reddit app's `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` |
| X and Telegram | none | no free API exists, so the dashboard marks them unavailable instead of inventing sentiment |

Every request goes through a per-source rate budget and a TTL cache that also merges duplicate requests (`src/degen/net.js`). When a budget is used up, lower-priority lookups wait for the next scan instead of exceeding the free tier.

How a token is judged:

1. **Scanner presets** (`fresh`, `momentum`, `runners`) filter on age, market cap, liquidity, 5m volume acceleration, buy/sell ratio, unique buyers, holder growth and breakouts. A rule with no data fails.
2. **Anti-rug gates**: mint authority, freeze authority, dangerous Token-2022 extensions, top-10 wallet concentration (pool and program accounts excluded), the largest wallet, bundled matching-bag wallets, minimum liquidity, liquidity drains, dev selling, wash trading and heavy dumping. A failed gate rejects the token. A gate with no data leaves it **unverified**, which is treated the same as a fail.
3. **Social Momentum Score** (0 to 100): local lexicon sentiment, shill and copy-paste detection, repeat-poster detection and mention spikes. It is `null` (unavailable) when no social source answered, never zero by default.
4. **Smart money**: wallets from `DEGEN_WALLETS` or the dashboard are read from public RPC. Reliability needs at least 5 closed round trips.
5. **Degen Score** (0 to 100) blends momentum, liquidity, price action, smart money and social. Missing parts drop out of the average and lower coverage trims the score.
6. **Alerts** fire for tokens that pass every gate, match a preset, score at least `DEGEN_ALERT_SCORE` and show two or more signals. The paper trader then opens a position with stop at the invalidation level, half off at target 1 and the rest at target 2.

Backtests replay the snapshots the scanner records (about 8 hours for up to 400 tokens) with the same exit rules. If a free model is configured (Groq, Gemini, or a local `OLLAMA_URL`), it writes a one-line take on the top three setups every ten minutes.

| Variable | Default | |
|---|---|---|
| `DEGEN` | `on` | `off` disables the scanner |
| `DEGEN_SCAN_SECONDS` | `60` | minimum 30 |
| `DEGEN_RPC_URL` | public mainnet RPC | the bot's own RPC is used when it is on mainnet |
| `DEGEN_WALLETS` | empty | `address:label,address:label` |
| `DEGEN_ALERT_SCORE` | `70` | |
| `DEGEN_PAPER_USD`, `DEGEN_PAPER_SIZE_USD`, `DEGEN_PAPER_MAX_POSITIONS` | `1000`, `100`, `5` | |
| `DEGEN_SECURITY_PER_CYCLE` | `8` | new tokens security-checked per scan |
| `DEGEN_RUGCHECK` | `on` | |
| `DEGEN_DISCORD_WEBHOOK` | empty | optional free alert delivery |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | empty | optional, free |
| `OLLAMA_URL`, `OLLAMA_MODEL` | empty, `llama3.2` | optional local model |
| `DEGEN_DATA_PATH` | `./data/degen.json` | put it on the `/data` volume |

API: `GET /api/degen/state`, `GET /api/degen/token/:mint`, `GET /api/degen/chart/:mint`, `GET /api/degen/backtest?preset=fresh`, `GET /api/degen/stream` (server-sent events). `POST /api/degen/watch`, `/api/degen/wallets`, `/api/degen/presets` and `/api/degen/paper/reset` need `Authorization: Bearer <ADMIN_SECRET>`.
