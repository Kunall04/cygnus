import 'dotenv/config';
import { GetObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import express from 'express';
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

const app = express();

app.get("*", async (req, res) => {
    const host = req.hostname;

    const id = host.split(".")[0];
    const filePath = req.path === "/"
        ? "/index.html"
        : req.path;

    try {
        const { Body } = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: `dist/${id}${filePath}`,
        }));
        if (!(Body instanceof Readable)) throw new Error('Storage returned no object stream');
        
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: { [key: string]: string } = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".json": "application/json",
            ".txt": "text/plain"
        };
        
        const type = mimeTypes[ext] || "application/octet-stream";
        res.set("Content-Type", type);

        await pipeline(Body, res);
    } catch (err) {
        if (err instanceof S3ServiceException && err.name === 'NoSuchKey') {
            res.status(404).send("Not Found");
        } else {
            console.error(`Error fetching file dist/${id}${filePath}:`, err);
            if (res.headersSent || res.destroyed) res.destroy();
            else res.status(500).send("Internal Server Error");
        }
    }
})

app.listen(3001);