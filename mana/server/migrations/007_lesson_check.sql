ALTER TABLE lessons ADD CONSTRAINT lessons_correct_in_range CHECK (correct >= 0 AND correct < cardinality(options));
