-- MANA schema + Row Level Security
-- Dates are stored as Gregorian (DATE/TIMESTAMPTZ); Jalali conversion is done in the API/UI.
-- Weekday convention: 0=شنبه(Sat) 1=یکشنبه 2=دوشنبه 3=سه‌شنبه 4=چهارشنبه 5=پنجشنبه 6=جمعه

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('parent','child')),
  password_hash text NOT NULL,
  avatar_photo_id uuid,
  active        boolean NOT NULL DEFAULT true,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE TABLE settings (
  key text PRIMARY KEY, value jsonb NOT NULL
);
INSERT INTO settings VALUES ('currency','"تومان"'), ('timezone','"Asia/Tehran"');

-- ---------- Parent-only domain ----------
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, description text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
  start_date date, end_date date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL, description text, assignee text,
  start_date date, due_date date, due_time time,
  priority int NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3), -- 1=بالا 2=متوسط 3=پایین
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','waiting','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), done_at timestamptz
);
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, kind text NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting','family','birthday','occasion','other')),
  starts_at timestamptz NOT NULL, ends_at timestamptz, note text,
  remind_minutes int[] NOT NULL DEFAULT '{30}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  amount bigint NOT NULL CHECK (amount > 0), category text NOT NULL DEFAULT 'سایر',
  occurred_on date NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jy int NOT NULL, jm int NOT NULL CHECK (jm BETWEEN 1 AND 12), category text NOT NULL, amount bigint NOT NULL CHECK (amount >= 0),
  UNIQUE (jy, jm, category)
);
CREATE TABLE debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, type text NOT NULL CHECK (type IN ('debt','installment','loan')),
  total_amount bigint NOT NULL CHECK (total_amount >= 0), paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  installment_amount bigint, next_due_date date, remaining_installments int, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, horizon text NOT NULL DEFAULT 'short' CHECK (horizon IN ('short','long','learning')),
  progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100), target_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','dropped')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE habit_logs (
  habit_id uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE, day date NOT NULL, PRIMARY KEY (habit_id, day)
);
CREATE TABLE ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id), input text NOT NULL, intent text NOT NULL, params jsonb NOT NULL, summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, user_id uuid, action text NOT NULL, detail jsonb, at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Children domain ----------
CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- whose gallery
  file_name text NOT NULL, mime text NOT NULL, bytes int NOT NULL, caption text,
  uploaded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

CREATE TABLE child_settings (
  child_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications_enabled boolean NOT NULL DEFAULT true,
  voice_notifications boolean NOT NULL DEFAULT false,
  read_aloud_default boolean NOT NULL DEFAULT false,
  quiet_start time NOT NULL DEFAULT '21:00', quiet_end time NOT NULL DEFAULT '07:00',
  reminder_offsets int[] NOT NULL DEFAULT '{-15,0,10}',   -- minutes relative to start
  mic_allowed boolean NOT NULL DEFAULT true               -- parental consent for microphone use
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('homework','study','class','music','language','reading','chore','story','writing','game','other')),
  description text, icon text NOT NULL DEFAULT '⭐',
  weekdays int[],            -- recurring (0=Sat..6=Fri); NULL when one-off
  on_date date,              -- one-off date
  start_time time, end_time time, stars int NOT NULL DEFAULT 3,
  notify boolean NOT NULL DEFAULT true, notify_text text, remind_offsets int[], -- NULL => child default
  active boolean NOT NULL DEFAULT true,
  CHECK ((weekdays IS NOT NULL) <> (on_date IS NOT NULL))
);
CREATE TABLE completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  stars_awarded int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  UNIQUE (activity_id, day)
);
CREATE TABLE star_ledger (
  id bigserial PRIMARY KEY, child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta int NOT NULL, reason text NOT NULL, completion_id uuid REFERENCES completions(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE badges (
  id bigserial PRIMARY KEY, child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL, title text NOT NULL, icon text NOT NULL, awarded_at timestamptz NOT NULL DEFAULT now(), UNIQUE (child_id, code)
);
CREATE TABLE rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, icon text NOT NULL DEFAULT '🎁', cost_stars int NOT NULL CHECK (cost_stars > 0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','granted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE TABLE child_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, icon text NOT NULL DEFAULT '🎯', target_stars int, done boolean NOT NULL DEFAULT false
);

-- ---------- Notifications ----------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL, title text NOT NULL, body text NOT NULL, icon text NOT NULL DEFAULT '🔔',
  ref_type text, ref_id uuid, ref_day date, voice_text text,
  due_at timestamptz NOT NULL, dedupe_key text NOT NULL UNIQUE,
  sent_at timestamptz, push_status text, seen_at timestamptz, done_at timestamptz, snoozed_count int NOT NULL DEFAULT 0
);
CREATE INDEX notifications_due ON notifications (user_id, due_at);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Row Level Security ----------
-- The API sets app.user_id / app.role with SET LOCAL inside every transaction.
CREATE FUNCTION app_uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_is_parent() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.role', true), '') = 'parent' $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','settings','projects','tasks','events','transactions','budgets','debts','goals','habits','habit_logs',
    'ai_proposals','audit_log','photos','child_settings','activities','completions','star_ledger','badges','rewards','reward_claims','child_goals','notifications','push_subscriptions']
  LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); END LOOP;
