import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const queueUrl = process.env.SQS_QUEUE_URL;
if (!queueUrl) throw new Error("SQS_QUEUE_URL is required");

// AWS's default credential chain is separate from the R2 ACCESS/SECRET keys.
const sqs = new SQSClient({
    region: process.env.AWS_REGION || "us-east-1",
    ...(process.env.SQS_ENDPOINT ? { endpoint: process.env.SQS_ENDPOINT } : {}),
});

export async function enqueueDeployment(id: string): Promise<void> {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: id }));
}
