declare module "virtual:dial-archive-schema" {
 const schema: { migrations: { file: string; sha256: string }[]; catalog: { type: string; name: string; tbl_name: string; sql: string }[] };
 export default schema;
}
