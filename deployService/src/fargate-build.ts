import { randomUUID } from 'node:crypto';
import type { createClient } from 'redis';
import { FargateBuildFailedError, startFargateBuild, waitForFargateBuild } from './fargate';
import { prepareBuildRole, removeBuildRole } from './fargate-role';

type BuildStateStore = Pick<ReturnType<typeof createClient>, 'get' | 'set' | 'eval'>;
type FargateRun = { clientToken: string; taskArn?: string };
const stateTtlSeconds = 24 * 3600;

export async function buildOnFargate(
    id: string,
    redis: BuildStateStore,
    log: (message: string) => Promise<void>,
): Promise<void> {
    const key = `fargate-run:${id}`;
    let saved = await redis.get(key);
    if (!saved) {
        // Persist before RunTask so a restarted worker can repeat the same launch request.
        const pending = JSON.stringify({ clientToken: randomUUID() });
        const set = await redis.set(key, pending, { NX: true, EX: stateTtlSeconds });
        saved = set === 'OK' ? pending : await redis.get(key);
        if (!saved) throw new Error(`Could not save Fargate launch state for ${id}`);
    }

    const { clientToken, taskArn: previousTask } = JSON.parse(saved) as FargateRun;
    let taskArn = previousTask;
    if (!taskArn) {
        const taskRoleArn = await prepareBuildRole(id, clientToken);
        taskArn = await startFargateBuild(id, { clientToken, taskRoleArn });
        const started = JSON.stringify({ clientToken, taskArn });
        const stored = await redis.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 end return 0",
            { keys: [key], arguments: [saved, started, String(stateTtlSeconds)] },
        );
        if (stored !== 1) throw new Error(`Fargate launch state changed while starting ${id}`);
        saved = started;
    }
    await log(`✦ Fargate task ${previousTask ? 'resumed' : 'started'}: ${taskArn.split('/').at(-1)}`);

    try {
        await waitForFargateBuild(taskArn);
    } catch (error) {
        // A confirmed failed task can be replaced. An uncertain result must resume the same task.
        if (error instanceof FargateBuildFailedError) {
            await cleanupRole(id, clientToken);
            await redis.eval(
                "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
                { keys: [key], arguments: [saved] },
            );
        }
        throw error;
    }
    await cleanupRole(id, clientToken);
}

async function cleanupRole(id: string, clientToken: string): Promise<void> {
    try {
        await removeBuildRole(id, clientToken);
    } catch (error) {
        console.error(`Could not remove the completed Fargate task role for ${id}`, error);
    }
}
