-- Course lifecycle, invite-code limits, submission attachments and hot-path indexes.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS archived_at TEXT DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS review_required BIGINT DEFAULT 0;

ALTER TABLE course_spaces ADD COLUMN IF NOT EXISTS expires_at TEXT DEFAULT '';
ALTER TABLE course_spaces ADD COLUMN IF NOT EXISTS max_uses BIGINT DEFAULT 0;
ALTER TABLE course_spaces ADD COLUMN IF NOT EXISTS uses BIGINT DEFAULT 0;

ALTER TABLE teacher_task_submissions ADD COLUMN IF NOT EXISTS attachment_path TEXT DEFAULT '';
ALTER TABLE teacher_task_submissions ADD COLUMN IF NOT EXISTS attachment_name TEXT DEFAULT '';
ALTER TABLE teacher_task_submissions ADD COLUMN IF NOT EXISTS attachment_size BIGINT DEFAULT 0;

CREATE INDEX IF NOT EXISTS course_student_memberships_student ON course_student_memberships(student_id);
CREATE INDEX IF NOT EXISTS course_teacher_assignments_user ON course_teacher_assignments(user_id);
CREATE INDEX IF NOT EXISTS messages_conversation_id ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS teacher_task_submissions_student ON teacher_task_submissions(student_id);
CREATE INDEX IF NOT EXISTS forum_posts_course ON forum_posts(course_id, id DESC);
