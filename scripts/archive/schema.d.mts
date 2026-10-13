export function schemaModel(): Promise<{ db: { close(): void }; migrations: {file: string; sha256: string}[]; catalog: {type: string; name: string; tbl_name: string; sql: string}[] }>;
