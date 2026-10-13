import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {contract, contractTitle} from './contract.mjs';
import {validateSources, archiveMirror, prepareApt, transportConfig} from '../scripts/ci-apt-bootstrap.mjs';

const stanza = suites => `Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: ${suites}\nComponents: main universe restricted multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
const sources = `${stanza('noble noble-updates noble-backports')}\n${stanza('noble-security')}`;
const mirrors = `http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n${archiveMirror}\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n`;
const effective = () => "HTTP='60'\nHTTPS='60'\nHTTP_HOST='60'\nHTTPS_HOST='60'\nRETRIES='0'\n";
function fixture(t, source = sources, mirror = mirrors) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dial-apt-fixture-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'sources.list.d'));
  fs.mkdirSync(path.join(root, 'apt.conf.d'));
  fs.writeFileSync(path.join(root, 'sources.list.d/ubuntu.sources'), source);
  fs.writeFileSync(path.join(root, 'apt-mirrors.txt'), mirror);
  fs.writeFileSync(path.join(root, 'sources.list.d/unrelated.list'), 'unrelated repository bytes\n');
  return root;
}

contract('BASE-SECRET-002', 'known Noble sources select the sole official HTTPS mirror and tolerate inactive comments', () => {
  assert.equal(validateSources(`# unrelated comment\n${sources}`, `# ignored mirror comment\n${mirrors}`), `${archiveMirror}\n`);
  assert.equal(validateSources(stanza('noble noble-updates noble-backports noble-security'), mirrors), `${archiveMirror}\n`);
});

const invalidSources = [
  '', sources.split('\n').map(line => `# ${line}`).join('\n'),
  sources.replaceAll('mirror+file:/etc/apt/apt-mirrors.txt', 'https://archive.ubuntu.com/ubuntu/'),
  sources.replace('noble-security', 'noble'),
  sources.replace('noble-security', 'unknown-suite'),
  sources.replace('URIs:', '# URIs:'),
  sources.replace('Types: deb', 'Enabled: no\nTypes: deb'),
  sources.replace('Types: deb', 'Types: deb\nTypes: deb'),
  sources.replace('Components: main', 'Components: other main'),
  sources.replace('/usr/share/keyrings/ubuntu-archive-keyring.gpg', '/other/key.gpg'),
  sources.replace('mirror+file:/etc/apt/apt-mirrors.txt', 'https://user:password@example.invalid/'),
];
const invalidMirrors = [
  '', mirrors.split('\n').map(line => `# ${line}`).join('\n'),
  mirrors.replace('priority:1', 'priority:2'), mirrors + `${archiveMirror}\tpriority:2\n`,
  mirrors.replace(archiveMirror, 'https://unknown.invalid/'),
  mirrors.replace(archiveMirror, 'https://user:password@archive.ubuntu.com/ubuntu/'),
  mirrors.replace(archiveMirror, 'https://archive.ubuntu.com/ubuntu/?credential=value'),
  `${archiveMirror}\tpriority:2\n`, `# ${archiveMirror}\nhttp://unknown.invalid/\n`,
];
for (const [index, source] of invalidSources.entries()) {
  contract('BASE-SECRET-002', `invalid active source arrangement ${index + 1} fails before writes`, t => {
    const root = fixture(t, source);
    assert.throws(() => prepareApt(root, effective), {message: 'Hosted Ubuntu APT bootstrap preparation failed'});
    assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), mirrors);
    assert.deepEqual(fs.readdirSync(path.join(root, 'apt.conf.d')), []);
  });
}
for (const [index, mirror] of invalidMirrors.entries()) {
  contract('BASE-SECRET-002', `invalid active mirror arrangement ${index + 1} fails before writes`, t => {
    const root = fixture(t, sources, mirror);
    assert.throws(() => prepareApt(root, effective), {message: 'Hosted Ubuntu APT bootstrap preparation failed'});
    assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), mirror);
    assert.deepEqual(fs.readdirSync(path.join(root, 'apt.conf.d')), []);
  });
}

