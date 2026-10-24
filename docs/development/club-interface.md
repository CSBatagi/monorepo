# Club interface

The default interface is the modern club dashboard. **Batak Boomer Edition** is the simplified alternative; it replaced the original classic design (classic header and home were removed).

## Switching

- The club interface keeps only **Sıcak grafit (design 5)**. The version switch and other variants have been removed. Saved historical version choices migrate to Sıcak grafit on the first render.
- Modern sidebar: **Batak Boomer Edition**.
- Boomer Edition: footer button **Tam siteye geç** returns to the club interface.
- The club sidebar also offers **Sinematik deneyim**. This is an independent layout, accessible directly with `?ui=cinematic`. Its **Arayüz** menu (or the full navigation menu on mobile) returns to the club interface or the Boomer Edition without changing their saved palettes or version.
- Login uses the club login layout for both club and Boomer.
- Direct links: add `?ui=boomer` or `?ui=modern` to any page (use `&ui=...` when other query parameters are present). A logged-out protected-page link retains its query in the existing login redirect.
- Choice persists in this browser as `cs-batagi-design`. Light/dark choices are independent: Boomer uses `cs-batagi-boomer-theme` and defaults to light; modern uses `cs-batagi-modern-theme` and defaults to dark. A saved or linked `classic` choice migrates to Boomer.
- No account preference or server-side setting is changed. Browser storage failures fall back to session-only controls.

## Design structure

- `src/components/ClubShell.tsx`: grouped navigation, mobile menu, breadcrumb, theme control, existing notification bell, account menu, Boomer switch.
- `src/components/ClubHome.tsx`: match-night actions, actual attendance summary, competition links, match links, and analysis tools. Counts use the existing version-validated `useLivePolling` hook; unavailable data is shown as a dash, never invented counts.
- `src/components/boomer/`: Boomer Edition. `BoomerShell.tsx` is a top bar plus four links (Ana sayfa, Katılım, Takımlar, Gece & Maçlar); `BoomerHome.tsx` shows only tonight's headcount, one-tap Geliyorum / Gelmiyorum / Belirsiz for the signed-in player, the attendance list link and team picking. It sets `data-design="modern"` (so every shared page keeps the club styling) plus `data-edition="boomer"` for its own rules in `boomer.css`.
- `src/lib/useAttendanceWriter.ts`: the shared attendance write (captaincy reset, sheet mirror, teker döndü notification) used by both the Katılım page and the Boomer home.
- `src/styles/club-design.css`: modern palette, typography, responsive layouts, status colors, tables, controls, login, and motion. Shared-page overrides are scoped under `html[data-design="modern"]`. Do not place new shared-page rules outside this scope.
- `src/styles/club-versions.css`: the retained design 5 artwork layout and graphite colours, scoped to the modern interface. Light mode keeps the original graphite artwork cards with light text.

- `src/contexts/ThemeContext.tsx`: interface and light/dark preferences. An early root script applies saved palette preferences before hydration.

The modern design uses charcoal, orange, and neutral surfaces. Attendance retains meaningful green/amber/red states; team and statistical heatmap colors are not globally recolored. The data pages use their existing components and operations in both interfaces. Domination's embedded external Figma content remains controlled by that external document.

## Performance and accessibility

No packages, remote fonts, animation libraries, polling caches, or backend changes were added. Existing Geist fonts, logo, and Lucide icons are reused. The home hero uses a locally hosted, generated game-atmosphere illustration (`public/images/club-match-night.webp`, approximately 105 KiB); competition artwork uses CSS and existing Lucide icons. Warm grey surfaces and bordered section panels separate content from the dark canvas. Competition emblems sit behind the copy on the right and fade into the warm grey surface toward the left, without a separate artwork header. New navigation links disable automatic Next.js prefetching so opening the dashboard does not render every stats route on the small VM. Home performs one visible-page attendance poll using the existing non-overlapping, visibility-aware hook.

Motion is limited to short transitions and home entrance; reduced-motion preferences disable it. Keyboard focus is visible, the mobile menu supports Escape, active routes use `aria-current`, and a skip link targets page content. Tables retain horizontal scrolling and numeric alignment.

