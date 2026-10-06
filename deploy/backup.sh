#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/deploy/.env.server"}
PROJECT_NAME=${COMPOSE_PROJECT_NAME:-school-demo}
DESTINATION=${1:-/var/backups/school-demo}
[[ -f "$ENV_FILE" ]] || { echo "Missing protected server env file: $ENV_FILE" >&2; exit 1; }
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "Invalid Compose project name" >&2; exit 1; }
command -v docker >/dev/null
command -v sha256sum >/dev/null
command -v flock >/dev/null
COMPOSE=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.server.yml")
"${COMPOSE[@]}" config --quiet
mkdir -p -- "$DESTINATION"
exec 9>"$DESTINATION/.${PROJECT_NAME}.backup.lock"
flock -n 9 || { echo "Another backup is already running for $PROJECT_NAME" >&2; exit 1; }
for volume in blockchain-data blockchain-deployments ipfs-data caddy-data caddy-config; do
  docker volume inspect "${PROJECT_NAME}_${volume}" >/dev/null
done
RUNNING=$("${COMPOSE[@]}" ps --services --status running)
[[ $'\n'"$RUNNING"$'\n' == *$'\npostgres\n'* ]] || { echo "PostgreSQL must be running before backup" >&2; exit 1; }
RESTORE=()
for service in blockchain ipfs backend frontend; do
  if [[ $'\n'"$RUNNING"$'\n' == *$'\n'"$service"$'\n'* ]]; then RESTORE+=("$service"); fi
done

BACKUP_DIR=$(mktemp -d "$DESTINATION/school-demo-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
chmod 700 "$BACKUP_DIR"
touch "$BACKUP_DIR/INCOMPLETE"
STOPPED=0
finish() {
  local status=$?
  trap - EXIT
  if [[ "$STOPPED" == 1 && ${#RESTORE[@]} -gt 0 ]]; then
    if ! "${COMPOSE[@]}" up -d --wait --no-deps --no-recreate "${RESTORE[@]}"; then
      echo "Service restart needs attention; backup directory: $BACKUP_DIR" >&2
      status=1
    fi
  fi
  if [[ "$status" != 0 ]]; then echo "Backup did not complete successfully; inspect $BACKUP_DIR" >&2; fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Quiesce all writers before capturing cross-service state. PostgreSQL remains
# up only for pg_dump; no public entry or backend worker can mutate the records.
STOPPED=1
"${COMPOSE[@]}" stop frontend backend
"${COMPOSE[@]}" stop blockchain ipfs
"${COMPOSE[@]}" exec -T postgres pg_dump -U postgres -d school_mgmt --format=custom > "$BACKUP_DIR/postgres.dump"

for volume in blockchain-data blockchain-deployments ipfs-data caddy-data caddy-config; do
  docker run --rm --network none \
    --mount "type=volume,source=${PROJECT_NAME}_${volume},target=/source,readonly" \
    --entrypoint tar postgres:16-alpine -czf - -C /source . > "$BACKUP_DIR/$volume.tar.gz"
done
install -m 600 "$ENV_FILE" "$BACKUP_DIR/server.env"
cp "$ROOT_DIR/docker-compose.server.yml" "$BACKUP_DIR/docker-compose.server.yml"
cp "$ROOT_DIR/deploy/Caddyfile" "$BACKUP_DIR/Caddyfile"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "project=$PROJECT_NAME"
  for image in school-demo-backend:latest school-demo-frontend:latest school-demo-blockchain:latest postgres:16-alpine ipfs/kubo:v0.32.1; do
    docker image inspect --format '{{.RepoTags}} {{.Id}}' "$image"
  done
} > "$BACKUP_DIR/manifest.txt"
(cd "$BACKUP_DIR" && sha256sum postgres.dump ./*.tar.gz server.env docker-compose.server.yml Caddyfile manifest.txt > SHA256SUMS)
unlink "$BACKUP_DIR/INCOMPLETE"
echo "Backup complete: $BACKUP_DIR (contains private keys; keep access restricted)"
