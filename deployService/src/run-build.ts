import { buildDeployment } from './build';

buildDeployment(process.argv[2], console.log).then(() => {
    console.log('Build artifacts uploaded.');
}).catch(error => {
    console.error('Build failed:', error);
    process.exitCode = 1;
});
