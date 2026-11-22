const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudWatchLogsClient, ResourceNotFoundException } = require('@aws-sdk/client-cloudwatch-logs');
const { forwardFargateLogs } = require('../dist/cloudwatch-logs');
const { buildOnFargate } = require('../dist/fargate-build');
const fargate = require('../dist/fargate');
const roles = require('../dist/fargate-role');

const taskArn = 'arn:aws:ecs:us-east-1:123456789012:task/cluster/task-id';

test('resumes a CloudWatch stream, follows empty pages, and collects late output', { timeout: 15000 }, async t => {
    const buildFinished = new AbortController();
    const messages = ['[build] already displayed'];
    let cursor = 'resume';
    const tokens = [];
    const redis = {
        async get(key) {
            assert.equal(key, 'fargate-log-cursor:task-id');
            return cursor;
        },
        async eval(_script, { keys, arguments: [previous, next, ...page] }) {
            assert.deepEqual(keys, ['fargate-log-cursor:task-id', 'logs:abc12']);
            assert.equal(previous, cursor);
            cursor = next;
            messages.push(...page);
            return 1;
        },
    };
    t.mock.method(CloudWatchLogsClient.prototype, 'send', async ({ input }) => {
        assert.equal(input.logGroupName, 'cygnus-builds');
        assert.equal(input.logStreamName, 'build/runner/task-id');
        assert.equal(input.startFromHead, true);
        tokens.push(input.nextToken);
        if (tokens.length === 1) {
            throw new ResourceNotFoundException({ message: 'The stream is not ready', $metadata: {} });
        }
        if (input.nextToken === 'resume') return { events: [], nextForwardToken: 'empty-page' };
        if (input.nextToken === 'empty-page') {
            return {
                events: [
                    { message: 'npm run build stdout: vite compiling' },
                    { message: '\u001b[32m[build] vite compiling\u001b[0m' },
                ],
                nextForwardToken: 'caught-up',
            };
        }
        if (!buildFinished.signal.aborted) {
            buildFinished.abort();
            return { events: [], nextForwardToken: 'caught-up' };
        }
        if (input.nextToken === 'caught-up') {
            return { events: [{ message: '[build] final line' }], nextForwardToken: 'finished' };
        }
        return { events: [], nextForwardToken: 'finished' };
    });

    await forwardFargateLogs('abc12', taskArn, 'cygnus-builds', redis, buildFinished.signal);

    assert.deepEqual(tokens.slice(0, 5), ['resume', 'resume', 'empty-page', 'caught-up', 'caught-up']);
    assert.deepEqual(messages, ['[build] already displayed', '[build] vite compiling', '[build] final line']);
    assert.equal(cursor, 'finished');
});

test('CloudWatch permission failure does not fail a successful build', async t => {
    const originalGroup = process.env.ECS_LOG_GROUP;
    process.env.ECS_LOG_GROUP = 'cygnus-builds';
    t.after(() => {
        if (originalGroup === undefined) delete process.env.ECS_LOG_GROUP;
        else process.env.ECS_LOG_GROUP = originalGroup;
    });

    t.mock.method(console, 'warn', () => {});
    t.mock.method(CloudWatchLogsClient.prototype, 'send', async () => {
        const error = new Error('Missing logs:GetLogEvents');
        error.name = 'AccessDeniedException';
        throw error;
    });
    const wait = t.mock.method(fargate, 'waitForFargateBuild', async () => {});
    const cleanup = t.mock.method(roles, 'removeBuildRole', async () => {});
    const redis = {
        async get(key) {
            return key === 'fargate-run:abc12' ? JSON.stringify({ clientToken: 'token', taskArn }) : null;
        },
    };
    const messages = [];

    await buildOnFargate('abc12', redis, async message => { messages.push(message); });

    assert.equal(wait.mock.callCount(), 1);
    assert.equal(cleanup.mock.callCount(), 1);
    assert.match(messages[0], /Fargate task resumed/);
    assert.match(messages[1], /Build output is unavailable/);
});
