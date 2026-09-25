#!/usr/bin/env bash
#
# Checks that a merge to main was deployed by deploy.yml, and only by deploy.yml.
# Read-only throughout: it never deploys, redeploys or changes a Railway setting.
#
#   scripts/deploy-checks/watch-deploy.sh                # wait for the next merge touching client/ or server/
#   scripts/deploy-checks/watch-deploy.sh --since <sha>  # the first such merge after <sha>
#   scripts/deploy-checks/watch-deploy.sh --sha <sha>    # check a merge that has already landed
#
# Checks, per DEPLOYMENT.md "Checking a deploy":
#   1. The Deploy run for the merge logs a queued deployment for both services at that commit.
#   2. Each service has a Railway deployment at that commit ending in SUCCESS.
#   3. Each service has exactly one deployment record, of any status, at that commit, and its id
#      is the one deploy.yml logged. Railway's push trigger is deleted, so even a SKIPPED record
#      means something other than deploy.yml is deploying.
# Finally it re-checks that neither service has grown a deployment trigger back. A trigger found, or
# a trigger query that fails (no "data" in the reply), prints FAILED instead of DONE and exits 1.
#
# A Deploy run skipped because CI was red is not treated as the result: the script keeps watching
# the same commit for a re-run's Deploy. DEPLOY_WAIT_MINUTES (default 60) bounds the wait for the
# first Deploy result; RERUN_WAIT_MINUTES (default 360) bounds the wait after a skip. Set
# RERUN_WAIT_MINUTES=0 to report a skip at once. test-watch-deploy.sh covers this.
#
# Needs git, gh (logged in), node and the Railway CLI (`railway login`; `railway whoami`
# refreshes an expired session). The ids below are this project's production ids. They are
# identifiers, not credentials; override them with the environment variables for another project.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

REPO="${GITHUB_REPO:-naabelverse/internship-tracker}"
PROJECT="${RAILWAY_PROJECT_ID:-066337f8-6ed8-4ad8-a57d-bd3aeef3e606}"
ENV_ID="${RAILWAY_ENVIRONMENT_ID:-9db1105b-3231-4234-ae28-5d79eca1bd1f}"
CLIENT_SERVICE="@internship-tracker/client"
SERVER_SERVICE="@internship-tracker/server"
CLIENT_SERVICE_ID="${RAILWAY_CLIENT_SERVICE_ID:-b9024249-9c27-4137-b42c-41375fc4586e}"
SERVER_SERVICE_ID="${RAILWAY_SERVER_SERVICE_ID:-4b5bd6cc-d005-4447-b0ec-6589cc2a45b2}"

sha=""
base=""
case "${1:-}" in
  --sha) sha=$(git rev-parse "${2:?--sha needs a commit}") || exit 2 ;;
  --since) base=$(git rev-parse "${2:?--since needs a commit}") || exit 2 ;;
  "") git fetch -q origin main && base=$(git rev-parse origin/main) || exit 2 ;;
  *) echo "usage: $0 [--since <sha> | --sha <sha>]" >&2; exit 2 ;;
esac

# Prints "createdAt status id reason" for each recent deployment of commit $2 on service $1.
# A CLI failure is printed, not hidden, so an expired login cannot pass for "no deployments".
list_deploys() {
  railway deployment list -p "$PROJECT" -e production --service "$1" --json 2>&1 | node -e '
    let x="";process.stdin.on("data",d=>x+=d).on("end",()=>{
      try{for(const d of JSON.parse(x).slice(0,15)) if(d.meta?.commitHash===process.argv[1])
        console.log(`${d.createdAt} ${d.status} ${d.id} reason=${d.meta.reason||"-"}`)}
      catch(e){console.log("RAILWAY-ERROR "+x.slice(0,200).replace(/\n/g," "))}})' "$2"
}

if [ -z "$sha" ]; then
  echo "Waiting for the first merge after $(git rev-parse --short "$base") that touches client/ or server/..."
fi
while [ -z "$sha" ]; do
  git fetch -q origin main || echo "git fetch failed; retrying" >&2
  for c in $(git rev-list --first-parent --reverse "$base..origin/main"); do
    if git diff --quiet "$c^1" "$c" -- client server; then continue; fi
    sha=$c; break
  done
  [ -z "$sha" ] && sleep 60
done
echo "MERGE $(git log -1 --format='%h %ci %s' "$sha")"
for d in client server; do
  if git diff --quiet "$sha^1" "$sha" -- "$d"; then echo "  touches $d/: no"; else echo "  touches $d/: YES"; fi
done

