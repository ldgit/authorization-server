CREATE TABLE IF NOT EXISTS authorization_tokens (
  id BIGSERIAL PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  value text NOT NULL UNIQUE,
  scope text NOT NULL,
  client_id uuid NOT NULL references clients(id)
);

CREATE TABLE IF NOT EXISTS access_tokens (
  id BIGSERIAL PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_in integer NOT NULL,
  value text NOT NULL UNIQUE,
  scope text NOT NULL,
  client_id uuid NOT NULL references clients(id),
  authorization_token_id BIGSERIAL NOT NULL references authorization_tokens(id)
);
