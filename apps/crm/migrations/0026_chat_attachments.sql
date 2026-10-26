-- Files attached to internal chat messages and task comments. Bytes live in R2 MEDIA under chat/<conversation>/<id>.
-- message_id is NULL between upload and the message that uses it.
CREATE TABLE chat_attachment (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  message_id TEXT REFERENCES chat_message(id),
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL
);
CREATE INDEX chat_attachment_message ON chat_attachment(message_id);
