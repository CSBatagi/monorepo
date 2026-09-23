# Team Balancer

The team picker (`/team-picker`) has a **Denge Önerisi** panel. After captains pick the teams, it scores both
sides, estimates each side's chance to win the map, and when the teams are clearly uneven it suggests the
smallest swap that fixes it. It never changes the teams on its own: a swap only happens when someone clicks
**Uygula** and confirms.

- Model: `frontend-nextjs/src/lib/teamBalance.ts` (pure functions, all constants in `BALANCE_MODEL`)
- Panel: `frontend-nextjs/src/components/TeamBalancePanel.tsx`
- Data: backend dataset `player_ratings` (`backend/statsGenerator.js`, `PLAYER_RATING_WINDOW = 150`)
- Backtest: `cd frontend-nextjs && npm run backtest-team-balance`

## The formula

1. **Player rating.** The player's average HLTV 2.0 over their last 150 maps, across all seasons, with
   10 "phantom" maps at 0.90 mixed in:

   `base = (sum of HLTV 2.0 over last 150 maps + 10 × 0.90) / (maps + 10)`

   Veterans barely move from their real average. New players start near 0.90, because new players
   averaged about 0.80 over their first 10 maps. A manual HLTV override in the picker replaces the 0.90
   for that player.

2. **Map adjustment.** When maps are selected, the rating leans toward the player's record on those maps,
   with 8 phantom maps at their base rating (averaged over the selected maps):

   `map rating = (sum of HLTV 2.0 on this map + 8 × base) / (maps on this map + 8)`

3. **Team power.** The average rating plus a bonus for the best player:

   `power = mean(ratings) + 0.2 × best rating`

4. **Win chance.** `P(A wins the map) = 1 / (1 + e^(−4.5 × (power A − power B)))`

5. **Verdict and suggestions.** Gap = power A − power B.

   | Gap | Verdict | What happened historically | Panel shows |
   |---|---|---|---|
   | < 0.05 | Dengeli | favourite won 47% | no suggestion |
   | 0.05 to 0.10 | Hafif avantaj | favourite won 51% | no suggestion |
   | ≥ 0.10 | Dengesiz | favourite won 74% | up to 3 swaps |

   Suggestions are 1-for-1 swaps and 2-for-2 swaps (plus single moves when team sizes differ by 2 or more),
   ranked by the gap they leave. Each extra pair moved costs 0.02, and the best single swap is always listed.

## What the history says

We replayed every map from Feb 2025 to Apr 2026 (about 220 maps across 99 nights). For each night, player
numbers were rebuilt from earlier nights only, so nothing uses information the pickers didn't have.
Correlation is with the share of rounds each team won.

| Signal (team A − team B) | Correlation with round share | Verdict |
|---|---|---|
| Last-10 HLTV 2.0 (shown in the picker) | −0.01 | no signal |
| Season HLTV 2.0 (shown in the picker) | −0.08 | no signal |
| Recent form (last-10 minus long-run) | **−0.22** | hot streaks mislead |
| Win rate / plus-minus (credit players for wins) | ≈ 0 | no signal |
| Utility damage, HS%, assists | ≈ 0 | no signal |
| Long-run HLTV 2.0 (shrunk average) | +0.20 | real signal |
| Long-run ADR, K/D, kills, MVPs | +0.17 to +0.21 | same signal as HLTV, adds nothing |
| + map-specific record | +0.25 | helps |
| + best-player bonus, newcomer prior 0.90 | **+0.31** | final model |

What we learned:

- **Long-run skill wins, recent form doesn't.** Pickers already even out last-10 numbers, so what is left
  is players who are hot or cold. A team full of hot players is overrated and loses more than expected.
  Last-10 and season numbers therefore get weight zero.
- **The map matters.** A player's record on the chosen map adds real information.
- **Stars matter more than the weakest slot.** The best player's rating predicts results. The weakest
  player's does not.
- **Other stats add nothing new.** ADR, K/D, kills and MVPs carry the same information as HLTV 2.0 and add
  nothing when combined with it. Win rate and plus-minus carry none.
- **Duels weren't used.** The duel matrix only exists as a whole-season total that already includes the
  results we would be predicting, so it cannot be tested fairly. Head-to-head kill share is mostly the same
  firepower HLTV 2.0 already measures.

How reliable it is: the correlation holds in every season. A bootstrap over nights puts its 90% interval at
roughly 0.14 to 0.36. Log loss is 0.669, against 0.693 for a coin flip. The model is a little cautious: when
it calls a team "Dengesiz" it predicts about 65% for the favourite, and the real rate was 74%. On history,
53 of 211 picks would have been flagged, and in 52 of them a single swap brings the gap under 0.05.

## Keeping it honest

Run `npm run backtest-team-balance` in `frontend-nextjs` after new seasons are baked. It replays history
through the same `teamBalance.ts` the page uses. If the verdict rows stop showing a clear edge in the
"unbalanced" group, revisit the constants in `BALANCE_MODEL`.
