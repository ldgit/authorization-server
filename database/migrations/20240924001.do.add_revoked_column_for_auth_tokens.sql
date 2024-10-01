ALTER TABLE authorization_tokens
ADD COLUMN revoked boolean NOT NULL DEFAULT false