contract('BASE-SECRET-002', 'preparation preserves sources and unrelated repos, reaches effective APT settings, and repeats safely', t => {
  const root = fixture(t);
  let inspections = 0;
  const inspect = () => {
    inspections++;
    assert.equal(fs.readFileSync(path.join(root, 'apt.conf.d/zzz-dial-ci-bootstrap'), 'utf8'), transportConfig);
    return effective();
  };
  prepareApt(root, inspect);
  prepareApt(root, inspect);
  assert.equal(inspections, 2);
  assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), `${archiveMirror}\n`);
  assert.equal(fs.readFileSync(path.join(root, 'sources.list.d/ubuntu.sources'), 'utf8'), sources);
  assert.equal(fs.readFileSync(path.join(root, 'sources.list.d/unrelated.list'), 'utf8'), 'unrelated repository bytes\n');
});

contract('BASE-SECRET-002', 'missing input fails before writes', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'sources.list.d/ubuntu.sources'));
  assert.throws(() => prepareApt(root, effective), {message: 'Hosted Ubuntu APT bootstrap preparation failed'});
  assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), mirrors);
  assert.deepEqual(fs.readdirSync(path.join(root, 'apt.conf.d')), []);
});

contract('BASE-SECRET-001', 'filesystem and APT inspection failures propagate with constant safe errors', t => {
  const root = fixture(t);
  fs.rmSync(path.join(root, 'apt.conf.d'), {recursive: true});
  assert.throws(() => prepareApt(root, effective), {message: 'Hosted Ubuntu APT bootstrap preparation failed'});
  fs.mkdirSync(path.join(root, 'apt.conf.d'));
  for (const inspect of [() => { throw Error('sensitive diagnostic'); }, () => "HTTP='0'\nHTTPS='60'\nRETRIES='0'", () => "HTTP='60'\nHTTPS='60'\nRETRIES='1'"]) {
    assert.throws(() => prepareApt(root, inspect), {message: 'Hosted Ubuntu APT bootstrap preparation failed'});
  }
});

contract('BASE-SECRET-002', 'workflow bounds the unchanged actual Playwright install and lets preparation failures fail the step', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8');
  assert.match(workflow, /runs-on: ubuntu-latest\n {4}timeout-minutes: 60/);
  assert.match(workflow, /timeout-minutes: 10\n {8}run: \|\n {10}sudo --preserve-env=GITHUB_ACTIONS,RUNNER_OS "\$\(command -v node\)" scripts\/ci-apt-bootstrap.mjs\n {10}pnpm exec playwright install --with-deps chromium\n/);
});

const failure = 'Hosted Ubuntu APT bootstrap preparation failed';
const identity = 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nUBUNTU_CODENAME=noble\n';
const timeoutKeys = [
  'Acquire::http::Timeout', 'Acquire::https::Timeout',
  'Acquire::http::archive.ubuntu.com::Timeout', 'Acquire::https::archive.ubuntu.com::Timeout',
];

