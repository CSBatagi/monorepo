-- One-off data fix for the 23 October 2026 night (captains darbe and Nerull, final score 2-1).
-- de_ancient (match checksum 5c4df3b632c80154) was loaded with the team names "team_darbe" and
-- "team_ekl1ps", while de_overpass and de_thera used "Team darbe" and "Team Nerull" with the same
-- rosters. The mismatched names split the night into two different pairings, so the 2-1 never
-- added up. This renames the two teams on that one map everywhere CS Demo Manager stores a team
-- name, and records the night's captains if nobody has assigned them yet.
-- Run by the deploy workflow as the database superuser on every migration run. One-shot: once the
-- teams are renamed the block does nothing, and an existing captain assignment is never overwritten.
-- The UPDATEs fire the statement-level stats triggers, so the backend republishes stats after its
-- quiet window.
\set ON_ERROR_STOP on

DO $$
DECLARE
  target CONSTANT text := '5c4df3b632c80154';
  col record;
  key_column text;
  changed bigint;
BEGIN
  -- Statement triggers fire even when an UPDATE matches no rows, so skip everything once the fix is in.
  IF NOT EXISTS (SELECT 1 FROM teams WHERE match_checksum = target AND name IN ('team_darbe', 'team_ekl1ps')) THEN
    RAISE NOTICE 'fix_20261023: nothing to do';
    RETURN;
  END IF;

  FOR col IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying')
      AND (c.column_name LIKE '%team_name'
           OR c.column_name LIKE 'team\_%\_name'
           OR c.column_name = 'winner_name'
           OR (c.table_name = 'teams' AND c.column_name = 'name'))
    ORDER BY c.table_name, c.column_name
  LOOP
    SELECT k.column_name INTO key_column
    FROM information_schema.columns k
    WHERE k.table_schema = 'public' AND k.table_name = col.table_name
      AND (k.column_name = 'match_checksum' OR (col.table_name = 'matches' AND k.column_name = 'checksum'))
    LIMIT 1;
    CONTINUE WHEN key_column IS NULL;

    EXECUTE format(
      'UPDATE %I SET %I = CASE %I WHEN %L THEN %L ELSE %L END WHERE %I = $1 AND %I IN (%L, %L)',
      col.table_name, col.column_name, col.column_name,
      'team_darbe', 'Team darbe', 'Team Nerull',
      key_column, col.column_name, 'team_darbe', 'team_ekl1ps')
    USING target;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed > 0 THEN
      RAISE NOTICE 'fix_20261023: %.% renamed % row(s)', col.table_name, col.column_name, changed;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM superliga_captains WHERE date = '2026-10-23') THEN
    INSERT INTO superliga_captains (date, team_key, steam_id, steam_name, team_name, set_by_uid, set_by_name, set_at, updated_at)
    VALUES
      ('2026-10-23', 'team1', '76561198031411056', 'darbe', 'Team darbe', '76561198001957069', 'Malawhur',
       (extract(epoch FROM now()) * 1000)::bigint, now()),
      ('2026-10-23', 'team2', '76561199508399712', 'Nerull', 'Team Nerull', '76561198001957069', 'Malawhur',
       (extract(epoch FROM now()) * 1000)::bigint, now());
    UPDATE live_version SET version = version + 1 WHERE key = 'superliga_captains';
    RAISE NOTICE 'fix_20261023: recorded captains darbe (team1) and Nerull (team2) for 2026-10-23';
  END IF;
END
$$;
