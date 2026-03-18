# GPT-5.4 Audit Results

## 1. Executive Summary
- The application is a genuinely promising foundation for a calm, professional stock watchlist dashboard. The visual language is restrained, the route/controller/service layering is much cleaner than the older CRYPTO_API codebase, and the expanded-row pattern is a good product decision.
- The biggest strengths are the clean main table, lazy-loaded detail panels, useful analyst/financial context in expansion, and a backend that is small enough to stay understandable.
- The biggest concerns are trust-related, not styling-related: symbol mapping quality is inconsistent, the current app behaves more like a pre-seeded market board than a personal watchlist, and the source strategy does not match the stated philosophy.
- Yahoo is currently the real backbone of the product. eToro is only a narrow fallback in code, even though live testing shows eToro can provide more stock snapshot data than the current code comments suggest.
- Overall verdict: strong direction, but not yet trustworthy enough to be treated as a serious decision-support tool until the symbol/source layer is tightened.

## 2. Current Product State

### 2.1 What currently exists
- Authentication flow with login, register, logout.
- `/home` renders a shell first, then fetches dashboard rows asynchronously from `/api/dashboard-data`.
- Main dashboard table with columns for symbol, company, market cap, price, daily change, daily change percent, beta, target, rating, events, and delete action.
- Search filter across symbol and company name.
- Client-side sorting for market cap, daily change, daily change percent, and beta.
- Add-symbol flow through `/add-symbol`.
- Delete flow through `/delete-symbol`.
- Row expansion with lazy-loaded request to `/api/assets/:symbol/financial-history`.
- Expanded row contains:
  - Financial performance chart
  - Quarterly/yearly toggle
  - Latest period change summary
  - Analyst consensus block
- Loading states:
  - Full-page loading overlay on dashboard load
  - Inline loader for expanded row detail
- Error handling:
  - Inline error banner for add/load issues
  - Empty detail state for unsupported assets
- Responsive behavior:
  - Toolbar stacks on smaller screens
  - Table remains horizontally scrollable

### 2.2 What works well
- The main UI is visually calm. It does not feel like a noisy finance terminal.
- The shell-first dashboard load is the right UX choice for an API-heavy page.
- The expanded-row pattern is the best part of the product:
  - It keeps the main table light
  - It hides heavier financial context until the user asks for it
  - It fits the "decision-support, not clutter" goal
- The financial chart plus analyst summary is useful for quick single-stock review.
- Search and sort are responsive because they are client-side once data is loaded.
- The architecture is understandable enough that the product can still evolve cleanly.

### 2.3 What feels weak / misleading / unfinished
- The app is not really behaving like a personal watchlist today.
  - New users are auto-seeded with 129 symbols. <- MUST FIX (I have to be able to provide other users the same list. From there on each user manages his/her list independently. The sharing must be so that I enter the username, for example liispaas@gmail.com and click share. If he or she has added items previously, those must be added as well. I (renevoog@gmail.com - master admin) must be the only one to do this)
  - If a user deletes everything, the next dashboard load reseeds the whole list again because initialization is tied to "count is zero". <- MUST FIX
  - That is a major product mismatch if the goal is a clean personal watchlist.
- The `Events` column is broader in name than in reality.
  - It currently means "earnings date from Yahoo quote fields", not general events.
  - In live testing, 118 of 129 seeded rows had event badges, but only 7 were within 7 days.
  - Most rows therefore show far-future earnings dates that reduce signal quality.
- Some symbols are stale or wrong:
  - `PACW` produces a fully blank row in live testing.
  - `SIE` is mapped to `SIEMENS.NS`, which is Siemens Limited in India, not Siemens AG in Germany. <- MUST FIX
- Some mappings use proxy listings that distort venue, currency, and analyst coverage:
  - `LVMH -> LVMHF`
  - `NTDOF -> NTO.F`
  - `ATCO_A -> ATCO-B.ST`
- Delete is optimistic on the client and ignores server failure.<- MUST FIX
- Add-symbol success triggers a full page reload, which is workable but not elegant.<- MUST FIX.
- The "No matching assets" state is not the same as a real "your watchlist is empty" state, and the app currently cannot remain empty anyway. <- MUST FIX

