-- When the CRM extractor was last asked to read the conversation; the idle-conversation cron
-- extracts again only after a newer customer message.
ALTER TABLE conversation ADD COLUMN last_extracted_at TEXT;
