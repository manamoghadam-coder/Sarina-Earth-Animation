-- Ported from the parallel "MANA v2-v4" line: personal features for EVERY non-parent account (diary, Mom's messages, family chat,
-- profile photo, wish board), nightly reflection, weekly-report support, meal plan, annual dates (merged into `occasions`).
-- Feature levels: 0 none, 1 view, 2 view+write. Defaults (when Mana has not set a value): diary 2, chat 2, inbox 1, avatar 2, wishes 2.
CREATE FUNCTION app_feat(m text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN current_setting('app.role', true) = 'parent' THEN 2
    ELSE COALESCE((SELECT LEAST(2, GREATEST(0, COALESCE((permissions ->> m)::int,
           CASE m WHEN 'diary' THEN 2 WHEN 'chat' THEN 2 WHEN 'inbox' THEN 1 WHEN 'avatar' THEN 2 WHEN 'wishes' THEN 2 ELSE 0 END)))
         FROM users WHERE id = app_uid() AND active), 0) END $$;

ALTER TABLE photos ADD COLUMN kind text NOT NULL DEFAULT 'gallery' CHECK (kind IN ('gallery','avatar','wish','task'));
UPDATE photos SET kind = 'avatar' WHERE caption = 'پروفایل' AND uploaded_by = owner_id;

-- ---------- diary: the author reads it; Mana may read CHILDREN's diaries (read-only; children are told). Adults' diaries stay private ----------
CREATE TABLE diary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, entry_date date NOT NULL DEFAULT current_date,
  title text CHECK (title IS NULL OR char_length(title) <= 120), body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000), mood text CHECK (mood IS NULL OR char_length(mood) <= 8),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diary_user_date ON diary_entries (user_id, entry_date DESC, created_at DESC);
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY diary_read ON diary_entries FOR SELECT USING (user_id = app_uid() AND app_feat('diary') >= 1);
CREATE POLICY diary_ins  ON diary_entries FOR INSERT WITH CHECK (user_id = app_uid() AND app_feat('diary') >= 2);
CREATE POLICY diary_upd  ON diary_entries FOR UPDATE USING (user_id = app_uid() AND app_feat('diary') >= 2) WITH CHECK (user_id = app_uid());
CREATE POLICY diary_del  ON diary_entries FOR DELETE USING (user_id = app_uid() AND app_feat('diary') >= 2);
CREATE POLICY diary_parent_read_children ON diary_entries FOR SELECT USING (app_is_parent() AND user_id IN (SELECT id FROM users WHERE role = 'child'));

-- ---------- Mom's messages ----------
CREATE TABLE mom_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), to_user uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, msg_date date NOT NULL DEFAULT current_date,
  title text CHECK (title IS NULL OR char_length(title) <= 120), body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX mom_to_date ON mom_messages (to_user, msg_date DESC, created_at DESC);
ALTER TABLE mom_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY mom_parent ON mom_messages FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());
CREATE POLICY mom_read   ON mom_messages FOR SELECT USING (to_user = app_uid() AND app_feat('inbox') >= 1);
CREATE POLICY mom_mark   ON mom_messages FOR UPDATE USING (to_user = app_uid() AND app_feat('inbox') >= 1) WITH CHECK (to_user = app_uid());
CREATE FUNCTION mom_only_read() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF app_uid() IS NOT NULL AND NOT app_is_parent() AND (to_jsonb(NEW) - 'read_at') <> (to_jsonb(OLD) - 'read_at') THEN RAISE EXCEPTION 'read_at only' USING ERRCODE = '42501'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER mom_only_read BEFORE UPDATE ON mom_messages FOR EACH ROW EXECUTE FUNCTION mom_only_read();

-- ---------- family chat: one group + private 1-to-1 (only the two people can read a DM; not even Mana) ----------
CREATE TABLE chat_messages (
  id bigserial PRIMARY KEY, sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, peer_id uuid REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_peer ON chat_messages (peer_id, id);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_read ON chat_messages FOR SELECT USING (app_feat('chat') >= 1 AND (peer_id IS NULL OR sender_id = app_uid() OR peer_id = app_uid()));
CREATE POLICY chat_ins  ON chat_messages FOR INSERT WITH CHECK (sender_id = app_uid() AND app_feat('chat') >= 2 AND peer_id IS DISTINCT FROM app_uid());
CREATE POLICY chat_del  ON chat_messages FOR DELETE USING (app_feat('chat') >= 2 AND (sender_id = app_uid() OR (app_is_parent() AND peer_id IS NULL)));
CREATE FUNCTION chat_people() RETURNS TABLE (id uuid, display_name text, role text, avatar_photo_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.display_name, u.role, u.avatar_photo_id FROM users u WHERE u.active AND app_feat('chat') >= 1 ORDER BY u.display_name $$;

-- ---------- profile photo: each person changes their own ----------
CREATE FUNCTION app_is_avatar(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE avatar_photo_id = p AND active) $$;
CREATE POLICY photos_avatar_read ON photos FOR SELECT USING (app_is_avatar(id));
CREATE POLICY photos_self_ins ON photos FOR INSERT WITH CHECK (owner_id = app_uid() AND uploaded_by = app_uid() AND ((kind = 'avatar' AND app_feat('avatar') >= 2) OR (kind = 'wish' AND app_feat('wishes') >= 2)));
CREATE POLICY photos_self_del ON photos FOR DELETE USING (owner_id = app_uid() AND uploaded_by = app_uid() AND ((kind = 'avatar' AND app_feat('avatar') >= 2) OR (kind = 'wish' AND app_feat('wishes') >= 2)));
CREATE FUNCTION set_my_avatar(p uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_uid() IS NULL OR app_feat('avatar') < 2 THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM photos WHERE id = p AND owner_id = app_uid()) THEN RETURN false; END IF;
  UPDATE users SET avatar_photo_id = p WHERE id = app_uid(); RETURN true;
END $$;

-- ---------- nightly reflection ----------
ALTER TABLE child_settings ADD COLUMN reflection_enabled boolean NOT NULL DEFAULT true, ADD COLUMN reflection_time time NOT NULL DEFAULT '20:30',
  ADD COLUMN reflection_stars int NOT NULL DEFAULT 0 CHECK (reflection_stars BETWEEN 0 AND 10), ADD COLUMN show_homework boolean NOT NULL DEFAULT false;
UPDATE child_settings SET show_homework = true WHERE child_id IN (SELECT id FROM users WHERE age_group = 'young');
CREATE TABLE reflection_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), child_id uuid REFERENCES users(id) ON DELETE CASCADE, text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','gratitude')), sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reflection_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rq_read  ON reflection_questions FOR SELECT USING (app_is_parent() OR (app_uid() IS NOT NULL AND (child_id IS NULL OR child_id = app_uid())));
CREATE POLICY rq_write ON reflection_questions FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());
INSERT INTO reflection_questions (text, kind, sort) VALUES
  ('امروز چه اتفاقی خیلی خوشحالت کرد؟', 'text', 10), ('چه چیزی تو را ناراحت کرد؟', 'text', 20), ('چه چیز جدیدی یاد گرفتی؟', 'text', 30),
  ('امروز چه کار خوبی کردی یا به چه کسی کمک کردی؟', 'text', 40), ('خدایا ازت سپاسگزارم که …', 'gratitude', 100);
