import { missing } from './errors.mjs';
import { shared } from './shared.mjs';

// Reuse the seed's existing declarations; no parallel auth setting aliases.
export function localSettingKeys(project) {
 const manifest = project.setupManifest ?? project.setupSeed?.manifest;
 const claim = manifest?.steps.find(step => step.type === 'owner-claim');
 return {
  origin: project.adapter?.hooks?.secrets?.originKey ?? 'AUTH_ORIGIN',
  email: claim?.emailField ?? project.adapter?.input?.names?.email ?? 'OWNER_EMAIL',
 };
}

export function requiredLocalSettings(project, values) {
 const keys=localSettingKeys(project);
 const manifest=project.setupManifest ?? project.setupSeed?.manifest;
 return [...new Set([keys.email,keys.origin,...(manifest?.fields??[]).filter(field=>field.kind==='secret'&&field.required&&!field.when&&field.input!=='entered'&&field.name!==manifest?.steps.find(step=>step.type==='owner-claim')?.tokenField).map(field=>field.name)])].filter(name=>!values[name]);
}

// The CLI's own proof to the running application, keyed by the session secret
// in the seed's private settings: its declared file and format, under the name
// its adapter declares as sessionSecretKey (default SESSION_SECRET).
export async function localCliSessionProof(project) {
 const hooks = project.adapter?.hooks ?? {}, key = hooks.sessionSecretKey ?? 'SESSION_SECRET';
 const { readSettings } = await shared('adapter-settings.mjs'), { localCliProof } = await shared('adapter-auth.mjs');
 const secret = (await readSettings(project.root, hooks.secrets ?? {})).values[key];
 if (typeof secret !== 'string' || !secret) throw missing(`${key} is missing from the private settings.`);
 return localCliProof(secret);
}
