# Portable container hosting

An image contains the seed's real Vite server/client build, migrations and the
shared host. Workers remains the default. Opt in with `platforms` in `deploy.json`:

```json
{"platforms":["workers","container"],"container":{"engine":"node"}}
```

Choose the engine for the adopting seed's runtime requirements and qualify it
at the intended memory limit. A retained-public-snapshot cache contract is
selected through `cacheContract` when the seed implements that contract. This
is not a general Durable Object adapter. A seed requiring KV or other
Cloudflare-only APIs cannot use Node.
The import boundary rejects those APIs and new Cloudflare imports outside the
platform binding/cache boundary.

The entrypoint holds a Linux kernel `flock` for the lifetime of the host. Each
installation has one local data volume and one writer. The lock inode retains
PID/heartbeat diagnostics and is never unlinked. The host applies hashed
migrations using a separately committed claim, followed by atomic SQL plus
completion. Changed or uncertain history stops startup. Cron uses Base's five
numeric-field grammar and dispatches matching handlers at minute boundaries.
Node queues retain pending/claimed/dead messages across restarts; expired claims
are delivered again. Consumers must already be idempotent. Dead jobs make health
unhealthy. `/health` reports the container platform and the image ID supplied by
the launcher. No image ID is invented when an operator starts an image manually.

`rer build --platform container` builds the image. `rer dev` and `rer preview`
with that flag use it with local settings and a persistent Docker volume named for the checkout.
SQLite stays on the Docker host's local filesystem; host-shared checkout mounts
are not used for database storage. Back up with export before deleting a volume. Build
uses the ordinary private-file custody and command admission boundary. Secrets
are provided at runtime, never baked into the image or transferred in archives.

`rer deploy --platform container --host ssh://user@host --env-file FILE` uses
strict SSH host-key checking and a Linux host with Python 3 and Docker. FILE must
be owned and private (0600); local-only keys are rejected. Settings travel as a
raw Docker env file so dollar signs and other secret bytes are not interpolated. Caddy terminates production TLS; only its
peer can supply forwarded origin/address facts. Inbound Cloudflare and forwarded
headers from other peers are discarded. `RER_SSH_IDENTITY` and
`RER_SSH_KNOWN_HOSTS` select explicit SSH files; neither key contents nor settings
are logged. Local loopback origins support a disposable SSH Docker host for
qualification. Owner hosting/account setup remains an owner step.

A seed can package its own scoped Node runner with a declaration such as:

```json
{"engine":"workerd","runner":{"entry":"runners/src/private-runner.mjs","files":["runners/src","src/domain","src/base","scripts/runner-config.mjs"]}}
```

The entrypoint, supporting files and `scripts/runner-config.mjs` belong to the
adopting seed; replace these example paths with its actual runner dependencies.
Provide the configuration names that runner reads (for example,
`APP_CONTROL_ORIGIN` and `APP_RUNNER_KEY` if the adopter defines them). The host
supervises the process; an unexpected runner exit stops the host so Compose can
restart the complete unit. The runner owns its transport's public-address
validation and TLS behavior.

Local container export/import uses the same Base archive service and exclusion
policy as Workers. Stop the serving process first: one-shot transfers acquire
the same volume lock. `rer archive diff BEFORE AFTER` verifies both entire
archives, then reports added/removed/changed row keys, objects and payloads.
It never merges writes and does not print row values.

## Qualification

`tests/conformance.mjs SEED SOURCE RESULTS` runs the same native public journey
against local Workers and the selected container image. It uses real migrations,
D1, object storage, queues and handlers. Test-only helpers are mounted separately;
the only fakes are paid mail/network edges. It checks ingress, health, assets,
SIGKILL recovery, exclusive volume custody, same-volume upgrades and public-only
egress. Run with the host's Docker socket and an admitted machine budget.

`tests/differential.mjs` compares real local Workers D1 with Node SQLite. Run it
on Node 26.8.1 (the image runtime), with Base's pinned Miniflare dependency.
`node --test modules/container/tests/command.test.mjs` covers the public archive
command. Product source paths are explicit inputs; this suite never downloads
private products, opens provider accounts or performs a provider deployment.

