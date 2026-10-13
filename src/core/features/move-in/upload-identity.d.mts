export interface UploadBinding { owner: string; session: string; source: string; asOf: string; generation: number; bookingCount: number }
export interface VerifiedUpload { identity: string; nonces: string[] }
export function issueUploadIdentity(secret: string, binding: UploadBinding): Promise<VerifiedUpload>;
export function verifyUploadIdentity(identity: string, secret: string, binding: UploadBinding): Promise<VerifiedUpload>;
