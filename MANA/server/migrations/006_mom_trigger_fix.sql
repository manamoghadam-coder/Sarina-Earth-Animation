-- The read_at-only guard applies to API sessions (which always set app.user_id); system maintenance (FK SET NULL, scripts) is not blocked.
CREATE OR REPLACE FUNCTION mom_only_read() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF app_uid() IS NOT NULL AND NOT app_is_parent() AND (to_jsonb(NEW) - 'read_at') <> (to_jsonb(OLD) - 'read_at') THEN RAISE EXCEPTION 'read_at only' USING ERRCODE = '42501'; END IF;
  RETURN NEW; END $$;