# Wait for CI and then a Deploy run that actually ran. A red CI makes Deploy skip itself, but that
# is not the final word: re-running CI on the same commit starts a new Deploy run. So a skipped run
# only resets the deadline, to RERUN_WAIT_MINUTES, and the wait continues for a run that ran.
deploy_wait=${DEPLOY_WAIT_MINUTES:-60}
rerun_wait=${RERUN_WAIT_MINUTES:-360}
deadline=$(( $(date +%s) + deploy_wait * 60 ))
run=""
skipped=""
while :; do
  runs=$(gh run list -R "$REPO" --workflow deploy.yml --limit 20 --json databaseId,headSha,status,conclusion \
    --jq ".[] | select(.headSha==\"$sha\" and .status==\"completed\") | \"\(.databaseId) \(.conclusion)\"")
  run=$(echo "$runs" | awk '$2 != "skipped" && $1 != "" { print $1; exit }')
  [ -n "$run" ] && break
  s=$(echo "$runs" | awk '$2 == "skipped" { print $1; exit }')
  if [ -n "$s" ] && [ -z "$skipped" ]; then
    skipped=$s
    echo "Deploy run $s was skipped (CI was not green). Waiting up to $rerun_wait min for a re-run to deploy..."
    deadline=$(( $(date +%s) + rerun_wait * 60 ))
  fi
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 30
done
ci=$(gh run list -R "$REPO" --workflow ci.yml --limit 10 --json headSha,conclusion,event \
  --jq ".[] | select(.headSha==\"$sha\" and .event==\"push\") | .conclusion" | head -1)
echo "CI conclusion: ${ci:-not found}"

# deploy.yml logs "Railway queued deployment <id> of the web service|API service at <sha>."
queued=""
if [ -z "$run" ] && [ -n "$skipped" ]; then
  echo "CHECK 1 FAIL: Deploy run $skipped was skipped because CI was not green, and no re-run deployed within $rerun_wait min"
elif [ -z "$run" ]; then
  echo "CHECK 1 FAIL: no completed Deploy run for $sha within $deploy_wait min"
else
  echo "DEPLOY RUN $run conclusion=$(gh run view -R "$REPO" "$run" --json conclusion --jq .conclusion)"
  queued=$(gh run view -R "$REPO" "$run" --log | grep -E 'Railway queued deployment|Railway API error|No service|skipping' \
    | grep -v 'echo ' | sed -E 's/^.*[0-9]Z //')
  echo "$queued"
  n=$(echo "$queued" | grep -c "Railway queued deployment .* at $sha\.")
  if [ "$n" -eq 2 ]; then echo "CHECK 1 PASS: both services queued at $sha"
  else echo "CHECK 1 FAIL: $n of 2 services queued at $sha"; fi
fi

# Let Railway's builds settle before judging.
for _ in $(seq 1 40); do
  all="$(list_deploys "$CLIENT_SERVICE" "$sha")$(list_deploys "$SERVER_SERVICE" "$sha")"
  echo "$all" | grep -qE 'BUILDING|DEPLOYING|INITIALIZING|QUEUED|WAITING' || break
  sleep 30
done
sleep 90

for pair in "$CLIENT_SERVICE:web service" "$SERVER_SERVICE:API service"; do
  svc=${pair%%:*}; label=${pair#*:}
  rows=$(list_deploys "$svc" "$sha")
  echo "RAILWAY $svc deployments at $sha:"; echo "${rows:-  (none)}" | sed 's/^/  /'
  want=$(echo "$queued" | sed -nE "s/^Railway queued deployment ([0-9a-f-]+) of the $label at .*/\1/p")
  if echo "$rows" | grep -q " SUCCESS "; then echo "CHECK 2 PASS: $svc SUCCESS at $sha"
  else echo "CHECK 2 FAIL: $svc has no SUCCESS deployment at $sha"; fi
  count=$(echo "$rows" | grep -c . || true)
  if [ "$count" -eq 1 ] && [ -n "$want" ] && echo "$rows" | grep -q " $want "; then
    echo "CHECK 3 PASS: $svc has exactly one deployment, id $want, the one deploy.yml queued"
  else
    echo "CHECK 3 FAIL: $svc has $count deployment record(s); deploy.yml queued id '${want:-none}'"
  fi
done

# A failed query must never read as "no triggers": a network error or an expired session prints no
# "data", and treating that like an empty list is how a returning trigger would go unnoticed.
TQ='query($p:String!,$e:String!,$s:String!){ deploymentTriggers(projectId:$p, environmentId:$e, serviceId:$s){ edges{ node{ id } } } }'
trigger_problems=0
for pair in "client:$CLIENT_SERVICE_ID" "server:$SERVER_SERVICE_ID"; do
  name=${pair%%:*}
  out=$(node "$SCRIPT_DIR/railway-query.mjs" "$TQ" "{\"p\":\"$PROJECT\",\"e\":\"$ENV_ID\",\"s\":\"${pair#*:}\"}" 2>&1)
  rc=$?
  # Matched with whitespace removed, printed with only newlines folded so error text stays readable.
  flat=$(echo "$out" | tr -d ' \n')
  shown=$(echo "$out" | tr '\n' ' ' | tr -s ' ')
  if [ "$rc" -ne 0 ] || ! echo "$flat" | grep -qF '"data":{"deploymentTriggers":{"edges":'; then
    echo "TRIGGERS $name ERROR: query failed (exit $rc), so triggers could not be checked. Response: $shown"
    trigger_problems=$((trigger_problems + 1))
  elif echo "$flat" | grep -qF '"edges":[]'; then
    echo "TRIGGERS $name PASS: none"
  else
    echo "TRIGGERS $name FAIL: a deployment trigger is back, so something besides deploy.yml can deploy. Response: $shown"
    trigger_problems=$((trigger_problems + 1))
  fi
done

if [ "$trigger_problems" -gt 0 ]; then
  echo "FAILED: $trigger_problems trigger check(s) did not pass; see the TRIGGERS lines above"
  exit 1
fi
echo "DONE"
