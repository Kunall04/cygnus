import 'dotenv/config';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

export async function downloadS3Folder(prefix: string) {
    const localRoot = path.resolve(__dirname, prefix) + path.sep;
    let continuationToken: string | undefined;
    let downloaded = 0;
    do {
        const page = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));
        await Promise.all((page.Contents ?? []).map(async ({ Key }) => {
            if (!Key || Key.endsWith('/')) return;
            const finalOutputPath = path.join(__dirname, Key);
            if (!finalOutputPath.startsWith(localRoot)) {
                throw new Error(`Source object is outside the deployment directory: ${Key}`);
            }
            await fs.promises.mkdir(path.dirname(finalOutputPath), { recursive: true });
            const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
            if (!(Body instanceof Readable)) throw new Error(`Missing object stream for ${Key}`);
            // pipeline rejects on read or write errors, so the SQS job can retry.
            await pipeline(Body, fs.createWriteStream(finalOutputPath));
            downloaded++;
        }));
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && !continuationToken) throw new Error("Missing storage continuation token");
    } while (continuationToken);
    if (downloaded === 0) throw new Error(`No source files found for ${prefix}`);
}

export async function copyFinalDist(id: string) {
    const folderPath = path.join(__dirname, `output/${id}/dist`);

    const allFiles = getAllFiles(folderPath);

    const uploadPromises = allFiles.map(async (file) => {
        const relativePath = path
            .relative(folderPath, file)
            .replace(/\\/g, "/");

        await uploadFile(
            `dist/${id}/${relativePath}`,
            file
        );
    });

    await Promise.all(uploadPromises);
}

export async function copyStaticFiles(id: string) {
    const folderPath = path.join(__dirname, `output/${id}`);

    const allFiles = getAllFiles(folderPath);

    const uploadPromises = allFiles.map(async (file) => {
        const relativePath = path
            .relative(folderPath, file)
            .replace(/\\/g, "/");

        await uploadFile(
            `dist/${id}/${relativePath}`,
            file
        );
    });

    await Promise.all(uploadPromises);
}

const getAllFiles = (folderPath: string) => {
    let response: string[] = [];

    const allFilesAndFolders = fs.readdirSync(folderPath);allFilesAndFolders.forEach(file => {
        const fullFilePath = path.join(folderPath, file);
        if (fs.statSync(fullFilePath).isDirectory()) {
            response = response.concat(getAllFiles(fullFilePath))
        } else {
            response.push(fullFilePath);
        }
    });
    return response;
}

async function uploadFile(fileName: string, localFilePath: string): Promise<void> {
    await s3.send(new PutObjectCommand({
        Body: await fs.promises.readFile(localFilePath),
        Bucket: bucket,
        Key: fileName,
    }));
}
