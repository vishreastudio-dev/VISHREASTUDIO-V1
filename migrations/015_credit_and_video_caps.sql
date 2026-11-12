-- Customer videos are capped at 10 seconds. Lower the previous default where it is still that default.
UPDATE app_settings
   SET value = '10'::jsonb, updated_at = now()
 WHERE key = 'max_video_seconds'
   AND value::text IN ('30', '"30"');
