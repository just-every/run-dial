import https from 'node:https';
import { Readable } from 'node:stream';

// fetch normalizes dot segments, even percent-encoded ones. Object keys are
// opaque: send the validated account path verbatim through Node's HTTP client.
// This transport never follows redirects and never selects another origin.
export function deleteR2Object(path, {headers, signal}) {
  return new Promise((resolve, reject) => {
    const request = https.request({hostname:'api.cloudflare.com', port:443, path, method:'DELETE', headers, signal}, response => {
      try {
        const empty = [204,205,304].includes(response.statusCode);
        if (empty) response.resume();
        resolve(new Response(empty ? null : Readable.toWeb(response), {status:response.statusCode, headers:response.headers}));
      } catch (error) { response.destroy(); reject(error); }
    });
    request.on('error', reject);
    request.end();
  });
}
