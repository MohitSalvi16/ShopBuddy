# ShopBuddy — your friendly shopping buddy

*Not the cheapest. The right one — together.* Working name: set `APP_NAME` in `.env` and `client/src/brand.ts` to rebrand.

A voice-first shopping assistant that works in English, Hindi and Hinglish. It works out what you need, finds the best deal for your budget,
and tells you plainly when the cheap option is a bad buy. It applies coupons only after the backend checks them, and it checks out only when you say yes.
Built on **Agora Conversational AI + Agora RTC**, **Murf Falcon TTS** and an **LLM that calls real backend tools** over SQLite.

> This is a demo store. The catalog, stock, prices, mic and comfort scores, and payments are **simulated**. No real money moves.
> There is a printable overview at `docs/ShopBuddy-Overview.pdf`.

## Agentic architecture

```
Mic ─► Agora RTC ─► Agora Conversational AI ─┬─ ASR (Agora ARES / Deepgram)
                                             ├─ LLM = POST {PUBLIC_BASE_URL}/api/llm/chat/completions  (our backend, OpenAI SSE)
                                             │        └─ runTurn(): LLM picks tool → executeTool() validates + runs on SQLite
                                             │                      → {ok,data|error} back to LLM → loop → spoken reply
                                             └─ TTS = Murf Falcon (vendor "murf")  ─► audio back over RTC
Browser ◄── SSE /api/events: transcript · deal cards · critic · comparison · cart · checkout · order · tool log
```
- **Why the tools run on our server:** Agora's engine-side `llm.tools` doesn't support custom LLMs. So the backend runs the loop of
  customer intent → LLM picks a tool → backend runs it → result goes back to the LLM → agent explains.
  No tool success is hard-coded in a prompt, and replies quote totals the backend calculated.
- **Shared state:** voice and text use the same `runTurn()` with the same session ID. They share the goal, the products on screen, the product in focus, the cart and orders.
- **Without an LLM key** a labelled **rule engine** (`server/src/fallback.ts`) parses the same intents and calls the **same tools**.

