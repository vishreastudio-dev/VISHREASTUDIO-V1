ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS model_version text DEFAULT 'vishrea-colour-engine-1.0';
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS confidence numeric(5,2);
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS quality_score numeric(5,2);
ALTER TABLE colour_reviews ADD COLUMN IF NOT EXISTS lighting text;