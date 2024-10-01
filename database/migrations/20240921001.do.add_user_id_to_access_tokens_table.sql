ALTER TABLE access_tokens
ADD COLUMN user_id uuid NOT NULL references users(id)
