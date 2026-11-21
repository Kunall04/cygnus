// Run against a local SQS emulator, never a real AWS account.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand,
  SendMessageCommand, ReceiveMessageCommand, ChangeMessageVisibilityCommand, DeleteQueueCommand,
} = require('@aws-sdk/client-sqs');
const { processMessage } = require('../dist/job-processor');

const endpoint = process.env.SQS_TEST_ENDPOINT;
if (!endpoint || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(endpoint).hostname)) {
  throw new Error('Set SQS_TEST_ENDPOINT to a local SQS emulator, for example http://127.0.0.1:5017');
}
const sqs = new SQSClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });

function memoryStore() {
  const statuses = new Map(), logs = new Map(), leases = new Map();
  return {
    statuses, logs,
    async getStatus(id) { return statuses.get(id) ?? null; },
    async setStatus(id, status) { statuses.set(id, status); },
    async addLog(id, message) { logs.set(id, [...(logs.get(id) ?? []), message]); },
    async expireLogs() {},
    async acquireLease(id, token) { if (leases.has(id)) return false; leases.set(id, token); return true; },
    async renewLease(id, token) { return leases.get(id) === token; },
    async releaseLease(id, token) { if (leases.get(id) === token) leases.delete(id); },
  };
}
async function queues() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dlq = (await sqs.send(new CreateQueueCommand({ QueueName: `cygnus-dlq-${suffix}` }))).QueueUrl;
  const arn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ['QueueArn'] }))).Attributes.QueueArn;
  const queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: `cygnus-test-${suffix}` }))).QueueUrl;
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: '2' }) } }));
  return { queueUrl, dlq };
}
async function receive(url) {
  return (await sqs.send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 1, VisibilityTimeout: 10, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }))).Messages?.[0];
}
async function send(url, id) { await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: id })); }
async function retryNow(url, message) { await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 0 })); }
async function removeQueues({ queueUrl, dlq }) {
  await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
  await sqs.send(new DeleteQueueCommand({ QueueUrl: dlq }));
}

test('successful jobs are acknowledged and already completed deliveries do not rebuild', async () => {
  const q = await queues();
  try {
    const store = memoryStore(); let builds = 0;
    const options = { sqs, queueUrl: q.queueUrl, maxReceives: 2, store, runBuild: async () => { builds++; } };
    await send(q.queueUrl, 'abc12');
    await processMessage(await receive(q.queueUrl), options);
    assert.equal(store.statuses.get('abc12'), 'deployed');
    assert.equal(await receive(q.queueUrl), undefined, 'acknowledgement removes the message');
    await send(q.queueUrl, 'abc12');
    await processMessage(await receive(q.queueUrl), options);
    assert.equal(builds, 1, 'redelivery of a completed deployment does not build again');
    assert.equal(await receive(q.queueUrl), undefined);
  } finally { await removeQueues(q); }
});

test('failed job is retried and acknowledged only after a later success', async () => {
  const q = await queues();
  try {
    const store = memoryStore(); let builds = 0;
    const options = { sqs, queueUrl: q.queueUrl, maxReceives: 2, store, runBuild: async () => { if (++builds === 1) throw new Error('temporary failure'); } };
    await send(q.queueUrl, 'abc12');
    const first = await receive(q.queueUrl);
    await processMessage(first, options);
    assert.equal(store.statuses.get('abc12'), 'retrying');
    await retryNow(q.queueUrl, first);
    const second = await receive(q.queueUrl);
    assert.equal(second.Attributes.ApproximateReceiveCount, '2');
    await processMessage(second, options);
    assert.equal(store.statuses.get('abc12'), 'deployed');
    assert.equal(builds, 2);
    assert.equal(await receive(q.queueUrl), undefined);
  } finally { await removeQueues(q); }
});

test('repeated failure marks deployment failed and moves the unacknowledged job to the DLQ', async () => {
  const q = await queues();
  try {
    const store = memoryStore();
    const options = { sqs, queueUrl: q.queueUrl, maxReceives: 2, store, runBuild: async () => { throw new Error('build failed'); } };
    await send(q.queueUrl, 'xyz34');
    const first = await receive(q.queueUrl);
    await processMessage(first, options);
    await retryNow(q.queueUrl, first);
    const second = await receive(q.queueUrl);
    await processMessage(second, options);
    assert.equal(store.statuses.get('xyz34'), 'failed');
    await retryNow(q.queueUrl, second);
    assert.equal(await receive(q.queueUrl), undefined);
    const dead = await receive(q.dlq);
    assert.equal(dead?.Body, 'xyz34');
  } finally { await removeQueues(q); }
});


