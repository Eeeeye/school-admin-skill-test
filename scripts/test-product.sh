#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T backend node < backend/test/product.integration.js
docker compose exec -T backend node < backend/test/school-workflows.integration.js
docker compose exec -T backend node < backend/test/staff.integration.js
