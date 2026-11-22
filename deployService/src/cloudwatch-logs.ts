import { CloudWatchLogsClient, GetLogEventsCommand, ResourceNotFoundException } from '@aws-sdk/client-cloudwatch-logs';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import type { createClient } from 'redis';

type LogStore = Pick<ReturnType<typeof createClient>, 'get' | 'eval'>;

const cloudwatch = new CloudWatchLogsClient({ maxAttempts: 2 });
const pollIntervalMs = 2000;
const finalReadWindowMs = 6000;

// Save the cursor with the log page so a retried worker does not replay it.
const appendLogPage = `
    if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
    if #ARGV > 2 then
        redis.call('RPUSH', KEYS[2], unpack(ARGV, 3))
    end
    redis.call('SET', KEYS[1], ARGV[2], 'EX', 86400)
    return 1
`;

export async function forwardFargateLogs(
    id: string,
    taskArn: string,
    logGroupName: string,
    redis: LogStore,
    buildFinished: AbortSignal,
): Promise<void> {
    const taskId = taskArn.split('/').at(-1);
    const logStreamName = `build/runner/${taskId}`;
    const cursorKey = `fargate-log-cursor:${taskId}`;
    let deadline = buildFinished.aborted ? performance.now() + finalReadWindowMs : Infinity;
    buildFinished.addEventListener('abort', () => {
        deadline = performance.now() + finalReadWindowMs;
    }, { once: true });
    let consecutiveErrors = 0;

    while (performance.now() < deadline) {
        try {
            const cursor = await redis.get(cursorKey);
            const timeoutMs = Math.max(1, Math.floor(Math.min(4000, deadline - performance.now())));
            const { events, nextForwardToken } = await cloudwatch.send(new GetLogEventsCommand({
                logGroupName,
                logStreamName,
                startFromHead: true,
                nextToken: cursor ?? undefined,
                limit: 200,
            }), { abortSignal: AbortSignal.timeout(timeoutMs) });
            if (nextForwardToken && nextForwardToken !== cursor) {
                // The runner writes both raw npm chunks and formatted lines. Mirror the formatted lines once.
                const messages = (events ?? [])
                    .map(event => stripVTControlCharacters(event.message ?? ''))
                    .filter(message => /^(?:\[(?:install|build)(?:-err)?\] |✦ |Build (?:artifacts uploaded\.|failed:))/.test(message));
                await redis.eval(appendLogPage, {
                    keys: [cursorKey, `logs:${id}`],
                    arguments: [cursor ?? '', nextForwardToken, ...messages],
                });
                consecutiveErrors = 0;
                // A changed token can lead to more messages even when this page was empty.
                continue;
            }
            consecutiveErrors = 0;
        } catch (error) {
            if (!(error instanceof ResourceNotFoundException)) {
                if (error instanceof Error && /AccessDenied|InvalidParameter/.test(error.name)) throw error;
                if (++consecutiveErrors >= 3) throw error;
            }
        }
        // CloudWatch can create the stream after RunTask returns, and ingest the last lines after STOPPED.
        const remainingMs = deadline - performance.now();
        if (remainingMs > 0) await delay(Math.min(pollIntervalMs, remainingMs));
    }
}
