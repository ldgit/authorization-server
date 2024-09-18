ALTER TABLE users
ALTER COLUMN created_at TYPE timestamptz;

ALTER TABLE clients
ALTER COLUMN created_at TYPE timestamptz;

ALTER TABLE sessions
ALTER COLUMN created_at TYPE timestamptz;

ALTER TABLE access_tokens
ALTER COLUMN created_at TYPE timestamptz;
