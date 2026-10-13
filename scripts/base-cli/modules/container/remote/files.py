"""Private dirfd custody, including verification of the live pathname chain."""
import os, stat, json, pwd, uuid, fcntl, re


def refuse(message):
    raise RuntimeError(message)


def metadata(info, directory=False, ancestor=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    owners = {0, os.getuid()} if ancestor else {os.getuid()}
    mask = 0o022 if ancestor else 0o077
    if not kind(info.st_mode) or info.st_uid not in owners or info.st_mode & mask or (not directory and info.st_nlink != 1):
        refuse('Unsafe host path ownership, permissions or type')
    return info


def checked(fd, directory=False, ancestor=False):
    return metadata(os.fstat(fd), directory, ancestor)


def same_inode(left, right):
    if right is None or (left.st_dev, left.st_ino) != (right.st_dev, right.st_ino):
        refuse('Host deployment path changed')


def directory(parent, name, create=False, ancestor=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
        except FileExistsError:
            pass
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        checked(fd, True, ancestor)
        return fd
    except BaseException:
        os.close(fd)
        raise


def file_info(parent, name):
    try:
        metadata(os.stat(name, dir_fd=parent, follow_symlinks=False))
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        return None
    try:
        return checked(fd)
    finally:
        os.close(fd)


def read_json(parent, name):
    metadata(os.stat(name, dir_fd=parent, follow_symlinks=False))
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        checked(fd)
        with os.fdopen(os.dup(fd)) as stream:
            return json.load(stream)
    finally:
        os.close(fd)


def exclusive(parent, name, content):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
    try:
        checked(fd)
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(content.encode())
            stream.flush()
            os.fsync(stream.fileno())
        return checked(fd)
    finally:
        os.close(fd)


def retain_file(parent, name):
    # Identity plus exact bytes: a same-UID file transplanted from another
    # installation passes every ownership and permission check.
    try:
        metadata(os.stat(name, dir_fd=parent, follow_symlinks=False))
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        return None
    try:
        info = checked(fd)
        with os.fdopen(os.dup(fd), 'rb') as stream:
            return info, stream.read(65537)
    finally:
        os.close(fd)


def same_file(parent, name, retained):
    current = retain_file(parent, name)
    if retained is None or current is None:
        if retained is not current:
            refuse('Host deployment path changed')
        return
    same_inode(retained[0], current[0])
    if current[1] != retained[1]:
        refuse('Host deployment file changed')


def open_install(plan):
    # Do not resolve symlinks before checking them. System ancestors may belong
    # to root; the account home and private deployment tree must belong to uid.
    home = pwd.getpwuid(os.getuid()).pw_dir
    if not home.startswith('/') or any(part in ('.', '..') for part in home.split('/')):
        refuse('Unsafe account home')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    checked(fd, True, True)
    chain = [('/', fd, True)]
    for part in filter(None, home.split('/')):
        nxt = directory(fd, part, ancestor=True)
        chain.append((part, nxt, True))
        fd = nxt
    info = os.fstat(fd)
    if info.st_uid != os.getuid():
        refuse('Account home is not owned by login user')
    base = directory(fd, '.rer-host', create=True)
    chain.append(('.rer-host', base, False))
    # One host-account lock also serializes creation and binding admission for
    # cooperating installs. The pathname chain is checked independently of it.
    file_info(base, 'deploy.lock')
    lock = os.open('deploy.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=base)
    checked(lock)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    created = False
    try:
        os.mkdir(plan['name'], 0o700, dir_fd=base)
        created = True
    except FileExistsError:
        pass
    install = directory(base, plan['name'])
    chain.append((plan['name'], install, False))
    if created:
        exclusive(install, 'owner.json', json.dumps(plan['labels']))
    if read_json(install, 'owner.json') != plan['labels']:
        refuse('Installation ownership mismatch')
    validate_install(chain, lock, plan)
    return install, lock, home + '/.rer-host/' + plan['name'], chain


def validate_install(chain, lock, plan):
    # A retained dirfd remains usable after rename. Check each original edge
    # from / as well, so it cannot silently become a detached installation.
    parent = None
    for name, fd, ancestor in chain:
        info = checked(fd, True, ancestor)
        if parent is not None:
            linked = metadata(os.stat(name, dir_fd=parent, follow_symlinks=False), True, ancestor)
            same_inode(info, linked)
        parent = fd
    if os.fstat(chain[-3][1]).st_uid != os.getuid():
        refuse('Account home is not owned by login user')
    same_inode(checked(lock), file_info(chain[-2][1], 'deploy.lock'))
    install = chain[-1][1]
    if read_json(install, 'owner.json') != plan['labels']:
        refuse('Installation ownership mismatch')
    validate_tree(install)


def validate_tree(install):
    checked(install, True)
    for entry in os.listdir(install):
        if entry in ('owner.json', 'current.json'):
            file_info(install, entry)
        elif re.fullmatch(r'current-[0-9a-f]{32}', entry):
            file_info(install, entry)
        elif re.fullmatch(r'(generation|stage)-[0-9a-f]{32}', entry):
            child = directory(install, entry)
            try:
                for name in os.listdir(child):
                    if name not in ('settings.env', 'compose.yaml', 'Caddyfile'):
                        refuse('Unexpected deployment file')
                    file_info(child, name)
            finally:
                os.close(child)
        else:
            refuse('Unexpected installation path')


def stage_files(install, files):
    token = uuid.uuid4().hex
    stage = 'stage-' + token
    os.mkdir(stage, 0o700, dir_fd=install)
    fd = directory(install, stage)
    try:
        records = {}
        for name, contents in files.items():
            records[name] = (contents, exclusive(fd, name, contents))
        os.fsync(fd)
        return stage, 'generation-' + token, fd, records
    except BaseException:
        os.close(fd)
        raise


def validate_generation(install, name, fd, records):
    validate_generation_entries(install, name, fd, {filename: created for filename, (_, created) in records.items()})
    for filename, (contents, created) in records.items():
        file = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            same_inode(created, checked(file))
            with os.fdopen(os.dup(file), 'rb') as stream:
                if stream.read(len(contents.encode()) + 1) != contents.encode():
                    refuse('Host deployment file changed')
        finally:
            os.close(file)


def validate_generation_entries(install, name, fd, entries):
    same_inode(checked(fd, True), metadata(os.stat(name, dir_fd=install, follow_symlinks=False), True))
    if set(os.listdir(fd)) != set(entries):
        refuse('Unexpected deployment file')
    for filename, created in entries.items():
        same_inode(created, file_info(fd, filename))


def retain_generation(install, name):
    fd = directory(install, name)
    try:
        entries = {}
        for filename in os.listdir(fd):
            if filename not in ('settings.env', 'compose.yaml', 'Caddyfile'):
                refuse('Unexpected deployment file')
            info = file_info(fd, filename)
            if info is None:
                refuse('Host deployment path changed')
            entries[filename] = info
        validate_generation_entries(install, name, fd, entries)
        return fd, entries
    except BaseException:
        os.close(fd)
        raise


def publish_generation(install, stage, generation):
    validate_tree(install)
    os.rename(stage, generation, src_dir_fd=install, dst_dir_fd=install)


def commit_manifest(install, generation, current):
    # A single atomic commit points to a complete generation; interrupted
    # transfers cannot make an existing installation run partial configuration.
    # Only the manifest retained before asynchronous work may be replaced.
    content = json.dumps({'generation': generation})
    pending = 'current-' + uuid.uuid4().hex
    committed = (exclusive(install, pending, content), content.encode())
    try:
        same_file(install, pending, committed)
        same_file(install, 'current.json', current)
        os.replace(pending, 'current.json', src_dir_fd=install, dst_dir_fd=install)
        os.fsync(install)
        same_file(install, 'current.json', committed)
        return committed
    finally:
        remaining = file_info(install, pending)
        if remaining is not None:
            same_inode(committed[0], remaining)
            os.unlink(pending, dir_fd=install)


def remove_generation(install, name, fd, entries):
    # A private path can still have been replaced by the same login UID.
    # Validate the whole retained generation before removing any member, then
    # require the captured identity again immediately before each deletion.
    validate_generation_entries(install, name, fd, entries)
    for entry, created in entries.items():
        same_inode(checked(fd, True), metadata(os.stat(name, dir_fd=install, follow_symlinks=False), True))
        same_inode(created, file_info(fd, entry))
        os.unlink(entry, dir_fd=fd)
    same_inode(checked(fd, True), metadata(os.stat(name, dir_fd=install, follow_symlinks=False), True))
    os.rmdir(name, dir_fd=install)
