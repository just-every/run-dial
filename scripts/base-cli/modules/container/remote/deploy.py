import sys


def deploy():
    payload = json.load(sys.stdin)
    plan = payload['plan']
    install, lock, path, chain = open_install(plan)
    stage = generation_fd = None
    previous, pending = {}, {}
    try:
        # Retain cleanup identities before Docker/other asynchronous work can
        # give another process an opportunity to substitute private paths.
        for entry in os.listdir(install):
            if re.fullmatch(r'(generation|stage)-[0-9a-f]{32}', entry):
                previous[entry] = retain_generation(install, entry)
            elif re.fullmatch(r'current-[0-9a-f]{32}', entry):
                pending[entry] = file_info(install, entry)
                if pending[entry] is None:
                    refuse('Host deployment path changed')
        manifest = retain_file(install, 'current.json')
        def validate_previous():
            for entry, (fd, entries) in previous.items():
                validate_generation_entries(install, entry, fd, entries)
            for entry, created in pending.items():
                same_inode(created, file_info(install, entry))
            same_file(install, 'current.json', manifest)
        owned, containers = inventory(plan)
        admit_ports(plan, owned, containers)
        if payload.get('phase') == 'check':
            print('{}')
            return
        stage, generation, generation_fd, records = stage_files(install, payload['files'])
        caddy = prepare_resources(plan, owned)
        # Recheck destinations and all resource ownership immediately before
        # committing a complete generation and before the first shutdown.
        inventory(plan)
        validate_install(chain, lock, plan)
        validate_previous()
        validate_generation(install, stage, generation_fd, records)
        publish_generation(install, stage, generation)
        stage = generation
        manifest = commit_manifest(install, generation, manifest)
        stage = None
        def validate():
            validate_install(chain, lock, plan)
            validate_previous()
            validate_generation(install, generation, generation_fd, records)
        replace_containers(plan, validate, payload['files'], caddy)
        validate()
        for entry, (fd, entries) in previous.items():
            remove_generation(install, entry, fd, entries)
        for entry, created in pending.items():
            same_inode(created, file_info(install, entry))
            os.unlink(entry, dir_fd=install)
        print(json.dumps({'installation': path, 'generation': generation}))
    finally:
        try:
            if stage:
                remove_generation(install, stage, generation_fd, {filename: created for filename, (_, created) in records.items()})
        finally:
            if generation_fd is not None:
                os.close(generation_fd)
            for fd, _ in previous.values():
                os.close(fd)
            for _, fd, _ in reversed(chain):
                os.close(fd)
            os.close(lock)


try:
    deploy()
except BaseException as error:
    # No exceptions from parsers or subprocesses may echo private inputs.
    message = str(error) if isinstance(error, RuntimeError) else 'Host deployment refused: unsafe path or failed operation'
    print(message, file=sys.stderr)
    sys.exit(1)
