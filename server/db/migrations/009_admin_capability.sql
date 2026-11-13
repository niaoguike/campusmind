-- Administrator access is an independent capability, so an administrator can
-- also have a student account role and participate in courses as a student.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_admin = TRUE WHERE role = 'admin';
