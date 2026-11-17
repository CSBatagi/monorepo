-- CS Demo Manager database schema 14 -> 15 (CS Demo Manager 3.21.0), for the shared csdm database.
--
-- Why: the CS2 update of 11 November 2026 added fixed8-encoded fields to CCSPlayerController. The
-- demo parser in CS Demo Manager 3.20.1 read them as varints and crashed on every demo recorded since
-- ("nextByte: insufficient buffer" in sendtables2), so the game VM's analyzer could not analyze any
-- new match. CS Demo Manager 3.21.0 (CS Demo Analyzer 1.14.2) parses them, and needs schema 15.
-- The analyzer's restricted csdm_analyzer role cannot migrate the schema (csdm_analyzer_role.sql),
-- and no desktop app reaches the production database, so the deploy applies the migration here.
--
-- A faithful port of src/node/database/migrations/v15.ts at akiver/cs-demo-manager v3.21.0, plus the
-- migrations row CS Demo Manager's migrateDatabase() writes afterwards. Differences: tables are
-- schema-qualified, column drops use IF EXISTS, and csdm_analyzer is granted the recreated tables.
-- Nothing the website reads is touched: the frame columns are unused, and the position tables (only
-- filled by "--analyze-positions", never used here) were empty in production on 17 November 2026.
--
-- Run by the deploy workflow as the database superuser on every migration run. One-shot: it runs only
-- while the schema is at 14, in one transaction that also records version 15.
\set ON_ERROR_STOP on

SELECT to_regclass('public.migrations') IS NOT NULL AS csdm_has_schema \gset
\if :csdm_has_schema
SELECT coalesce(max(schema_version), 0) AS csdm_schema FROM migrations \gset
SELECT :csdm_schema = 14 AS csdm_v15_needed, :csdm_schema >= 15 AS csdm_v15_done \gset
\else
\set csdm_v15_needed false
\set csdm_v15_done false
\set csdm_schema none
\endif

\if :csdm_v15_needed
SELECT tableowner AS csdm_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'matches' \gset
BEGIN;
-- New objects get the same owner as CS Demo Manager's existing tables.
SET LOCAL ROLE :"csdm_owner";
-- The column drops need a brief exclusive lock on large tables (shots); never queue behind a long
-- stats query for minutes while the website waits behind this migration. A timeout fails the step,
-- and the next deploy's migration run tries again.
SET LOCAL lock_timeout = '30s';

-- The kills and rounds tables are frequently filtered by match_checksum and round_number.
CREATE INDEX IF NOT EXISTS kills_match_checksum_round_number_idx ON public.kills (match_checksum, round_number);
CREATE INDEX IF NOT EXISTS rounds_match_checksum_number_idx ON public.rounds (match_checksum, number);
-- Redundant with shots_match_checksum_round_number_idx.
DROP INDEX IF EXISTS public.shots_match_checksum_idx;

-- Frame columns are not used, ticks are enough. CS Demo Manager 3.21.0 no longer writes them, and
-- they are NOT NULL, so its inserts would fail while they exist.
ALTER TABLE public.bombs_defuse_start DROP COLUMN IF EXISTS frame;
ALTER TABLE public.bombs_defused DROP COLUMN IF EXISTS frame;
ALTER TABLE public.bombs_exploded DROP COLUMN IF EXISTS frame;
ALTER TABLE public.bombs_plant_start DROP COLUMN IF EXISTS frame;
ALTER TABLE public.bombs_planted DROP COLUMN IF EXISTS frame;
ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS frame;
ALTER TABLE public.chicken_deaths DROP COLUMN IF EXISTS frame;
ALTER TABLE public.clutches DROP COLUMN IF EXISTS frame;
ALTER TABLE public.damages DROP COLUMN IF EXISTS frame;
ALTER TABLE public.decoys_start DROP COLUMN IF EXISTS frame;
ALTER TABLE public.flashbangs_explode DROP COLUMN IF EXISTS frame;
ALTER TABLE public.grenade_bounces DROP COLUMN IF EXISTS frame;
ALTER TABLE public.grenade_projectiles_destroy DROP COLUMN IF EXISTS frame;
ALTER TABLE public.he_grenades_explode DROP COLUMN IF EXISTS frame;
ALTER TABLE public.hostage_pick_up_start DROP COLUMN IF EXISTS frame;
ALTER TABLE public.hostage_picked_up DROP COLUMN IF EXISTS frame;
ALTER TABLE public.hostage_rescued DROP COLUMN IF EXISTS frame;
ALTER TABLE public.kills DROP COLUMN IF EXISTS frame;
ALTER TABLE public.player_blinds DROP COLUMN IF EXISTS frame;
ALTER TABLE public.player_buys DROP COLUMN IF EXISTS frame;
ALTER TABLE public.shots DROP COLUMN IF EXISTS frame;
ALTER TABLE public.smokes_start DROP COLUMN IF EXISTS frame;
ALTER TABLE public.rounds
  DROP COLUMN IF EXISTS start_frame,
  DROP COLUMN IF EXISTS freeze_time_end_frame,
  DROP COLUMN IF EXISTS end_frame,
  DROP COLUMN IF EXISTS end_officially_frame;