Validation commands from `frontend-nextjs`: `node scripts/check-design.cjs` (preference, Boomer switch and classic migration checks), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next build`. Backend regression tests remain `npm test` from `backend`.

This source change uses the existing Next.js/Docker deployment; it is not a migration to Sites hosting. Build and deployment of the frontend through the existing workflow are needed for production rollout. There are no database migrations.

## Cinematic interface

The cinematic home is a continuous four-chapter journey: Kulüp, Rekabet, Maç merkezi, and İstatistik. Native vertical scrolling and chapter anchors drive camera keyframes (pan, zoom, roll) and a perspective-projected Canvas 2D particle field. Pointer movement adds subtle parallax. Chapter copy reveals as it enters the viewport. Native scrolling remains available for touch, keyboard, and long sections on small screens.

The hero reuses the club design's rotating voice-chat quotes (`src/lib/clubQuotes.ts`, shared with `ClubQuotes.tsx`) in place of a static lede, cross-fading one line at a time. All lines occupy one grid cell so the hero never shifts, and rotation pauses in hidden tabs. With motion off or reduced motion the current quote stays visible instead of blinking.

`src/components/cinematic/CinematicShell.tsx` keeps the scene mounted across routes. Internal links navigate natively through `next/link`, so routes swap as soon as the next page is ready; there is no staged exit or full-screen interstitial. The arriving page gets a 200ms entrance fade, the same for in-app navigation and browser back/forward. The scene remains behind existing functional data pages, with a page heading and related navigation. The menu uses a native dialog for focus trapping and Escape dismissal.

`CinematicScene.tsx` uses 100 particles on desktop and 42 on mobile, caps canvas pixel ratio at 1.5, and stops its animation frame loop in hidden tabs. No 3D engine, animation package, or new runtime dependency is added. The effect uses a 2D image with camera-like transforms and projected particles, rather than a full 3D world. The generated locally hosted WebP is 141,028 bytes. Asset provenance and the generation prompt are in [cinematic-artwork.md](cinematic-artwork.md).

The footer motion button pauses camera motion, particles, smoke, reveals, and smooth scrolling. Its preference is stored in `cs-batagi-cinema-motion`. System reduced-motion preferences disable motion on initial load and when changed. Cinematic mode uses a fixed dark palette and its own theme storage key so entering it cannot overwrite Boomer or club light/dark choices. Styling is isolated in `src/styles/cinematic.css`; existing table data and semantic status colors are retained.

Validation includes the interface preference script, TypeScript, the production build, and browser checks for chapter navigation, camera changes, mobile overflow, the menu, route arrival, and motion controls. No production deployment or authentication change is part of this redesign.

## Night recap and navigation

`LastNightCard.tsx` is shared by the club and cinematic homes. It requests only `night_avg_periods` and `sonmac_by_date_periods`, uses the latest recorded date, and never combines different nights. Its prominent Gece Ortalaması and Maç Detayları actions open the same night in **Gece & Maçlar**, the single destination in Maç Merkezi. The club home uses one Batak Mundial card; draw and bracket navigation remains inside Mundial.

`NightCenterClient.tsx` combines averages and map details at `/gece-ortalama`. One season/date selector drives both views; `gorunum`, `tarih` and `sezon` query parameters preserve shareable navigation and browser back/forward. `/sonmac` redirects to the match view while preserving existing query parameters. Historical seasons and all-time selection reuse the static shard loader. Stats refresh retains the selected season/date, and both datasets revalidate the combined page. `NightStatsTable.tsx` uses quiet surfaces, sortable keyboard-accessible headers, a sticky player column and subtle red/amber/green values. Both views always show every statistic, with no summary/full-stats toggle. Player names and values use 16 px type, column headers use 14 px, and mobile retains these readable sizes with horizontal table scrolling. The landing-page recap also uses larger type. Radar graphs, player comparisons and the match round history remain available; graph modules load only when selected.

The recap shows up to three positive and three negative performances using the existing monthly awards formula (`performanceScore.ts`): `HLTV2 DIFF * 70 + ADR DIFF`. Those precomputed differences compare a player to their historical matches across the preceding ten recorded game dates. Rows with missing differences or no historical baseline are excluded; zero scores appear in neither group. The card shows signed differences and score, a crown for the top performer and a golden poop emoji for the lowest score. It does not rank by raw ADR/HLTV or invent negative signs.

`HorizontalTableScroll.tsx` wraps the nightly averages, both team tables and the round history. Desktop mouse users can drag the table body, use larger native scrollbars above and below it, or step sideways with the arrow buttons. The controls use muted neutral theme colors without a visible instruction label. The top and bottom bars share the same scroll range. Sorting controls retain normal clicks, both scroll regions support keyboard navigation, and touch/pen gestures retain native scrolling. Desktop controls are hidden on small screens and coarse pointers. A ResizeObserver tracks overflow without polling or a new dependency.

## Night and map duels

Gece & Maçlar now has a third **Düello** view beside Gece Ortalaması and Maç Detayları. A dedicated view keeps the full matrix discoverable without nesting another analysis tab inside each existing view. **Gece Toplamı** sums the selected night's matches; map buttons show the individual match, score and matrix. `harita` preserves the selected map when switching between match details and duels, and URLs/back/forward retain that selection. Changing the date or season clears the map selection. The matrix uses readable kill/death pairs, a sticky player column, semantic colors, horizontal scrolling and an optional player focus. `/duello` now contains only current-season totals and a prominent link to the combined page; navigation calls it **Sezon Düelloları**.

## Production rollout — 2026-09-13

The retained club design, shared night recap, personal equipment dashboard, and roster-member server controls were deployed together with `ops/cs2/deploy-cosmetics-web.py`. The locally built Next.js artifact was layered over the existing production image; no build ran on the 1 GB VM. Backend and frontend image tags are `csbatagi-cosmetics-backend:20260913t165500z` and `csbatagi-cosmetics-frontend-nextjs:20260913t165500z`. Active pins are in `/home/runner/docker-compose.cosmetics.yml`; rollback configuration is `/home/runner/cosmetics-web-backup-20260913t165500z/rollback.yml`.

Verification matched SHA-256 hashes for all 439 deployed service files. Both services remained within their unchanged 256 MiB limits, with no OOM or restart events. Backend cache hydration took approximately 164 seconds before requests recovered; the final 18 live checks passed. Stats remained clean and idle at version 54. Checks exercised authenticated pages, roster-member status authorization, and rejection of unauthorized power requests without starting or stopping the game server or changing personal equipment.

Local validation passed the production build, separate TypeScript check, design/cinematic/auth/pull-to-refresh checks, and backend tests (116 passed; 13 database-dependent tests skipped). Browser review covered desktop and 390 px mobile layouts, light/dark and cinematic interfaces, equipment filters and item details, and mocked start/stop flows. Live browser review confirmed the real equipment dashboard and night recap. The source commit uses `[skip ci]` to preserve the verified direct deployment and avoid the existing asynchronous build/deploy workflow race.
