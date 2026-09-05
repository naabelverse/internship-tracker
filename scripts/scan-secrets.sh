#!/usr/bin/env bash
#
# Scans the whole git history for committed secrets.
#
# SPEC section 11 asks for this to be verified rather than assumed, and "we were
# careful" is not a verification. Runs gitleaks over every commit, not just the
# working tree: a secret that was committed and later deleted is still in the
# history and still compromised.
#
# Docker is used so the check needs no local install and pins nothing to one
# machine's toolchain.
#
# Usage: scripts/scan-secrets.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="zricethezav/gitleaks:latest"

echo "Scanning every commit for secrets with ${IMAGE}"
echo

# MSYS_NO_PATHCONV stops Git Bash on Windows from rewriting the container path.
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${REPO_ROOT}:/repo" \
  "${IMAGE}" detect \
  --source=/repo \
  --config=/repo/.gitleaks.toml \
  --redact \
  --no-banner \
  --verbose

echo
echo "No secrets found in the git history."
