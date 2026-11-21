#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
floci_url=http://127.0.0.1:4566
region=us-east-1
bucket=cygnus-local
floci_container=cygnus-floci-check
redis_container=cygnus-redis-check

command -v aws >/dev/null || { echo 'Install the AWS CLI before running this script.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Start Docker before running this script.' >&2; exit 1; }

ensure_container() {
    local name="$1"
    shift
    if docker container inspect "$name" >/dev/null 2>&1; then
        if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]; then
            docker start "$name" >/dev/null
        fi
    else
        docker run -d --rm --name "$name" "$@" >/dev/null
    fi
}

aws_local() {
    env -u AWS_PROFILE -u AWS_DEFAULT_PROFILE -u AWS_SESSION_TOKEN \
        AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_MAX_ATTEMPTS=1 \
        AWS_PAGER= aws --endpoint-url "$floci_url" --region "$region" "$@"
}

ensure_container "$floci_container" -p 127.0.0.1:4566:4566 \
    -e "FLOCI_BASE_URL=$floci_url" floci/floci:2.5.0
ensure_container "$redis_container" -p 127.0.0.1:6387:6379 redis:7-alpine

for attempt in {1..30}; do
    if aws_local sqs list-queues --cli-connect-timeout 1 --cli-read-timeout 1 >/dev/null 2>&1 &&
        docker exec "$redis_container" redis-cli ping | grep -qx PONG; then
        break
    fi
    if [ "$attempt" -eq 30 ]; then
        echo 'Timed out waiting for Floci and Redis.' >&2
        exit 1
    fi
    sleep 1
done

if ! aws_local s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    aws_local s3api create-bucket --bucket "$bucket" >/dev/null
fi
dlq_url="$(aws_local sqs create-queue --queue-name cygnus-dlq --query QueueUrl --output text)"
dlq_arn="$(aws_local sqs get-queue-attributes --queue-url "$dlq_url" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)"
queue_url="$(aws_local sqs create-queue --queue-name cygnus-builds --query QueueUrl --output text)"
aws_local sqs set-queue-attributes --queue-url "$queue_url" \
    --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$dlq_arn\\\",\\\"maxReceiveCount\\\":3}\"}"

cat > "$root/.env.floci" <<CONFIG
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=$region
S3_REGION=$region
BUCKET=$bucket
ENDPOINT=
AWS_ENDPOINT_URL_S3=$floci_url
S3_FORCE_PATH_STYLE=true
REDIS_URL=redis://127.0.0.1:6387
SQS_ENDPOINT=$floci_url
SQS_QUEUE_URL=$queue_url
CONFIG

printf 'Floci and Redis are ready. Service settings are in .env.floci.\n'
