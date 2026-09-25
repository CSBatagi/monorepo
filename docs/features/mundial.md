# Batak Mundial (active season)

Batak Mundial follows Superliga. Pots are seeded from the final Superliga
standings (1-4 → pot 1, 5-8 → pot 2, …), a draw places one player from each pot
in each of four groups, and the top two of every group reach an eight-player
knockout bracket. There is no promotion or relegation. Night scoring is
identical to Superliga (`src/lib/superliga.ts`).

Page: `/mundial` (`frontend-nextjs/src/app/mundial/`). Tabs: **Kura**, **Gruplar**,
**Eleme Tablosu**, **Format**, plus the admin tabs shared with Superliga
(**Kaptan Atama**, **Eksik Maç Ekle**, **Manuel Gece**). A tab can be linked
directly with `?sekme=kura|gruplar|eleme|format`.

## Configuration

`frontend-nextjs/public/data/mundial_config.json` (static, registered in `dataReader.ts`):

- `seasonStart`: first scored night (inclusive). Superliga's `seasonEnd` in
  `superliga_config.json` is the day before, so a night never counts in both.
- `groupStageLength`: number of scored nights in the group stage. Later nights
  (knockout matches) do not change group standings.
- `pots`: Steam IDs per pot, in seeding order.
- `tentative`: players whose participation is decided on the Kura tab just before
  the draw (the draw button stays disabled until each one is answered).
- `wildcards`: the group that receives one of these players is labelled
  "ölüm grubu".
- `drawOperators`: Steam IDs that may start and drive the draw in addition to
  admins.

## Draw (kura)

The draw is live and click-driven. Nothing is drawn in advance.

- **Who can drive it:** Steam admins (`steam_members.is_admin`) plus the Steam IDs
  in `drawOperators` in the config (Uncle Iroh). `src/lib/mundialServer.ts`
  checks this server-side in the `/api/live/mundial` proxy for `draw-start`,
  `draw-next` and `draw-reset`. The page asks `/api/mundial/operator` only to
  decide which buttons to show. The acting user's name comes from the verified
  session.
- **Kura Törenini Başlat** (`POST /live/mundial/draw-start`) opens the ceremony
  with the pots fixed (including the tentative player's yes/no answer) and no
  balls drawn. A second start returns 409 until **Kurayı sıfırla**, which also
  clears knockout results.
- **Each click opens one ball** (`POST /live/mundial/draw-next`,
  `backend/mundialDraw.js advanceDraw`, `crypto.randomInt`). First comes a player
  ball from the current pot, then that player's group ball, drawn from the groups
  that do not yet have a player from that pot. Pots are emptied in order. 20
  players take 40 clicks. Space, Enter and → also open the next ball.
- The request carries the number of balls the client has seen (`cursor`). The
  server locks the row (`SELECT … FOR UPDATE`), so if two operators click at the
  same time only one ball opens and the other gets 409.
- The stored state holds only opened balls, so the page data never reveals a
  result early.
- Viewers poll every 2 s. Each new ball shakes for 1.4 s on every screen, then
  opens. A page opened mid-draw shows the current state and is switched to the
  Kura tab.
- **Prova kura** is a local, click-driven rehearsal that is never saved.
  **Töreni tekrar izle** replays a finished draw locally, one ball every few
  seconds.
- Groups and the bracket use the draw only after the last ball is open.

## Storage

Table `mundial_state (key, value JSONB)`, live-version key `mundial`:

- `draw`: pots, groups and the balls opened so far (`steps`, each with who opened it and when; `completedAt` after the last ball).
- `ko:<slot>`: knockout result for `qf1..qf4`, `sf1`, `sf2`, `final` (the two
  players, the winner, an optional score and date). Deleting a result also deletes
  the results that depend on it (`qf1` → `sf1`, `final`).

Captains, missing-map overrides and manual nights reuse the Superliga tables.
They are keyed by date, and each season reads only its own date range.

## Bracket

QF1 A1–B2, QF2 C1–D2, QF3 B1–A2, QF4 D1–C2; SF1 = QF1/QF2 winners, SF2 = QF3/QF4
winners. Group winners can meet their own group's runner-up only in the final.
Until the group stage is complete, the bracket shows the current standings as
provisional. A saved result keeps the pairing that was saved with it.

## Archive

Previous formats (Superliga, Token Wars, All-Stars, Domination) are removed from
the home pages and main navigation. Their pages still work and are listed at
`/arsiv` (`src/lib/archivedFormats.ts`). Each shows `ArchivedFormatBanner`.
Superliga reads its own date range from static stats history, so a later global
season change does not empty it.

## Next season

Build the new pots from this season's standings, update `pots`, `seasonStart`
and `groupStageLength`, and set the previous season end date. Then run
**Kurayı sıfırla** and draw again. To keep this season viewable, first move it to the
archive with its own config and table keys.
