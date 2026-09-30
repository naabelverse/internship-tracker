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
#
# It also replays the server's trigger query (TRIGGERS=...): an empty list passes, while a trigger,
# a reply with no "data" and a network error each fail with exit 1. The last two are the bug from
# PR #43's check, where an ECONNRESET was printed and the script still said DONE.
#
# Checks 2 and 3 are failed one at a time (SERVER_STATUS=FAILED, DUPLICATE=client), and no-rerun
# fails check 1. Each must end in FAILED with exit 1, which they did not before issue #45.
#
# GH_FAIL=<call>:<n> makes the first n attempts of one gh call fail with a connection error, for the
# Deploy run's conclusion, the CI conclusion or the Deploy log. One failure must be retried away; two
# must read as "unknown", never as a blank or "not found". On the check of PR #58's deploy, a dropped
# connection printed "conclusion=" with nothing after it.

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
key=""
case "$args" in
  *"--workflow ci.yml"*) key=ci ;;
  *"run view"*"--json conclusion"*) key=conclusion ;;
  *"run view"*"--log"*) key=log ;;
esac
if [ -n "$key" ] && [ "${GH_FAIL%%:*}" = "$key" ]; then
  n=$(( $(cat "$WORK/fail-$key" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$WORK/fail-$key"
  if [ "$n" -le "${GH_FAIL#*:}" ]; then
    echo 'Get "https://api.github.com/repos/x/y": dial tcp 20.205.243.168:443: connectex: A connection attempt failed' >&2
    exit 1
  fi
fi
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

# railway: one SUCCESS deployment per service, with the id the Deploy log names. SERVER_STATUS
# replaces the server's status (check 2), and DUPLICATE=client adds a second client record at the
# same commit, as a deploy from outside deploy.yml would (check 3).
cat > "$WORK/bin/railway" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *client*) svc=client id=aaaa-0001 status=SUCCESS ;;
  *) svc=server id=bbbb-0002 status=${SERVER_STATUS:-SUCCESS} ;;
esac
extra=""
if [ "${DUPLICATE:-}" = "$svc" ]; then
  extra=",{\"id\":\"cccc-0003\",\"status\":\"SKIPPED\",\"createdAt\":\"2026-09-25T00:00:01Z\",\"meta\":{\"commitHash\":\"$SHA\",\"reason\":\"deploy\"}}"
fi
echo "[{\"id\":\"$id\",\"status\":\"$status\",\"createdAt\":\"2026-09-25T00:00:00Z\",\"meta\":{\"commitHash\":\"$SHA\",\"reason\":\"deploy\"}}$extra]"
EOF

# node: only railway-query.mjs is faked. Every other call (the deployment list parser) runs the real
# node. The client's trigger list is always empty; the server's reply is chosen by TRIGGERS.
REAL_NODE=$(command -v node)
SERVER_ID=4b5bd6cc-d005-4447-b0ec-6589cc2a45b2
cat > "$WORK/bin/node" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *railway-query.mjs)
    mode=empty
    case "$3" in *"$SERVER_ID"*) mode=${TRIGGERS:-empty} ;; esac
    case "$mode" in
      empty) echo '{"data":{"deploymentTriggers":{"edges":[]}}}' ;;
      present) echo '{"data":{"deploymentTriggers":{"edges":[{"node":{"id":"trig-0001"}}]}}}' ;;
      no-data) echo '{"errors":[{"message":"Not Authorized"}]}' ;;
      econnreset) echo "TypeError: fetch failed [cause]: Error: read ECONNRESET" >&2; exit 1 ;;
    esac ;;
  *) exec "$REAL_NODE" "$@" ;;
esac
EOF

printf '#!/usr/bin/env bash\n' > "$WORK/bin/sleep"
chmod +x "$WORK/bin/gh" "$WORK/bin/railway" "$WORK/bin/node" "$WORK/bin/sleep"

failures=0
# expect <scenario> <extra env> <pattern that must appear>... ; a pattern starting with ! must not.
expect() {
  local scenario=$1 env=$2; shift 2
  rm -f "$WORK/calls" "$WORK"/fail-*
  local out
  # HOME points at an empty directory, so nothing can pick up a real Railway login. The script's exit
  # code is appended as "exit=N" so patterns can assert on it.
  out=$(env $env SCENARIO="$scenario" WORK="$WORK" SHA="$SHA" HOME="$WORK/home" \
    REAL_NODE="$REAL_NODE" SERVER_ID="$SERVER_ID" \
    PATH="$WORK/bin:$PATH" bash "$SCRIPT_DIR/watch-deploy.sh" --sha "$SHA" 2>&1; echo "exit=$?")
  for pattern in "$@"; do
    if [ "${pattern#!}" != "$pattern" ]; then
      echo "$out" | grep -qF -- "${pattern#!}" && { echo "FAIL [$scenario]: unexpected '${pattern#!}'"; failures=$((failures + 1)); }
    else
      echo "$out" | grep -qF -- "$pattern" || { echo "FAIL [$scenario]: missing '$pattern'"; failures=$((failures + 1)); }
    fi
  done
  echo "ran [$scenario${env:+ $env}] $(echo "$out" | tail -1)"
}