-- Positions are now stored as binary packed columns; existing positions are deleted and have to be
-- generated again (CS Demo Manager's own behaviour).
DROP TABLE IF EXISTS public.player_positions;
CREATE TABLE public.player_positions (
  match_checksum varchar NOT NULL,
  round_number integer NOT NULL,
  player_steam_id varchar NOT NULL,
  player_name varchar NOT NULL,
  ticks bytea NOT NULL,
  x bytea NOT NULL,
  y bytea NOT NULL,
  z bytea NOT NULL,
  yaw bytea NOT NULL,
  flash_duration_remaining bytea NOT NULL,
  is_ducking bytea NOT NULL,
  is_airborne bytea NOT NULL,
  state_ticks bytea NOT NULL,
  is_alive bytea NOT NULL,
  side bytea NOT NULL,
  money bytea NOT NULL,
  health bytea NOT NULL,
  armor bytea NOT NULL,
  has_helmet bytea NOT NULL,
  has_bomb bytea NOT NULL,
  has_defuse_kit bytea NOT NULL,
  is_scoping bytea NOT NULL,
  is_defusing bytea NOT NULL,
  is_planting bytea NOT NULL,
  is_grabbing_hostage bytea NOT NULL,
  active_weapon_name text[] NOT NULL,
  equipments text[] NOT NULL,
  grenades text[] NOT NULL,
  pistols text[] NOT NULL,
  smgs text[] NOT NULL,
  rifles text[] NOT NULL,
  heavy text[] NOT NULL,
  CONSTRAINT player_positions_match_checksum_fk FOREIGN KEY (match_checksum)
    REFERENCES public.matches (checksum) ON DELETE CASCADE
);
CREATE INDEX player_positions_match_checksum_round_number_idx ON public.player_positions (match_checksum, round_number);

-- Players positions sampled once per second for the positions heatmaps. Every 3.21.0 analysis
-- writes this table, with or without --analyze-positions.
CREATE TABLE public.player_position_samples (
  match_checksum varchar NOT NULL,
  round_number integer NOT NULL,
  player_steam_id varchar NOT NULL,
  side int2 NOT NULL,
  ticks bytea NOT NULL,
  x bytea NOT NULL,
  y bytea NOT NULL,
  z bytea NOT NULL,
  CONSTRAINT player_position_samples_match_checksum_fk FOREIGN KEY (match_checksum)
    REFERENCES public.matches (checksum) ON DELETE CASCADE
);
CREATE INDEX player_position_samples_match_checksum_round_number_idx ON public.player_position_samples (match_checksum, round_number);
CREATE INDEX player_position_samples_player_steam_id_idx ON public.player_position_samples (player_steam_id);

DROP TABLE IF EXISTS public.grenade_positions;
CREATE TABLE public.grenade_positions (
  match_checksum varchar NOT NULL,
  round_number integer NOT NULL,
  grenade_id varchar NOT NULL,
  projectile_id varchar NOT NULL,
  grenade_name varchar NOT NULL,
  thrower_steam_id varchar NOT NULL,
  thrower_name varchar NOT NULL,
  thrower_side int2 NOT NULL,
  thrower_team_name varchar NOT NULL,
  thrower_velocity_x real NOT NULL,
  thrower_velocity_y real NOT NULL,
  thrower_velocity_z real NOT NULL,
  thrower_yaw real NOT NULL,
  thrower_pitch real NOT NULL,
  ticks bytea NOT NULL,
  x bytea NOT NULL,
  y bytea NOT NULL,
  z bytea NOT NULL,
  CONSTRAINT grenade_positions_match_checksum_fk FOREIGN KEY (match_checksum)
    REFERENCES public.matches (checksum) ON DELETE CASCADE
);
CREATE INDEX grenade_positions_match_checksum_round_number_idx ON public.grenade_positions (match_checksum, round_number);

DROP TABLE IF EXISTS public.inferno_positions;
CREATE TABLE public.inferno_positions (
  match_checksum varchar NOT NULL,
  round_number integer NOT NULL,
  unique_id varchar NOT NULL,
  thrower_steam_id varchar NOT NULL,
  thrower_name varchar NOT NULL,
  x real NOT NULL,
  y real NOT NULL,
  z real NOT NULL,
  ticks bytea NOT NULL,
  convex_hulls_2d text[] NOT NULL,
  CONSTRAINT inferno_positions_match_checksum_fk FOREIGN KEY (match_checksum)
    REFERENCES public.matches (checksum) ON DELETE CASCADE
);
CREATE INDEX inferno_positions_match_checksum_round_number_idx ON public.inferno_positions (match_checksum, round_number);

DROP TABLE IF EXISTS public.hostage_positions;
CREATE TABLE public.hostage_positions (
  match_checksum varchar NOT NULL,
  round_number integer NOT NULL,
  ticks bytea NOT NULL,
  x bytea NOT NULL,
  y bytea NOT NULL,
  z bytea NOT NULL,
  state_ticks bytea NOT NULL,
  states bytea NOT NULL,
  CONSTRAINT hostage_positions_match_checksum_fk FOREIGN KEY (match_checksum)
    REFERENCES public.matches (checksum) ON DELETE CASCADE
);
CREATE INDEX hostage_positions_match_checksum_round_number_idx ON public.hostage_positions (match_checksum, round_number);

DROP TABLE IF EXISTS public.chicken_positions;
CREATE TABLE public.chicken_positions (
  match_checksum varchar NOT NULL,
  round_number integer NOT NULL,
  ticks bytea NOT NULL,
  x bytea NOT NULL,
  y bytea NOT NULL,
  z bytea NOT NULL,
  CONSTRAINT chicken_positions_match_checksum_fk FOREIGN KEY (match_checksum)
    REFERENCES public.matches (checksum) ON DELETE CASCADE
);
CREATE INDEX chicken_positions_match_checksum_round_number_idx ON public.chicken_positions (match_checksum, round_number);

-- PostgreSQL can't convert bytes to a float, this function makes the packed float32 columns queryable
-- in SQL. Ticks (int32) can be compared with int4send() as they use the same byte order.
CREATE OR REPLACE FUNCTION public.float32_be(buf bytea, idx integer)
RETURNS real
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  -- substring() only decompresses the value up to the slice it needs, get_byte() on buf would decompress it entirely
  w    bytea := substring(buf FROM idx * 4 + 1 FOR 4);
  bits bigint;
  e    integer;
  m    integer;
  v    float8;
BEGIN
  IF idx < 0 OR length(w) < 4 THEN
    RETURN NULL;
  END IF;

  bits := (get_byte(w, 0)::bigint << 24) | (get_byte(w, 1) << 16) | (get_byte(w, 2) << 8) | get_byte(w, 3);
  e := (bits >> 23) & 255;      -- exponent
  m := bits & 8388607;          -- 23-bit mantissa

  IF e = 255 THEN
    RETURN CASE WHEN m <> 0 THEN 'NaN'::real
                WHEN bits >> 31 = 1 THEN '-Infinity'::real
                ELSE 'Infinity'::real END;
  END IF;

  -- exact in float8: 24-bit integer times a power of two
  v := CASE WHEN e = 0 THEN m * 2::float8 ^ -149                 -- subnormal
            ELSE (m + 8388608) * 2::float8 ^ (e - 150) END;      -- normal (implicit leading 1)

  RETURN CASE WHEN bits >> 31 = 1 THEN -v ELSE v END;            -- keeps -0
END
$$;

-- Whole packed columns as arrays, much faster than float32_be() when reading many values.
CREATE OR REPLACE FUNCTION public.float32_be_array(buf bytea)
RETURNS real[]
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  b      bytea  := buf || ''::bytea;  -- forces a single decompression into memory
  result real[] := '{}';
BEGIN
  FOR k IN 0 .. length(b) / 4 - 1 LOOP
    result[k + 1] := float32_be(b, k);
  END LOOP;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.int32_be_array(buf bytea)
RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  b      bytea     := buf || ''::bytea;  -- forces a single decompression into memory
  result integer[] := '{}';
  bits   bigint;
BEGIN
  FOR k IN 0 .. length(b) / 4 - 1 LOOP
    bits := (get_byte(b, k * 4)::bigint << 24) | (get_byte(b, k * 4 + 1) << 16)
          | (get_byte(b, k * 4 + 2) << 8) | get_byte(b, k * 4 + 3);
    -- two's complement for negative values
    result[k + 1] := CASE WHEN bits >= 2147483648 THEN bits - 4294967296 ELSE bits END;
  END LOOP;
  RETURN result;
END
$$;

-- Boolean columns use 1 byte per value, 1 for true and 0 for false.
CREATE OR REPLACE FUNCTION public.bool_array(buf bytea)
RETURNS boolean[]
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  b      bytea     := buf || ''::bytea;  -- forces a single decompression into memory
  result boolean[] := '{}';
BEGIN
  FOR k IN 0 .. length(b) - 1 LOOP
    result[k + 1] := get_byte(b, k) = 1;
  END LOOP;
  RETURN result;
END
$$;

-- The analyzer inserts into the recreated tables; csdm_analyzer_role.sql grants the same on every run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'csdm_analyzer') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_positions, public.player_position_samples,
      public.grenade_positions, public.inferno_positions, public.hostage_positions, public.chicken_positions
      TO csdm_analyzer;
  END IF;
END $$;

INSERT INTO public.migrations (schema_version, run_at) VALUES (15, now());
COMMIT;
\echo csdm schema: migrated 14 -> 15 (CS Demo Manager 3.21.0)
\elif :csdm_v15_done
\echo csdm schema: version :csdm_schema already includes 15; nothing to do
\else
\echo csdm schema: version :csdm_schema is not 14; v15 migration not applied
\endif
