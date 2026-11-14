-- Migration 027: Personalized Size Profiles, Category-Specific Sizing, and Size Guides

-- 1. Customer Size Profiles (Primary profile + "Shop for someone else" profiles)
CREATE TABLE IF NOT EXISTS customer_size_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL,
  name text NOT NULL,
  relationship text NOT NULL DEFAULT 'self',
  is_primary boolean NOT NULL DEFAULT false,
  size_standard text NOT NULL DEFAULT 'India',
  clothing_size text NOT NULL DEFAULT 'M',
  custom_size text,
  category_sizes jsonb NOT NULL DEFAULT '{}'::jsonb,
  bust numeric(6,2),
  waist numeric(6,2),
  hips numeric(6,2),
  shoulder numeric(6,2),
  inseam numeric(6,2),
  height numeric(6,2),
  measurement_unit text NOT NULL DEFAULT 'cm',
  fit_preference text NOT NULL DEFAULT 'regular',
  silhouette_preference text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_size_profiles_user ON customer_size_profiles (auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_size_profiles_primary ON customer_size_profiles (auth_user_id) WHERE is_primary = true;

-- 2. Link active size profile to customer_profiles
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS active_size_profile_id uuid;

-- 3. Product Size Guides (category-level size charts and fit guidance)
CREATE TABLE IF NOT EXISTS product_size_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  category_name text NOT NULL,
  standard text NOT NULL DEFAULT 'India',
  size_chart jsonb NOT NULL DEFAULT '[]'::jsonb,
  fit_guidance text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_size_guides_category ON product_size_guides (category_id);

-- 4. Extend products with fit type, one-size eligibility, size guidance, and optional size guide link
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_guide_id uuid REFERENCES product_size_guides(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fit_type text DEFAULT 'regular';
ALTER TABLE products ADD COLUMN IF NOT EXISTS one_size_fit_range text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_notes text;

-- 5. Seed default standard size guides for existing categories if none exist
INSERT INTO product_size_guides (category_name, standard, fit_guidance, size_chart)
VALUES
  ('Tops', 'India', 'Measurements refer to body size, not garment dimensions. Relaxed silhouettes offer 2–3 inches of ease.',
   '[
     {"size": "XS", "bust_cm": 81, "waist_cm": 64, "uk": 6, "us": 2, "eu": 34},
     {"size": "S",  "bust_cm": 86, "waist_cm": 69, "uk": 8, "us": 4, "eu": 36},
     {"size": "M",  "bust_cm": 91, "waist_cm": 74, "uk": 10, "us": 6, "eu": 38},
     {"size": "L",  "bust_cm": 97, "waist_cm": 80, "uk": 12, "us": 8, "eu": 40},
     {"size": "XL", "bust_cm": 103, "waist_cm": 86, "uk": 14, "us": 10, "eu": 42},
     {"size": "XXL", "bust_cm": 109, "waist_cm": 92, "uk": 16, "us": 12, "eu": 44}
   ]'::jsonb),
  ('Dresses', 'India', 'For contoured eveningwear, choose your exact bust and waist measurement. For fluid draped slip dresses, choose your standard top size.',
   '[
     {"size": "XS", "bust_cm": 81, "waist_cm": 64, "hips_cm": 89, "uk": 6, "us": 2, "eu": 34},
     {"size": "S",  "bust_cm": 86, "waist_cm": 69, "hips_cm": 94, "uk": 8, "us": 4, "eu": 36},
     {"size": "M",  "bust_cm": 91, "waist_cm": 74, "hips_cm": 99, "uk": 10, "us": 6, "eu": 38},
     {"size": "L",  "bust_cm": 97, "waist_cm": 80, "hips_cm": 105, "uk": 12, "us": 8, "eu": 40},
     {"size": "XL", "bust_cm": 103, "waist_cm": 86, "hips_cm": 111, "uk": 14, "us": 10, "eu": 42},
     {"size": "XXL", "bust_cm": 109, "waist_cm": 92, "hips_cm": 117, "uk": 16, "us": 12, "eu": 44}
   ]'::jsonb),
  ('Pants', 'India', 'High-waisted trousers are measured at the natural waistline. Mid-rise pieces rest 1 inch below the navel.',
   '[
     {"size": "26", "waist_cm": 66, "hips_cm": 91, "letter": "XS"},
     {"size": "28", "waist_cm": 71, "hips_cm": 96, "letter": "S"},
     {"size": "30", "waist_cm": 76, "hips_cm": 101, "letter": "M"},
     {"size": "32", "waist_cm": 81, "hips_cm": 107, "letter": "L"},
     {"size": "34", "waist_cm": 86, "hips_cm": 112, "letter": "XL"},
     {"size": "36", "waist_cm": 91, "hips_cm": 117, "letter": "XXL"}
   ]'::jsonb)
ON CONFLICT DO NOTHING;

-- 6. Backfill: create a primary size profile for existing customer_profiles that lack one
INSERT INTO customer_size_profiles (auth_user_id, name, relationship, is_primary, size_standard, clothing_size, category_sizes, fit_preference, silhouette_preference)
SELECT cp.auth_user_id,
       COALESCE(NULLIF(trim(cp.full_name), ''), 'My Wardrobe'),
       'self',
       true,
       'India',
       'M',
       '{"tops": "M", "dresses": "M", "skirts": "M", "pants": "30", "jeans": "30", "coord_sets": "M"}'::jsonb,
       'regular',
       COALESCE(cp.preferred_silhouette, 'Fluid & Relaxed')
FROM customer_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM customer_size_profiles sp WHERE sp.auth_user_id = cp.auth_user_id AND sp.is_primary = true
)
ON CONFLICT DO NOTHING;

-- Update active_size_profile_id on customer_profiles to their primary profile
UPDATE customer_profiles cp
SET active_size_profile_id = sp.id
FROM customer_size_profiles sp
WHERE sp.auth_user_id = cp.auth_user_id AND sp.is_primary = true AND cp.active_size_profile_id IS NULL;

-- 7. Backfill from legacy wearer_profiles (if any exist) as additional profiles
INSERT INTO customer_size_profiles (auth_user_id, name, relationship, is_primary, size_standard, clothing_size, category_sizes, bust, waist, hips, height, fit_preference)
SELECT wp.auth_user_id,
       COALESCE(NULLIF(trim(wp.name), ''), 'Friend'),
       COALESCE(NULLIF(trim(wp.relationship), ''), 'friend'),
       false,
       'India',
       COALESCE(NULLIF(trim(wp.size_label), ''), 'M'),
       jsonb_build_object(
         'tops', COALESCE(NULLIF(trim(wp.size_label), ''), 'M'),
         'dresses', COALESCE(NULLIF(trim(wp.size_label), ''), 'M'),
         'pants', '30'
       ),
       wp.bust_cm,
       wp.waist_cm,
       wp.hip_cm,
       wp.length_cm,
       'regular'
FROM wearer_profiles wp
WHERE NOT EXISTS (
  SELECT 1 FROM customer_size_profiles sp
  WHERE sp.auth_user_id = wp.auth_user_id AND lower(sp.name) = lower(wp.name)
)
ON CONFLICT DO NOTHING;