### SSH installation custody and ingress bindings

The remote Linux account requires Python 3, Docker, and permission to use its
Docker daemon. HTTPS deployment acquires `caddy:2.10.2` from its standard registry
if absent, then pins its resolved image ID before shutting down anything. Preload
that image on isolated hosts. `--image IMAGE` deploys an
already built local image; the CLI resolves it once and transfers/runs that exact
image ID, so moving a shared tag cannot substitute another image.

The installation key hashes the full project and environment as a structured
pair. Every app, Caddy container, data/config volume and ingress network carries
that identity plus the complete project/environment and resource role labels.
Missing, mismatched or unexpected resources are refused before replacement;
legacy last-segment namespaces are never taken over. Same-identity redeployment
preserves its volumes. There is no remote `deploy --stop` command. Internal
replacement verifies labels and stops/removes only the inspected container IDs;
it never executes stored Compose files or deletes volumes.

Remote settings live below the account's `.rer-host/INSTALLATION/` in private,
immutable generations. The account home must be owned by the login UID. System
ancestors may be owned by that UID or root, and must not be writable by group or
others; links are refused throughout. Installation directories/files must be
owned by the UID with no group/other permissions. Files must be regular with one
hard link. Pre-existing unmarked directories, unsafe paths and unexpected files
are refused without chmod, truncation or adoption. Exclusive dirfd-relative
writes create a complete generation; one atomic manifest replacement commits it
before shutdown. Interrupted staging leaves the previous generation intact.
A private account lock serializes deployments. Before shutdown the CLI checks
that every ancestor still names the original owned directory and that the
generation still contains its exclusively written files and exact content.
This catches path substitution by the login UID as well as unsafe permissions.
Failure cleanup and removal of previous generations also require the retained
directory and file identities; replacement paths and unexpected files are left
untouched. Previous-generation identities are captured before Docker work and
checked again before shutdown. The current manifest is retained the same way
(identity and exact bytes); the commit replaces only that retained manifest, then
checks that the committed manifest is its own exclusively written file before
any shutdown. A transplanted manifest is refused and left untouched.
Verified settings go to the Docker client on stdin; verified Caddy configuration
goes through the daemon's archive API into the stopped replacement container.
Neither client nor daemon reopens a host configuration pathname after shutdown.

Multiple HTTPS installations can use distinct bindings in `deploy.json`:

```json
{"container":{"engine":"node","ingress":{"address":"127.0.0.1","httpPort":18080,"httpsPort":18443}}}
```

The matching CLI overrides are `--bind-address 127.0.0.1 --http-port 18080
--https-port 18443`. The defaults are `0.0.0.0:80` and `0.0.0.0:443`; duplicate
ports are rejected. These bindings apply to production Caddy ingress. Loopback
HTTP qualification binds the app to the origin's loopback port. Occupied bindings
are refused before stopping the currently installed service.

Place a shared TCP/SNI proxy in front of distinct Caddy TLS ports. Route each
hostname's TLS (including TLS-ALPN certificate challenges) and HTTP challenge
traffic to its installation. Caddy still terminates TLS and remains the app's
only trusted forwarding peer on a separate labeled network. Preserve Host/SNI
when routing. A public non-default port belongs in the origin setting; bindings
alone do not change the public origin. Certificate issuance needs a reachable
public challenge path; private tests should supply a local certificate authority
at that network edge. Changing to a proxy that terminates TLS itself requires a
separate reviewed trust/certificate configuration.

Run the real SSH safety suite with an isolated local Docker/SSH host and a built
reference image:

```sh
RER_SSH_TEST_HOST=ssh://root@127.0.0.1:60420 \
RER_SSH_TEST_IMAGE=host1-fix-probe-app:latest \
node --test --test-concurrency=1 modules/container/tests/ssh.test.mjs modules/container/tests/ssh-tls.test.mjs
```

Set `DOCKER_HOST`, `RER_SSH_IDENTITY` and `RER_SSH_KNOWN_HOSTS` for that fixture.
The suite uses public source and packaged CLI commands and removes only its own
labeled test resources. It never supplies real provider credentials.
