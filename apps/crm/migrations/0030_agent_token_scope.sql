-- Self-service MCP tokens for external agents (Claude Code, Codex, Antigravity). Existing script-issued
-- tokens become 'legacy' and keep their current tool set. 'read' lists and reads chat and tasks; 'read_tasks'
-- also writes the user's tasks. No scope may send chat messages.
ALTER TABLE agent_token ADD COLUMN scope TEXT NOT NULL DEFAULT 'legacy' CHECK (scope IN ('legacy', 'read', 'read_tasks'));
ALTER TABLE agent_token ADD COLUMN expires_at TEXT;
ALTER TABLE agent_token ADD COLUMN created_via TEXT NOT NULL DEFAULT 'script' CHECK (created_via IN ('script', 'self'));