### 2.4 UX cleanliness / noise assessment
- Visually, the product is still clean.
- Product-wise, it is already at risk of becoming noisy for two reasons:
  - The default 129-row seeded universe is large for a watchlist product. <- There should be no limit to list length
  - The Events column is populated on most rows, so badges stop meaning much. <- MUST FIX
- The expanded-row components are genuinely value-adding.
- The current feature set mostly aligns with a decision-support dashboard, but the watchlist identity is weakened by the seeded universe and source trust issues.

## 3. Architecture & Maintainability Audit

### 3.1 Structural alignment with CRYPTO_API conventions
- The app is strongly aligned with the CRYPTO_API-style structure:
  - `server/routes`
  - `server/controller`
  - `server/services`
  - `views`
  - EJS templates
  - Bootstrap plus custom CSS
- Compared with the older CRYPTO_API controller-heavy style, this project is materially cleaner and easier to reason about.
- The frontend split between `public/js/dashboard.js` and `public/js/financial-detail.js` is sensible.

### 3.2 Separation of concerns
- Strong points:
  - Routes are thin.
  - Controller mostly orchestrates.
  - Provider logic is split into Yahoo and eToro service folders.
  - Formatting and event normalization are in dedicated services.
- Weak points:
  - `server/controller/controller.js` is still a single controller file. It is manageable now, but it is the most obvious place that would bloat first as features grow.
  - `trackedAssetModel` stores `yahooSymbol`, but runtime reads only `tvSymbol` and reconstructs mapping from the in-memory map. That means persisted symbol resolution is not actually used. <- Do not fully understand but must be fixed if this does not break anything.

### 3.3 Lazy loading / row expansion audit
- This is one of the cleaner parts of the implementation.
- Good:
  - The dashboard does not fetch financial detail on initial page load.
  - Expanded-row detail is lazy-loaded on demand.
  - Expanded-row detail is cached client-side for the page session.
  - The main table stays lightweight.
- Weak:
  - There is no server-side caching for dashboard data or expanded-row detail. <- If there is some reasonable way, for example session based, then MUST FIX. I Have very limited database capacity
  - Every dashboard load re-fetches analyst data for the entire watchlist.
  - Expanded state is lost when sorting/filtering rerenders the table. <- MUST FIX but only session based. If the session is terminated, the data will be deleted.
  - The detail view defaults to `quarterly` after fetch even if only yearly data exists, which is a small logic fragility.

### 3.4 Maintainability risks
- The in-memory symbol map is mutated at runtime for discovered symbols, but that dynamic mapping is not durable across process restart.
- The database stores `yahooSymbol`, but the main read path ignores it.
- The manual mapping table will become a long-term maintenance liability as more international assets are added.
- Comments about eToro capability are already outdated relative to live API behavior.
- The current source strategy is implicit rather than explicit. That makes it harder to reason about when a field is trustworthy.

### 3.5 Technical debt hotspots
- `server/services/symbolMap.js`
  - Contains manual mappings, stale tickers, and at least one clearly wrong mapping.
- `server/services/trackedAssetsService.js`
  - Dynamic symbol resolution logic is not durable and uses loose search heuristics.
- `server/services/stockAggregator.js`
  - Source policy is simple but underspecified, and comments no longer match API reality.
- `server/services/eventService.js`
  - Treats past earnings as current events and fills the table too aggressively.
- `public/js/dashboard.js`
  - Delete is optimistic and not reconciled on failure.
- `server/services/yahoo/yahooFinancialService.js`
  - "vs prev" period changes are sequential, not year-over-year, which can be misread.

### 3.6 Positive foundations worth preserving
- Route -> controller -> service separation.
- Shell-first load.
- Lazy detail expansion.
- Calm main table with detail hidden until requested.
- Small, understandable service modules.
- Clear frontend responsibility split.

## 4. API Capability Audit

### 4.1 eToro API - actual strengths
- Live testing of `https://public-api.etoro.com/api/v1/market-data/search` showed that eToro can return much richer stock snapshot data than the current code assumes.
- For `AAPL`, the live search payload included:
  - `marketCapInUSD`
  - `beta-TTM`
  - `tipranksConsensus`
  - `tipranksTargetPrice`
  - `tipranksTotalAnalysts`
  - `nextEarningDate`
  - dividend history
  - many annual/TTM ratio and fundamentals fields
