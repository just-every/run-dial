// The published 0.2.2 client deliberately discards response bodies. Recognize
// only its fixed vocabulary; never echo arbitrary exceptions or paths.
import { PortabilityError } from '@runeditrun/rer/modules/portability';
const archiveCodes = new Set(['archive_schema_mismatch', 'archive_export_refused', 'archive-migration-history-mismatch', 'archive-owner-salt-required', 'archive-erasure-incomplete', 'archive-unclassified-schema', 'archive-object-changed', 'archive-object-contains-credential', 'archive_maintenance', 'archive_writer_admissions_present']);
const formatCodes = new Set(['archive_json', 'archive_format', 'legacy_archive_unverifiable', 'part_order', 'part_byte_limit', 'part_checksum', 'part_row_limit', 'manifest_identity', 'manifest_counts', 'manifest_inventory', 'schema_checksum', 'table_inventory', 'binary_inventory', 'row_order', 'rowid_inventory', 'rows_missing', 'binary_order', 'binary_size', 'binary_checksum', 'archive_incomplete', 'data_after_closing', 'part_count', 'content_checksum', 'archive_checksum', 'extra_part', 'closing_missing', 'row_columns', 'row_not_null', 'row_type', 'unsafe_integer']);
const transportCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);
export function remoteExportDiagnostic(error) {
 const message = error instanceof Error ? error.message : '';
 const status = /^The transfer was refused \(HTTP ([4-5][0-9]{2})\)\.$/.exec(message);
 if (status) return { reason: 'hosted-http-refused', httpStatus: Number(status[1]) };
 if (message === 'The transfer request failed.') return { reason: 'hosted-transport-failed' };
 if (message === 'The export is not complete.') return { reason: 'hosted-archive-incomplete' };
 const archiveCause = error instanceof PortabilityError ? error.code.split(':')[0] : message === 'archive_json' ? message : undefined;
 if (formatCodes.has(archiveCause)) return { reason: 'hosted-archive-invalid', archiveCause };
 if (message === 'remote-credentials-required' || message === 'private-session-file-required') return { reason: message };
 return { reason: 'hosted-export-refused' };
}

// This adapter runs only in its dedicated CLI child. Observe the published
// client's request once, preserving its HTTP/auth/archive protocol, and restore
// fetch before cleanup. Never make a diagnostic request or retain response text.
export async function observeRemoteExport(operation) {
 const original = globalThis.fetch;
 let diagnostic;
 globalThis.fetch = async (...args) => {
  let response;
  try { response = await original(...args); }
  catch (error) {
   const code = [error?.cause?.code, error?.code].find(value => transportCodes.has(value));
   diagnostic = { reason: 'hosted-transport-failed', ...(code ? { transport: code } : {}) };
   throw error;
  }
  if (!response.ok) {
   const archiveCause = response.headers.get('X-Dial-Archive-Error');
   diagnostic = { reason: 'hosted-http-refused', httpStatus: response.status, ...(archiveCodes.has(archiveCause) ? { archiveCause } : {}) };
  }
  return response;
 };
 try { return await operation(); }
 catch (error) { throw Object.assign(new Error('hosted-export-failed'), { diagnostic: diagnostic ?? remoteExportDiagnostic(error) }); }
 finally { globalThis.fetch = original; }
}

export function remoteExportFailure(receipt) {
 const reasons = new Set(['hosted-http-refused', 'hosted-transport-failed', 'hosted-archive-incomplete', 'hosted-archive-invalid', 'remote-credentials-required', 'private-session-file-required']);
 const reason = reasons.has(receipt?.reason) ? receipt.reason : 'hosted-export-refused';
 const status = reason === 'hosted-http-refused' && Number.isInteger(receipt.httpStatus) && receipt.httpStatus >= 400 && receipt.httpStatus <= 599 ? `; HTTP ${receipt.httpStatus}` : '';
 const cause = (reason === 'hosted-http-refused' && archiveCodes.has(receipt.archiveCause) || reason === 'hosted-archive-invalid' && formatCodes.has(receipt.archiveCause)) ? `; ${receipt.archiveCause}` : reason === 'hosted-transport-failed' && transportCodes.has(receipt.transport) ? `; ${receipt.transport}` : '';
 const action = reason === 'hosted-transport-failed' ? 'Check network connectivity and the HTTPS origin.'
  : reason === 'hosted-archive-invalid' ? 'The downloaded archive failed verification; do not restore its partial output.'
  : receipt?.archiveCause === 'archive_writer_admissions_present' ? 'Writer admissions remain; inspect Settings export status. Their liveness is unknown; do not delete them.'
  : receipt?.archiveCause === 'archive_maintenance' ? 'An export holds maintenance or its lease is no longer usable; inspect owner export status.'
  : receipt?.httpStatus === 401 ? 'Sign in as the native owner and replace the private session file.'
  : receipt?.httpStatus === 403 ? 'Check the configured application origin.'
  : receipt?.httpStatus === 409 ? 'Check source archive schema, migration history, and incomplete erasure operations.'
  : 'Check source availability and owner export status.';
 return `Dial hosted export failed (${reason}${status}${cause}). ${action}`;
}
