-- Per-user features for EVERY non-parent account: diary, chat, inbox (mom's messages), avatar.  0=none 1=view 2=view+write.
-- Defaults (when Mana has not set a value): diary 2, chat 2, inbox 1, avatar 2.
CREATE FUNCTION app_feat(m text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN current_setting('app.role', true) = 'parent' THEN 2
    ELSE COALESCE((SELECT LEAST(2, GREATEST(0, COALESCE((permissions ->> m)::int,
           CASE m WHEN 'diary' THEN 2 WHEN 'chat' THEN 2 WHEN 'inbox' THEN 1 WHEN 'avatar' THEN 2 ELSE 0 END)))
         FROM users WHERE id = app_uid() AND active), 0) END $$;

-- ---------- private diary: ONLY the author can read it (not even Mana) ----------
CREATE TABLE diary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT current_date,
  title text CHECK (title IS NULL OR char_length(title) <= 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  mood text CHECK (mood IS NULL OR char_length(mood) <= 8),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diary_user_date ON diary_entries (user_id, entry_date DESC, created_at DESC);
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY diary_read ON diary_entries FOR SELECT USING (user_id = app_uid() AND app_feat('diary') >= 1);
CREATE POLICY diary_ins  ON diary_entries FOR INSERT WITH CHECK (user_id = app_uid() AND app_feat('diary') >= 2);
CREATE POLICY diary_upd  ON diary_entries FOR UPDATE USING (user_id = app_uid() AND app_feat('diary') >= 2) WITH CHECK (user_id = app_uid());
CREATE POLICY diary_del  ON diary_entries FOR DELETE USING (user_id = app_uid() AND app_feat('diary') >= 2);

-- ---------- Mom's messages: Mana writes, the recipient reads ----------
CREATE TABLE mom_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_user uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  msg_date date NOT NULL DEFAULT current_date,
  title text CHECK (title IS NULL OR char_length(title) <= 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX mom_to_date ON mom_messages (to_user, msg_date DESC, created_at DESC);
ALTER TABLE mom_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY mom_parent ON mom_messages FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());
CREATE POLICY mom_read   ON mom_messages FOR SELECT USING (to_user = app_uid() AND app_feat('inbox') >= 1);
CREATE POLICY mom_mark   ON mom_messages FOR UPDATE USING (to_user = app_uid() AND app_feat('inbox') >= 1) WITH CHECK (to_user = app_uid());
-- a recipient may only change read_at
CREATE FUNCTION mom_only_read() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT app_is_parent() AND (to_jsonb(NEW) - 'read_at') <> (to_jsonb(OLD) - 'read_at') THEN RAISE EXCEPTION 'read_at only' USING ERRCODE = '42501'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER mom_only_read BEFORE UPDATE ON mom_messages FOR EACH ROW EXECUTE FUNCTION mom_only_read();

-- ---------- family chat (one group of all active accounts) ----------
CREATE TABLE chat_messages (
  id bigserial PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_read ON chat_messages FOR SELECT USING (app_feat('chat') >= 1);
CREATE POLICY chat_ins  ON chat_messages FOR INSERT WITH CHECK (sender_id = app_uid() AND app_feat('chat') >= 2);
CREATE POLICY chat_del  ON chat_messages FOR DELETE USING (app_feat('chat') >= 2 AND (sender_id = app_uid() OR app_is_parent()));
-- names/avatars of chat participants (users table itself stays private)
CREATE FUNCTION chat_people() RETURNS TABLE (id uuid, display_name text, role text, avatar_photo_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.display_name, u.role, u.avatar_photo_id FROM users u WHERE u.active AND app_feat('chat') >= 1 ORDER BY u.display_name $$;

-- ---------- profile photo: each person can change their own ----------
CREATE FUNCTION app_is_avatar(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE avatar_photo_id = p AND active) $$;
CREATE POLICY photos_avatar_read ON photos FOR SELECT USING (app_is_avatar(id));
CREATE POLICY photos_self_ins ON photos FOR INSERT WITH CHECK (owner_id = app_uid() AND uploaded_by = app_uid() AND app_feat('avatar') >= 2);
CREATE POLICY photos_self_del ON photos FOR DELETE USING (owner_id = app_uid() AND uploaded_by = app_uid() AND app_feat('avatar') >= 2);
CREATE FUNCTION set_my_avatar(p uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_uid() IS NULL OR app_feat('avatar') < 2 THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM photos WHERE id = p AND owner_id = app_uid()) THEN RETURN false; END IF;
  UPDATE users SET avatar_photo_id = p WHERE id = app_uid(); RETURN true;
END $$;
REVOKE ALL ON FUNCTION app_feat(text), chat_people(), app_is_avatar(uuid), set_my_avatar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_feat(text), chat_people(), app_is_avatar(uuid), set_my_avatar(uuid) TO mana_app;
