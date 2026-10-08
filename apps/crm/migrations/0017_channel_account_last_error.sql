-- The reason the Zalo bridge last reported for a channel account in error (an error code such as
-- ZALO_KICKED), shown to admins next to the error status. Cleared when the account connects again.

ALTER TABLE channel_account ADD COLUMN last_error TEXT;
