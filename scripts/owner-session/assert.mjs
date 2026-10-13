import {createHash} from 'node:crypto';
export function must(value,code){if(!value)throw new Error(code);}
export const hash=value=>createHash('sha256').update(value).digest('hex');
