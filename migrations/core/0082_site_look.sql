-- BRAND-001 and BRAND-002 (ct C2, C3; ruling 24 Oct): the workspace's look, read from its website only on request.
-- One row for the workspace. The read keeps what the site gave (name, line, mark, colours, and its face's family,
-- kind and own licence) and when; overrides_json holds the owner's changes, value by value, and a read keeps them;
-- look is site or plain.
-- mark_asset is the read mark's R2 key (brand/<sha256>.<ext>), served publicly under /media/brand/; mark_source is the
-- address it was read from, or the icon the site offered that could not be kept, with mark_unread saying why.
-- The site's font file is never copied: font_source is where the site serves it, font_unread why it was not read (then
-- font_licence is null), and booking pages use the open face Dial bundles nearest font_family and font_kind.
-- font_asset is a face the owner uploads with its licence confirmed (a later round).
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
  mark_source TEXT,
  mark_unread TEXT,
  font_asset TEXT,
  font_family TEXT,
  font_licence TEXT,
  font_kind TEXT,
  font_source TEXT,
  font_unread TEXT,
  colours_json TEXT NOT NULL DEFAULT '{}',
  overrides_json TEXT NOT NULL DEFAULT '{}',
  look TEXT NOT NULL DEFAULT 'plain' CHECK (look IN ('site', 'plain')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
