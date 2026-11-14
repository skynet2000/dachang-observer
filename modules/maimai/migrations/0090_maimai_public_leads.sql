CREATE TABLE IF NOT EXISTS maimai_public_leads (
  post_id text PRIMARY KEY,
  url text NOT NULL,
  topic_url text NOT NULL,
  title text NOT NULL,
  excerpt text NOT NULL,
  likes integer NOT NULL CHECK (likes >= 0),
  comments integer NOT NULL CHECK (comments >= 0),
  published_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  visible boolean NOT NULL DEFAULT true
);
