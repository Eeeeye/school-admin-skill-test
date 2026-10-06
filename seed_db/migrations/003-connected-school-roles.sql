-- Section names must support the same length across classrooms and assignments.
ALTER TABLE class_teachers ALTER COLUMN section_name TYPE VARCHAR(50);

-- Default school workflows: scoped APIs still enforce record ownership,
-- notice audiences and the assigned teacher/admin reviewer.
INSERT INTO permissions(role_id, access_control_id, type)
SELECT r.role_id,a.id,a.type FROM (VALUES (2),(3)) r(role_id)
CROSS JOIN access_controls a WHERE a.path IN (
  'leave_parent','leave/request','communication_parent','notices','notices/:id',
  '/api/v1/leave/policies/me','/api/v1/leave/request','/api/v1/leave/request/:id',
  '/api/v1/notices','/api/v1/notices/:id'
) AND (a.method IS NULL OR a.path LIKE '/api/v1/leave/%' OR a.method='GET')
ON CONFLICT DO NOTHING;
INSERT INTO permissions(role_id,access_control_id,type)
SELECT 2,id,type FROM access_controls WHERE path IN (
  'leave/pending','/api/v1/leave/pending','/api/v1/leave/pending/:id/status',
  'notices/add','notices/edit/:id','/api/v1/notices/recipients/list',
  '/api/v1/notices','/api/v1/notices/:id','/api/v1/notices/:id/status'
)
ON CONFLICT DO NOTHING;