- eToro also supports `fields=` filtering on search results, which is useful for keeping payloads smaller.
- `market-data/instruments/rates` gives a dedicated current price/rate payload by instrument ID.
- Conclusion: eToro is stronger for covered single-stock snapshots than the current implementation suggests.

### 4.2 eToro API - actual weaknesses / limitations
- Coverage and symbol resolution are uneven.
  - `MC.PA` worked.
  - `SIE.DE` worked.
  - `ATCO-A.ST` worked.
  - `SAAB-B.ST` returned no result in live testing.
  - `7974.T` returned no result in live testing.
- Alias handling is brittle.
  - Querying `SPX` returned crypto `SPX` first, not the S&P 500 index. <- MUST FIX
  - Querying `SEMI` returned `Semiconductors` index and the current validation logic would accept it as valid.
- The current `pickBestSymbolMatch()` falls back to `items[0]` if no exact match is found, which is dangerous for ambiguous tickers. <- MUST FIX
- I did not find evidence in the current integration that eToro is a clean source for:
  - multi-period financial statement history
  - robust cross-market financial time series
  - consistent ETF / index / international alias coverage
- Conclusion: eToro is usable as a selective stock snapshot source, not as a blanket backbone for the whole app.

### 4.3 Yahoo Finance integration - actual strengths
- Yahoo quote coverage is broad and forgiving.
- Live Yahoo quote testing supported:
  - price
  - daily change
  - daily change percent
  - market cap for many equities
  - company names
  - earnings timestamps
  - ETFs and indices at quote level
- Live Yahoo quoteSummary testing supported, for many equities:
  - `financialData`
  - `summaryDetail`
  - `recommendationTrend`
  - `incomeStatementHistoryQuarterly`
  - `incomeStatementHistory`
- Yahoo search is much better than eToro for discovering symbol candidates from loose input.
- Conclusion: Yahoo is the real broad-coverage workhorse in the current ecosystem.

### 4.4 Yahoo Finance integration - actual weaknesses / limitations
- Yahoo free endpoints are brittle and uneven.
- `quoteSummary` is single-symbol only, which creates many requests for a full watchlist.
- ETFs and indices frequently fail on `quoteSummary` modules used for financial detail.
  - Live testing of `CSPX.L` and `^SPX` with the current modules returned `404`.
- Analyst coverage quality depends heavily on the exact listing used.
  - `MC.PA` had usable analyst fields.
  - `LVMHF` did not.
  - `7974.T` had usable analyst fields.
  - `NTO.F` did not.
- Raw Yahoo news/search behavior is fragile for heavier use.
  - In live testing, Yahoo search with news payload returned `Too Many Requests`.
- Conclusion: Yahoo is broad and useful, but not stable enough to be used as a high-volume noisy signal feed.

### 4.5 PUBLIC_CRYPTO_API relevance
- PUBLIC_CRYPTO_API contains genuinely relevant supporting Yahoo logic that is not currently used by this app.
- Most relevant pieces:
  - `insights()` wrapper
  - `fundamentalsTimeSeries()` wrapper
  - Google Sheets-facing routes around them
- Live `insights('AAPL')` returned structured objects:
  - `recommendation`
  - `sigDevs`
  - `events`
  - `secReports`
  - `companySnapshot`
  - `instrumentInfo`
- Live `fundamentalsTimeSeries('AAPL', quarterly)` returned a structured array of quarterly metrics like:
  - `totalRevenue`
  - `operatingIncome`
  - `netIncome`
  - `EBITDA`
  - `basicEPS`
  - many others
- Relevance assessment:
  - `fundamentalsTimeSeries` is highly relevant for future detail views or rule-based change detection.
  - `insights.sigDevs` may be relevant for low-noise watchlist awareness.
  - `insights.events` looks noisy and technical, not suitable for a calm investing dashboard.

### 4.6 Source-by-feature capability matrix

