import 'dotenv/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';

const bucket = process.env.BUCKET;
if (!bucket) throw new Error('BUCKET is required');

const endpoint = process.env.ENDPOINT;
const accessKeyId = process.env.ACCESS;
const secretAccessKey = process.env.SECRET;
if (endpoint && (!accessKeyId || !secretAccessKey)) {
    throw new Error('ACCESS and SECRET are required with a custom ENDPOINT');
}

const s3 = new S3Client({
    region: process.env.S3_REGION ?? (endpoint ? 'auto' : process.env.AWS_REGION ?? 'us-east-1'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    // AWS S3 uses the SDK's default credential chain. R2 uses its own keys.
    ...(endpoint && accessKeyId && secretAccessKey
        ? { endpoint, credentials: { accessKeyId, secretAccessKey } }
        : {}),
});

export async function uploadFile(fileName: string, localFilePath: string): Promise<void> {
    await s3.send(new PutObjectCommand({
        Body: await readFile(localFilePath),
        Bucket: bucket,
        Key: fileName.replace(/\\/g, '/'),
    }));
}