END $$;

-- parent-only tables (default deny for children: no policy for child role)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projects','tasks','events','transactions','budgets','debts','goals','habits','habit_logs','ai_proposals','audit_log']
  LOOP EXECUTE format('CREATE POLICY parent_only ON %I FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent())', t); END LOOP;
END $$;

-- users: self or parent can read; only parent writes
CREATE POLICY users_read ON users FOR SELECT USING (id = app_uid() OR app_is_parent());
CREATE POLICY users_write ON users FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());
-- sessions: only the system pool touches them (no policy => app role sees nothing)
-- settings: everyone reads, parent writes
CREATE POLICY settings_read ON settings FOR SELECT USING (app_uid() IS NOT NULL);
CREATE POLICY settings_write ON settings FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());

-- children-owned data: child reads own rows, parent everything
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['child_settings','activities','completions','star_ledger','badges','rewards','reward_claims','child_goals']
  LOOP
    EXECUTE format('CREATE POLICY own_read ON %I FOR SELECT USING (child_id = app_uid() OR app_is_parent())', t);
    EXECUTE format('CREATE POLICY parent_write ON %I FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent())', t);
  END LOOP;
END $$;
-- the only things a child may create: a pending completion and a reward request for herself/himself
CREATE POLICY child_insert_completion ON completions FOR INSERT
  WITH CHECK (child_id = app_uid() AND status = 'pending' AND stars_awarded = 0);
CREATE POLICY child_insert_claim ON reward_claims FOR INSERT
  WITH CHECK (child_id = app_uid() AND status = 'requested');

-- photos: owner (child) or parent read; parent writes
CREATE POLICY photos_read ON photos FOR SELECT USING (owner_id = app_uid() OR app_is_parent());
CREATE POLICY photos_write ON photos FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent());

-- notifications: own rows (history visible to parent); owner may update seen/done/snooze
CREATE POLICY notif_read ON notifications FOR SELECT USING (user_id = app_uid() OR app_is_parent());
CREATE POLICY notif_update_own ON notifications FOR UPDATE USING (user_id = app_uid() OR app_is_parent()) WITH CHECK (user_id = app_uid() OR app_is_parent());
CREATE POLICY notif_parent_insert ON notifications FOR INSERT WITH CHECK (app_is_parent());
CREATE POLICY push_own ON push_subscriptions FOR ALL USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());

-- Application role: no superuser, no BYPASSRLS. Grants are made by scripts/db-setup.sh
