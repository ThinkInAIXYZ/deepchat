#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release-fast-forward.sh <target-ref> [--tag <tag>] [--remote <remote>]

Fast-forward origin/main to a reviewed release branch or commit that already exists on origin/dev.

Examples:
  scripts/release-fast-forward.sh release/v1.0.0-beta.4
  scripts/release-fast-forward.sh origin/release/v1.0.0-beta.4 --tag v1.0.0-beta.4
  pnpm run release:ff -- release/v1.0.0-beta.4 --tag v1.0.0-beta.4
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

REMOTE='origin'
TARGET_REF=''
TAG_NAME=''

while (($# > 0)); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --remote)
      [[ $# -ge 2 ]] || fail "--remote requires a value"
      REMOTE="$2"
      shift 2
      ;;
    --tag)
      [[ $# -ge 2 ]] || fail "--tag requires a value"
      TAG_NAME="$2"
      shift 2
      ;;
    *)
      if [[ -z "$TARGET_REF" ]]; then
        TARGET_REF="$1"
        shift
      else
        fail "Unexpected argument: $1"
      fi
      ;;
  esac
done

[[ -n "$TARGET_REF" ]] || {
  usage
  exit 1
}

if [[ -n "$(git status --porcelain)" ]]; then
  fail "Working tree must be clean before fast-forwarding main."
fi

resolve_commit_ref() {
  local ref="$1"

  if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
    printf '%s' "$ref"
    return 0
  fi

  if git rev-parse --verify --quiet "refs/remotes/${REMOTE}/${ref}^{commit}" >/dev/null; then
    printf '%s' "${REMOTE}/${ref}"
    return 0
  fi

  return 1
}

fetch_target_ref() {
  local ref="$1"

  case "$ref" in
    refs/*)
      return 0
      ;;
    "${REMOTE}/"*)
      local remote_branch="${ref#${REMOTE}/}"
      git fetch "$REMOTE" "${remote_branch}:${ref}" --prune >/dev/null 2>&1 || true
      ;;
    *)
      git fetch "$REMOTE" "${ref}:refs/remotes/${REMOTE}/${ref}" --prune >/dev/null 2>&1 || true
      ;;
  esac
}

echo "Fetching ${REMOTE}/dev and ${REMOTE}/main..."
git fetch "$REMOTE" dev main --prune
fetch_target_ref "$TARGET_REF"

RESOLVED_TARGET_REF="$(resolve_commit_ref "$TARGET_REF")" || fail "Unable to resolve target ref: ${TARGET_REF}"
TARGET_SHA="$(git rev-parse "${RESOLVED_TARGET_REF}^{commit}")"
REMOTE_MAIN_REF="refs/remotes/${REMOTE}/main"
REMOTE_DEV_REF="refs/remotes/${REMOTE}/dev"
REMOTE_MAIN_SHA="$(git rev-parse "${REMOTE_MAIN_REF}^{commit}")"

if ! git merge-base --is-ancestor "$TARGET_SHA" "$REMOTE_DEV_REF"; then
  fail "Target commit ${TARGET_SHA} is not contained in ${REMOTE}/dev."
fi

if ! git merge-base --is-ancestor "$REMOTE_MAIN_SHA" "$TARGET_SHA"; then
  fail "${REMOTE}/main is not an ancestor of target commit ${TARGET_SHA}."
fi

if [[ "$RESOLVED_TARGET_REF" != release/* && "$RESOLVED_TARGET_REF" != "${REMOTE}/release/"* ]]; then
  echo "Warning: target ref is not a release/* branch. Continuing because the commit passed ancestry checks." >&2
fi

if [[ -n "$TAG_NAME" ]]; then
  [[ "$TAG_NAME" == v* ]] || fail "Tag must start with 'v'."

  if git rev-parse --verify --quiet "refs/tags/${TAG_NAME}" >/dev/null; then
    fail "Local tag ${TAG_NAME} already exists."
  fi

  if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/${TAG_NAME}" >/dev/null 2>&1; then
    fail "Remote tag ${TAG_NAME} already exists on ${REMOTE}."
  fi
fi

ORIGINAL_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
restore_branch() {
  if [[ -n "$ORIGINAL_BRANCH" && "$ORIGINAL_BRANCH" != 'main' ]]; then
    git switch "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true
  fi
}
trap restore_branch EXIT

if git show-ref --verify --quiet refs/heads/main; then
  git switch main >/dev/null
else
  git switch --track -c main "${REMOTE}/main" >/dev/null
fi

if ! git merge-base --is-ancestor main "$REMOTE_MAIN_REF"; then
  fail "Local main contains commits not present on ${REMOTE}/main. Sync or clean local main first."
fi

git merge --ff-only "$REMOTE_MAIN_REF" >/dev/null
git merge --ff-only "$TARGET_SHA" >/dev/null
git push "$REMOTE" main

echo "Fast-forwarded ${REMOTE}/main to ${TARGET_SHA}."

if [[ -n "$TAG_NAME" ]]; then
  cat <<EOF
Tag ${TAG_NAME} was validated but not created automatically.
Create it on the released commit with:
  git tag ${TAG_NAME} ${TARGET_SHA}
  git push ${REMOTE} ${TAG_NAME}
EOF
fi
