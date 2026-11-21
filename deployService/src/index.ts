import 'dotenv/config';
import { createClient } from 'redis';
import {
    GetQueueAttributesCommand,
    GetQueueUrlCommand,
    type Message,
    ReceiveMessageCommand,
    SQSClient,
} from '@aws-sdk/client-sqs';
import { buildDeployment } from './build';
import { reconcileDeadLetter } from './dead-letter';
import { buildOnFargate } from './fargate-build';
import { JobStore, processMessage, VISIBILITY_SECONDS } from './job-processor';

const queueUrl: string = process.env.SQS_QUEUE_URL ?? (() => { throw new Error('SQS_QUEUE_URL is required'); })();
const buildBackend = process.env.BUILD_BACKEND ?? 'local';
if (buildBackend !== 'local' && buildBackend !== 'fargate') {
    throw new Error('BUILD_BACKEND must be local or fargate');
}
const sqs = new SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.SQS_ENDPOINT ? { endpoint: process.env.SQS_ENDPOINT } : {}),
});
const publisher = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });
publisher.on('error', error => console.error('Redis error:', error));

// Compare the token before renewing/deleting, so an old worker cannot change a
// lease acquired by another worker after the old lease expires.
const store: JobStore = {
    getStatus: id => publisher.hGet('status', id),
    setStatus: async (id, status) => { await publisher.hSet('status', id, status); },
    addLog: async (id, message) => { await publisher.rPush(`logs:${id}`, message); },
    expireLogs: async id => { await publisher.expire(`logs:${id}`, 3600); },
    acquireLease: async (id, token, seconds) =>
        (await publisher.set(`deployment-lock:${id}`, token, { NX: true, EX: seconds })) === 'OK',
    renewLease: async (id, token, seconds) => (await publisher.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [`deployment-lock:${id}`], arguments: [token, String(seconds)] },
    )) === 1,
    releaseLease: async (id, token) => {
        await publisher.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            { keys: [`deployment-lock:${id}`], arguments: [token] },
        );
    },
};

async function runBuild(id: string): Promise<void> {
    const log = (message: string) => store.addLog(id, message);
    if (buildBackend === 'fargate') {
        await buildOnFargate(id, publisher, log);
        return;
    }
    await buildDeployment(id, log);
}

async function pollQueue(
    url: string,
    label: string,
    visibilityTimeout: number,
    handleMessage: (message: Message) => Promise<void>,
): Promise<void> {
    while (true) {
        try {
            const response = await sqs.send(new ReceiveMessageCommand({
                QueueUrl: url,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 20,
                VisibilityTimeout: visibilityTimeout,
                MessageSystemAttributeNames: ['ApproximateReceiveCount'],
            }));
            const message = response.Messages?.[0];
            if (message) await handleMessage(message);
        } catch (error) {
            console.error(`SQS ${label} worker error; retrying in 5 seconds`, error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function main(): Promise<void> {
    await publisher.connect();
    // Discover both the retry limit and the target queue from the same policy.
    const attributes = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['RedrivePolicy'],
    }));
    const rawPolicy = attributes.Attributes?.RedrivePolicy;
    const policy = rawPolicy ? JSON.parse(rawPolicy) : {};
    const maxReceives = Number(policy.maxReceiveCount);
    const [, , service, , account, name] = String(policy.deadLetterTargetArn ?? '').split(':');
    if (!Number.isInteger(maxReceives) || maxReceives < 1 || service !== 'sqs' || !account || !name) {
        throw new Error('Configure an SQS dead-letter queue and redrive policy before starting the worker');
    }
    const { QueueUrl: deadLetterUrl } = await sqs.send(new GetQueueUrlCommand({
        QueueName: name,
        QueueOwnerAWSAccountId: account,
    }));
    if (!deadLetterUrl) throw new Error('Could not resolve the dead-letter queue URL');

    console.log(`Worker listening on the SQS build and dead-letter queues (max receives: ${maxReceives})`);
    await Promise.all([
        pollQueue(queueUrl, 'build', VISIBILITY_SECONDS,
            message => processMessage(message, { sqs, queueUrl, maxReceives, store, runBuild })),
        pollQueue(deadLetterUrl, 'dead-letter', 30,
            message => reconcileDeadLetter(message, deadLetterUrl, sqs, publisher)),
    ]);
}

main().catch(async error => {
    console.error('Worker startup failed:', error);
    if (publisher.isOpen) await publisher.quit().catch(console.error);
    process.exitCode = 1;
});
