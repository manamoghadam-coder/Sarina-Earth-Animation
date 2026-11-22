-- Adds a configurable "member" role (e.g. the father). Mana (parent) grants per-module access: 0=none, 1=read, 2=read+write.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('parent','member','child'));
ALTER TABLE users ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}';

-- SECURITY DEFINER so it can read users.permissions regardless of the caller's RLS; the actor id comes from the session GUC set by the API.
CREATE FUNCTION app_perm(m text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN current_setting('app.role', true) = 'parent' THEN 2
    ELSE COALESCE((SELECT LEAST(2, GREATEST(0, (permissions ->> m)::int)) FROM users WHERE id = app_uid() AND active AND role = 'member'), 0) END $$;

-- module-gated tables: replace parent_only with per-module read/write policies (parent still gets 2 everywhere)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES ('projects','tasks'),('tasks','tasks'),('events','events'),('transactions','finance'),('budgets','finance'),('debts','finance'),
                                 ('goals','goals'),('habits','goals'),('habit_logs','goals')) v(t,m) LOOP
    EXECUTE format('DROP POLICY parent_only ON %I', r.t);
    EXECUTE format('CREATE POLICY perm_read ON %I FOR SELECT USING (app_perm(%L) >= 1)', r.t, r.m);
    EXECUTE format('CREATE POLICY perm_ins ON %I FOR INSERT WITH CHECK (app_perm(%L) >= 2)', r.t, r.m);
    EXECUTE format('CREATE POLICY perm_upd ON %I FOR UPDATE USING (app_perm(%L) >= 2) WITH CHECK (app_perm(%L) >= 2)', r.t, r.m, r.m);
    EXECUTE format('CREATE POLICY perm_del ON %I FOR DELETE USING (app_perm(%L) >= 2)', r.t, r.m);
  END LOOP;
  -- children data + photos for members
  FOR r IN SELECT * FROM (VALUES ('child_settings','children'),('activities','children'),('completions','children'),('star_ledger','children'),('badges','children'),
                                 ('rewards','children'),('reward_claims','children'),('child_goals','children'),('photos','photos')) v(t,m) LOOP
    EXECUTE format('CREATE POLICY member_read ON %I FOR SELECT USING (app_perm(%L) >= 1)', r.t, r.m);
    EXECUTE format('CREATE POLICY member_ins ON %I FOR INSERT WITH CHECK (app_perm(%L) >= 2)', r.t, r.m);
    EXECUTE format('CREATE POLICY member_upd ON %I FOR UPDATE USING (app_perm(%L) >= 2) WITH CHECK (app_perm(%L) >= 2)', r.t, r.m, r.m);
    EXECUTE format('CREATE POLICY member_del ON %I FOR DELETE USING (app_perm(%L) >= 2)', r.t, r.m);
  END LOOP;
END $$;
-- members with children access may list the children's accounts
CREATE POLICY users_members_see_children ON users FOR SELECT USING (role = 'child' AND app_perm('children') >= 1);
-- ai_proposals, audit_log keep parent_only