| Feature | Current Source | eToro Feasible? | Yahoo Feasible? | Confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Company name | Yahoo quote, eToro fallback | Yes | Yes | High | Both can provide it for covered assets. |
| Market cap | Yahoo quote | Partial-to-Yes | Partial-to-Yes | Medium | Yahoo often missing on ETFs/indices; eToro has `marketCapInUSD` for many stocks. |
| Last price | Yahoo quote, eToro fallback | Yes | Yes | High | Robust on both for supported assets. |
| Daily change | Yahoo quote, derived from eToro percent fallback | Partial-to-Yes | Yes | Medium | eToro fallback absolute change is derived, not directly sourced. |
| Daily change % | Yahoo quote, eToro search fallback | Yes | Yes | High | eToro search returns percent-style change field. |
| Beta | Yahoo `summaryDetail.beta` | Yes for many stocks | Yes for many stocks | Medium | Current code comment saying eToro lacks beta is outdated. |
| Target price | Yahoo `financialData.targetMeanPrice` | Yes for many stocks | Yes for many stocks | Medium | eToro exposes TipRanks target for covered stocks. Coverage uneven. |
| Rating / consensus | Yahoo `recommendationKey` | Partial | Yes | Medium | eToro has TipRanks consensus for covered stocks, but app does not use it. |
| Events | Yahoo quote earnings timestamps | Partial | Yes | Medium | eToro has `nextEarningDate` for some stocks, but not broad enough for whole app. |
| Financial performance chart | Yahoo `incomeStatementHistory*` | No clear fit in current tested routes | Yes for operating companies | High | eToro snapshot payload is rich, but not a clean source of multi-period financial statements in this app. |
| Analyst summary card | Yahoo `financialData` + `recommendationTrend` | Partial | Yes | Medium | eToro has some analyst-like snapshot fields, but Yahoo is currently stronger for structured card output. |
| Symbol validation / search | Yahoo direct quote + search, eToro validate fallback | Partial and risky | Partial | Medium | Yahoo search is broader; eToro current fallback can accept wrong first result. |
| Expanded-row period change calculations | Derived from Yahoo statement history | No | Yes | High | Current logic is sequential period-over-period, not YoY. |

## 5. Data Realism & Trustworthiness
- Robust today:
  - Last price
  - Daily change percent
  - Company name
  - Upcoming earnings dates for well-covered equities
  - Revenue / net income history for operating companies that Yahoo supports
- Partially reliable:
  - Market cap
  - Beta
  - Target price
  - Rating / consensus
  - Events column
- Fragile or likely misleading:
  - Stale tickers like `PACW`
  - Wrong mapping like `SIE -> SIEMENS.NS`
  - Proxy-listing mappings that change venue/currency and analyst coverage
  - Dynamic symbol mappings discovered through search, because they are not truly persisted into the runtime read path
  - eToro validation on ambiguous symbols because first-result fallback can validate the wrong instrument
  - Expanded-row "vs prev" summary because it is sequential and not clearly labeled as such

- Where fallback logic is appropriate:
  - Price-level fallback when Yahoo has no quote is reasonable.
- Where fallback logic is currently too weak:
  - The app does not explicitly tell the user which source provided which field.
  - The current code assumes eToro is weaker than it is for stock snapshots, but also does not handle eToro exact-symbol coverage carefully enough to use it more heavily.

- Presentation caution areas:
  - Target and rating should not be treated as equally trustworthy across all symbols.
  - Analyst data on proxy listings can be materially weaker than on the primary listing.
  - ETFs and indices need cleaner unsupported states rather than looking like "missing data" mistakes.<- MUST FIX

## 6. Important Developments / Watchlist Awareness

This is the most important strategic section of the audit.

### 6.1 What kind of "important developments" are actually worth surfacing
- Confirmed earnings dates when they are close enough to matter.
- Post-earnings regime shifts:
  - material beat/miss <- MUST FIX (Elegantly)
  - guidance raise/cut
  - major margin surprise<- MUST FIX
- Large abnormal price and volume moves that likely indicate something changed. <- MUST FIX
- Material analyst consensus shifts:
  - not one analyst note
  - actual movement in average target, recommendation, or analyst mix
- Macro or sector shocks tied to holdings: <- MUST FIX
  - oil shock for energy names
  - defense / war escalation for defense names
  - export restrictions / AI cycle changes for semis
  - rates and credit stress for banks / insurers / REITs
- Delisting, merger, symbol-change, or source-integrity issues for tracked assets.<- MUST FIX

### 6.2 What should definitely NOT be surfaced
- A raw headline feed.
- Every Yahoo news item.
- Every SEC filing.
- Technical indicator "events" from Yahoo insights.
- One-off analyst opinions shown as if they were major developments.
- A permanent list of earnings dates 30-50 days away for nearly every asset.

