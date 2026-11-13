-- Move saved users from retired DeepSeek aliases to current API model names.
ALTER TABLE users ALTER COLUMN model_type SET DEFAULT 'deepseek-flash';

UPDATE users
SET model_type = CASE
  WHEN model_type IN ('deepseek-v4-flash', 'deepseek-chat', 'deepseek') THEN 'deepseek-flash'
  WHEN model_type = 'deepseek-reasoner' THEN 'deepseek-v4-pro'
  ELSE model_type
END
WHERE model_type IN ('deepseek-v4-flash', 'deepseek-chat', 'deepseek', 'deepseek-reasoner');
