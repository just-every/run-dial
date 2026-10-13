# Publication scan implementation

See [setup, command and scope](../publish-check-README.md).

`git_history.py` delegates revision resolution, traversal, tree inventory and
blob reads to system Git (`rev-parse`, `rev-list`, `ls-tree`, `cat-file --batch`).
`gitleaks.py` runs the pinned scanner in git, directory and stdin modes and keeps
its report private until translating it into the value-free v3 envelope.
Hexadecimal credential assignments also use a Gitleaks rule without generic
entropy or English stopword filters. Both assignment rules go through the same
location-bound Source/module identity proof; provider and environment findings
remain independent.
`tree_scan.py` applies the kept text and licence policy. `history_scan.py`
assigns release, working-tree and historical scopes. The Node entry point bounds
the whole operation and stops its private process group on timeout/cancellation.

Binary metadata decoding, Git protocol/object/ref modelling, frozen comparison,
resumable inspection and their tests have been removed. Tests live in `tests.py`
and `coverage_tests.py` and construct disposable repositories with actual Git.

`content_identities.py` classifies only exact generic-api-key occurrences at
proved Source key locations. It requires same-tree edition/lock selections,
manifest and archive hashes, valid retained file records, and exact native match
bytes. Retained archive bytes must hash to the maintained Source serializer's
`hash(json(saved))` as well as the selected pin. `source_hashes.mjs` reuses that
serializer. Duplicate JSON fields, non-JSON constants (including ignored fields),
incorrect types, missing preimages, mismatched pins and unrecognized locations keep
the native finding. Each selection's complete dependency closure must have valid
archive and pin proofs before any location in that graph is allowed; unrelated
coherent selections remain eligible. Normal origin repositories obey the maintained
Source schema, including rejection of strings starting with `-`.
Original/private keys and arbitrary copies of a known digest
are not proofs. Provider and environment findings are unaffected. Native git/dir
matches are held only in the private temporary report and memory for this proof;
matched values are never added to the public report. This classification does not
replace or relax the edition-authoring check.

`copy_identities.py` proves the maintained `base-copies.json` and portable
`base/PROVENANCE.json` copy-inventory SHA-256 values
against every declared file's bytes and regular-file mode in the same scanned
tree. Historical matches use only that commit's blobs; present files cannot
rescue a historical mismatch. Working-tree preimages reject linked paths.
Only the exact native match at a proved inventory field is classified. There
is no filename, hash-value or comma-delimited credential exemption.

`checksum_maps.py` classifies a file-name to digest map (`'0005_operator_auth.sql':
'<sha256>'`, in JSON, JavaScript, YAML or similar) in any file outside the
content-identity documents above. The native match must sit in a run of
`name: digest` entries separated only by commas, semicolons, whitespace and line
comments, and every entry in that run must name a regular file in the same scanned
tree (a path, or a trailing path component) whose bytes hash to that SHA-256. One
entry that does not prove, a 40-hex value, a key that names no tree file, or a hex
value with no file-name key keeps the native finding. Historical matches use only
that commit's blobs and working-tree preimages reject linked paths. There is no
path, filename, hash-value or repository exemption. `hit_location.py` resolves
the native match's exact bytes for both proofs.

`trust_bundle.py` classifies an email match as public CA certificate metadata
only when all of these hold: the file's path is an artifact listed by a committed
`trust-bundle.json` in its directory and its bytes hash to the SHA-256 pinned
there; that manifest's webpki-roots release and checksum are exactly the one the
same directory's `Cargo.lock` locks from crates.io; and the match lies entirely
inside an attribute value of a subject Name parsed (`der.py`, strict DER) from
those bytes, where the anchor's subject Name and SubjectPublicKeyInfo DER both
occur in the file and hash to one anchor entry of the manifest. With the verified
subject values blanked, no email may remain, and every match must be one found
inside them; otherwise the file keeps `hygiene.email`. Historical blobs use their
own commit's manifest and lock; working-tree files use the selected commit's.
The build that produces the artifacts (`modules/egress-service/tls/build.mjs`)
regenerates the manifest, and its `--check` mode rejects a stale one. An
alphabetic top-level domain label ends before a following digit, so a match
ends at the DER string's boundary rather than absorbing the next tag byte.
