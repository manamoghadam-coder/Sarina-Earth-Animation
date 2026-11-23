-- ============ photos get a kind so wish/avatar pictures stay out of the gallery ============
ALTER TABLE photos ADD COLUMN kind text NOT NULL DEFAULT 'gallery' CHECK (kind IN ('gallery','avatar','wish','task'));
UPDATE photos SET kind = 'avatar' WHERE caption = 'پروفایل' AND uploaded_by = owner_id;

-- personal features: add 'wishes' (default write)
CREATE OR REPLACE FUNCTION app_feat(m text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN current_setting('app.role', true) = 'parent' THEN 2
    ELSE COALESCE((SELECT LEAST(2, GREATEST(0, COALESCE((permissions ->> m)::int,
           CASE m WHEN 'diary' THEN 2 WHEN 'chat' THEN 2 WHEN 'inbox' THEN 1 WHEN 'avatar' THEN 2 WHEN 'wishes' THEN 2 ELSE 0 END)))
         FROM users WHERE id = app_uid() AND active), 0) END $$;

DROP POLICY photos_self_ins ON photos; DROP POLICY photos_self_del ON photos;
CREATE POLICY photos_self_ins ON photos FOR INSERT WITH CHECK (owner_id = app_uid() AND uploaded_by = app_uid()
  AND ((kind = 'avatar' AND app_feat('avatar') >= 2) OR (kind = 'wish' AND app_feat('wishes') >= 2)));
CREATE POLICY photos_self_del ON photos FOR DELETE USING (owner_id = app_uid() AND uploaded_by = app_uid()
  AND ((kind = 'avatar' AND app_feat('avatar') >= 2) OR (kind = 'wish' AND app_feat('wishes') >= 2)));

-- ============ Wish board (تابلو آرزوها) ============
CREATE TABLE wish_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'تابلو آرزوهای من' CHECK (char_length(title) <= 80),
  starts_on date NOT NULL DEFAULT current_date,
  refresh_months int NOT NULL DEFAULT 3 CHECK (refresh_months BETWEEN 1 AND 12),   -- "update me" reminder
  archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wish_one_active ON wish_boards (user_id) WHERE NOT archived;
CREATE TABLE wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES wish_boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120), note text CHECK (note IS NULL OR char_length(note) <= 500),
  kind text NOT NULL DEFAULT 'dream' CHECK (kind IN ('dream','place','goal')),
  photo_id uuid REFERENCES photos(id) ON DELETE SET NULL,
  achieved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wishes_board ON wishes (board_id, created_at);
ALTER TABLE wish_boards ENABLE ROW LEVEL SECURITY; ALTER TABLE wishes ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['wish_boards','wishes'] LOOP
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_id = app_uid() AND app_feat(''wishes'') >= 1)', t || '_read', t);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_is_parent() AND user_id IN (SELECT id FROM users WHERE role = ''child''))', t || '_parent_read', t);
  EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = app_uid() AND app_feat(''wishes'') >= 2)', t || '_ins', t);
  EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (user_id = app_uid() AND app_feat(''wishes'') >= 2) WITH CHECK (user_id = app_uid())', t || '_upd', t);
  EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (user_id = app_uid() AND app_feat(''wishes'') >= 2)', t || '_del', t);
END LOOP; END $$;

-- ============ per-child settings replacing hard-coded names ============
ALTER TABLE child_settings ADD COLUMN show_homework boolean NOT NULL DEFAULT false;
ALTER TABLE child_settings ADD COLUMN theme text NOT NULL DEFAULT 'sarina' CHECK (theme IN ('sarina','saman'));
ALTER TABLE child_settings ADD COLUMN reflection_stars int NOT NULL DEFAULT 0 CHECK (reflection_stars BETWEEN 0 AND 10);
UPDATE child_settings SET show_homework = true, theme = 'saman' WHERE child_id IN (SELECT id FROM users WHERE username = 'saman');

-- ============ stars for completing the nightly reflection (optional; 0 = off) ============
CREATE FUNCTION claim_reflection_stars() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; d date := (now() AT TIME ZONE 'Asia/Tehran')::date; why text;
BEGIN
  IF app_uid() IS NULL THEN RETURN 0; END IF;
  SELECT reflection_stars INTO n FROM child_settings WHERE child_id = app_uid();
  IF COALESCE(n, 0) <= 0 THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM reflection_entries WHERE user_id = app_uid() AND day = d) THEN RETURN 0; END IF;
  why := 'مرور شبانه ' || d::text;
  IF EXISTS (SELECT 1 FROM star_ledger WHERE child_id = app_uid() AND reason = why) THEN RETURN 0; END IF;
  INSERT INTO star_ledger (child_id, delta, reason) VALUES (app_uid(), n, why); RETURN n;
