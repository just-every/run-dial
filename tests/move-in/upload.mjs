// Native HTTP client custody mirrors the UI: upload identity stays in memory,
// outside downloadable reports, and is supplied unchanged with the review.
export function savedUploader(api, instant) {
  const reviews = new Map();
  return async (action, files, options = {}) => {
    const review = action === 'apply' ? reviews.get(options.fingerprint) : undefined;
    const body = new FormData();
    for (const file of files) body.append('files', new Blob([file.bytes], { type: 'application/json' }), file.name);
    body.set('options', JSON.stringify({ choices: {}, asOf: review?.asOf ?? instant,
      ...(review ? { uploadIdentity: review.identity } : {}), ...options }));
    const response = await api(`/api/app/move-in/${action}`, { method: 'POST', body });
    if (action === 'preview' && response.ok) {
      const result = await response.clone().json();
      reviews.set(result.report.fingerprint, { identity: result.uploadIdentity, asOf: result.report.asOf });
    }
    return response;
  };
}
