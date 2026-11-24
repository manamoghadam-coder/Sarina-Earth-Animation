-- Phase 2: daily facts, financial literacy + wallet, library, recipes, kids AI log, 2FA
CREATE FUNCTION app_age_group() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT age_group FROM users WHERE id = app_uid() $$;

ALTER TABLE child_settings ADD COLUMN allowance_amount bigint NOT NULL DEFAULT 0 CHECK (allowance_amount >= 0), ADD COLUMN allowance_weekday int NOT NULL DEFAULT 6 CHECK (allowance_weekday BETWEEN 0 AND 6),
  ADD COLUMN ai_enabled boolean NOT NULL DEFAULT true, ADD COLUMN ai_daily_limit int NOT NULL DEFAULT 15 CHECK (ai_daily_limit BETWEEN 0 AND 200);
ALTER TABLE users ADD COLUMN totp_secret text, ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), age_group text NOT NULL CHECK (age_group IN ('young','teen','adult')),
  topic text NOT NULL DEFAULT 'general', title text NOT NULL, body text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE (age_group, title)
);
CREATE TABLE lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), age_group text NOT NULL CHECK (age_group IN ('young','teen')), position int NOT NULL DEFAULT 0,
  title text NOT NULL, body text NOT NULL, question text NOT NULL, options text[] NOT NULL, correct int NOT NULL, stars int NOT NULL DEFAULT 2 CHECK (stars BETWEEN 0 AND 20),
  active boolean NOT NULL DEFAULT true, UNIQUE (age_group, title)
);
CREATE TABLE lesson_progress (
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  correct boolean NOT NULL, attempts int NOT NULL DEFAULT 1, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (child_id, lesson_id)
);
CREATE TABLE savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, icon text NOT NULL DEFAULT '🎯', target_amount bigint NOT NULL CHECK (target_amount > 0), done boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet_ledger (   -- goal_id NULL = spendable pocket money; goal_id set = money saved in that goal's jar
  id bigserial PRIMARY KEY, child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, goal_id uuid REFERENCES savings_goals(id) ON DELETE CASCADE,
  delta bigint NOT NULL, reason text NOT NULL, ref_key text UNIQUE, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kid_ai_chats (
  id bigserial PRIMARY KEY, child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL, flagged boolean NOT NULL DEFAULT false, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kid_ai_chats_child ON kid_ai_chats (child_id, at DESC);

CREATE TABLE library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK (kind IN ('pdf','audio')), title text NOT NULL, description text,
  category text NOT NULL DEFAULT 'story', audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','young','teen','adults')),
  file_name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL, uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recipe_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, icon text NOT NULL DEFAULT '🍽️', sort int NOT NULL DEFAULT 0);
CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_id uuid REFERENCES recipe_categories(id) ON DELETE SET NULL, title text NOT NULL, description text,
  ingredients text, steps text, minutes int, servings int, video_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recipe_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('photo','video')),
  file_name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['facts','lessons','lesson_progress','savings_goals','wallet_ledger','kid_ai_chats','library_items','recipe_categories','recipes','recipe_media'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); END LOOP;
  -- shared learning content: everyone signed in reads; "children" module (or Mana) writes
  FOREACH t IN ARRAY ARRAY['facts','lessons'] LOOP
    EXECUTE format('CREATE POLICY content_read ON %I FOR SELECT USING (app_uid() IS NOT NULL)', t);
    EXECUTE format('CREATE POLICY content_ins ON %I FOR INSERT WITH CHECK (app_perm(''children'') >= 2)', t);
    EXECUTE format('CREATE POLICY content_upd ON %I FOR UPDATE USING (app_perm(''children'') >= 2) WITH CHECK (app_perm(''children'') >= 2)', t);
    EXECUTE format('CREATE POLICY content_del ON %I FOR DELETE USING (app_perm(''children'') >= 2)', t);
  END LOOP;
  -- child-owned data: child reads own; Mana/member via "children"; writes only by Mana/member-with-write (child changes go through audited API paths)
  FOREACH t IN ARRAY ARRAY['lesson_progress','savings_goals','wallet_ledger','kid_ai_chats'] LOOP
    EXECUTE format('CREATE POLICY own_read ON %I FOR SELECT USING (child_id = app_uid() OR app_perm(''children'') >= 1)', t);
    EXECUTE format('CREATE POLICY staff_ins ON %I FOR INSERT WITH CHECK (app_perm(''children'') >= 2)', t);
    EXECUTE format('CREATE POLICY staff_upd ON %I FOR UPDATE USING (app_perm(''children'') >= 2) WITH CHECK (app_perm(''children'') >= 2)', t);
    EXECUTE format('CREATE POLICY staff_del ON %I FOR DELETE USING (app_perm(''children'') >= 2)', t);
  END LOOP;
  -- recipes: family-wide read (children included; members need "recipes"), write needs "recipes" level 2
  FOREACH t IN ARRAY ARRAY['recipe_categories','recipes','recipe_media'] LOOP
    EXECUTE format('CREATE POLICY rc_read ON %I FOR SELECT USING (app_uid() IS NOT NULL AND (current_setting(''app.role'', true) <> ''member'' OR app_perm(''recipes'') >= 1))', t);
    EXECUTE format('CREATE POLICY rc_ins ON %I FOR INSERT WITH CHECK (app_perm(''recipes'') >= 2)', t);
    EXECUTE format('CREATE POLICY rc_upd ON %I FOR UPDATE USING (app_perm(''recipes'') >= 2) WITH CHECK (app_perm(''recipes'') >= 2)', t);
    EXECUTE format('CREATE POLICY rc_del ON %I FOR DELETE USING (app_perm(''recipes'') >= 2)', t);
  END LOOP;
END $$;
-- library: Mana/members with "library"; a child sees only items for everyone or for his/her age group
CREATE POLICY lib_read ON library_items FOR SELECT USING (app_perm('library') >= 1 OR (current_setting('app.role', true) = 'child' AND audience IN ('all', app_age_group())));
CREATE POLICY lib_ins ON library_items FOR INSERT WITH CHECK (app_perm('library') >= 2);
CREATE POLICY lib_upd ON library_items FOR UPDATE USING (app_perm('library') >= 2) WITH CHECK (app_perm('library') >= 2);
CREATE POLICY lib_del ON library_items FOR DELETE USING (app_perm('library') >= 2);
INSERT INTO recipe_categories (name, icon, sort) VALUES ('غذای سنتی','🍲',1),('فست‌فود','🍔',2),('ساندویچ','🥪',3),('دسر','🍰',4),('سالاد','🥗',5),('صبحانه','🍳',6),('نوشیدنی','🥤',7),('سایر','🍽️',9);
