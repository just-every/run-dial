"""Public-tree and message hygiene; findings never include matched values."""
from collections import Counter
import re
from github_refs import REPOSITORY_HOSTS, references
from destination import RULE as PENDING_DESTINATION
from hygiene_text import decoded_text
from provenance import provenance_text
from hygiene_config import EMAIL, LOCAL_PATH, public_email
from font_licence import without_required_notices
from trust_bundle import anchor_values
URI_AUTHORITY = re.compile(r'''(?i)(?a:(?P<scheme>[a-z][a-z0-9+.-]*:))?//(?P<authority>[^/?#\s<>"']+)''')


def email_userinfo(match):
    userinfo, _, host = match['authority'].rpartition('@')
    # Without a scheme, arbitrary //text can also be a source comment.
    if not match['scheme'] and host.lower().split(':', 1)[0] not in REPOSITORY_HOSTS:
        return match.group()
    # Keep actual email-valued userinfo, including a decoded %40, while
    # excluding the host delimiter in an ordinary transport username@host.
    return userinfo


def private_emails(text, config):
    # URL paths, queries and fragments remain visible to email inspection.
    email_text = URI_AUTHORITY.sub(email_userinfo, without_required_notices(text))
    email_text = re.sub(r'(?i)\b(?a:git@github\.com:)(?=[A-Za-z0-9])', '', email_text)
    version = r'(?:v?[0-9]+(?:\.[0-9]+)*(?:-[A-Za-z0-9-]+)?|[a-f0-9]{40})(?![A-Za-z0-9_.-])'
    email_text = re.sub(r'(?m)^\s*-?\s*uses:\s*[\"\']?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[^\s\"\']+', '', email_text)
    email_text = re.sub(r'(?<![A-Za-z0-9])(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?@' + version, '', email_text)
    return [match.group() for match in EMAIL.finditer(email_text) if not public_email(match.group(), config)]


def certificate_metadata(data, bundle, emails, config):
    # Every match lies inside a verified trust-anchor subject value: none
    # remains once those values are blanked, and each is one of theirs.
    spans = anchor_values(data, bundle)
    if not spans:
        return False
    blanked = bytearray(data)
    for start, end in spans:
        blanked[start:end] = b' ' * (end - start)
    if private_emails(decoded_text(bytes(blanked)), config):
        return False
    inside = Counter(match.group() for start, end in spans for match in EMAIL.finditer(decoded_text(data[start:end])))
    return not Counter(emails) - inside


def inspect(data, path, config, resolver):
    return inspect_text(data, path, config, resolver)


def inspect_text(data, path, config, resolver):
    # NUL removal covers UTF-16/32 ASCII content, matching the secret scanner.
    text = decoded_text(data)
    rules = set()
    if LOCAL_PATH.search(text):
        rules.add('hygiene.local-path')
    if any(pattern.search(text) for pattern in config['internalReferencePatterns']):
        rules.add('hygiene.internal-reference')
    if '@' in text:
        emails = private_emails(text, config)
        bundle = config.get('trustBundles', {}).get(path)
        if emails and not (bundle and certificate_metadata(data, bundle, emails, config)):
            rules.add('hygiene.email')
    ref_text, provenance = provenance_text(text, path, config.get('declaredSources', frozenset()))
    for repository in references(ref_text, path, config.get('localPaths', frozenset()), config.get('projectIdentity')):
        # A future source identity does not assert current GitHub visibility.
        # Explicit release destinations still take the strict visibility path.
        if (repository in config.get('intendedPublicRepositories', frozenset()) and
                repository != config.get('pendingDestination')):
            continue
        state = resolver.resolve(repository)
        if state == 'missing' and repository == config.get('pendingDestination'):
            rules.add(PENDING_DESTINATION)
        elif state in ('private', 'missing'):
            rules.add('hygiene.github-' + state)
        elif state != 'public':
            rules.add('scan.github-incomplete')
    return rules, provenance
