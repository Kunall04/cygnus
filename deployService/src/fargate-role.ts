import {
    CreateRoleCommand,
    DeleteRoleCommand,
    DeleteRolePolicyCommand,
    EntityAlreadyExistsException,
    GetRoleCommand,
    IAMClient,
    NoSuchEntityException,
    PutRolePolicyCommand,
    type Role,
} from '@aws-sdk/client-iam';

const iam = new IAMClient({});
const rolePath = '/cygnus-builds/';
const policyName = 'DeploymentFiles';

function roleName(id: string, token: string): string {
    return `cygnus-${id}-${token}`;
}

function verifyRole(role: Role | undefined, id: string, token: string): Role {
    const tags = role?.Tags;
    if (!role || role.Path !== rolePath
        || !tags?.some(tag => tag.Key === 'CygnusDeployment' && tag.Value === id)
        || !tags.some(tag => tag.Key === 'CygnusRun' && tag.Value === token)) {
        throw new Error(`Could not verify ownership of the Fargate role for ${id}`);
    }
    return role;
}

export async function prepareBuildRole(id: string, token: string): Promise<string> {
    const [, partition, region, account] = process.env.ECS_TASK_DEFINITION?.match(
        /^arn:([^:]+):ecs:([^:]+):(\d{12}):task-definition\//,
    ) ?? [];
    const bucket = process.env.BUCKET;
    if (!partition || !region || !account || !bucket) {
        throw new Error('Fargate builds require an ECS task definition ARN and an S3 bucket');
    }

    const RoleName = roleName(id, token);
    let role: Role | undefined;
    try {
        const result = await iam.send(new CreateRoleCommand({
            RoleName,
            Path: rolePath,
            Tags: [
                { Key: 'CygnusDeployment', Value: id },
                { Key: 'CygnusRun', Value: token },
            ],
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                    Action: 'sts:AssumeRole',
                    Condition: {
                        ArnLike: { 'aws:SourceArn': `arn:${partition}:ecs:${region}:${account}:*` },
                        StringEquals: { 'aws:SourceAccount': account },
                    },
                }],
            }),
        }));
        role = result.Role;
    } catch (error) {
        if (!(error instanceof EntityAlreadyExistsException)) throw error;
        role = (await iam.send(new GetRoleCommand({ RoleName }))).Role;
    }
    const roleArn = verifyRole(role, id, token).Arn;
    if (!roleArn) throw new Error(`IAM returned no ARN for ${RoleName}`);

    const bucketArn = `arn:${partition}:s3:::${bucket}`;
    const source = `output/${id}/`;
    await iam.send(new PutRolePolicyCommand({
        RoleName,
        PolicyName: policyName,
        PolicyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Action: 's3:ListBucket',
                    Resource: bucketArn,
                    Condition: { StringEquals: { 's3:prefix': source } },
                },
                { Effect: 'Allow', Action: 's3:GetObject', Resource: `${bucketArn}/${source}*` },
                { Effect: 'Allow', Action: 's3:PutObject', Resource: `${bucketArn}/dist/${id}/*` },
            ],
        }),
    }));
    return roleArn;
}

export async function removeBuildRole(id: string, token: string): Promise<void> {
    const RoleName = roleName(id, token);
    try {
        const { Role } = await iam.send(new GetRoleCommand({ RoleName }));
        verifyRole(Role, id, token);
    } catch (error) {
        if (error instanceof NoSuchEntityException) return;
        throw error;
    }
    try {
        await iam.send(new DeleteRolePolicyCommand({ RoleName, PolicyName: policyName }));
    } catch (error) {
        if (!(error instanceof NoSuchEntityException)) throw error;
    }
    try {
        await iam.send(new DeleteRoleCommand({ RoleName }));
    } catch (error) {
        if (!(error instanceof NoSuchEntityException)) throw error;
    }
}
