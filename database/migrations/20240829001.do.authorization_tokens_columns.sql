ALTER TABLE authorization_tokens
ADD COLUMN user_id uuid NOT NULL references users(id),
ADD COLUMN code_challenge text NOT NULL,
ADD COLUMN code_challenge_method text NOT NULL
