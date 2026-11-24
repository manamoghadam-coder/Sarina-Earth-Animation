-- Phase 1: configurable routines (habits + medicine), purchase requests, suggestions, occasions, quotes, age groups, debts as separate permission.
ALTER TABLE users ADD COLUMN age_group text CHECK (age_group IN ('young','teen','adult'));
UPDATE users SET age_group = 'adult' WHERE role IN ('parent','member');
UPDATE users SET age_group = CASE username WHEN 'saman' THEN 'young' ELSE 'teen' END WHERE role = 'child';
ALTER TABLE notifications ADD COLUMN ref_slot text;

-- debts/installments get their own module so Mana can open "finance" and "debts" separately
DROP POLICY perm_read ON debts; DROP POLICY perm_ins ON debts; DROP POLICY perm_upd ON debts; DROP POLICY perm_del ON debts;
CREATE POLICY perm_read ON debts FOR SELECT USING (app_perm('debts') >= 1);
CREATE POLICY perm_ins ON debts FOR INSERT WITH CHECK (app_perm('debts') >= 2);
CREATE POLICY perm_upd ON debts FOR UPDATE USING (app_perm('debts') >= 2) WITH CHECK (app_perm('debts') >= 2);
CREATE POLICY perm_del ON debts FOR DELETE USING (app_perm('debts') >= 2);
UPDATE users SET permissions = permissions || jsonb_build_object('debts', COALESCE((permissions->>'finance')::int, 0)) WHERE role = 'member';

CREATE TABLE routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'habit' CHECK (kind IN ('habit','medicine')),
  title text NOT NULL, icon text NOT NULL DEFAULT '✅', dose text,
  times time[] NOT NULL DEFAULT '{}',          -- reminder/slot times in the day
  weekdays int[],                              -- NULL = every day (0=Sat..6=Fri)
  start_date date, end_date date,              -- medicine courses
  notify boolean NOT NULL DEFAULT true, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE routine_logs (
  routine_id uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL, slot text NOT NULL DEFAULT '', at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (routine_id, day, slot)
);
CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other', title text NOT NULL, note text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','bought','rejected')),
  mom_note text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE TABLE suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'food' CHECK (kind IN ('food','fun','other')), text text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','done')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE occasions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, kind text NOT NULL DEFAULT 'family' CHECK (kind IN ('family','birthday','iranian','school','other')),
  jm int NOT NULL CHECK (jm BETWEEN 1 AND 12), jd int NOT NULL CHECK (jd BETWEEN 1 AND 31),
  birth_jy int,                                -- for birthdays: age is computed
  icon text NOT NULL DEFAULT '🎉', audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','kids','adults')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  age_group text NOT NULL CHECK (age_group IN ('young','teen','adult')), text text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE (age_group, text)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['routines','routine_logs','purchase_requests','suggestions','occasions','quotes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); END LOOP;
  -- child-owned data: same pattern as other children tables (child reads own; Mana everything; member by "children" module)
  FOREACH t IN ARRAY ARRAY['routines','routine_logs','purchase_requests','suggestions'] LOOP
    EXECUTE format('CREATE POLICY own_read ON %I FOR SELECT USING (child_id = app_uid() OR app_is_parent())', t);
    EXECUTE format('CREATE POLICY parent_write ON %I FOR ALL USING (app_is_parent()) WITH CHECK (app_is_parent())', t);
    EXECUTE format('CREATE POLICY member_read ON %I FOR SELECT USING (app_perm(''children'') >= 1)', t);
    EXECUTE format('CREATE POLICY member_ins ON %I FOR INSERT WITH CHECK (app_perm(''children'') >= 2)', t);
    EXECUTE format('CREATE POLICY member_upd ON %I FOR UPDATE USING (app_perm(''children'') >= 2) WITH CHECK (app_perm(''children'') >= 2)', t);
    EXECUTE format('CREATE POLICY member_del ON %I FOR DELETE USING (app_perm(''children'') >= 2)', t);
  END LOOP;
END $$;
-- what a child may create: own routine log, own request (status requested), own suggestion (status new)
CREATE POLICY child_insert_log ON routine_logs FOR INSERT WITH CHECK (child_id = app_uid());
CREATE POLICY child_insert_request ON purchase_requests FOR INSERT WITH CHECK (child_id = app_uid() AND status = 'requested' AND mom_note IS NULL);
CREATE POLICY child_insert_suggestion ON suggestions FOR INSERT WITH CHECK (child_id = app_uid() AND status = 'new');
-- occasions & quotes: readable by every signed-in user (children only see audience all/kids); written by Mana, or members with the "events" module
CREATE POLICY occ_read ON occasions FOR SELECT USING (app_uid() IS NOT NULL AND (current_setting('app.role', true) <> 'child' OR audience IN ('all','kids')));
CREATE POLICY occ_ins ON occasions FOR INSERT WITH CHECK (app_perm('events') >= 2);
CREATE POLICY occ_upd ON occasions FOR UPDATE USING (app_perm('events') >= 2) WITH CHECK (app_perm('events') >= 2);
CREATE POLICY occ_del ON occasions FOR DELETE USING (app_perm('events') >= 2);
CREATE POLICY quotes_read ON quotes FOR SELECT USING (app_uid() IS NOT NULL);
CREATE POLICY quotes_ins ON quotes FOR INSERT WITH CHECK (app_perm('children') >= 2);
CREATE POLICY quotes_upd ON quotes FOR UPDATE USING (app_perm('children') >= 2) WITH CHECK (app_perm('children') >= 2);
CREATE POLICY quotes_del ON quotes FOR DELETE USING (app_perm('children') >= 2);
