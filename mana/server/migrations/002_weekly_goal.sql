ALTER TABLE child_settings ADD COLUMN weekly_goal_stars int NOT NULL DEFAULT 30 CHECK (weekly_goal_stars >= 0);
