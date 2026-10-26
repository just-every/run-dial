#!/usr/bin/env bash
set -euo pipefail

wf="${WF_REF%@*}"; wf="${wf##*/}"
# Only the newest same-repository push of this workflow is evidence. PR runs
# may themselves be skips; dispatches may exercise a subset. Errors fail closed.
newest_push() {
  gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs?head_sha=$1&event=push&per_page=100" \
    --jq "[.workflow_runs[] | select(.event == \"push\" and .head_sha == \"$1\" and .head_repository.full_name == \"$GITHUB_REPOSITORY\" and .id != $GITHUB_RUN_ID)] | max_by(.id) | select(. != null) | \"\(.status) \(.conclusion)\"" || true
}
green() { [ "$(newest_push "$1")" = 'completed success' ]; }

skip=false
if [ "$EVENT" = push ] && [ "$REF" = refs/heads/main ] && green "$GITHUB_SHA"; then skip=true; fi
if [ "$skip" = false ] && [ "$EVENT" = push ] && parent=$(git rev-parse -q --verify HEAD~1) \
   && [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD~1^{tree}')" ] && green "$parent"; then skip=true; fi
if [ "$EVENT" = pull_request ] && [ "$SAME_REPO" = true ]; then
  for _ in $(seq 1 50); do
    state=$(newest_push "$PR_HEAD")
    case "$state" in
      'completed success') skip=true; break ;;
      ''|completed\ *) break ;;
      *) sleep 30 ;;
    esac
  done
fi
echo "skip=$skip" >> "$GITHUB_OUTPUT"
