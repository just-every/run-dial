import {localDependencyLinks} from './dependency-doctor.mjs';
import { contained } from './project.mjs';
import { missing, refuse } from './errors.mjs';
import { locateExport, locateImport } from './archive-path.mjs';
export async function transfer(project, options, signal, custody) {
 const direction = options.verb, file = direction === 'export' ? options.output : options.input;
 if (!file) throw missing(`Provide --${direction === 'export' ? 'output' : 'input'} FILE.`);
 if (direction === 'import' && !options.yes) throw refuse('Import requires explicit --yes confirmation.');
 const target = options.target ?? 'local', api = project.adapter.portability;
 if(direction==='import' && options.legacyV1) {
  if(!options.acknowledgeUnverifiedMetadata)throw refuse('Legacy v1 recovery requires --acknowledge-unverified-metadata: source identity, erasure metadata and other manifest metadata cannot be authenticated. See modules/portability/README.md#backup-only-v1-recovery.');
  if(!options.output)throw missing('Legacy v1 recovery requires --output FILE for the new v2 backup.');
  if(target!=='local'||options.platform==='container'||api?.legacyRecovery!==true)throw refuse('Legacy v1 recovery is supported only by the local Workers portability adapter in an empty isolated installation.');
 }else if(direction==='import' && (options.acknowledgeUnverifiedMetadata||options.output))throw refuse('--acknowledge-unverified-metadata and import --output require --legacy-v1.');
 if (!api || typeof api[direction] !== 'function' || (target === 'remote' && api.remote !== true)) throw refuse(`Complete ${target} ${direction} is unsupported: the reviewed portability API and binding policy must be adopted first.`);
 const located = direction === 'export' ? await locateExport(project.root, file) : await locateImport(project.root, file), path = located.path;
 const legacyOutput = options.legacyV1 ? await locateExport(project.root, options.output) : undefined;
 const legacyRecovery=legacyOutput?{output:legacyOutput.path,acknowledged:options.acknowledgeUnverifiedMetadata}:undefined;
 const sessionFile = options.sessionFile ? await contained(project.root, options.sessionFile, { privateFile: true }) : undefined;
 if(options.journal && legacyRecovery)throw refuse('--journal requires normal v2 import; legacy v1 metadata cannot authenticate a later-journal recovery.');
 if (options.journal && (direction !== 'import' || target !== 'local')) throw refuse('--journal applies to a local import only.');
 // A later archive of the same installation carries its latest erasure journal.
 const journal = options.journal ? await contained(project.root, options.journal, { privateFile: true }) : undefined;
 await project.adapter.prepareData?.(project.root, custody.store, signal);
 // Only now can the seed's Vite configuration load in a checkout that never built.
 await located.unserved(); await legacyOutput?.unserved();
 const result=await api[direction]({ root: project.root, target, path, journal, origin: options.origin, sessionFile, signal, platform:options.platform, legacyRecovery, ...custody });
 if(direction==='import' && target==='local' && (await localDependencyLinks(project.root)).some(link=>link.needs_relink)) {
  custody.store.report('Imported provider links need fresh approval. Run rer setup with RER_LINK_TOKEN_FILE to re-link this installation.');
  return {...result,needsRelink:true,nextCommand:'rer setup'};
 }
 return result;
}