END $$;

-- ============ direct messages in the chat ============
ALTER TABLE chat_messages ADD COLUMN peer_id uuid REFERENCES users(id) ON DELETE CASCADE;   -- NULL = family group
DROP POLICY chat_read ON chat_messages; DROP POLICY chat_ins ON chat_messages; DROP POLICY chat_del ON chat_messages;
CREATE POLICY chat_read ON chat_messages FOR SELECT USING (app_feat('chat') >= 1 AND (peer_id IS NULL OR sender_id = app_uid() OR peer_id = app_uid()));
CREATE POLICY chat_ins  ON chat_messages FOR INSERT WITH CHECK (sender_id = app_uid() AND app_feat('chat') >= 2 AND peer_id IS DISTINCT FROM app_uid());
CREATE POLICY chat_del  ON chat_messages FOR DELETE USING (app_feat('chat') >= 2 AND (sender_id = app_uid() OR (app_is_parent() AND peer_id IS NULL)));
CREATE INDEX chat_peer ON chat_messages (peer_id, id);

-- ============ annual dates: birthdays, occasions, official (solar) holidays ============
CREATE TABLE family_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('birthday','anniversary','occasion','holiday')),
  jm int NOT NULL CHECK (jm BETWEEN 1 AND 12), jd int NOT NULL CHECK (jd BETWEEN 1 AND 31),
  person_id uuid REFERENCES users(id) ON DELETE CASCADE,
  notify boolean NOT NULL DEFAULT true, official boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE family_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_read ON family_dates FOR SELECT USING (app_uid() IS NOT NULL);
CREATE POLICY fd_write ON family_dates FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());
-- Fixed (solar-calendar) official holidays only. Lunar-calendar holidays move every year and are NOT included: add them by hand.
INSERT INTO family_dates (title, kind, jm, jd, notify, official) VALUES
  ('نوروز (۱ فروردین)','holiday',1,1,false,true),('نوروز (۲ فروردین)','holiday',1,2,false,true),('نوروز (۳ فروردین)','holiday',1,3,false,true),('نوروز (۴ فروردین)','holiday',1,4,false,true),
  ('روز جمهوری اسلامی','holiday',1,12,false,true),('روز طبیعت (سیزده‌به‌در)','holiday',1,13,false,true),
  ('رحلت امام خمینی','holiday',3,14,false,true),('قیام ۱۵ خرداد','holiday',3,15,false,true),
  ('پیروزی انقلاب اسلامی','holiday',11,22,false,true),('ملی شدن صنعت نفت','holiday',12,29,false,true);

-- ============ Home: shopping list, meal plan (module 'home'), task attachments (module 'tasks') ============
CREATE TABLE shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120), qty text CHECK (qty IS NULL OR char_length(qty) <= 40),
  done boolean NOT NULL DEFAULT false, done_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), day date NOT NULL, slot text NOT NULL CHECK (slot IN ('breakfast','lunch','dinner')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120), UNIQUE (day, slot)
);
CREATE TABLE task_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name text NOT NULL, original_name text NOT NULL, mime text NOT NULL, bytes int NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES ('shopping_items','home'),('meals','home'),('task_files','tasks')) v(t,m) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.t);
    EXECUTE format('CREATE POLICY perm_read ON %I FOR SELECT USING (app_perm(%L) >= 1)', r.t, r.m);
    EXECUTE format('CREATE POLICY perm_ins ON %I FOR INSERT WITH CHECK (app_perm(%L) >= 2)', r.t, r.m);
    EXECUTE format('CREATE POLICY perm_upd ON %I FOR UPDATE USING (app_perm(%L) >= 2) WITH CHECK (app_perm(%L) >= 2)', r.t, r.m, r.m);
    EXECUTE format('CREATE POLICY perm_del ON %I FOR DELETE USING (app_perm(%L) >= 2)', r.t, r.m);
  END LOOP;
END $$;

-- ============ weekly report notification bookkeeping uses notifications; reports are computed on demand ============
REVOKE ALL ON FUNCTION claim_reflection_stars() FROM PUBLIC; GRANT EXECUTE ON FUNCTION claim_reflection_stars() TO mana_app;