### 6.3 What is realistically feasible with current APIs/tools
- Earnings event awareness:
  - Yes, clearly feasible.
  - Yahoo quote already provides earnings timestamps.
  - eToro also has next earnings date for many covered stocks.
- Big guidance / quarterly result awareness:
  - Partially feasible.
  - The APIs can expose earnings timing and some structured context, but detecting "guidance changed" cleanly from free endpoints alone is not fully reliable without storing before/after snapshots or using a stronger news/event source.
- Analyst sentiment shifts:
  - Partially feasible.
  - Yahoo and eToro both expose usable analyst-related fields for many stocks.<- MUST FIX (If yahoo finance does not provide information, try eToro)
  - But current app stores no historical analyst snapshots, so it cannot detect a shift over time yet.
- Large abnormal moves:
  - Feasible.
  - Current price data plus Yahoo historical/chart logic from the supporting project is enough to build rule-based move detection later.
- Macro / geopolitical triggers:
  - Only partially feasible with the current stack.
  - eToro and Yahoo do not give a reliable "this war matters to your oil holdings" signal directly.
  - This needs a small curated rule layer, not blind API trust.
- News-based "important only" markers:
  - Partially feasible, but only with restraint.
  - Yahoo `insights.sigDevs` looks more promising than raw Yahoo news. <- MUST FIX (If this is feasible and really useful. Trust you).
  - Raw Yahoo news/search is already rate-limit-fragile in live testing.

### 6.4 Best low-noise implementation strategies
- The right future pattern is rule-based, not feed-based.
- Best direction:
  - Keep the main dashboard calm.
  - Surface only a tiny set of triggered "attention needed" states.
  - Make those triggers objective and asset-aware.
- The cleanest professional model is:
  - no scrolling news feed
  - no article wall
  - no minute-by-minute noise
  - only curated alert classes

- Recommended alert classes: <- MUST FIX (but I still want to see dates as well. Maybe currently the date part takes too much space? Ot those marking could be done by symbols or something)
  - Earnings Soon
  - Earnings Aftermath
  - Consensus Shift
  - Abnormal Move
  - Macro / Sector Shock
  - Source Integrity Warning

### 6.5 Recommended detection model
- Best model for this stack: hybrid objective rules plus very selective structured signal inputs.

1. Scheduled events
- Use earnings only when close enough to matter.
- Good threshold: within 7 calendar days.
- Past earnings should not stay in the main event column as a default state.

2. Abnormal move detection
- Use Yahoo price history or current quote plus a recent baseline.
- Trigger only when move is clearly outside normal behavior.
- This is far more useful than random headlines.

3. Analyst drift detection
- Store periodic snapshots of:
  - target mean
  - analyst count
  - recommendation key / consensus
- Flag only material changes, not tiny noise.

4. Source-integrity detection
- Flag:
  - stale / unsupported symbol
  - proxy listing in use
  - missing primary data support
  - mapping mismatch
- This is highly valuable because bad source trust quietly damages every other feature.

5. Macro / sector overlay
- Do not try to infer world events from generic news with the current stack.
- Instead, define a small manual map of exposure types:
  - Energy
  - Defense
  - Semis
  - Banks / rates
  - Healthcare policy
- Then pair those with a tiny set of tracked external indicators or manually curated triggers.

6. Optional structured news support
- If anything from Yahoo `insights` is used, prefer `sigDevs`.
- Do not use `events` directly; they look technical/noisy.
- Do not use `recommendation` alone as "consensus"; it is provider-specific.

### 6.6 Recommendation: how this app should handle "major developments" without becoming noisy
- The app should not become a news reader.
- It should become a watchlist alert board.
- Best professional direction:
  - show only triggered signals
  - keep them few
  - make them explainable
  - keep supporting detail behind expansion

- With the current stack, the most realistic low-noise implementation path is:
  - Earnings within 7 days
  - Post-earnings abnormal move
  - Material consensus shift
  - Macro / sector shock on tagged holdings
  - Symbol / source integrity warning

- That is much more useful than "latest news" and much less likely to rot into clutter.

## 7. Product Direction Recommendations