// Run the unchanged CLI module, substituting only its OS/filesystem/command
// dependencies in a VM. Every file access is confined to this private fixture.
function cli(t, options = {}) {
  const root = fixture(t);
  const identityFile = path.join(root, 'identity/etc/os-release');
  const linkedIdentity = path.join(root, 'identity/usr/lib/os-release');
  fs.mkdirSync(path.dirname(identityFile), {recursive: true});
  fs.mkdirSync(path.dirname(linkedIdentity), {recursive: true});
  if (options.identity !== null) fs.writeFileSync(identityFile, options.identity ?? identity, {mode: 0o444});
  if (options.identityLink) {
    fs.renameSync(identityFile, linkedIdentity);
    fs.symlinkSync('../usr/lib/os-release', identityFile);
  }
  const result = execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', String.raw`
    import fs from 'node:fs';
    import path from 'node:path';
    import vm from 'node:vm';
    import {pathToFileURL} from 'node:url';
    const {root, script, options} = JSON.parse(fs.readFileSync(0, 'utf8'));
    const reads = [], commands = [], logs = [], errors = [];
    let writes = 0;
    const mapped = name => {
      if (typeof name === 'number') return name;
      if (name === '/etc/os-release') return path.join(root, 'identity/etc/os-release');
      if (name === '/' || name === '/etc') return root;
      if (name === '/etc/apt' || name.startsWith('/etc/apt/')) return root + name.slice(8);
      throw Error('Fixture filesystem boundary');
    };
    const virtualFs = {...fs};
    virtualFs.writeSync = (...args) => { writes++; return fs.writeSync(...args); };
    for (const name of ['readFileSync', 'writeFileSync', 'lstatSync', 'openSync']) {
      virtualFs[name] = (target, ...args) => {
        if (name === 'readFileSync' && typeof target === 'string') reads.push(target);
        if (name === 'writeFileSync' || (name === 'openSync' && (args[0] & fs.constants.O_CREAT))) writes++;
        return fs[name](mapped(target), ...args);
      };
    }
    virtualFs.realpathSync = target => {
      const actual = fs.realpathSync(mapped(target));
      if (actual === root || actual.startsWith(root + path.sep)) return '/etc/apt' + actual.slice(root.length);
      throw Error('Fixture filesystem boundary');
    };
    const inspect = (command, args, settings) => {
      commands.push({command, args, settings});
      if (options.inspectionError) throw Error('sensitive diagnostic');
      const config = {...options.before};
      for (const line of fs.readFileSync(path.join(root, 'apt.conf.d/zzz-dial-ci-bootstrap'), 'utf8').trim().split('\n')) {
        const match = /^(\S+) "(\d+)";$/.exec(line);
        if (!match) throw Error('Fixture config syntax');
        config[match[1]] = match[2];
      }
      Object.assign(config, options.after);
      return args.slice(1).reduce((out, name, i, pairs) => i % 2 ? out :
        out + (Object.hasOwn(config, pairs[i + 1]) ? name + "='" + config[pairs[i + 1]] + "'\n" : ''), '');
    };
    const runner = {
      argv: ['/node', script], platform: options.platform ?? 'linux',
      env: {GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', ...options.env},
      getuid: () => process.getuid(), geteuid: () => process.geteuid(),
    };
    const context = vm.createContext({process: runner, Buffer, console: {
      log: value => logs.push(value), error: value => errors.push(value),
    }});
    const modules = {
      'node:fs': {default: virtualFs}, 'node:path': {default: path},
      'node:child_process': {execFileSync: inspect}, 'node:url': {pathToFileURL},
    };
    const actual = new vm.SourceTextModule(fs.readFileSync(script, 'utf8'), {
      context, initializeImportMeta(meta) { meta.url = pathToFileURL(script).href; },
    });
    await actual.link(name => new vm.SyntheticModule(Object.keys(modules[name]), function () {
      for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value);
    }, {context}));
    await actual.evaluate();
    console.log(JSON.stringify({exitCode: runner.exitCode ?? 0, reads, writes, commands, logs, errors}));
  `], {
    input: JSON.stringify({root, script: fileURLToPath(new URL('../scripts/ci-apt-bootstrap.mjs', import.meta.url)), options}),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {root, ...JSON.parse(result)};
}

for (const [name, value] of Object.entries({
  missing: null, empty: '', debian: identity.replace('ID=ubuntu', 'ID=debian'),
  jammy: identity.replace('24.04', '22.04').replaceAll('noble', 'jammy'),
  version: identity.replace('24.04', '24.10'), codename: identity.replace('VERSION_CODENAME=noble', 'VERSION_CODENAME=jammy'),
  ubuntuCodename: identity.replace('UBUNTU_CODENAME=noble', 'UBUNTU_CODENAME=jammy'),
  missingVersion: identity.replace('VERSION_ID="24.04"\n', ''),
  missingCodename: identity.replace('VERSION_CODENAME=noble\n', ''),
  duplicate: identity + 'ID=ubuntu\n', malformed: identity + 'not an assignment\n',
  unterminated: identity.replace('"24.04"', '"24.04'), expansion: identity.replace('ID=ubuntu', 'ID=$(false)'),
})) {
  contract('BASE-SECRET-002', `CLI rejects ${name} OS identity before any APT write`, t => {
    const result = cli(t, {identity: value});
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.errors, [failure]);
    assert.equal(result.writes, 0);
    assert.deepEqual(result.commands, []);
    assert.equal(fs.readFileSync(path.join(result.root, 'apt-mirrors.txt'), 'utf8'), mirrors);
    assert.deepEqual(fs.readdirSync(path.join(result.root, 'apt.conf.d')), []);
  });
}

for (const options of [{platform: 'darwin'}, {env: {GITHUB_ACTIONS: 'false'}}, {env: {RUNNER_OS: 'macOS'}}]) {
  contract('BASE-SECRET-002', `CLI retains hosted Linux guard ${JSON.stringify(options)}`, t => {
    const result = cli(t, options);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.errors, [failure]);
    assert.equal(result.writes, 0);
  });
}

for (const identityLink of [false, true]) {
  contract('BASE-SECRET-002', `CLI accepts genuine Noble identity with ${identityLink ? 'standard symlink' : 'regular file'} and inspects all effective bounds`, t => {
    const result = cli(t, {identityLink, before: Object.fromEntries(timeoutKeys.map(key => [key, '0']))});
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.errors, []);
    assert.ok(result.reads.includes('/etc/os-release'));
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].command, 'apt-config');
    assert.equal(result.commands[0].args[0], 'shell');
    assert.deepEqual(result.commands[0].args.slice(2).filter((_, i) => i % 2 === 0).sort(), [...timeoutKeys, 'Acquire::Retries'].sort());
    assert.equal(fs.readFileSync(path.join(result.root, 'apt-mirrors.txt'), 'utf8'), `${archiveMirror}\n`);
    for (const key of timeoutKeys) assert.ok(transportConfig.includes(`${key} "60";\n`));
  });
}

for (const key of timeoutKeys) {
  for (const value of ['0', '-1', 'Infinity', '3600']) {
    contract('BASE-SECRET-002', `CLI rejects effective ${key}=${value} despite other finite settings`, t => {
      const result = cli(t, {after: {[key]: value}});
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.errors, [failure]);
      assert.equal(result.commands.length, 1);
    });
  }
}

contract('BASE-SECRET-001', 'CLI preserves a constant error when narrow effective inspection fails', t => {
  const result = cli(t, {inspectionError: true});
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors, [failure]);
});

for (const target of ['sources.list.d/ubuntu.sources', 'apt-mirrors.txt', 'apt.conf.d/zzz-dial-ci-bootstrap', 'sources.list.d', 'apt.conf.d', '.']) {
  contract('BASE-SECRET-002', `symlink at ${target} is rejected without changing any target`, t => {
    const root = fixture(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dial-apt-outside-'));
    t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
    const name = path.join(root, target), destination = path.join(outside, 'unrelated');
    if (fs.existsSync(name)) fs.renameSync(name, destination);
    else fs.writeFileSync(destination, 'unrelated output bytes\n');
    fs.symlinkSync(destination, name);
    const before = fs.readFileSync(target === '.' ? path.join(destination, 'apt-mirrors.txt') :
      target.endsWith('.d') ? path.join(root, 'apt-mirrors.txt') : destination);
    assert.throws(() => prepareApt(root, effective), {message: failure});
    assert.deepEqual(fs.readFileSync(target === '.' ? path.join(destination, 'apt-mirrors.txt') :
      target.endsWith('.d') ? path.join(root, 'apt-mirrors.txt') : destination), before);
    assert.equal(fs.existsSync(path.join(target === '.' ? destination : root, 'apt.conf.d/zzz-dial-ci-bootstrap')),
      target === 'apt.conf.d/zzz-dial-ci-bootstrap');
  });
}

for (const target of ['sources.list.d/ubuntu.sources', 'apt-mirrors.txt', 'apt.conf.d/zzz-dial-ci-bootstrap']) {
  contract('BASE-SECRET-002', `directory in place of ${target} fails before writes`, t => {
    const root = fixture(t), name = path.join(root, target);
    if (fs.existsSync(name)) fs.unlinkSync(name);
    fs.mkdirSync(name);
    assert.throws(() => prepareApt(root, effective), {message: failure});
    if (target !== 'apt-mirrors.txt') assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), mirrors);
    assert.deepEqual(fs.readdirSync(path.join(root, 'apt.conf.d')), target.startsWith('apt.conf.d/') ? ['zzz-dial-ci-bootstrap'] : []);
  });
}

contract('BASE-SECRET-002', 'unknown existing bootstrap drop-in fails before mirror or config writes', t => {
  const root = fixture(t), name = path.join(root, 'apt.conf.d/zzz-dial-ci-bootstrap');
  fs.writeFileSync(name, 'unrecognized configuration\n');
  assert.throws(() => prepareApt(root, effective), {message: failure});
  assert.equal(fs.readFileSync(name, 'utf8'), 'unrecognized configuration\n');
  assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), mirrors);
});

contract('BASE-SECRET-002', 'hard-linked mirror is rejected before overwriting unrelated bytes', t => {
  const root = fixture(t), target = path.join(root, 'unrelated-hardlink');
  fs.linkSync(path.join(root, 'apt-mirrors.txt'), target);
  assert.throws(() => prepareApt(root, effective), {message: failure});
  assert.equal(fs.readFileSync(target, 'utf8'), mirrors);
  assert.deepEqual(fs.readdirSync(path.join(root, 'apt.conf.d')), []);
});

for (const target of ['.', 'sources.list.d', 'apt.conf.d', 'sources.list.d/ubuntu.sources', 'apt-mirrors.txt']) {
  contract('BASE-SECRET-002', `externally writable ${target} fails before writes`, t => {
    const root = fixture(t), name = path.join(root, target);
    fs.chmodSync(name, fs.statSync(name).mode | 0o022);
    assert.throws(() => prepareApt(root, effective), {message: failure});
    assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), mirrors);
    assert.deepEqual(fs.readdirSync(path.join(root, 'apt.conf.d')), []);
  });
}

// The exact hosted image writes these later-loading defaults:
// https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/scripts/build/configure-apt.sh
const runnerTransportDefaults = 'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n';
const inspectionPairs = [
  ['HTTP', timeoutKeys[0]], ['HTTPS', timeoutKeys[1]],
  ['HTTP_HOST', timeoutKeys[2]], ['HTTPS_HOST', timeoutKeys[3]], ['RETRIES', 'Acquire::Retries'],
];

// Portable model of APT 2.8.3 ReadConfigDir's sorted, last-setting-wins load.
// The separate Linux test below runs the same regression through apt-config.
function inspectFixtureDropIns(root) {
  const config = new Map();
  for (const name of fs.readdirSync(path.join(root, 'apt.conf.d')).sort()) {
    for (const line of fs.readFileSync(path.join(root, 'apt.conf.d', name), 'utf8').trim().split('\n')) {
      const match = /^(\S+) "(\d+)";$/.exec(line);
      assert.ok(match, 'The test fixture contains only literal APT transport settings');
      config.set(match[1], match[2]);
    }
  }
  return inspectionPairs.map(([name, key]) => `${name}='${config.get(key)}'\n`).join('');
}

function checkRunnerLoadOrder(t, inspection) {
  const root = fixture(t), directory = path.join(root, 'apt.conf.d');
  const runnerFile = path.join(directory, 'zz-retries');
  fs.writeFileSync(runnerFile, runnerTransportDefaults);
  const inspect = inspection(root);

  // Reproduce the rejected effective values caused by the original filename.
  const originalFile = path.join(directory, 'zz-dial-ci-bootstrap');
  fs.writeFileSync(originalFile, transportConfig);
  assert.equal(inspect(), "HTTP='15'\nHTTPS='15'\nHTTP_HOST='60'\nHTTPS_HOST='60'\nRETRIES='1'\n");
  fs.unlinkSync(originalFile);

  assert.doesNotThrow(() => prepareApt(root, inspect));
  assert.equal(inspect(), effective());
  assert.equal(fs.readFileSync(runnerFile, 'utf8'), runnerTransportDefaults);
  assert.equal(fs.readFileSync(path.join(root, 'sources.list.d/ubuntu.sources'), 'utf8'), sources);
  assert.equal(fs.readFileSync(path.join(root, 'apt-mirrors.txt'), 'utf8'), `${archiveMirror}\n`);
  assert.doesNotThrow(() => prepareApt(root, inspect));

  // A future image with a still-later conflicting file must fail closed.
  const laterFile = path.join(directory, 'zzzz-external-override');
  for (const [, key] of inspectionPairs) {
    const override = `${key} "${key === 'Acquire::Retries' ? '1' : '0'}";\n`;
    fs.writeFileSync(laterFile, override);
    assert.throws(() => prepareApt(root, inspect), {message: failure});
    assert.equal(fs.readFileSync(laterFile, 'utf8'), override);
    assert.equal(fs.readFileSync(runnerFile, 'utf8'), runnerTransportDefaults);
  }
}

contract('BASE-SECRET-002', 'bootstrap settings load after hosted runner defaults and later conflicts still fail closed', t => {
  checkRunnerLoadOrder(t, root => () => inspectFixtureDropIns(root));
});

test(contractTitle('BASE-SECRET-002', 'native Linux apt-config proves hosted default precedence and effective bounds'), {skip: process.platform !== 'linux'}, t => {
  checkRunnerLoadOrder(t, root => {
    const config = path.join(root, 'inspection.conf');
    fs.writeFileSync(config, `Dir::Etc ${JSON.stringify(root)};\nDir::Etc::parts "apt.conf.d";\nDir::Etc::main "apt.conf";\n`);
    return () => execFileSync('apt-config', ['shell', ...inspectionPairs.flat()], {
      env: {...process.env, APT_CONFIG: config}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  });
});
