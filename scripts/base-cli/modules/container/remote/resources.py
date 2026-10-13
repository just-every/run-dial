"""Operate only on fresh Docker inventory, never on stored executable config."""
import subprocess, socket, io, tarfile


def docker(*args, input=None):
    result = subprocess.run(['docker', *args], input=input, capture_output=True, text=not isinstance(input, bytes), timeout=120)
    if result.returncode:
        # Docker may echo environment/configuration. Never propagate its output.
        refuse('Docker host operation failed: ' + args[0])
    return (result.stdout.decode() if isinstance(result.stdout, bytes) else result.stdout).strip()


def inspect(kind, names):
    return json.loads(docker(kind, 'inspect', *names)) if names else []


def labels_for(plan, role):
    return {**plan['labels'], 'io.runeditrun.role': role}


def check_labels(plan, role, actual):
    if any((actual or {}).get(key) != value for key, value in labels_for(plan, role).items()):
        refuse('Docker resource ownership mismatch: ' + role)


def inventory(plan):
    resources = {'container': {}, 'volume': {}, 'network': {}}
    # Inventory every container so foreign mounts, network peers and occupied
    # bindings are accounted for, even when they carry no RER label at all.
    containers = inspect('container', docker('container', 'ls', '-aq').split())
    for item in containers:
        resources['container'][item['Name'].lstrip('/')] = item
    for kind in ('volume', 'network'):
        names = docker(kind, 'ls', '--format', '{{.Name}}').splitlines()
        for item in inspect(kind, names):
            resources[kind][item['Name']] = item
    expected = {'container': ['app', 'caddy'], 'volume': ['data', 'caddy', 'caddy-config'], 'network': ['ingress']}
    owned = {'container': {}, 'volume': {}, 'network': {}}
    for kind, objects in resources.items():
        for name, item in objects.items():
            labels = item.get('Config', {}).get('Labels') if kind == 'container' else item.get('Labels')
            matching_name = name in [plan['name'] + '-' + role for role in expected[kind]]
            matching_owner = (labels or {}).get('io.runeditrun.installation') == plan['labels']['io.runeditrun.installation']
            # Old compose-labelled extra services can otherwise be selected by
            # compose down. Refuse these too rather than silently adopting them.
            matching_compose = (labels or {}).get('com.docker.compose.project') == plan['name']
            if matching_name or matching_owner or matching_compose:
                role = name.removeprefix(plan['name'] + '-')
                if role not in expected[kind] or name != plan['name'] + '-' + role:
                    refuse('Unexpected Docker installation resource')
                check_labels(plan, role, labels)
                owned[kind][role] = item
                if kind == 'volume' and (item.get('Driver') != 'local' or item.get('Options')):
                    refuse('Unsafe Docker volume driver/options')
                if kind == 'network' and (item.get('Driver') != 'bridge' or item.get('Options') or item.get('Internal') or item.get('ConfigOnly')):
                    refuse('Unsafe Docker ingress network')
    owned_ids = {item['Id'] for item in owned['container'].values()}
    for item in containers:
        if item['Id'] not in owned_ids:
            if any(mount.get('Name') in {v['Name'] for v in owned['volume'].values()} for mount in item.get('Mounts', [])):
                refuse('Foreign container uses installation volume')
    for network in owned['network'].values():
        if any(key not in owned_ids for key in (network.get('Containers') or {})):
            refuse('Foreign container uses installation network')
    return owned, containers


def admit_ports(plan, owned, containers):
    own_ids = {item['Id'] for item in owned['container'].values()}
    for binding in plan['ports']:
        address, port, _ = binding.split(':')
        occupied_by_own = False
        for item in containers:
            if not item.get('State', {}).get('Running'):
                continue
            for entries in (item.get('NetworkSettings', {}).get('Ports') or {}).values():
                for entry in entries or []:
                    overlap = address == '0.0.0.0' or entry['HostIp'] in ('0.0.0.0', '::', address)
                    if entry['HostPort'] == port and overlap:
                        if item['Id'] not in own_ids:
                            refuse('Host ingress binding is already occupied')
                        occupied_by_own = True
        if not occupied_by_own:
            with socket.socket() as listener:
                try:
                    listener.bind((address, int(port)))
                except OSError:
                    refuse('Host ingress binding is unavailable')


