ALTER TABLE users ADD COLUMN IF NOT EXISTS grade_key TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS college_code TEXT NOT NULL DEFAULT '';

ALTER TABLE course_targets ADD COLUMN IF NOT EXISTS grade_key TEXT NOT NULL DEFAULT '';
ALTER TABLE course_targets DROP CONSTRAINT IF EXISTS course_targets_pkey;
ALTER TABLE course_targets ADD PRIMARY KEY (course_id, college_key, grade_key, class_key);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS archived_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS course_targets_grade_lookup
  ON course_targets(college_key, grade_key, class_key, course_id);
