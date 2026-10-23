export type AccountingConnection = {id:string;realm_id:string;status:string;access_token_ciphertext:string|null;refresh_token_ciphertext:string|null;expires_at:string|null;income_account_id:string|null;item_id:string|null;reason:string|null;refresh_started_at:string|null};
export class AccountingFailure extends Error { constructor(readonly code:string, readonly status=503){super(code);} }
