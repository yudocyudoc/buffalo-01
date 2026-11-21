-- Apply after 0001_tasks.sql to an explicitly selected D1 only; never by CI.
ALTER TABLE buffalo_tasks ADD COLUMN dispatch_head_sha TEXT;
ALTER TABLE buffalo_tasks ADD COLUMN dispatch_started_at TEXT;
ALTER TABLE buffalo_tasks ADD COLUMN github_workflow_id INTEGER;
ALTER TABLE buffalo_tasks ADD COLUMN github_artifact_id INTEGER;