### 7.1 Must-have next steps
- Fix the trust layer first:
  - audit the manual symbol map
  - remove stale tickers
  - fix clearly wrong mappings
  - decide which symbols should map to primary listings vs proxies
- Decide the true product identity:
  - personal watchlist
  - or curated market board
- If the goal is personal watchlist, stop auto-reseeding a 129-symbol default list when the user has zero holdings.
- Persist symbol resolution properly and actually read `yahooSymbol` from storage.
- Reduce event noise:
  - upcoming only
  - close-window only
  - major only

### 7.2 Good next steps
- Add explicit source-confidence thinking to the UI and service layer, even if hidden at first.
- Use eToro selectively where it clearly adds value for exact covered stocks.<- MUST FIX
- Consider using PUBLIC_CRYPTO_API `fundamentalsTimeSeries` for richer future financial-detail logic.
- Add minimal caching or snapshot persistence so the app can support analyst shift detection and reduce repeated heavy fetches.

### 7.3 Nice-to-have later
- Rule-based watchlist alerts.
- Historical analyst drift markers.
- Macro-sensitive tagging per asset.
- Small daily digest / attention summary.

### 7.4 Avoid for now
- Full news feed.
- Real-time terminal behavior.
- Raw SEC filing stream.
- Technical indicator event feed.
- Overcrowding the table with more columns.

### 7.5 Things that sound exciting but are probably not worth the complexity
- Fully automatic "important news" scoring from free Yahoo headlines.
- Geopolitical inference engines on top of noisy news.
- Multi-source article fusion with ranking logic.
- Trying to make this a Bloomberg-lite terminal.

## 8. Practical Recommendations for Simplicity, Cleanliness, and Usefulness
- Keep the main table sparse and confidence-weighted.
- Keep financial performance and analyst detail behind expansion.
- Do not push more content into the main row area unless it clearly improves actionability.
- Treat unsupported data honestly.
  - ETF/index rows should look intentionally unsupported, not broken. <- MUST FIX, If index information is more trustworthy in eToro, use this.
- Treat proxy mappings carefully.<- MUST FIX
  - A clean UI with the wrong instrument is worse than a slightly emptier UI with the right one.
- Emphasize:
  - price
  - move
  - near-term event risk
  - a few important alerts
- De-emphasize or gate:
  - weak analyst fields on proxy listings
  - far-future earnings dates
  - anything that resembles a headline stream
- Preserve the current calm visual style.
- Preserve lazy loading.
- Use alert design sparingly so badges mean something.

## 9. Final Verdict
- The current product direction is strong in concept.
- The biggest opportunity is to become a trustworthy, low-noise watchlist alert dashboard rather than a broad market board or mini news terminal.
- The biggest risk is not lack of features. It is trust erosion:
  - wrong symbol mappings
  - stale seeded assets
  - proxy listings with weaker data
  - too many event badges
- If the trust layer is fixed first, the existing architecture is good enough to support a much stronger product.

## Appendix A - Evidence / Notes

- Routes checked:
  - `server/routes/router.js`
  - `/api/dashboard-data`
  - `/add-symbol`
  - `/delete-symbol`
  - `/api/assets/:symbol/financial-history`
  - `/debug/stocks`

- Main implementation files inspected:
  - `server/controller/controller.js`
  - `server/services/stockAggregator.js`
  - `server/services/trackedAssetsService.js`
  - `server/services/symbolMap.js`
  - `server/services/eventService.js`
  - `server/services/yahoo/yahooFinanceClient.js`
  - `server/services/yahoo/yahooStockService.js`
  - `server/services/yahoo/yahooFinancialService.js`
  - `server/services/etoro/etoroHttpClient.js`
  - `server/services/etoro/etoroStockService.js`
  - `views/home.ejs`
  - `public/js/dashboard.js`
  - `public/js/financial-detail.js`
  - `public/css/dashboard.css`

- Supporting project files inspected:
  - `PUBLIC_CRYPTO_API/server/services/yahoo_finance_client.js`
  - `PUBLIC_CRYPTO_API/server/services/yahoofinance_API.js`
  - `PUBLIC_CRYPTO_API/server/controller/controller.js`
  - `PUBLIC_CRYPTO_API/server/routes/router.js`

