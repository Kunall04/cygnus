import { ClientException, DescribeTasksCommand, ECSClient, RunTaskCommand, waitUntilTasksStopped } from '@aws-sdk/client-ecs';
import { setTimeout as delay } from 'node:timers/promises';

const ecs = new ECSClient({});

export class FargateBuildFailedError extends Error {}

export async function startFargateBuild(
    deploymentId: string,
    run?: { taskRoleArn: string; clientToken: string },
): Promise<string> {
    const cluster = process.env.ECS_CLUSTER;
    const taskDefinition = process.env.ECS_TASK_DEFINITION;
    const securityGroup = process.env.ECS_SECURITY_GROUP;
    const subnet = process.env.ECS_SUBNET_ID;

    if (!cluster || !taskDefinition || !securityGroup || !subnet) {
        throw new Error('Missing ECS configuration in .env');
    }

    const request = new RunTaskCommand({
        cluster,
        taskDefinition,
        launchType: 'FARGATE',
        count: 1,
        startedBy: `cygnus-${deploymentId}`,
        ...(run && { clientToken: run.clientToken }),
        overrides: {
            ...(run && { taskRoleArn: run.taskRoleArn }),
            containerOverrides: [
                { name: 'runner', command: [deploymentId] },
            ],
        },
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: [subnet],
                securityGroups: [securityGroup],
                assignPublicIp: 'ENABLED',
            },
        },
    });

    for (let retries = 0; ; retries++) {
        try {
            const result = await ecs.send(request);
            const taskArn = result.tasks?.[0]?.taskArn;
            if (result.failures?.length || !taskArn) {
                throw new Error(`ECS could not start the task: ${JSON.stringify(result.failures)}`);
            }
            return taskArn;
        } catch (error) {
            // ECS can take a few seconds to see a newly created IAM role.
            if (!run || retries >= 8 || !(error instanceof ClientException)
                || !/unable to assume|role.*not (?:valid|found)/i.test(error.message)) throw error;
            await delay(5000);
        }
    }
}

export async function waitForFargateBuild(taskId: string): Promise<void> {
    const cluster = process.env.ECS_CLUSTER;
    if (!cluster) throw new Error('ECS_CLUSTER is required');

    const request = { cluster, tasks: [taskId] };

    await waitUntilTasksStopped({ client: ecs, maxWaitTime: 420 }, request);

    const result = await ecs.send(new DescribeTasksCommand(request));
    const task = result.tasks?.[0];
    if (result.failures?.length || task?.lastStatus !== 'STOPPED') {
        throw new Error(`Could not confirm completion of Fargate task ${taskId}`);
    }

    const runner = task.containers?.find(container => container.name === 'runner');
    if (runner?.exitCode !== 0) {
        const reason = runner?.reason ?? task.stoppedReason ?? 'No exit code returned';
        throw new FargateBuildFailedError(`Fargate build failed (exit ${runner?.exitCode ?? 'unknown'}): ${reason}`);
    }
}