expect green "" \
  "DEPLOY RUN 222 conclusion=success" "CHECK 1 PASS" "!skipped" \
  "CHECK 3 PASS: @internship-tracker/client" "CHECK 3 PASS: @internship-tracker/server" \
  "TRIGGERS client PASS: none" "TRIGGERS server PASS: none" "DONE" "exit=0"
expect rerun "" \
  "Deploy run 111 was skipped" "DEPLOY RUN 222 conclusion=success" "CHECK 1 PASS" \
  "CHECK 3 PASS: @internship-tracker/client" "CHECK 3 PASS: @internship-tracker/server" \
  "DONE" "exit=0"
expect no-rerun "RERUN_WAIT_MINUTES=0" \
  "Deploy run 111 was skipped" "CHECK 1 FAIL: Deploy run 111 was skipped" "!DEPLOY RUN" \
  "FAILED:" "!DONE" "exit=1"

# Checks 2 and 3, each failing on its own while every other check passes.
expect green "SERVER_STATUS=FAILED" \
  "CHECK 1 PASS" "CHECK 2 PASS: @internship-tracker/client" \
  "CHECK 2 FAIL: @internship-tracker/server has no SUCCESS deployment" \
  "CHECK 3 PASS: @internship-tracker/client" "CHECK 3 PASS: @internship-tracker/server" \
  "TRIGGERS server PASS: none" "FAILED: 1 check(s) did not pass" "!DONE" "exit=1"
expect green "DUPLICATE=client" \
  "CHECK 1 PASS" "CHECK 2 PASS: @internship-tracker/client" \
  "CHECK 3 FAIL: @internship-tracker/client has 2 deployment record(s)" \
  "CHECK 3 PASS: @internship-tracker/server" \
  "TRIGGERS server PASS: none" "FAILED: 1 check(s) did not pass" "!DONE" "exit=1"

# A reply with no "data" exits 0 from the query itself, so only the content check can catch it.
expect green "TRIGGERS=no-data" \
  "TRIGGERS client PASS: none" "TRIGGERS server ERROR: query failed (exit 0)" "Not Authorized" \
  "FAILED: 1 check(s) did not pass" "!DONE" "exit=1"
expect green "TRIGGERS=econnreset" \
  "TRIGGERS server ERROR: query failed (exit 1)" "ECONNRESET" \
  "FAILED: 1 check(s) did not pass" "!DONE" "exit=1"
expect green "TRIGGERS=present" \
  "TRIGGERS server FAIL: a deployment trigger is back" "trig-0001" \
  "FAILED: 1 check(s) did not pass" "!DONE" "exit=1"

# A gh call that drops its connection once is retried, and the report is the same as a clean run.
expect green "GH_FAIL=conclusion:1"   "DEPLOY RUN 222 conclusion=success" "CHECK 1 PASS" "DONE" "exit=0"
# Twice, and it is marked unknown with gh's error, not left blank. The conclusion is informational
# (checks 1-3 decide), so the run still ends in DONE when every check passed.
expect green "GH_FAIL=conclusion:2"   "DEPLOY RUN 222 conclusion=unknown (gh failed twice:" "dial tcp" "!conclusion=success"   "CHECK 1 PASS" "DONE" "exit=0"
expect green "GH_FAIL=ci:2"   "CI conclusion: unknown (gh failed twice:" "!CI conclusion: not found" "DONE" "exit=0"
# Without the log there is no way to tell which deployments deploy.yml queued, so check 1 is an
# error rather than "0 of 2 services queued", which blamed the deploy for a network fault.
expect green "GH_FAIL=log:2"   "CHECK 1 ERROR: could not read Deploy run 222's log" "dial tcp" "!0 of 2 services queued"   "FAILED:" "!DONE" "exit=1"

if [ "$failures" -eq 0 ]; then echo "PASS: all scenarios"; else echo "$failures failure(s)"; exit 1; fi
