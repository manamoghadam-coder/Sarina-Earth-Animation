-- messenger links (Bale / Telegram), shared shopping list, health records, task attachments
CREATE TABLE messenger_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('bale','telegram')), chat_id text NOT NULL, enabled boolean NOT NULL DEFAULT true, linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, chat_id), UNIQUE (user_id, provider)
);
CREATE TABLE messenger_codes (code text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider text NOT NULL, expires_at timestamptz NOT NULL);
ALTER TABLE notifications ADD COLUMN msg_status text;
ALTER TABLE messenger_links ENABLE ROW LEVEL SECURITY; ALTER TABLE messenger_codes ENABLE ROW LEVEL SECURITY;   -- codes: system pool only (no policy)
CREATE POLICY ml_read ON messenger_links FOR SELECT USING (user_id = app_uid());
CREATE POLICY ml_upd ON messenger_links FOR UPDATE USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
CREATE POLICY ml_del ON messenger_links FOR DELETE USING (user_id = app_uid());

CREATE TABLE shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, qty text, category text NOT NULL DEFAULT 'food' CHECK (category IN ('food','home','school','health','other')),
  note text, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','bought')), added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(), bought_at timestamptz
);
CREATE TABLE health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), person_id uuid REFERENCES users(id) ON DELETE SET NULL, person_label text,
  kind text NOT NULL DEFAULT 'appointment' CHECK (kind IN ('vaccine','appointment','checkup','dental','other')), title text NOT NULL,
  due_date date, due_time time, doctor text, note text, done boolean NOT NULL DEFAULT false, done_on date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, orig_name text NOT NULL,
  file_name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES ('shopping_items','shopping'),('health_records','health'),('task_files','tasks')) v(t,m) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.t);
    EXECUTE format('CREATE POLICY perm_read ON %I FOR SELECT USING (app_perm(%L) >= 1)', r.t, r.m);
    EXECUTE format('CREATE POLICY perm_ins ON %I FOR INSERT WITH CHECK (app_perm(%L) >= 2)', r.t, r.m);
    EXECUTE format('CREATE POLICY perm_upd ON %I FOR UPDATE USING (app_perm(%L) >= 2) WITH CHECK (app_perm(%L) >= 2)', r.t, r.m, r.m);
    EXECUTE format('CREATE POLICY perm_del ON %I FOR DELETE USING (app_perm(%L) >= 2)', r.t, r.m);
  END LOOP;
END $$;
