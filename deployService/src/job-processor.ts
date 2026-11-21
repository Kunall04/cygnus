import { randomUUID } from "crypto";
import {
    ChangeMessageVisibilityCommand,
    DeleteMessageCommand,
    Message,
    SQSClient,
} from "@aws-sdk/client-sqs";
import { isDeploymentId } from "./utils";

// The lease expires before SQS visibility, so after a crash another worker
// can acquire the lock by the time the message becomes visible again.
export const VISIBILITY_SECONDS = 120;
const LEASE_SECONDS = 80;
const HEARTBEAT_MS = 40_000;

export interface JobStore {
    getStatus(id: string): Promise<string | null>;
    setStatus(id: string, status: string): Promise<void>;
    addLog(id: string, message: string): Promise<void>;
    expireLogs(id: string): Promise<void>;
    acquireLease(id: string, token: string, seconds: number): Promise<boolean>;
    renewLease(id: string, token: string, seconds: number): Promise<boolean>;
    releaseLease(id: string, token: string): Promise<void>;
}

interface ProcessorOptions {
    sqs: SQSClient;
    queueUrl: string;
    maxReceives: number;
    store: JobStore;
    runBuild(id: string): Promise<void>;
    heartbeatMs?: number; // Shorter interval can be supplied by integration tests.
}

/** Process one SQS delivery. Failure deliberately leaves the message unacknowledged. */
export async function processMessage(message: Message, options: ProcessorOptions): Promise<void> {
    const { sqs, queueUrl, maxReceives, store, runBuild } = options;
    const id = message.Body;
    const receipt = message.ReceiptHandle;
    if (!isDeploymentId(id) || !receipt) {
        console.error("Invalid SQS job; leaving it for the dead-letter queue", message.MessageId);
        return;
    }
    const parsedAttempt = Number(message.Attributes?.ApproximateReceiveCount);
    const attempt = Number.isInteger(parsedAttempt) && parsedAttempt > 0 ? parsedAttempt : 1;
    const token = randomUUID();
    if (!await store.acquireLease(id, token, LEASE_SECONDS)) {
        console.log(`Deployment ${id} is already being processed; leaving message in SQS`);
        return;
    }

    let heartbeatFailure: unknown;
    let pendingHeartbeat = Promise.resolve();
    const timer = setInterval(() => {
        pendingHeartbeat = pendingHeartbeat.then(async () => {
            // Extend SQS first: if the worker crashes between these operations,
            // the Redis lease still expires before the message is visible again.
            await sqs.send(new ChangeMessageVisibilityCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: receipt,
                VisibilityTimeout: VISIBILITY_SECONDS,
            }));
            if (!await store.renewLease(id, token, LEASE_SECONDS)) {
                throw new Error("Lost deployment lease");
            }
        }).catch(error => {
            heartbeatFailure = error;
            console.error(`Could not extend visibility or lease for ${id}`, error);
        });
    }, options.heartbeatMs ?? HEARTBEAT_MS);

    try {
        // A prior worker may have completed the build but crashed before DeleteMessage.
        const status = await store.getStatus(id);
        if (status === "deployed") {
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt }));
            return;
        }
        // A DLQ reconciliation can finish before a duplicate reaches this worker.
        // Leave copies of failed jobs for the DLQ and retry from the UI with a new ID.
        if (status === "failed") return;

        try {
            await store.setStatus(id, "building");
            await store.addLog(id, `✦ Build attempt ${attempt} of ${maxReceives}`);
            await runBuild(id);
            clearInterval(timer);
            await pendingHeartbeat;
            if (heartbeatFailure) throw new Error("Lost job visibility or deployment lease during build");
            // Verify the lease before publishing success. It may have expired during a pause.
            if (!await store.renewLease(id, token, LEASE_SECONDS)) throw new Error("Lost deployment lease");
            await store.addLog(id, "✦ Artifacts uploaded. Deployment live!");
            await store.setStatus(id, "deployed");
            await store.expireLogs(id);
        } catch (error) {
            clearInterval(timer);
            await pendingHeartbeat;
            // Don't overwrite another worker's status if our lease was lost.
            if (await store.renewLease(id, token, LEASE_SECONDS)) {
                const detail = error instanceof Error ? error.message : String(error);
                const finalAttempt = attempt >= maxReceives;
                await store.addLog(id, `✖ Attempt ${attempt} failed: ${detail}`);
                await store.addLog(id, finalAttempt
                    ? "✖ Retry limit reached; SQS will move the message to the dead-letter queue."
                    : "✦ Leaving the message in SQS for another attempt.");
                await store.setStatus(id, finalAttempt ? "failed" : "retrying");
                if (finalAttempt) await store.expireLogs(id);
            }
            console.error(`Deployment ${id}, attempt ${attempt} failed`, error);
            return; // No DeleteMessage: SQS retries or moves it to the DLQ.
        }

        // This is the acknowledgement. It is deliberately after the entire build
        // and after Redis records success, and uses this delivery's receipt handle.
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt }));
        console.log(`Acknowledged SQS build job ${id}`);
    } finally {
        clearInterval(timer);
        await pendingHeartbeat;
        await store.releaseLease(id, token);
    }
}
