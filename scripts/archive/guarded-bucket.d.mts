export function guardedBucket(bucket: R2Bucket, knownSecrets: string[], onRefusal?: (code: string) => void): R2Bucket;
