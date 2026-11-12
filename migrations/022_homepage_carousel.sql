-- Migration 022: homepage hero carousel managed from the admin panel.
-- Additive only. Banner images stay in the existing upload storage; rows hold their URLs and
-- dimensions, never image bytes. Text, typography and buttons are stored as data and rendered as
-- HTML over the image, so changing one never requires replacing the other.
--
-- The editable columns are the working draft. Publishing copies them into `published_content`,
-- which is the only thing the public homepage reads, so saving a draft never changes the live site.

CREATE TABLE IF NOT EXISTS homepage_carousel_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 80),
  subtitle text NOT NULL DEFAULT '' CHECK (length(subtitle) <= 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 220),
  desktop_image_url text,
  desktop_image_width integer CHECK (desktop_image_width IS NULL OR desktop_image_width > 0),
  desktop_image_height integer CHECK (desktop_image_height IS NULL OR desktop_image_height > 0),
  mobile_image_url text,
  mobile_image_width integer CHECK (mobile_image_width IS NULL OR mobile_image_width > 0),
  mobile_image_height integer CHECK (mobile_image_height IS NULL OR mobile_image_height > 0),
  image_alt text NOT NULL DEFAULT '' CHECK (length(image_alt) <= 200),
  display_mode text NOT NULL DEFAULT 'overlay' CHECK (display_mode IN ('overlay', 'image_only')),
  layout_type text NOT NULL DEFAULT 'full' CHECK (layout_type IN ('full', 'split_image_right', 'split_image_left')),
  -- Validated by lib/carousel.js against the shared schema in vishrea-react/src/lib/heroCarousel.js;
  -- missing keys fall back to the defaults defined there.
  image_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  heading_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtitle_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  description_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  overlay_position jsonb NOT NULL DEFAULT '{}'::jsonb,
  overlay_visibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_cta_label text NOT NULL DEFAULT '' CHECK (length(primary_cta_label) <= 30),
  primary_cta_url text NOT NULL DEFAULT '' CHECK (length(primary_cta_url) <= 500),
  primary_cta_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  secondary_cta_label text NOT NULL DEFAULT '' CHECK (length(secondary_cta_label) <= 30),
  secondary_cta_url text NOT NULL DEFAULT '' CHECK (length(secondary_cta_url) <= 500),
  secondary_cta_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft', 'published')),
  starts_at timestamptz,
  ends_at timestamptz,
  published_content jsonb,
  published_at timestamptz,
  published_by text,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT homepage_carousel_slides_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT homepage_carousel_slides_published_snapshot CHECK (publication_status = 'draft' OR published_content IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_homepage_carousel_slides_live
  ON homepage_carousel_slides (display_order, created_at) WHERE publication_status = 'published' AND is_active;

-- One row of carousel behaviour. Changes apply to the homepage as soon as they are saved.
CREATE TABLE IF NOT EXISTS homepage_carousel_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled boolean NOT NULL DEFAULT true,
  autoplay_enabled boolean NOT NULL DEFAULT true,
  autoplay_interval integer NOT NULL DEFAULT 6000 CHECK (autoplay_interval BETWEEN 3000 AND 15000),
  transition_duration integer NOT NULL DEFAULT 600 CHECK (transition_duration BETWEEN 200 AND 1500),
  transition_type text NOT NULL DEFAULT 'fade' CHECK (transition_type IN ('slide', 'fade')),
  show_navigation boolean NOT NULL DEFAULT true,
  show_pagination boolean NOT NULL DEFAULT true,
  pause_on_hover boolean NOT NULL DEFAULT true,
  desktop_height integer NOT NULL DEFAULT 690 CHECK (desktop_height BETWEEN 420 AND 900),
  mobile_height integer NOT NULL DEFAULT 600 CHECK (mobile_height BETWEEN 380 AND 820),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO homepage_carousel_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Initial editable content for the first slide. It starts as a draft without an image: the banner
-- is uploaded from Admin → Homepage, then the slide is published. Until a slide is published the
-- homepage keeps its existing hero.
INSERT INTO homepage_carousel_slides (title, subtitle, primary_cta_label, primary_cta_url, image_alt, display_order)
SELECT 'Cozy Layers for Every Mood',
       'Sweaters, cardigans and more — effortless warmth, all season long.',
       'EXPLORE SWEATERS',
       '/catalogue/sweaters',
       'Model wearing a green embroidered sweater',
       10
 WHERE NOT EXISTS (SELECT 1 FROM homepage_carousel_slides);

-- Same hosted-Postgres lockdown as migrations 020 and 021 for the new tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE homepage_carousel_slides ENABLE ROW LEVEL SECURITY;
    ALTER TABLE homepage_carousel_settings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON homepage_carousel_slides, homepage_carousel_settings FROM anon, authenticated;
  END IF;
END $$;