CREATE TABLE reflection_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL, answers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, day)
);
ALTER TABLE reflection_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY re_read  ON reflection_entries FOR SELECT USING ((user_id = app_uid() AND app_feat('diary') >= 1) OR (app_is_parent() AND user_id IN (SELECT id FROM users WHERE role = 'child')));
CREATE POLICY re_ins   ON reflection_entries FOR INSERT WITH CHECK (user_id = app_uid() AND app_feat('diary') >= 2);
CREATE POLICY re_upd   ON reflection_entries FOR UPDATE USING (user_id = app_uid() AND app_feat('diary') >= 2) WITH CHECK (user_id = app_uid());
CREATE POLICY re_del   ON reflection_entries FOR DELETE USING (user_id = app_uid() AND app_feat('diary') >= 2);
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

-- ---------- wish board ----------
CREATE TABLE wish_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL DEFAULT 'تابلو آرزوهای من' CHECK (char_length(title) <= 80),
  starts_on date NOT NULL DEFAULT current_date, refresh_months int NOT NULL DEFAULT 3 CHECK (refresh_months BETWEEN 1 AND 12), archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wish_one_active ON wish_boards (user_id) WHERE NOT archived;
CREATE TABLE wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), board_id uuid NOT NULL REFERENCES wish_boards(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120), note text CHECK (note IS NULL OR char_length(note) <= 500), kind text NOT NULL DEFAULT 'dream' CHECK (kind IN ('dream','place','goal')),
  photo_id uuid REFERENCES photos(id) ON DELETE SET NULL, achieved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
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

-- ---------- weekly meal plan (module "home"; shopping list + task files already exist in this line) ----------
CREATE TABLE meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), day date NOT NULL, slot text NOT NULL CHECK (slot IN ('breakfast','lunch','dinner')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120), recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL, UNIQUE (day, slot)
);
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
CREATE POLICY perm_read ON meals FOR SELECT USING (app_perm('shopping') >= 1 OR (current_setting('app.role', true) = 'child'));
CREATE POLICY perm_ins ON meals FOR INSERT WITH CHECK (app_perm('shopping') >= 2);
CREATE POLICY perm_upd ON meals FOR UPDATE USING (app_perm('shopping') >= 2) WITH CHECK (app_perm('shopping') >= 2);
CREATE POLICY perm_del ON meals FOR DELETE USING (app_perm('shopping') >= 2);

-- ---------- annual dates: merge the other line's "family_dates" into `occasions` ----------
ALTER TABLE occasions DROP CONSTRAINT occasions_kind_check;
ALTER TABLE occasions ADD CONSTRAINT occasions_kind_check CHECK (kind IN ('family','birthday','iranian','school','other','anniversary','holiday'));
ALTER TABLE occasions ADD COLUMN notify boolean NOT NULL DEFAULT false, ADD COLUMN person_id uuid REFERENCES users(id) ON DELETE CASCADE, ADD COLUMN official boolean NOT NULL DEFAULT false;
UPDATE occasions SET official = true WHERE kind = 'iranian';
INSERT INTO occasions (title, kind, jm, jd, icon, audience, official)
SELECT v.t, 'holiday', v.m, v.d, '🇮🇷', 'all', true FROM (VALUES ('رحلت امام خمینی', 3, 14), ('قیام ۱۵ خرداد', 3, 15), ('پیروزی انقلاب اسلامی', 11, 22)) v(t, m, d)
WHERE NOT EXISTS (SELECT 1 FROM occasions o WHERE o.jm = v.m AND o.jd = v.d AND o.official);

REVOKE ALL ON FUNCTION app_feat(text), chat_people(), app_is_avatar(uuid), set_my_avatar(uuid), claim_reflection_stars() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_feat(text), chat_people(), app_is_avatar(uuid), set_my_avatar(uuid), claim_reflection_stars() TO mana_app;
