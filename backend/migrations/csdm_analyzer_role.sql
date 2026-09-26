-- Postgres role for the demo analyzer on the game VM (ops/cs2/demo-analyzer.py runs `csdm analyze`).
-- Run by the deploy workflow as the database owner against the csdm database, with
--   psql -v csdm_analyzer_password=... (the CSDM_ANALYZER_PASSWORD secret).
-- Idempotent: every run sets the password and rebuilds the role's privileges from scratch.
--
-- What the CS Demo Manager 3.20.1 CLI needs, and why:
--   * Before every command it runs `CREATE TABLE IF NOT EXISTS migrations (...)`. Postgres checks
--     CREATE on the schema even when the table exists, so the role needs CREATE on schema public.
--     The event trigger below turns that into "may run no-op DDL only": any statement by this role
--     that would create or change an object is rolled back. The role also owns no tables, so it
--     cannot alter or drop them, and CS Demo Manager can never migrate or reset the schema from the
--     game VM (the desktop app that pushes official stats does that).
--   * Data access to CS Demo Manager's own tables only (migrations: read only). The same database
--     holds the website's tables (admins, steam_members, notification_subscriptions, ...), which
--     this role must not touch: the game VM is exposed to the internet.
--   * stats_refresh_state: the website's stats triggers on the CS Demo Manager tables write it with
--     the inserting role's rights.
--   * USAGE on the bigserial sequences of those tables.
-- Keep the table list in step with the CS Demo Manager version (src/node/database/schema.ts).
\set ON_ERROR_STOP on

\if :{?csdm_analyzer_password}
SELECT :'csdm_analyzer_password' <> '' AS has_password \gset
\else
\set has_password false
\endif
\if :has_password
BEGIN;

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'csdm_analyzer') AS create_role \gset
\if :create_role
CREATE ROLE csdm_analyzer;
\endif
ALTER ROLE csdm_analyzer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'csdm_analyzer_password';
ALTER ROLE csdm_analyzer SET search_path = public;

-- Rejects any object this role would create or change; `CREATE TABLE IF NOT EXISTS` on an existing
-- table creates nothing and passes.
CREATE OR REPLACE FUNCTION csdm_analyzer_no_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (session_user = 'csdm_analyzer' OR current_user = 'csdm_analyzer')
     AND EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands()) THEN
    RAISE EXCEPTION 'csdm_analyzer may not change the database schema (%)', tg_tag;
  END IF;
END $$;
DROP EVENT TRIGGER IF EXISTS csdm_analyzer_no_ddl;
CREATE EVENT TRIGGER csdm_analyzer_no_ddl ON ddl_command_end EXECUTE FUNCTION csdm_analyzer_no_ddl();

DO $$
DECLARE
  data_tables text[] := ARRAY[
    'bombs_defuse_start', 'bombs_defused', 'bombs_exploded', 'bombs_plant_start', 'bombs_planted', 'cameras',
    'chicken_deaths', 'clutches', 'chat_messages', 'checksum_tags', 'chicken_positions', 'comments', 'damages',
    'decoys_start', 'demo_paths', 'demos', 'download_history', 'faceit_accounts', 'faceit_match_players',
    'faceit_match_teams', 'faceit_matches', '5eplay_accounts', 'flashbangs_explode', 'grenade_bounces',
    'grenade_positions', 'grenade_projectiles_destroy', 'he_grenades_explode', 'hostage_pick_up_start',
    'hostage_picked_up', 'hostage_positions', 'hostage_rescued', 'ignored_steam_accounts', 'inferno_positions',
    'kills', 'timestamps', 'maps', 'matches', 'player_ban_per_match', 'player_comments', 'round_comments',
    'player_blinds', 'player_buys', 'player_economies', 'player_positions', 'players', 'renown_accounts',
    'round_tags', 'rounds', 'shots', 'smokes_start', 'steam_accounts', 'steam_account_overrides',
    'steam_account_tags', 'tags', 'teams'];
  name text;
  sequence regclass;
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO csdm_analyzer', current_database());
  GRANT USAGE, CREATE ON SCHEMA public TO csdm_analyzer;
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM csdm_analyzer;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM csdm_analyzer;
  FOREACH name IN ARRAY data_tables LOOP
    IF to_regclass(format('public.%I', name)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO csdm_analyzer', name);
    END IF;
  END LOOP;
  IF to_regclass('public.migrations') IS NOT NULL THEN
    GRANT SELECT ON public.migrations TO csdm_analyzer;
  END IF;
  IF to_regclass('public.stats_refresh_state') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON public.stats_refresh_state TO csdm_analyzer;
  END IF;
  -- The bigserial sequences behind those tables' ids.
  FOR sequence IN
    SELECT s.oid::regclass FROM pg_class s
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid
      AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE s.relkind = 'S' AND t.relnamespace = 'public'::regnamespace AND t.relname = ANY (data_tables)
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO csdm_analyzer', sequence);
  END LOOP;
END $$;

COMMIT;
\echo csdm_analyzer: role and privileges applied
\else
\echo csdm_analyzer: CSDM_ANALYZER_PASSWORD is not set; role left unchanged
\endif

-- Must be 14 for CS Demo Manager 3.20.1: the CLI refuses a newer schema and cannot migrate an older one.
SELECT max(schema_version) AS csdm_schema_version FROM migrations;
