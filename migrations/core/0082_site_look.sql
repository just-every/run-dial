-- BRAND-001 and PROFILE-003 (ct C2, C3): the workspace's look, read from its website only on request.
-- One row for the workspace. The read keeps what the site gave (name, line, mark, colours and face, with the face's
-- own licence) and when; overrides_json holds the owner's changes, value by value; look is site or plain.
-- mark_asset and font_asset are R2 keys (brand/<sha256>.<ext>) served publicly under /media/brand/.
-- colours_json records the read colours, the colours booking pages use and each one adjusted for contrast.
-- read_error records the last failed read; a failed read leaves the previous look as it was.
CREATE TABLE site_looks (
  id TEXT PRIMARY KEY,
  singleton_key TEXT NOT NULL UNIQUE DEFAULT 'default' CHECK (singleton_key = 'default'),
  website_url TEXT,
  read_at TEXT,
  read_error TEXT,
  name TEXT,
  line TEXT,
  mark_asset TEXT,
  font_asset TEXT,
  font_family TEXT,
  font_licence TEXT,
  colours_json TEXT NOT NULL DEFAULT '{}',
  overrides_json TEXT NOT NULL DEFAULT '{}',
  look TEXT NOT NULL DEFAULT 'plain' CHECK (look IN ('site', 'plain')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
