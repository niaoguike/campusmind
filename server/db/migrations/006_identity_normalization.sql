ALTER TABLE users ADD COLUMN IF NOT EXISTS college_raw TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS class_raw TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS college_key TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS class_key TEXT NOT NULL DEFAULT '';

ALTER TABLE courses ADD COLUMN IF NOT EXISTS college_raw TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS class_name_raw TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS course_targets (
  course_id BIGINT NOT NULL,
  college_key TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '',
  class_key TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY(course_id, college_key, class_key)
);

CREATE INDEX IF NOT EXISTS course_targets_lookup
  ON course_targets(college_key, class_key, course_id);
