export function guardedBucket(bucket: R2Bucket, knownSecrets: string[], onRefusal?: (code: "archive-object-changed" | "archive-object-contains-credential") => void): R2Bucket;
