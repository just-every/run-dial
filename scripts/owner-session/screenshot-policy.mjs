import {must} from './assert.mjs';

export function assertScreenshotSafe(url,text,origin) {
 const location=new URL(url);
 must(location.protocol==='https:'&&/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(location.hostname)&&location.origin===origin,'screenshot-origin-not-approved');
 must(['/auth/confirm','/app','/app/requests'].includes(location.pathname)||/^\/book\/[^/]+\/[^/]+(?:\/request)?$/.test(location.pathname),'screenshot-document-not-approved');
 must(!/https?:\/\/[^\s<>]*\/auth\/confirm\?[^\s<>]*token=|(?:^|\n)(?:MIME-Version:|Content-Type:\s*multipart\/)/i.test(text),'screenshot-sensitive-content');
 for(const name of ['token','nonce']) {const value=location.searchParams.get(name);if(value)must(!text.includes(value),'screenshot-sensitive-content');}
 return true;
}
