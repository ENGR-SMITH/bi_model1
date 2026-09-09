-- Dubbing language of audio/script vault assets. Compulsory at upload time on
-- the audio and script role pages (English | Spanish | Portuguese | Hindi |
-- Indonesian); defaults to English for rows written before the field existed.
ALTER TABLE nexet_video_assets ADD COLUMN language text NOT NULL DEFAULT 'English';