test('a worker crash before acknowledgement makes the message visible again', async () => {
  const q = await queues();
  try {
    await send(q.queueUrl, 'crash');
    const first = (await sqs.send(new ReceiveMessageCommand({ QueueUrl: q.queueUrl, VisibilityTimeout: 1, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }))).Messages[0];
    assert.equal(first.Attributes.ApproximateReceiveCount, '1');
    // Simulate the worker disappearing: no processMessage and no DeleteMessage.
    await new Promise(resolve => setTimeout(resolve, 1300));
    const second = await receive(q.queueUrl);
    assert.equal(second.Body, 'crash');
    assert.equal(second.Attributes.ApproximateReceiveCount, '2');
  } finally { await removeQueues(q); }
});

test('heartbeat extends visibility while a long build is still running', async () => {
  const q = await queues();
  try {
    const store = memoryStore();
    let finishBuild;
    const building = new Promise(resolve => { finishBuild = resolve; });
    await send(q.queueUrl, 'long1');
    const message = (await sqs.send(new ReceiveMessageCommand({ QueueUrl: q.queueUrl, VisibilityTimeout: 1, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }))).Messages[0];
    const processing = processMessage(message, { sqs, queueUrl: q.queueUrl, maxReceives: 2, store, heartbeatMs: 200, runBuild: async () => building });
    try {
      await new Promise(resolve => setTimeout(resolve, 1400));
      assert.equal(await receive(q.queueUrl), undefined, 'heartbeat keeps the in-progress job hidden');
    } finally { finishBuild(); await processing; }
    assert.equal(store.statuses.get('long1'), 'deployed');
  } finally { await removeQueues(q); }
});

const redisUrl = process.env.SQS_TEST_REDIS_URL;

test('the running worker reconciles a crash on the final receive and preserves deployed status', {
  skip: !redisUrl && 'Set SQS_TEST_REDIS_URL to run the worker and Redis regression',
  timeout: 35_000,
}, async () => {
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(redisUrl).hostname));
  const { createClient } = require('redis');
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const { randomInt } = require('node:crypto');
  const { join } = require('node:path');
  const redis = createClient({ url: redisUrl });
  const q = await queues();
  const id = randomInt(11111, 99999).toString().replaceAll('0', 'a');
  const deployedId = `a${id.slice(1)}`;
  let worker;
  let workerOutput = '';
  let crashMessage;
  let deployedMessage;
  await redis.connect();

  try {
    await send(q.queueUrl, id);
    const first = await receive(q.queueUrl);
    await retryNow(q.queueUrl, first);
    crashMessage = (await sqs.send(new ReceiveMessageCommand({
      QueueUrl: q.queueUrl,
      VisibilityTimeout: 1,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }))).Messages[0];
    assert.equal(crashMessage.Attributes.ApproximateReceiveCount, '2');
    // Simulate a crash after setting status but before acknowledging this delivery.
    await redis.hSet('status', id, 'building');
    await redis.hSet('status', deployedId, 'deployed');
    deployedMessage = await sqs.send(new SendMessageCommand({ QueueUrl: q.dlq, MessageBody: deployedId }));

    worker = spawn(process.execPath, [join(__dirname, '../dist/index.js')], {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_PROFILE: '',
        AWS_REGION: 'us-east-1',
        SQS_ENDPOINT: endpoint,
        SQS_QUEUE_URL: q.queueUrl,
        REDIS_URL: redisUrl,
        ACCESS: 'test',
        SECRET: 'test',
        ENDPOINT: endpoint,
        BUCKET: 'cygnus-test',
      },
    });
    for (const stream of [worker.stdout, worker.stderr]) {
      stream.on('data', chunk => { workerOutput += chunk.toString(); });
    }
    const deadline = Date.now() + 25_000;
    let records;
    do {
      records = await redis.mGet([
        `dead-letter:${crashMessage.MessageId}`,
        `dead-letter:${deployedMessage.MessageId}`,
      ]);
      if (records.every(Boolean) || worker.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);

    assert.equal(await redis.hGet('status', id), 'failed', workerOutput);
    assert.equal(await redis.hGet('status', deployedId), 'deployed');
    assert.equal(JSON.parse(records[0]).body, id);
    assert.equal(JSON.parse(records[1]).body, deployedId);
    assert.match((await redis.lRange(`logs:${id}`, 0, -1)).at(-1), /final delivery went unacknowledged/);
    assert.deepEqual(await redis.lRange(`logs:${deployedId}`, 0, -1), []);

    const ackDeadline = Date.now() + 3000;
    let queued;
    do {
      const { Attributes } = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: q.dlq,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }));
      queued = Number(Attributes.ApproximateNumberOfMessages) +
        Number(Attributes.ApproximateNumberOfMessagesNotVisible);
      if (queued === 0) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < ackDeadline);
    assert.equal(queued, 0, 'both DLQ deliveries were acknowledged');
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const exited = once(worker, 'exit');
      worker.kill();
      await exited;
    }
    await redis.hDel('status', [id, deployedId]);
    await redis.del([
      `logs:${id}`,
      `dead-letter:${crashMessage?.MessageId}`,
      `dead-letter:${deployedMessage?.MessageId}`,
    ]);
    await redis.close();
    await removeQueues(q);
  }
});
