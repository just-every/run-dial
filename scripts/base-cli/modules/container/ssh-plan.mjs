import { createHash } from 'node:crypto';
import { ingressBindings } from '../deploy-kit/container-config.mjs';
export { ingressBindings } from '../deploy-kit/container-config.mjs';

export function installationIdentity(project, environment = 'production') {
 if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(project) || project.length > 512 || !/^[a-z][a-z0-9-]{0,39}$/.test(environment)) throw Error('Invalid installation identity');
 const identity = createHash('sha256').update(JSON.stringify([project, environment])).digest('hex');
 return { name: `rer-${identity}`, labels: { 'io.runeditrun.managed': 'ssh-v1', 'io.runeditrun.installation': identity, 'io.runeditrun.project': project, 'io.runeditrun.environment': environment } };
}


export function deploymentPlan({ declaration, settings, environment, digest, ingress }) {
 const { name, labels } = installationIdentity(declaration.project, environment);
 if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw Error('Invalid Docker image digest');
 const origin = settings[declaration.originVar] ?? settings.PUBLIC_ORIGIN;
 if (!origin) throw Error('Declare the public origin in the private env file');
 const url = new URL(origin);
 if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Invalid public origin');
 const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
 if (!local && url.protocol !== 'https:') throw Error('Production ingress requires HTTPS');
 if (local && url.protocol !== 'http:') throw Error('Loopback qualification requires an HTTP origin');
 const hostnames = [url.hostname];
 for (const variable of declaration.container?.hostVariables ?? []) {
  const hostname = settings[variable];
  if (!hostname || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname)) throw Error('Invalid declared ingress hostname');
  if (!hostnames.includes(hostname)) hostnames.push(hostname);
 }
 const bindings = ingressBindings({ ...declaration.container?.ingress, ...ingress });
 const roleLabels = role => ({ ...labels, 'io.runeditrun.role': role });
 const volume = role => ({ name: `${name}-${role}`, labels: roleLabels(role) });
 const ports = local ? [`127.0.0.1:${url.port || 80}:8080`] : [`${bindings.address}:${bindings.httpPort}:80`, `${bindings.address}:${bindings.httpsPort}:443`];
 const compose = { name, services: { app: { image: digest, container_name: `${name}-app`, labels: roleLabels('app'), restart: 'unless-stopped', environment: { RER_IMAGE_DIGEST: digest, PORT: '8080', ...(local ? {} : { TRUSTED_PROXY: 'caddy' }) }, env_file: [{ path: 'settings.env', format: 'raw' }], volumes: ['data:/data'], networks: ['ingress'], ...(local ? { ports } : {}) } }, volumes: { data: volume('data') }, networks: { ingress: { name: `${name}-ingress`, labels: roleLabels('ingress') } } };
 if (!local) {
  compose.services.caddy = { image: 'caddy:2.10.2', container_name: `${name}-caddy`, labels: roleLabels('caddy'), restart: 'unless-stopped', ports, configs: [{ source: 'caddy', target: '/etc/caddy/Caddyfile' }], volumes: ['caddy:/data', 'caddy-config:/config'], networks: ['ingress'] };
  compose.volumes.caddy = volume('caddy'); compose.volumes['caddy-config'] = volume('caddy-config');
 }
 // Listener ports are internal. A TCP/SNI proxy must preserve the public
 // authority and route ACME HTTP/TLS challenges to these private bindings.
 const sites = hostnames.map(hostname => `https://${hostname}`).join(', ');
 const redirects = hostnames.map(hostname => `http://${hostname} {\n redir https://${hostname}${url.port ? ':' + url.port : ''}{uri} permanent\n}`).join('\n');
 const caddyfile = `{\n auto_https disable_redirects\n}\n${sites} {\n reverse_proxy app:8080\n}\n${redirects}\n`;
 if (!local) compose.configs = { caddy: { content: caddyfile } };
 return { name, labels, origin, digest, local, ports, compose, caddyfile };
}
