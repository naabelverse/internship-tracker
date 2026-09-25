#!/usr/bin/env bash
#
# Regression test for watch-deploy.sh's wait for the Deploy run.
#
#   bash scripts/deploy-checks/test-watch-deploy.sh
#
# It replays three Deploy histories for one real commit, with gh, railway and sleep replaced by
# stubs, so it runs in seconds and needs no login or network:
#   - green:    CI passes and Deploy succeeds the first time.
#   - rerun:    CI is red, so Deploy skips; CI is re-run, and a second Deploy run succeeds.
#   - no-rerun: Deploy skips and nothing re-runs before the deadline.
# The rerun case is the bug this guards: a skipped Deploy run used to be read as the final result.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/home"

# gh: answers the four calls watch-deploy.sh makes. The Deploy run list is scripted per scenario
# by SCENARIO and a call counter; the re-run's Deploy run appears on the third poll.
cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
args="$*"
case "$args" in
  *"--workflow deploy.yml"*)
    n=$(( $(cat "$WORK/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$WORK/calls"
    case "$SCENARIO" in
      green) echo "222 success" ;;
      rerun) if [ "$n" -ge 3 ]; then printf '222 success\n111 skipped\n'; else echo "111 skipped"; fi ;;
      no-rerun) echo "111 skipped" ;;
    esac ;;
  *"--workflow ci.yml"*) [ "$SCENARIO" = green ] && echo success || echo failure ;;
  *"run view"*"--json conclusion"*) [ "$5" = 111 ] && echo skipped || echo success ;;
  *"run view"*"--log"*)
    echo "deploy	Deploy	2026-09-25T00:00:00.0000000Z Railway queued deployment aaaa-0001 of the web service at $SHA."
    echo "deploy	Deploy	2026-09-25T00:00:00.0000000Z Railway queued deployment bbbb-0002 of the API service at $SHA." ;;
esac
EOF

# railway: one SUCCESS deployment per service, with the id the Deploy log names.
cat > "$WORK/bin/railway" <<'EOF'
#!/usr/bin/env bash
case "$*" in *client*) id=aaaa-0001 ;; *) id=bbbb-0002 ;; esac
echo "[{\"id\":\"$id\",\"status\":\"SUCCESS\",\"createdAt\":\"2026-09-25T00:00:00Z\",\"meta\":{\"commitHash\":\"$SHA\",\"reason\":\"deploy\"}}]"
EOF

printf '#!/usr/bin/env bash\n' > "$WORK/bin/sleep"
chmod +x "$WORK/bin/gh" "$WORK/bin/railway" "$WORK/bin/sleep"

failures=0
# expect <scenario> <extra env> <pattern that must appear>... ; a pattern starting with ! must not.
expect() {
  local scenario=$1 env=$2; shift 2
  rm -f "$WORK/calls"
  local out
  # HOME points at an empty directory, so railway-query.mjs finds no login and makes no request.
  out=$(env $env SCENARIO="$scenario" WORK="$WORK" SHA="$SHA" HOME="$WORK/home" \
    PATH="$WORK/bin:$PATH" bash "$SCRIPT_DIR/watch-deploy.sh" --sha "$SHA" 2>&1)
  for pattern in "$@"; do
    if [ "${pattern#!}" != "$pattern" ]; then
      echo "$out" | grep -qF -- "${pattern#!}" && { echo "FAIL [$scenario]: unexpected '${pattern#!}'"; failures=$((failures + 1)); }
    else
      echo "$out" | grep -qF -- "$pattern" || { echo "FAIL [$scenario]: missing '$pattern'"; failures=$((failures + 1)); }
    fi
  done
  echo "ran [$scenario]"
}

expect green "" \
  "DEPLOY RUN 222 conclusion=success" "CHECK 1 PASS" "!skipped" \
  "CHECK 3 PASS: @internship-tracker/client" "CHECK 3 PASS: @internship-tracker/server"
expect rerun "" \
  "Deploy run 111 was skipped" "DEPLOY RUN 222 conclusion=success" "CHECK 1 PASS" \
  "CHECK 3 PASS: @internship-tracker/client" "CHECK 3 PASS: @internship-tracker/server"
expect no-rerun "RERUN_WAIT_MINUTES=0" \
  "Deploy run 111 was skipped" "CHECK 1 FAIL: Deploy run 111 was skipped" "!DEPLOY RUN"

if [ "$failures" -eq 0 ]; then echo "PASS: all scenarios"; else echo "$failures failure(s)"; exit 1; fi
