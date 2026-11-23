-- Mana may READ the children's diaries (children are told so in the app). Other adults' diaries stay private.
CREATE POLICY diary_parent_read_children ON diary_entries FOR SELECT
  USING (app_is_parent() AND user_id IN (SELECT id FROM users WHERE role = 'child'));

-- Nightly reflection: a few questions every evening
ALTER TABLE child_settings ADD COLUMN reflection_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE child_settings ADD COLUMN reflection_time time NOT NULL DEFAULT '20:30';

CREATE TABLE reflection_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid REFERENCES users(id) ON DELETE CASCADE,      -- NULL = asked of every child
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','gratitude')),
  sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reflection_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rq_read  ON reflection_questions FOR SELECT USING (app_is_parent() OR (app_uid() IS NOT NULL AND (child_id IS NULL OR child_id = app_uid())));
CREATE POLICY rq_write ON reflection_questions FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());
INSERT INTO reflection_questions (text, kind, sort) VALUES
  ('امروز چه اتفاقی خیلی خوشحالت کرد؟', 'text', 10),
  ('چه چیزی تو را ناراحت کرد؟', 'text', 20),
  ('چه چیز جدیدی یاد گرفتی؟', 'text', 30),
  ('امروز چه کار خوبی کردی یا به چه کسی کمک کردی؟', 'text', 40),
  ('خدایا ازت سپاسگزارم که …', 'gratitude', 100);

CREATE TABLE reflection_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  answers jsonb NOT NULL,                                     -- [{q: "question text", kind, a: "answer"}]  (question text is snapshotted)
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
ALTER TABLE reflection_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY re_read  ON reflection_entries FOR SELECT USING ((user_id = app_uid() AND app_feat('diary') >= 1)
  OR (app_is_parent() AND user_id IN (SELECT id FROM users WHERE role = 'child')));
CREATE POLICY re_ins   ON reflection_entries FOR INSERT WITH CHECK (user_id = app_uid() AND app_feat('diary') >= 2);
CREATE POLICY re_upd   ON reflection_entries FOR UPDATE USING (user_id = app_uid() AND app_feat('diary') >= 2) WITH CHECK (user_id = app_uid());
CREATE POLICY re_del   ON reflection_entries FOR DELETE USING (user_id = app_uid() AND app_feat('diary') >= 2);
