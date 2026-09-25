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

## Draw (kura)

- The draw runs **on the server** (`backend/mundialDraw.js`, `crypto.randomInt`):
  for each pot, a player ball is drawn, then a group ball from the groups that
  do not yet have a player from that pot. A short pot leaves a random group one
  player short.
- `POST /live/mundial/draw` stores the result once. A second draw returns 409
  until **Kurayı sıfırla** is used, which also clears knockout results.
- The stored draw includes `revealStartsAt` (15 s countdown), `stepMs` and
  `potIntroMs`. Every open page plays the same ceremony on the same timeline,
  aligned to the server clock (`serverTime` in the GET response). The page
  polls every 3 s and switches viewers to the Kura tab when a live draw starts.
- **Prova kura** runs the same algorithm in the browser for a private rehearsal;
  it is never saved. **Töreni tekrar izle** replays a saved draw locally.
- Admin actions use the same password prompt as the other league tools, and
  the Next.js middleware requires a Steam session for every POST.

## Storage

Table `mundial_state (key, value JSONB)`, live-version key `mundial`:

- `draw`: groups, pots, reveal steps and timing.
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
