import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const mapping = 'mirror+file:/etc/apt/apt-mirrors.txt';
export const archiveMirror = 'https://archive.ubuntu.com/ubuntu/';
const originalMirrors = [
  'http://azure.archive.ubuntu.com/ubuntu/ priority:1',
  `${archiveMirror} priority:2`,
  'https://security.ubuntu.com/ubuntu/ priority:3',
];
const invalid = () => { throw Error('Unexpected hosted Ubuntu APT sources'); };

// Accept active deb822 fields only; comments cannot establish a source mapping.
const fallbackMirrors = ['http://mirrors.edge.kernel.org/ubuntu/', 'http://us-east-1.ec2.archive.ubuntu.com/ubuntu/'];
export function validateSources(sources, mirrors, selectedMirror = archiveMirror) {
  if (![archiveMirror, ...fallbackMirrors, 'runner-default'].includes(selectedMirror)) invalid();
  const active = sources.split(/\r?\n/).filter(line => !line.trimStart().startsWith('#')).join('\n').trim();
  if (!active) invalid();
  const suites = [];
  for (const stanza of active.split(/\n\s*\n/)) {
    const fields = new Map();
    for (const line of stanza.split('\n')) {
      const match = /^([A-Za-z-]+):\s*(\S.*?)\s*$/.exec(line);
      if (!match || fields.has(match[1])) invalid();
      fields.set(match[1], match[2]);
    }
    if (fields.size !== 5 || fields.get('Types') !== 'deb' || fields.get('URIs') !== mapping ||
        fields.get('Signed-By') !== '/usr/share/keyrings/ubuntu-archive-keyring.gpg') invalid();
    const components = fields.get('Components')?.split(/\s+/).sort().join(' ');
    if (components !== 'main multiverse restricted universe') invalid();
    if (!fields.has('Suites')) invalid();
    suites.push(...fields.get('Suites').split(/\s+/));
  }
  if (suites.sort().join(' ') !== 'noble noble-backports noble-security noble-updates') invalid();
  const entries = mirrors.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#')).map(line => line.replace(/\s+/g, ' '));
  const original = entries.length === 3 && originalMirrors.every(entry => entries.includes(entry));
  const selected = entries.length === 1 && [archiveMirror, ...fallbackMirrors].includes(entries[0]);
  if (!original && !selected) invalid();
  return selectedMirror === 'runner-default' ? mirrors : `${selectedMirror}\n`;
}

const settings = [
  ['HTTP', 'Acquire::http::Timeout', '60'], ['HTTPS', 'Acquire::https::Timeout', '60'],
  ['HTTP_HOST', 'Acquire::http::archive.ubuntu.com::Timeout', '60'],
  ['HTTPS_HOST', 'Acquire::https::archive.ubuntu.com::Timeout', '60'],
  ['RETRIES', 'Acquire::Retries', '0'],
];
export const transportConfig = settings.map(([, key, value]) => `${key} "${value}";\n`).join('');
const keys = settings.flatMap(([name, key]) => [name, key]);
const expected = settings.map(([name, , value]) => `${name}='${value}'`).sort().join('\n');
const failure = () => { throw Error('Hosted Ubuntu APT bootstrap preparation failed'); };

function validateUbuntuIdentity(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(?:"([^"\\]*)"|'([^'\\]*)'|([A-Za-z0-9._:/@+-]+))$/.exec(line);
    if (!match || fields.has(match[1])) failure();
    fields.set(match[1], match[2] ?? match[3] ?? match[4]);
  }
  for (const [key, value] of Object.entries({ID: 'ubuntu', VERSION_ID: '24.04', VERSION_CODENAME: 'noble', UBUNTU_CODENAME: 'noble'})) {
    if (fields.get(key) !== value) failure();
  }
}

function checkDirectory(name, ancestor = false) {
  const stat = fs.lstatSync(name);
  if (!stat.isDirectory() || (stat.uid !== process.geteuid() && !(ancestor && stat.uid === 0)) ||
      ((stat.mode & 0o022) && !(ancestor && (stat.mode & 0o1000)))) failure();
}

function checkFile(stat) {
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.geteuid() || (stat.mode & 0o022)) failure();
}

function openFile(name, flags, handles, before = fs.lstatSync(name)) {
  checkFile(before);
  const fd = fs.openSync(name, flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  handles.push(fd);
  const after = fs.fstatSync(fd);
  checkFile(after);
  if (before.dev !== after.dev || before.ino !== after.ino) failure();
  return fd;
}

function writeFile(fd, value) {
  const length = Buffer.byteLength(value);
  if (fs.writeSync(fd, value, 0, 'utf8') !== length) failure();
  fs.ftruncateSync(fd, length);
}

// The drop-in is read by Playwright's sudo APT child, independently of its env.
export function prepareApt(aptDirectory, inspect = () => execFileSync('apt-config', ['shell', ...keys], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}), selectedMirror = archiveMirror) {
  const handles = [];
  let failed = false;
  try {
    if (!path.isAbsolute(aptDirectory) || fs.realpathSync(aptDirectory) !== aptDirectory) failure();
    for (let parent = path.dirname(aptDirectory); ; parent = path.dirname(parent)) {
      checkDirectory(parent, true);
      if (parent === path.dirname(parent)) break;
    }
    for (const directory of [aptDirectory, path.join(aptDirectory, 'sources.list.d'), path.join(aptDirectory, 'apt.conf.d')]) {
      checkDirectory(directory);
    }
    const mirrorFile = path.join(aptDirectory, 'apt-mirrors.txt');
    // The hosted image's zz-retries overrides earlier drop-ins. Load our
    // bounds after it, then verify the values APT actually resolves below.
    const configFile = path.join(aptDirectory, 'apt.conf.d/zzz-dial-ci-bootstrap');
    const source = openFile(path.join(aptDirectory, 'sources.list.d/ubuntu.sources'), fs.constants.O_RDONLY, handles);
    const mirror = openFile(mirrorFile, fs.constants.O_RDWR, handles);
    const configStat = fs.lstatSync(configFile, {throwIfNoEntry: false});
    let config = configStat ? openFile(configFile, fs.constants.O_RDWR, handles, configStat) : undefined;
    const selected = validateSources(fs.readFileSync(source, 'utf8'), fs.readFileSync(mirror, 'utf8'), selectedMirror);
    if (config !== undefined && fs.readFileSync(config, 'utf8') !== transportConfig) failure();
    // All identities, parents, file types and input bytes are validated before
    // creating or changing either output. Held non-following descriptors also
    // prevent a final-component replacement from redirecting these writes.
    if (config === undefined) {
      config = fs.openSync(configFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
      handles.push(config);
    }
    writeFile(mirror, selected);
    writeFile(config, transportConfig);
    const effective = inspect().trim().split(/\r?\n/).sort().join('\n');
    if (effective !== expected) failure();
  } catch {
    failed = true;
  } finally {
    for (const fd of handles) {
      try { fs.closeSync(fd); } catch { failed = true; }
    }
  }
  if (failed) failure();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux') {
      throw Error('Hosted Ubuntu APT bootstrap requires a GitHub Linux runner');
    }
    // Ubuntu's standard /etc/os-release symlink is intentionally supported.
    validateUbuntuIdentity(fs.readFileSync('/etc/os-release', 'utf8'));
    prepareApt('/etc/apt', undefined, process.argv[2] ?? archiveMirror);
    console.log('Hosted Ubuntu APT HTTPS mirror and finite transport bounds prepared');
  } catch {
    console.error('Hosted Ubuntu APT bootstrap preparation failed');
    process.exitCode = 1;
  }
}
