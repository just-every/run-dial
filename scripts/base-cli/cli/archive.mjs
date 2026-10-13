import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { diffArchives } from '../modules/portability/diff.mjs';
import { invalid } from './errors.mjs';
export async function archiveCommand(args,out) {
 if (args.length!==3 || args[0]!=='diff') throw invalid('Usage: rer archive diff BEFORE AFTER');
 const result=await diffArchives(Readable.toWeb(createReadStream(args[1])),Readable.toWeb(createReadStream(args[2]))); out.human(JSON.stringify(result,null,2)); return 0;
}
