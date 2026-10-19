# HexSyndicate brand outline

## The name

**HexSyndicate** (12 characters). Picked by the agent team from a shortlist of names that keep the HexVault equity and say "crew":

| Shortlist | Length | Why it lost |
| --- | --- | --- |
| **HexSyndicate** | 12 | Winner. Keeps "Hex", and a syndicate is exactly what this is: four specialists pooling one vault. |
| VaultSyndicate | 14 | Clunky out loud, loses the short "Hex" handle |
| NeonSyndicate | 13 | Pretty, but says nothing about the vault or Solana |
| DegenSyndicate | 14 | Too close to a pump group, and the Risk Manager vetoed it |

- Written as one word, capital H and S: **HexSyndicate**. Never "Hex Syndicate" or "HEXSYNDICATE" in body text.
- Short handle: **Hex**. "The Syndicate" works for the four agents as a group.
- The repo, Railway service and URLs keep the old `hexvault` slug for now. The vault is still the vault: it's the wallet the Syndicate trades from.

## One-liners

- **Tagline:** Four AI agents. One vault. Every call in the open.
- **Short:** Memefi with a seatbelt.
- **Elevator:** HexSyndicate is a crew of four AI agents trading Solana's loudest tokens from one public wallet. You watch every call, the code holds the hard limits, and profit only ever goes to one locked address.

## Products

| Name | Where | What it is |
| --- | --- | --- |
| **The Desk** | `/` | The live console: the crew's latest round, market, trades, wallets, donations, owner controls |
| **Degen Radar** | `/degen` | The memecoin scanner: new pairs, anti-rug gates, smart money, social, paper trading. Replaces "Axiom Degen", since Axiom is another trading platform's name |

## The crew

Each agent has a color and a glyph, used on the crew tiles and in the agent room.

| Agent | Color | Glyph | Personality |
| --- | --- | --- | --- |
| Scout | Neon green | ◉ | Twitchy, first to spot a move, sniffs out momentum and buy pressure |
| Analyst | Purple | ◆ | Calm nerd, turns hunches into buy, sell or hold |
| Risk Manager | Gold | ⛨ | The adult in the room. Says no a lot, on purpose |
| Trader | White | ➜ | Few words. Places the order and reports back |

## Voice

Casual, quick, a little cheeky, never hype. We sound like a friend who trades memecoins and also reads the docs.

- **Do:** short sentences, plain words, honest numbers, jokes about degens, admit losses.
- **Don't:** promise gains, say "moon", "guaranteed", "passive income" or "investment", use rocket emoji, invent stats.
- Every money surface keeps the fine print: no token, not financial advice, donations buy nothing back.

## Color

Dark only. Black carries the page, purple gives depth, gold gives structure, neon green means live or up. Rough ratio: 70% black, 15% purple, 10% gold, 5% green.

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#050407` | Page background |
| `--panel` | `#0e0a16` | Panels and cards |
| `--panel-2` | `#161025` | Raised surfaces, inputs |
| `--line` | `#2a2140` | Hairlines |
| `--purple` | `#8b3dff` | Primary buttons, glows, Analyst |
| `--purple-deep` | `#2a0f4a` | Background glow, gradients |
| `--gold` | `#d4af37` | Headings, frames, Risk Manager |
| `--gold-hi` | `#f3d98a` | Wordmark highlight, key numbers |
| `--neon` | `#39ff88` | Live state, gains, Scout. Never for decoration |
| `--bad` | `#ff4d7d` | Losses, rug risk, errors |
| `--fg` / `--muted` | `#f4f0e8` / `#a198b6` | Text |

Neon green is a signal, not a theme color: if it glows, something is live or up.

## Type

Lightweight on purpose: one web font.

- **Display:** Unbounded 600/800, for the wordmark, headings and big numbers.
- **Body:** the system UI stack (`system-ui, -apple-system, Segoe UI, Roboto, sans-serif`).
- **Numbers and addresses:** the system mono stack (`ui-monospace, SF Mono, Menlo, Consolas, monospace`) with tabular figures.

## Logo

A gold hexagon (the vault) holding four nodes (the agents) around a neon core (the live wallet), on a purple fill. It's inline SVG in both pages and doubles as the favicon. Wordmark: "Hex" in gold, "Syndicate" in white, Unbounded 800.

## UI rules

- Each page is one HTML file with inline CSS, no framework, one font request. Keep it that way.
- A faint hex grid sits behind everything. Panels are dark glass with a gold top edge.
- The sticky top bar holds the logo, the two products and the live pill on every page.
- Green glow only on live state, gains and alerts. Red only on losses and risk.
- Works at phone width with no sideways scroll; tables scroll inside their panel.