## Features
| Feature | Where | Notes |
|---|---|---|
| **Best Deal Finder** (budget negotiator) | `server/src/recommend.ts` → tool `find_best_deal` | Hard constraints come first: in stock, **final price after a verified coupon ≤ budget**, and ANC/wireless if required. Then a deterministic score: **40% requirement match + 25% quality + 20% value + 15% preferences**. Each use case (calls, gaming, music, travel, workout, general) weights attributes differently. Output for each product: ID, price, discount, final price, score breakdown, pros, cons and reasoning. |
| **Friendly tips** (devil's-advocate engine) | `critique_choice`, the `devils_advocate` field, the `advisor` on `add_to_cart` | The cheapest option is always shown and critiqued against the best pick using catalog attributes only (for example "weak microphone for calls 4.5/10"). Verdict is `reconsider` when the score gap is 8 or more, with the extra cost of the better option. "Buy the cheapest" gets a challenge, not an automatic add. |
| **Hinglish / Hindi** | `server/src/lang.ts` | Detects language for the reply, maps Devanagari words and digits so the rule engine understands hi-IN speech recognition, and uses Murf's hi-IN voice for Devanagari replies. If TTS fails it shows text with a clear note. |
| **Goal-based recommendations** | `fallback.ts` / system prompt | "WFH, meetings all day, comfortable" becomes calls + comfort, infers headphones and asks for the budget. "Isse sasta" uses the product in focus. "gaming ke liye nahi" excludes gaming. |
| **Safe checkout** | `create_demo_order` | Two steps: first a summary, which re-checks stock and coupon. Then `confirmed=true` with `expected_total`. A changed cart is rejected with `CART_CHANGED`, and a repeat "yes" returns `ALREADY_PLACED` without a duplicate order. |
| UI | `client/src/components/DealPanels.tsx` etc. | Deal cards with score ring, verified coupon, pros/cons and "why this score"; critic panel; budget & savings; comparison with final prices; cart drawer; live tool log; order confirmation. |

### Tools (`GET /api/tools` lists each tool's input and output JSON Schema)
`search_products`, `find_best_deal`, `critique_choice`, `get_product_details`, `compare_products`, `check_inventory`,
`find_best_coupon`, `add_to_cart`, `remove_from_cart`, `apply_coupon`, `get_cart`, `create_demo_order`, `get_order_status`.
- **Inputs:** zod schemas, converted to JSON Schema for the LLM.
- **Outputs:** checked against output schemas.
- **Response format:** every call returns `{ok:true, tool, data}` or `{ok:false, tool, error:{code, message}}`.
- **Error codes:** `INVALID_INPUT`, `NOT_FOUND`, `OUT_OF_STOCK`, `COUPON_INVALID`, `CART_EMPTY`, `CART_CHANGED`, `UNKNOWN_TOOL`.
- **Debugging:** you can call any tool with `POST /api/tools/:name {args}`.

Coupons: `WELCOME10` gives 10% off, up to ₹500. `SAVE200` gives ₹200 off orders above ₹2,000.

## Run locally
Requires Node.js 22.13 or later (uses built-in `node:sqlite`; tested on Node 24).
```bash
npm run setup          # install root, server and client
cp .env.example .env   # every key is optional for the text / lite-voice demo
npm run dev            # API http://localhost:4000 · web http://localhost:5173
npm test               # 12 tests: required demo, scoring, critic, Hinglish/Devanagari, tools, checkout safety, shared state
```
**To use Agora Live voice:**
1. Set `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE`.
2. Optionally set `AGORA_CUSTOMER_ID` and `AGORA_CUSTOMER_SECRET`.
3. Set `MURF_API_KEY`.
4. Set `LLM_PROVIDER=gemini|openai` and `LLM_API_KEY`.
5. Make port 4000 public (`ngrok http 4000`) and set `PUBLIC_BASE_URL` to that URL.

The badge then shows "Agora Live voice".

## Testing

| Layer | Command | What it proves | Network |
|---|---|---|---|
| Typecheck | `npm run typecheck` | Server + client compile cleanly | none |
| Unit + integration | `npm test` | Scoring engine, friendly-tip critic, Hinglish/Devanagari parsing, tool schemas & errors, checkout guards, voice-text sanitising (19 tests) | none (hermetic: `SKIP_DOTENV=1`, temp SQLite) |
| HTTP API | `npm test` | Every endpoint, status codes (400/401/404/422/503), SSE events, Agora custom-LLM wire format, **10 parallel confirms → 1 order**, **no overselling** when many buyers race for the last units (10 tests) | none |
| Browser E2E | `npm run test:e2e` | Real UI in headless Chrome against an isolated stack (`:4100`/`:5174`): full demo journey, cart buttons, friendly tip, errors, reload persistence, voice-mode toggle, **mobile layout fits the screen**, zero console errors. Screenshots in `client/e2e-shots/`, HTML report in `client/e2e-report/` | none |
| Live integrations | `npm run test:live` | Real Gemini tool call, Murf en-IN + hi-IN audio, Agora credentials, tunnel reachability, Agora → custom LLM through the public URL, a real Agora agent start/stop, backend TTS proxy. Each check is PASS / FAIL / SKIP | **real APIs** (uses keys in `.env`, starts one Agora agent for ~5 s) |
| Everything | `npm run test:all` | All of the above | |

Flaky-test policy: Playwright retries a failed test once and reports it as **flaky** (with a trace) instead of silently passing.

## Two-minute demo script
| Time | Say | Show |
|---|---|---|
| 0:00 | *(Onboarding)* "ShopBuddy ke kharido — ShopBuddy judges the deal, it doesn't just take orders." | Agora + Murf badges |
| 0:15 | **"Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye."** | 3 deal cards. #1 Cheapest has a warning about its weak mic. #2 Best pick has a verified coupon. The Devil's Advocate panel appears. The tool log shows `find_best_deal`. |
| 0:45 | **"Compare the first two."** | Comparison table: mic quality, comfort, final prices |
| 1:05 | **"Second wala cart mein add kar do aur coupon apply karo."** | `add_to_cart` → `find_best_coupon` → `apply_coupon` → summary. The cart badge updates and the drawer opens with "Awaiting confirmation". |
| 1:30 | **"Yes, confirm."** | Demo order ID, confetti, order spoken aloud |
| 1:45 | Say "Yes, confirm" again, then open the WFH example: *"I work from home and attend meetings all day. I need something comfortable."*, "5000", "Isse sasta kuch hai?" | No duplicate order. Goal inference. Cheaper alternatives based on the product in focus. |

All amounts come from the catalog and coupon APIs. With the bundled data, the first line currently picks the Logitech H390 at ₹2,065 after WELCOME10. With "comfortable" added, it picks the Jabra Evolve2 30 SE at ₹4,499 after a ₹500 discount.

## Status
**Done and verified locally:**
- Scoring engine, critic and all 13 tools.
- Coupon checks, stock checks and the duplicate-order guard.
- Rule-engine demo flows: 12 automated tests, plus a live run through the dev proxy that confirmed 8 tool calls, one order and the duplicate blocked.
- Agora-format SSE output.
- `/api/tools` schemas.
- Client and server builds.

**Demo fallbacks (clearly labelled):**
- The rule engine replaces the LLM when no key is set.
- Lite voice (browser speech recognition + Murf HTTP stream) replaces Agora when credentials are missing.
- Text input is always available.
- Simulated catalog and payments.

**Verified with a real key:**
- **Murf Falcon TTS over the HTTP stream** (`/api/tts` → `POST https://global.api.murf.ai/v1/speech/stream`):
  - English and Hinglish with `Anisha`/`en-IN`.
  - Hindi Devanagari with `Anisha`/`hi-IN`.
  - Real 24 kHz MP3 audio, first byte to end in 0.8–1.7 s.

**Not verified yet (needs Agora / LLM keys):**
- Live Agora `join`/`leave`, ASR language behaviour, and Murf invoked through Agora's engine.
- The Gemini/OpenAI tool-calling loop. The code is written for the OpenAI-compatible API, but no live run was possible.
- The UI was type-checked and built but not checked by eye in a browser.

**Known limits:**
- In Agora mode, the TTS locale is fixed when the call starts, so the LLM replies in Roman-script Hinglish.
- The rule engine replies in Roman Hinglish even when the input is Devanagari.