def label_args(plan, role):
    return [arg for key, value in labels_for(plan, role).items() for arg in ('--label', key + '=' + value)]


def prepare_resources(plan, owned):
    # Images and persistent resources must be available before stopping service.
    app = json.loads(docker('image', 'inspect', plan['digest']))[0]
    if app['Id'] != plan['digest']:
        refuse('Application image identity mismatch')
    caddy = None
    if not plan['local']:
        if not docker('image', 'ls', '--quiet', 'caddy:2.10.2'):
            docker('image', 'pull', 'caddy:2.10.2')
        caddy = json.loads(docker('image', 'inspect', 'caddy:2.10.2'))[0]['Id']
    for role in (['data'] if plan['local'] else ['data', 'caddy', 'caddy-config']):
        if role not in owned['volume']:
            docker('volume', 'create', *label_args(plan, role), plan['name'] + '-' + role)
    if 'ingress' not in owned['network']:
        docker('network', 'create', '--driver', 'bridge', *label_args(plan, 'ingress'), plan['name'] + '-ingress')
    return caddy


def replace_containers(plan, validate, files, caddy):
    # Configuration is the exact content checked in the owned generation.
    # Never ask either Docker client or daemon to reopen a host pathname after
    # shutdown; their filesystem/process namespaces may also be different.
    archive = io.BytesIO()
    if caddy:
        content = files['Caddyfile'].encode()
        with tarfile.open(fileobj=archive, mode='w') as bundle:
            entry = tarfile.TarInfo('Caddyfile')
            entry.size, entry.mode = len(content), 0o600
            bundle.addfile(entry, io.BytesIO(content))
    owned, containers = inventory(plan)
    admit_ports(plan, owned, containers)
    validate()
    # Stop by immutable IDs, with fresh labels on each individual operation.
    # rm never uses -v: persistent data survives replacement and failures.
    for role, item in owned['container'].items():
        current = inspect('container', [item['Id']])[0]
        check_labels(plan, role, current['Config'].get('Labels'))
        validate()
        docker('container', 'stop', '--time', '10', item['Id'])
        check_labels(plan, role, inspect('container', [item['Id']])[0]['Config'].get('Labels'))
        docker('container', 'rm', item['Id'])
    common = ['--restart', 'unless-stopped', '--network', plan['name'] + '-ingress']
    app = ['container', 'create', '--name', plan['name'] + '-app', *label_args(plan, 'app'), *common, '--network-alias', 'app', '--env-file', '/dev/stdin', '--env', 'PORT=8080', '--env', 'RER_IMAGE_DIGEST=' + plan['digest'], '--mount', 'type=volume,source=' + plan['name'] + '-data,target=/data']
    if plan['local']:
        for binding in plan['ports']:
            app.extend(['--publish', binding])
    else:
        app.extend(['--env', 'TRUSTED_PROXY=caddy'])
    app.append(plan['digest'])
    inventory(plan)
    app_id = docker(*app, input=files['settings.env'])
    if caddy:
        args = ['container', 'create', '--name', plan['name'] + '-caddy', *label_args(plan, 'caddy'), *common, '--network-alias', 'caddy', '--mount', 'type=volume,source=' + plan['name'] + '-caddy,target=/data', '--mount', 'type=volume,source=' + plan['name'] + '-caddy-config,target=/config']
        for binding in plan['ports']:
            args.extend(['--publish', binding])
        args.append(caddy)
        inventory(plan)
        caddy_id = docker(*args)
        check_labels(plan, 'caddy', inspect('container', [caddy_id])[0]['Config'].get('Labels'))
        docker('container', 'cp', '-', caddy_id + ':/etc/caddy/', input=archive.getvalue())
        docker('container', 'start', caddy_id)
    check_labels(plan, 'app', inspect('container', [app_id])[0]['Config'].get('Labels'))
    docker('container', 'start', app_id)
