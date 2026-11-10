-- One-off role grant, 10 November 2026: website admin for Nerull, Titus, Cago, Uncle Iroh and
-- ekl1ps, so they can
-- create matches on the game server, open and close the analysis server and queue demo analysis.
-- Website admin is the single flag steam_members.is_admin, so this also gives them every other
-- admin control (notifications, stats regeneration, cosmetics awards, Mundial draw).
-- SteamIDs come from frontend-nextjs/public/data/players.json. A member who has never signed in gets
-- the row Steam login would create (uid = SteamID); the next sign-in fills in name and avatar.
-- Run by the deploy workflow as the database superuser on every migration run. One-shot: the
-- data_fix_runs marker stops later runs, so a later revocation is not undone.
\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS data_fix_runs (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

DO $$
DECLARE
  fix CONSTANT text := 'grant_20261110_admins';
  member record;
BEGIN
  IF EXISTS (SELECT 1 FROM data_fix_runs WHERE name = fix) THEN
    RAISE NOTICE '%: already applied', fix;
    RETURN;
  END IF;

  FOR member IN
    INSERT INTO steam_members (steam_id, uid, display_name, is_admin)
    VALUES ('76561199508399712', '76561199508399712', 'Nerull', true),
           ('76561198084388347', '76561198084388347', 'Titus', true),
           ('76561198287242573', '76561198287242573', 'Cago', true),
           ('76561197996079017', '76561197996079017', 'Uncle Iroh', true),
           ('76561198004605665', '76561198004605665', 'ekl1ps', true)
    ON CONFLICT (steam_id) DO UPDATE SET is_admin = true
    RETURNING steam_id, display_name, (xmax = 0) AS created
  LOOP
    RAISE NOTICE '%: % (%) is admin%', fix, member.display_name, member.steam_id,
      CASE WHEN member.created THEN ', new member row' ELSE '' END;
  END LOOP;

  INSERT INTO data_fix_runs (name) VALUES (fix);
END $$;
