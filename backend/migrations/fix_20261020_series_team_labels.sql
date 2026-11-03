-- One-off data fix for the 20 October 2026 series (captains Malawhur and regarnur, final score 2-1 to
-- Malawhur). de_cbble_d (f176f559ec0cda4) and de_biome (1591463444f2961f) were maps 1 and 2 of one
-- MatchZy series and hit the same warmup restart as 30 October (fix_20261030_series_team_labels.sql):
-- each roster was saved under the other team's name, with the other team's score, the wrong map
-- winner and crossed labels on the final round. de_nuke, the final map, is correct.
-- Per map, this relabels every per-player team-name column by Steam ID, swaps the two team rows'
-- names, restores the final round's labels from round 1 and recomputes the map winner.
-- Run by the deploy workflow as the database superuser on every migration run. One-shot: a map is
-- skipped once its players carry their own team's name, or when its roster is not the expected one.
-- The UPDATEs fire the statement-level stats triggers, so the backend republishes stats after its
-- quiet window.
\set ON_ERROR_STOP on

DO $$
DECLARE
  fix record;
  col record;
  winner text;
  changed bigint;
BEGIN
  FOR fix IN
    SELECT * FROM (VALUES
      ('f176f559ec0cda4', 'de_cbble_d'),
      ('1591463444f2961f', 'de_biome')
    ) AS maps(checksum, map_name)
    CROSS JOIN (VALUES (
      'Team Malawhur',
      ARRAY['76561198001957069', '76561198287242573', '76561198045378695', '76561198031411056', '76561198047085527'],
      'Team regarnur',
      ARRAY['76561198155880054', '76561197996079017', '76561198084388347', '76561199508399712', '76561198051285785']
    )) AS rosters(name1, roster1, name2, roster2)
  LOOP
    -- Statement triggers fire even when an UPDATE matches no rows, so leave a fixed map untouched.
    IF NOT EXISTS (SELECT 1 FROM players WHERE match_checksum = fix.checksum
                   AND steam_id::text = ANY (fix.roster1) AND team_name = fix.name2) THEN
      RAISE NOTICE 'fix_20261020: % already labelled correctly', fix.map_name;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM players WHERE match_checksum = fix.checksum
               AND (NOT (steam_id::text = ANY (fix.roster1 || fix.roster2)) OR team_name NOT IN (fix.name1, fix.name2))) THEN
      RAISE NOTICE 'fix_20261020: % has an unexpected roster; skipped', fix.map_name;
      CONTINUE;
    END IF;

    -- Every <prefix>team_name column that sits next to a <prefix>steam_id column: players.team_name,
    -- kills.killer_team_name, damages.victim_team_name, shots.player_team_name, grenade throwers...
    FOR col IN
      SELECT c.table_name, c.column_name AS team_column, s.column_name AS steam_column
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      JOIN information_schema.columns s
        ON s.table_schema = c.table_schema AND s.table_name = c.table_name
       AND s.column_name = left(c.column_name, length(c.column_name) - length('team_name')) || 'steam_id'
      JOIN information_schema.columns k
        ON k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = 'match_checksum'
      WHERE c.table_schema = 'public'
        AND c.data_type IN ('text', 'character varying')
        AND c.column_name LIKE '%team\_name'
      ORDER BY c.table_name, c.column_name
    LOOP
      EXECUTE format(
        'UPDATE %1$I SET %2$I = CASE WHEN %3$I::text = ANY ($2) THEN $4 ELSE $5 END
         WHERE match_checksum = $1 AND %2$I IN ($4, $5)
           AND ((%3$I::text = ANY ($2) AND %2$I = $5) OR (%3$I::text = ANY ($3) AND %2$I = $4))',
        col.table_name, col.team_column, col.steam_column)
      USING fix.checksum, fix.roster1, fix.roster2, fix.name1, fix.name2;
      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed > 0 THEN
        RAISE NOTICE 'fix_20261020: % %.% relabelled % row(s)', fix.map_name, col.table_name, col.team_column, changed;
      END IF;
    END LOOP;

    -- Each team row kept its own score, side and letter; only the names were crossed.
    UPDATE teams SET name = CASE name WHEN fix.name1 THEN fix.name2 ELSE fix.name1 END
    WHERE match_checksum = fix.checksum AND name IN (fix.name1, fix.name2);

    -- Round 1 was recorded before the warmup restart, so its team labels are the map's real ones.
    UPDATE rounds r SET team_a_name = r1.team_a_name, team_b_name = r1.team_b_name
    FROM rounds r1
    WHERE r1.match_checksum = fix.checksum AND r1.number = 1
      AND r.match_checksum = fix.checksum
      AND (r.team_a_name, r.team_b_name) IS DISTINCT FROM (r1.team_a_name, r1.team_b_name);
    GET DIAGNOSTICS changed = ROW_COUNT;
    RAISE NOTICE 'fix_20261020: % relabelled % round(s)', fix.map_name, changed;

    SELECT name INTO winner FROM teams WHERE match_checksum = fix.checksum ORDER BY score DESC LIMIT 1;
    UPDATE matches SET winner_name = winner
    WHERE checksum = fix.checksum AND winner_name IS DISTINCT FROM winner;
    RAISE NOTICE 'fix_20261020: % winner is %', fix.map_name, winner;
  END LOOP;
END
$$;
