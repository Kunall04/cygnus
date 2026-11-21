import fs from 'node:fs';
import path from 'node:path';
import { copyFinalDist, copyStaticFiles, downloadS3Folder } from './aws';
import { buildProject, isDeploymentId } from './utils';

export async function buildDeployment(
    id: string | undefined,
    log: (message: string) => void | Promise<void>,
): Promise<void> {
    if (!isDeploymentId(id)) throw new Error('A valid deployment ID is required');

    const projectDir = path.join(__dirname, 'output', id);
    await log('✦ Downloading source code from storage...');
    // Each attempt starts with a clean project directory.
    await fs.promises.rm(projectDir, { recursive: true, force: true });
    await downloadS3Folder(`output/${id}/`);
    await log('✦ Source code downloaded.');

    if (fs.existsSync(path.join(projectDir, 'package.json'))) {
        await log('✦ Starting build pipeline (npm install & build)...');
        await buildProject(id, line => { void Promise.resolve(log(line)).catch(console.error); });
        await log('✦ Build completed successfully. Uploading artifacts...');
        await copyFinalDist(id);
    } else {
        await log('✦ No package.json found. Deploying as a static site...');
        await copyStaticFiles(id);
    }
}
