# Club interface

The default interface is the modern club dashboard. The classic header, home screen, page components, and existing stylesheet remain available.

## Switching

- Modern sidebar: **Klasik arayüze geç**.
- Classic interface: fixed **Yeni arayüze geç** button at the bottom left.
- Login has the same switch.
- Direct links: add `?ui=classic` or `?ui=modern` to any page (use `&ui=...` when other query parameters are present). A logged-out protected-page link retains its query in the existing login redirect.
- Choice persists in this browser as `cs-batagi-design`. Light/dark choices are independent: the classic interface retains the existing `cs-batagi-theme` value; modern uses `cs-batagi-modern-theme` and defaults to dark.
- No account preference or server-side setting is changed. Browser storage failures fall back to session-only controls.

## Design structure

- `src/components/ClubShell.tsx`: grouped navigation, mobile menu, breadcrumb, theme control, existing notification bell, account menu, classic switch.
- `src/components/ClubHome.tsx`: match-night actions, actual attendance summary, competition links, match links, and analysis tools. Counts use the existing version-validated `useLivePolling` hook; unavailable data is shown as a dash, never invented counts.
- `src/components/ClassicHome.tsx`: original home component, preserved verbatim apart from the component name.
- `src/styles/club-design.css`: modern palette, typography, responsive layouts, status colors, tables, controls, login, and motion. Shared-page overrides are scoped under `html[data-design="modern"]`. Do not place new shared-page rules outside this scope.
- `src/contexts/ThemeContext.tsx`: interface and light/dark preferences. An early root script applies saved palette preferences before hydration.

The modern design uses charcoal, orange, and neutral surfaces. Attendance retains meaningful green/amber/red states; team and statistical heatmap colors are not globally recolored. The data pages use their existing components and operations in both interfaces. Domination's embedded external Figma content remains controlled by that external document.

## Performance and accessibility

No packages, remote fonts, animation libraries, polling caches, or backend changes were added. Existing Geist fonts, logo, and Lucide icons are reused. The home hero uses a locally hosted, generated game-atmosphere illustration (`public/images/club-match-night.webp`, approximately 105 KiB); competition artwork uses CSS and existing Lucide icons. Brighter charcoal surfaces and bordered section panels separate content from the dark canvas. New navigation links disable automatic Next.js prefetching so opening the dashboard does not render every stats route on the small VM. Home performs one visible-page attendance poll using the existing non-overlapping, visibility-aware hook.

Motion is limited to short transitions and home entrance; reduced-motion preferences disable it. Keyboard focus is visible, the mobile menu supports Escape, active routes use `aria-current`, and a skip link targets page content. Tables retain horizontal scrolling and numeric alignment.

Validation commands from `frontend-nextjs`: `node scripts/check-design.cjs` (preference and classic-switch checks), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next build`. Backend regression tests remain `npm test` from `backend`.

This source change uses the existing Next.js/Docker deployment; it is not a migration to Sites hosting. Build and deployment of the frontend through the existing workflow are needed for production rollout. There are no database migrations.
