import { DeleteMessageCommand, type Message, type SQSClient } from '@aws-sdk/client-sqs';
import type { createClient } from 'redis';
import { isDeploymentId } from './utils';

const FAILED_LOG = '✖ SQS moved this job to the dead-letter queue after the final delivery went unacknowledged.';
const ARCHIVE_SECONDS = 14 * 24 * 3600;

// Check the lease and change the status together. The build worker uses that
// same lease, so we never mark a deployment failed while it owns the job.
const reconcileScript = `
    local id = ARGV[1]
    if id ~= '' and redis.call('EXISTS', KEYS[2]) == 1 then
        return 0
    end

    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3], 'NX')
    if id ~= '' then
        local status = redis.call('HGET', KEYS[3], id)
        if status == 'uploaded' or status == 'building' or status == 'retrying' then
            redis.call('RPUSH', KEYS[4], ARGV[4])
            redis.call('EXPIRE', KEYS[4], 3600)
            redis.call('HSET', KEYS[3], id, 'failed')
        end
    end
    return 1
`;

export async function reconcileDeadLetter(
    message: Message,
    queueUrl: string,
    sqs: SQSClient,
    redis: Pick<ReturnType<typeof createClient>, 'eval'>,
): Promise<void> {
    const { MessageId, ReceiptHandle, Body } = message;
    if (!MessageId || !ReceiptHandle) throw new Error('DLQ message is missing its ID or receipt handle');

    const id = isDeploymentId(Body) ? Body : '';
    const record = JSON.stringify({
        messageId: MessageId,
        body: Body,
        recordedAt: new Date().toISOString(),
        reason: FAILED_LOG,
    });
    const ready = await redis.eval(reconcileScript, {
        keys: [`dead-letter:${MessageId}`, `deployment-lock:${id}`, 'status', `logs:${id}`],
        arguments: [id, record, String(ARCHIVE_SECONDS), FAILED_LOG],
    });
    if (ready !== 1) return; // A live build owns this ID. Let the DLQ redeliver later.

    // Keep the diagnostic record in Redis before acknowledging the DLQ delivery.
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle }));
}
