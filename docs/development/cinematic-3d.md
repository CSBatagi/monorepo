# Cinematic local review

From `frontend-nextjs`, run:

```powershell
npm run preview:cinematic
```

Open [the cinematic preview](http://127.0.0.1:3002/?ui=cinematic). The runner binds only to `127.0.0.1:3002`; it cannot be opened directly from another device on the LAN. Browser mobile emulation can review responsive layouts. Press Ctrl+C in the runner terminal to stop it.

This command is exclusively a local visual review entry point. It provides a temporary `Yerel İnceleme` session signed with a new random HMAC secret on every start. It does not use a real user or change the application's authentication implementation. Keep the preview on its `127.0.0.1` origin, separate from an ordinary development session on `localhost`.

Attendance is a fixed sample from the committed player roster, marked `YEREL PROVA` and `Örnek katılım` in the page; attendance controls are disabled. Every non-GET/HEAD request, including Server Actions, receives HTTP 403. Unneeded API reads are blocked, notification registration is suppressed, and no real attendance or push data is written. Statistics use the existing local `runtime-data` fallback, with the application's saved-data indicator. The backend URL is set to the unavailable loopback endpoint `http://127.0.0.1:9` before Next starts.

The runner sets `CSBATAGI_CINEMATIC_PREVIEW=true` in its own process. This selects the ignored `.next-cinematic-preview/` output directory and generated `tsconfig.cinematic-preview.json`. Normal development and production keep their existing `.next/` output and `tsconfig.json`. Do not deploy the preview runner or enable its environment flag in production.

For a review of the optimized build, after the preview runner has generated its ignored TypeScript config:

```powershell
$env:LOCAL_DEV='true'
$env:CSBATAGI_CINEMATIC_PREVIEW='true'
$env:CSBATAGI_CINEMATIC_BUILD='true'
$env:BACKEND_INTERNAL_URL='http://127.0.0.1:9'
node node_modules/next/dist/bin/next build
node scripts/preview-cinematic.mjs --production
```

This uses `.next-cinematic-build/`, separate from both the normal build and the preview development cache. Stop an existing preview before starting another on port 3002.

## Scene implementation

- `camera-path.ts`: four scroll camera compositions and bounded render budgets.
- `breach-world.ts`: procedural sandstone architecture, A-site crates, ground, shared mineral texture, instanced rubble and brass, smoke sprites, and a procedural operator fallback.
- `breach-operators.ts`: optimized SAS/Phoenix GLBs; two players on mobile, four on desktop sharing model resources. Analytic two-bone limb poses keep feet planted and hands at rifle grips.
- `encounter-motion.ts`: absolute scroll choreography: advance 1.46 world units, settle behind low cover, alternate short firing bursts, then withdraw .73 units. Limb motion comes from travel distance, not an unrelated run clip. Stone chips and brass appear only after shots and follow ballistic paths.
- `breach-renderer.ts`: Three.js rendering and off-axis framing that leaves room for the interface.
- `CinematicScene.tsx`: lazy loading, visibility, motion, cleanup, context-loss fallback, and adaptive resolution.

There are no shadow maps or post-processing render targets. Static geometry shares material batches; debris uses instancing. The engine is a client-only dynamic import, so classic/modern pages and server request handling do not load the 3D scene. Docker memory limits and backend concurrency are unchanged. The mobile GLB pair totals 2.46 MiB (about 10 MiB decoded textures with mipmaps); the desktop pair totals 7.18 MiB (about 50 MiB decoded textures shared by four actors); the still mode and automatic data-saver fallback skip both the engine import and model request. A model-load failure retains the procedural squad, and a WebGL failure keeps the existing poster.

Motion is driven by native page scrolling with an independent slow scene clock. Scroll progress also controls player joint poses and movement, debris expansion/lift/fall and multi-axis spin, brass ejection, and smoke expansion. The system reduced-motion setting and footer pause stop the scene loop; detail pages render a single background frame. Automatic/light/static selection persists separately. The light tier starts on narrow screens or reported devices with at most four cores/4 GB memory. It caps rendering at 30 fps and 850k pixels; desktop caps at 60 fps and 1.9M pixels. Sustained high CPU render submission cost lowers the resolution and caps at 24 fps. Actual low-end phone battery/GPU performance still requires physical-device testing.

## Imported CS2 characters

The user supplied SAS and Phoenix GLB/ZIP exports on 6 September 2026. The
alternate GLBs contain the same geometry and materials at different texture
resolutions. `scripts/prepare-cs2-models.mjs` uses existing Sharp offline to remove
394 SAS editor clips, prune unused attributes/maps, repack shared buffers, and
produce 512px mobile / 1024px desktop textures. No new runtime dependency.
Source links, provided licenses, exact byte counts, and modifications are recorded
in `public/models/cinematic/README.md` and `credits.txt`; the menu links to credits.

Mobile browser review at 390x844: two actual CS2 rigs, 40,940 scene triangles,
47 draw calls, no horizontal overflow. This is browser emulation, not a physical
low-end phone benchmark. Automatic data-saving/static fallback remains available.

## Validation commands

`node scripts/check-design.cjs`, `node scripts/check-cinematic.cjs`, `node scripts/check-scroll-rigs.mjs`, `node node_modules/typescript/bin/tsc --noEmit`, and the isolated optimized build. The cinematic checks cover camera movement, finite/clamped interpolation, low-hardware selection, pixel budgets, and existing briefing/data contracts. Browser review covers responsive layout, camera changes, menu/anchors, pause and scene quality controls.
