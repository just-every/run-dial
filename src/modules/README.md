# Runtime Base erasure adoption

The erasure runtime files, declaration and schema were copied byte-for-byte from
Base commit 4eed99c6a4ca708a9db70d4b5759f5678053cdf5 (helper commit 27d83fa).
The copy list is the committed modules/erasure/README.md list.
Dial-specific graph, policy, authorization and UI live in core/features/erasure.
The adapter composes the maintained portability service; no second fence is defined.
