-- Referential integrity and reverse-lookup indexes.
-- Constraints are added NOT VALID so existing orphan rows do not block upgrades;
-- new writes are still enforced and cascades still fire.
CREATE INDEX IF NOT EXISTS conversation_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS teacher_tasks_course_published ON teacher_tasks(course_id, published);
CREATE INDEX IF NOT EXISTS course_join_requests_student ON course_join_requests(student_id);
CREATE INDEX IF NOT EXISTS group_agents_user ON group_agents(user_id);
CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id);

ALTER TABLE course_student_memberships
  ADD CONSTRAINT course_student_memberships_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT course_student_memberships_student_fk FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE course_teacher_assignments
  ADD CONSTRAINT course_teacher_assignments_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT course_teacher_assignments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE course_join_requests
  ADD CONSTRAINT course_join_requests_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT course_join_requests_student_fk FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE course_spaces
  ADD CONSTRAINT course_spaces_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT course_spaces_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE teacher_tasks
  ADD CONSTRAINT teacher_tasks_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE teacher_task_submissions
  ADD CONSTRAINT teacher_task_submissions_task_fk FOREIGN KEY (task_id) REFERENCES teacher_tasks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT teacher_task_submissions_student_fk FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE teacher_notes
  ADD CONSTRAINT teacher_notes_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT teacher_notes_teacher_fk FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT teacher_notes_student_fk FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE teacher_course_announcements
  ADD CONSTRAINT teacher_course_announcements_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT teacher_course_announcements_author_fk FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE teacher_forum_actions
  ADD CONSTRAINT teacher_forum_actions_post_fk FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT teacher_forum_actions_teacher_fk FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE resources
  ADD CONSTRAINT resources_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT resources_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE resource_folders
  ADD CONSTRAINT resource_folders_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT resource_folders_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE forum_posts
  ADD CONSTRAINT forum_posts_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT forum_posts_author_fk FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE forum_comments
  ADD CONSTRAINT forum_comments_post_fk FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT forum_comments_author_fk FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE forum_polls
  ADD CONSTRAINT forum_polls_post_fk FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE forum_votes
  ADD CONSTRAINT forum_votes_post_fk FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT forum_votes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT conversation_members_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE conversation_reads
  ADD CONSTRAINT conversation_reads_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT conversation_reads_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE messages
  ADD CONSTRAINT messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT messages_agent_owner_fk FOREIGN KEY (agent_owner_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE group_agents
  ADD CONSTRAINT group_agents_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT group_agents_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE group_learning_consents
  ADD CONSTRAINT group_learning_consents_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT group_learning_consents_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE group_tasks
  ADD CONSTRAINT group_tasks_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT group_tasks_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE group_summaries
  ADD CONSTRAINT group_summaries_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE group_attachments
  ADD CONSTRAINT group_attachments_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE agent_group_requests
  ADD CONSTRAINT agent_group_requests_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT agent_group_requests_owner_fk FOREIGN KEY (agent_owner_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE group_agent_activity
  ADD CONSTRAINT group_agent_activity_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT group_agent_activity_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE agent_threads
  ADD CONSTRAINT agent_threads_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE agent_messages
  ADD CONSTRAINT agent_messages_thread_fk FOREIGN KEY (thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE agent_attachments
  ADD CONSTRAINT agent_attachments_thread_fk FOREIGN KEY (thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT agent_attachments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE friend_requests
  ADD CONSTRAINT friend_requests_from_fk FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT friend_requests_to_fk FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE friendships
  ADD CONSTRAINT friendships_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT friendships_friend_fk FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE friend_notes
  ADD CONSTRAINT friend_notes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT friend_notes_friend_fk FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE friend_agent_access
  ADD CONSTRAINT friend_agent_access_requester_fk FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT friend_agent_access_owner_fk FOREIGN KEY (agent_owner_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE friend_agent_messages
  ADD CONSTRAINT friend_agent_messages_requester_fk FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT friend_agent_messages_owner_fk FOREIGN KEY (agent_owner_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE schedules
  ADD CONSTRAINT schedules_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE study_plans
  ADD CONSTRAINT study_plans_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE quizzes
  ADD CONSTRAINT quizzes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT quizzes_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE question_favorites
  ADD CONSTRAINT question_favorites_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT question_favorites_quiz_fk FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE learning_events
  ADD CONSTRAINT learning_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE learning_reviews
  ADD CONSTRAINT learning_reviews_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE user_knowledge_mastery
  ADD CONSTRAINT user_knowledge_mastery_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE agent_memories
  ADD CONSTRAINT agent_memories_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE agent_memory_items
  ADD CONSTRAINT agent_memory_items_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE memory_sync_preferences
  ADD CONSTRAINT memory_sync_preferences_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE memory_sync_requests
  ADD CONSTRAINT memory_sync_requests_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;
