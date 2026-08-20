-- ScrapMap schema. Applied idempotently on boot by migrate.ts.

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  -- 'homeowner' posts scrap, 'scrapper' collects it, 'both' does either.
  role              TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('homeowner', 'scrapper', 'both')),
  bio               TEXT NOT NULL DEFAULT '',
  phone             TEXT,
  -- Home base drives "near me" defaults and notification radius.
  home_lat          REAL,
  home_lon          REAL,
  city              TEXT,
  region            TEXT,
  postal_code       TEXT,
  search_radius_miles REAL NOT NULL DEFAULT 25,
  token_version     INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS listings (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'claimed', 'completed', 'cancelled', 'expired')),
  -- 'free' giveaway, 'obo' open to offers, 'firm' fixed asking price.
  price_type        TEXT NOT NULL DEFAULT 'free' CHECK (price_type IN ('free', 'obo', 'firm')),
  price_cents       INTEGER NOT NULL DEFAULT 0,
  lat               REAL NOT NULL,
  lon               REAL NOT NULL,
  address_line      TEXT,
  city              TEXT,
  region            TEXT,
  postal_code       TEXT,
  pickup_notes      TEXT NOT NULL DEFAULT '',
  available_from    TEXT,
  available_until   TEXT,
  -- Curbside means a scrapper can grab it without contact; help_needed flags
  -- heavy items where the poster cannot assist with loading.
  curbside          INTEGER NOT NULL DEFAULT 0,
  help_needed       INTEGER NOT NULL DEFAULT 0,
  -- Snapshot of the estimated yard payout when posted, in cents.
  estimated_value_cents INTEGER NOT NULL DEFAULT 0,
  total_weight_lbs  REAL NOT NULL DEFAULT 0,
  view_count        INTEGER NOT NULL DEFAULT 0,
  community_id      TEXT REFERENCES communities (id) ON DELETE SET NULL,
  claimed_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  expires_at        TEXT,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_bbox ON listings (lat, lon);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_community ON listings (community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_claimed_by ON listings (claimed_by);

CREATE TABLE IF NOT EXISTS listing_materials (
  id            TEXT PRIMARY KEY,
  listing_id    TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  material_key  TEXT NOT NULL,
  weight_lbs    REAL NOT NULL DEFAULT 0,
  quantity      INTEGER NOT NULL DEFAULT 1,
  notes         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_listing_materials_listing ON listing_materials (listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_materials_key ON listing_materials (material_key);

CREATE TABLE IF NOT EXISTS listing_photos (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  byte_size   INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listing_photos_listing ON listing_photos (listing_id, sort_order);

CREATE TABLE IF NOT EXISTS claims (
  id           TEXT PRIMARY KEY,
  listing_id   TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  scrapper_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'completed')),
  message      TEXT NOT NULL DEFAULT '',
  eta          TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (listing_id, scrapper_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_listing ON claims (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_scrapper ON claims (scrapper_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  listing_id    TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  read_at       TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id, read_at);

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  rater_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ratee_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  UNIQUE (listing_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_ratee ON reviews (ratee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS communities (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  city         TEXT,
  region       TEXT,
  postal_code  TEXT,
  lat          REAL,
  lon          REAL,
  radius_miles REAL NOT NULL DEFAULT 15,
  created_by   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_communities_bbox ON communities (lat, lon);

CREATE TABLE IF NOT EXISTS community_members (
  community_id  TEXT NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'organizer')),
  joined_at     TEXT NOT NULL,
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members (user_id);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  community_id  TEXT NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  starts_at     TEXT NOT NULL,
  ends_at       TEXT,
  lat           REAL,
  lon           REAL,
  address_line  TEXT,
  created_by    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_community ON events (community_id, starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id  TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status    TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'maybe', 'declined')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

-- TTL cache for third-party API responses. Keeping it in SQLite means a restart
-- does not send a burst of traffic at the free endpoints we depend on.
CREATE TABLE IF NOT EXISTS api_cache (
  key         TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_cache_expiry ON api_cache (expires_at);
