"""Bounded hosted-Ubuntu fallback, only after the bundled Chromium cannot launch."""

import os
from pathlib import Path
import signal
import subprocess
import tempfile


def bounded(command, environment, seconds=75):
    child = subprocess.Popen(command, env=environment, start_new_session=True)
    try:
        return child.wait(timeout=seconds) == 0
    except subprocess.TimeoutExpired:
        # Kill the entire apt/dpkg subtree before another mirror can take its lock.
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        return False


def main():
    if os.geteuid() != 0 or os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_OS') != 'Linux':
        raise SystemExit('Chromium dependencies require a hosted GitHub Ubuntu runner')
    cli = subprocess.check_output([
        'node', '-p', "require.resolve('@playwright/test/package.json').replace(/package.json$/, 'cli.js')",
    ], text=True, timeout=10).strip()
    environment = {**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'}
    with tempfile.TemporaryDirectory(prefix='dial-chromium-apt-') as directory:
        config = Path(directory) / 'apt.conf'
        archives = os.environ.get('APT_ARCHIVES')
        if archives:
            if not Path(archives).is_absolute() or any(char in archives for char in '\n\r"\\'):
                raise SystemExit('APT_ARCHIVES must be an absolute cache directory')
            Path(archives, 'partial').mkdir(parents=True, exist_ok=True)
            config.write_text(f'Dir::Cache::archives "{archives}";\n')
        else:
            config.write_text('')
        environment['APT_CONFIG'] = str(config)
        for mirror in ['runner-default', 'http://mirrors.edge.kernel.org/ubuntu/']:
            # The existing bootstrap validates Ubuntu 24.04 and bounds transport.
            if not bounded(['node', 'scripts/ci-apt-bootstrap.mjs', mirror], environment, 10):
                raise SystemExit('Chromium apt bootstrap failed')
            if (bounded(['dpkg', '--configure', '-a'], environment, 15)
                    and bounded(['node', cli, 'install-deps', 'chromium'], environment)):
                return
            print(f'Chromium dependency attempt failed: {mirror}', flush=True)
    raise SystemExit('Chromium dependency installation exhausted its bounded attempts')


if __name__ == '__main__':
    main()