- Live API checks performed:
  - Yahoo quote:
    - `AAPL`
    - `CSPX.L`
    - `^SPX`
    - `LVMHF`
    - `SAAB-B.ST`
  - Yahoo quoteSummary:
    - `AAPL`
    - `BRK-B`
    - `CSPX.L`
    - `^SPX`
    - `LVMHF`
    - `MC.PA`
    - `NTO.F`
    - `7974.T`
  - Yahoo search:
    - `LVMH`
    - `Nintendo`
    - `Siemens`
    - `Atlas Copco A`
  - eToro search:
    - `AAPL`
    - `MC.PA`
    - `SIE.DE`
    - `ATCO-A.ST`
    - `SAAB-B.ST`
    - `7974.T`
    - `SPX`
    - `SEMI`
    - `PACW`
  - eToro rates:
    - direct rates endpoint sanity check
  - PUBLIC_CRYPTO_API:
    - `insights('AAPL')`
    - `fundamentalsTimeSeries('AAPL', quarterly)`

- Notable live findings:
  - Initial watchlist size from `getInitialSymbols()` is 129.
  - Full seeded dashboard fetch via `getStockRows(getInitialSymbols())` took about 5.8 seconds in live testing.
  - That live run triggered only one eToro fallback symbol: `PACW`.
  - `PACW` still rendered fully blank because neither Yahoo nor eToro returned usable data.
  - In the seeded set:
    - 6 rows lacked market cap
    - 1 row lacked price
    - 11 rows lacked beta
    - 13 rows lacked target price
    - 18 rows lacked rating
    - 118 rows had event badges
    - only 7 event badges were within 7 days
  - eToro live payload for `AAPL` included stock fields the code comments currently say eToro does not provide:
    - beta
    - target price
    - consensus
    - next earnings
    - market cap
  - eToro live coverage was still uneven for non-US / exchange-specific symbols.
  - Yahoo quoteSummary failed for ETF/index detail modules on `CSPX.L` and `^SPX`.
  - Yahoo analyst coverage quality was much better on `MC.PA` than on `LVMHF`, and much better on `7974.T` than on `NTO.F`.
  - PUBLIC_CRYPTO_API `insights` exposed structured `sigDevs`, but also noisy technical `events`.
  - PUBLIC_CRYPTO_API `fundamentalsTimeSeries` returned strong structured quarterly financial arrays and is relevant for future evolution.

- Important code-level findings with line references:
  - `server/controller/controller.js:141-143`
    - Dashboard load always calls initialization, then tracked symbol fetch, then aggregation.
  - `server/services/trackedAssetsService.js:13`
    - Initialization seeds default assets whenever user count is zero.
  - `server/services/trackedAssetsService.js:39`
    - Add-symbol logic relies on Yahoo direct validation, Yahoo search, then eToro validation.
  - `server/services/stockAggregator.js:22`
    - Current source policy is Yahoo primary, eToro fallback.
  - `server/services/stockAggregator.js:155`
    - Comment claims eToro public API does not provide beta/target/rating. Live testing showed that is no longer fully true.
  - `server/services/symbolMap.js:75`
    - `SIE` maps to `SIEMENS.NS`, which is a wrong instrument for Siemens AG.
  - `server/services/symbolMap.js:11`
    - `LVMH` maps to `LVMHF`, which is a proxy listing choice.
  - `server/services/symbolMap.js:126`
    - `PACW` is still seeded despite no usable live data.
  - `server/services/eventService.js:45-47`
    - Past earnings are intentionally turned into event objects.
  - `public/js/dashboard.js:237`
    - Delete is optimistic and not reconciled if backend delete fails.
  - `public/js/dashboard.js:272`
    - Add success triggers full reload.
  - `server/services/yahoo/yahooFinancialService.js:63-80`
    - Expanded-row change calculations are period-over-period against the previous row, not year-over-year.
  - `server/services/etoro/etoroStockService.js:25`
    - eToro symbol match falls back to the first search result if no exact match exists.

- Assumptions and uncertainties
  - I did not perform a full authenticated browser session through the live UI, because that would require creating or using application data state and was not necessary to verify the implementation and provider behavior.
  - The audit is based on code inspection plus live service/API probing, which was enough to verify the core product, source strategy, and provider capability questions.
  - Free Yahoo behavior can vary by time and rate-limit state, so any future heavy news-oriented design should be treated cautiously.
