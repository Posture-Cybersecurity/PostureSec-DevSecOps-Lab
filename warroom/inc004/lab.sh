#!/usr/bin/env bash
# =============================================================================
# INC-004 lab OPERATOR script (EC2 edition) — instructor rehearsal and demonstration only.
# Squads run their own lab through the War Room control plane (squad/squad-lab.sh, never
# root), or the simulation (WAR_ROOM_INCIDENT=INC-004 ./warroom.sh up).
#
#   bash warroom/inc004/lab.sh preflight                       identity, account, region, isolation
#   bash warroom/inc004/lab.sh plan <baseline|fault|recover|reset>   saved plan + guard
#   bash warroom/inc004/lab.sh apply <plan-name>               apply a SAVED, GUARDED plan only
#   bash warroom/inc004/lab.sh url                             the browser address of the lab app
#   bash warroom/inc004/lab.sh inspect [label]                 READ-ONLY: instance, services, HTTP, SG vs Terraform
#   bash warroom/inc004/lab.sh verify                          users' view (healthcheck.sh) + rules + no drift
#   bash warroom/inc004/lab.sh capture <outage|restored>       record redacted evidence for the simulation
#   bash warroom/inc004/lab.sh resources                       what is running and tagged INC-004 now
#   bash warroom/inc004/lab.sh destroy-plan | destroy <plan-name>
#
#   baseline  http_ingress_cidrs = [operator /32]               the healthy lab (first apply)
#   fault     env/fault.tfvars: ["198.51.100.0/24"]             CHG-1042 — the incident
#   recover   [operator /32, "198.51.100.0/24"]                 the reviewed Terraform fix
#   reset     back to [operator /32] for the next class
#
# Operator settings: warroom/inc004/.operator/lab.env (git-ignored)
#   AWS_PROFILE=...                    the configured CLI profile to use
#   WARROOM_EXPECTED_ACCOUNT_ID=...    the lab account; anything else is refused
#   WARROOM_ADMIN_CIDR=x.x.x.x/32      the operator's (= "users'") address
# No credential is ever read, printed or stored by this script.
# =============================================================================
set -Eeuo pipefail
# Windows-form path under Git Bash (native terraform/jq), POSIX elsewhere.
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
OP="$HERE/.operator"
TF="$HERE/terraform"
STACK="$HERE/../../deploy/aws-ec2"
REGION="us-east-1"
VPN="198.51.100.0/24"
NAME="postureblog-ec2-warroom-inc004"
mkdir -p "$OP/plans"
if [ -f "$OP/lab.env" ]; then set -a; . "$OP/lab.env"; set +a; fi
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER="" TF_IN_AUTOMATION=1

die(){ echo "REFUSED: $*" >&2; exit 1; }
say(){ echo "==> $*"; }
mask(){ sed -E 's/[0-9]{8}([0-9]{4})/********\1/g'; }
stamp(){ date -u +%Y%m%dT%H%M%SZ; }
tf(){ terraform -chdir="$TF" "$@"; }

preflight(){
  for t in aws terraform node jq curl; do command -v "$t" >/dev/null || die "missing tool: $t"; done
  [ -n "${WARROOM_EXPECTED_ACCOUNT_ID:-}" ] || die "set WARROOM_EXPECTED_ACCOUNT_ID in $OP/lab.env"
  [[ "${WARROOM_ADMIN_CIDR:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/32$ ]] || die "set WARROOM_ADMIN_CIDR=<your public IP>/32 in $OP/lab.env"
  local acct arn
  acct="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || die "AWS credentials unavailable or rejected (sts get-caller-identity failed)"
  arn="$(aws sts get-caller-identity --query Arn --output text)"
  [ "$acct" = "$WARROOM_EXPECTED_ACCOUNT_ID" ] || die "caller account $(echo "$acct" | mask) is not the expected lab account"
  # State isolation: this root keeps LOCAL state; neither it nor the stack may declare a backend.
  ! grep -qE '^\s*backend\s+"' "$TF"/*.tf "$STACK"/*.tf || die "a backend block appeared; War Room state must stay local and separate"
  # Operator (instructor rehearsal) mode keeps its own names: squad "inc004", and creates its own SSM profile.
  export TF_VAR_expected_account_id="$acct" TF_VAR_squad_id="inc004" TF_VAR_use_precreated_profile=false
  echo "identity: $(echo "$arn" | mask)   region: $REGION   profile: ${AWS_PROFILE:-<default chain>}   state: $TF/terraform.tfstate"
}

init(){ tf init -input=false >/dev/null; }
managed(){ tf state list 2>/dev/null | wc -l | tr -d ' '; }

# A name collision means something we do not own already uses the War Room's names.
collision_check(){
  local sg role
  sg="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME" --query 'SecurityGroups[].GroupId' --output text)"
  role="$(aws iam get-role --role-name "$NAME-ssm" --query Role.RoleName --output text 2>/dev/null || true)"
  if [ "$(managed)" -eq 0 ] && { [ -n "$sg" ] || [ -n "$role" ]; }; then
    die "resources named $NAME already exist but are not in this state; investigate before creating anything"
  fi
}

save_plan(){   # name guard-mode [terraform plan args...]
  local name="$1" mode="$2"; shift 2
  local base="$OP/plans/$name"
  tf plan -input=false -lock-timeout=60s -out="$base.tfplan" "$@" | tee "$base.txt"
  tf show -json "$base.tfplan" > "$base.json"
  node "$HERE/plan-guard.js" "$base.json" "$mode" | tee -a "$base.txt"
  echo "$mode" > "$base.mode"
  say "saved plan: $name   (review $base.txt, then: lab.sh apply $name)"
}

ssm_run(){   # run ONE read-only shell command on the instance, print its output
  local id="$1" cmd="$2" params cid
  # Run Command treats {{ }} as a parameter reference: never send it.
  case "$cmd" in *'{{'*) die "refusing an SSM command containing {{ }}";; esac
  params="$(mktemp)"; jq -n --arg c "$cmd" '{commands: [$c]}' > "$params"
  [ -n "$(command -v cygpath)" ] && params="$(cygpath -m "$params")"
  cid="$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
        --parameters "file://$params" --query Command.CommandId --output text)"
  for _ in $(seq 30); do
    st="$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query Status --output text 2>/dev/null || true)"
    case "$st" in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 2
  done
  aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query StandardOutputContent --output text
}

# The terraform -var arguments for a variant. The live variant is recorded by `apply`.
vars_for(){
  case "$1" in
    baseline|reset) printf '%s\n' "-var=http_ingress_cidrs=[\"$WARROOM_ADMIN_CIDR\"]" ;;
    fault)          printf '%s\n' "-var-file=env/fault.tfvars" ;;
    recover)        printf '%s\n' "-var=http_ingress_cidrs=[\"$WARROOM_ADMIN_CIDR\",\"$VPN\"]" ;;
    *) return 1 ;;
  esac
}

# Hide your own address and the instance's public address in operator output.
hide(){
  local me="${WARROOM_ADMIN_CIDR%/32}" ip="${1:-}"
  sed -E "s/${me//./\\.}/<your-ip>/g${ip:+; s/${ip//./\\.}/<lab-public-ip>/g}" | mask
}

case "${1:-}" in
  url)
    preflight >/dev/null; init
    tf output -raw app_url; echo
    ;;

  inspect)
    # READ-ONLY: the four layers, side by side. Optional label saves a copy as evidence.
    preflight; init
    label="${2:-}"; [ -z "$label" ] || [[ "$label" =~ ^[a-z0-9-]{1,30}$ ]] || die "label: lowercase letters, digits, hyphens"
    id="$(tf output -raw instance_id)"; url="$(tf output -raw app_url)"; sg="$(tf output -raw security_group_id)"; ip="${url#http://}"
    variant="$(cat "$OP/current-variant" 2>/dev/null || echo unknown)"
    {
      echo "### INC-004 inspect ${label:+[$label] }$(date -u +%FT%TZ)   live variant: $variant"
      echo; echo "## 1. EC2: is the instance running?"
      aws ec2 describe-instance-status --instance-ids "$id" --include-all-instances \
        --query 'InstanceStatuses[0].{state:InstanceState.Name,system:SystemStatus.Status,instance:InstanceStatus.Status}' --output table
      echo; echo "## 2. Inside the instance (Session Manager): are the services healthy?"
      ssm_run "$id" 'cd /opt/postureblog/app && docker compose -p postureblog ps; echo; echo "GET http://localhost/api/health ->"; curl -s -m 5 http://localhost/api/health; echo; echo; ss -lntp | grep ":80 "; echo; tail -1 /var/log/postureblog-bootstrap.log'
      echo; echo "## 3. From your machine: is the app reachable over HTTP?"
      code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url/api/health" || true)"
      [ "$code" = 000 ] && echo "GET $url/api/health -> NO RESPONSE (timed out after 10 s)" || echo "GET $url/api/health -> HTTP $code"
      echo; echo "## 4. AWS vs Terraform: who may reach port 80, and does Terraform agree?"
      aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" \
        --query 'SecurityGroupRules[?!IsEgress].[IpProtocol,FromPort,ToPort,CidrIpv4]' --output text
      echo "-- in Terraform state:"; tf state list | grep ingress_rule
      if args="$(vars_for "$variant")"; then
        tf plan -input=false -no-color -lock-timeout=60s -detailed-exitcode "$args" >/dev/null 2>&1 && rc=0 || rc=$?
        case "$rc" in 0) echo "-- terraform plan ($variant): No changes (configuration == state == AWS)";;
                      2) echo "-- terraform plan ($variant): CHANGES PENDING (configuration and AWS differ)";;
                      *) echo "-- terraform plan ($variant): ERROR (exit $rc)";; esac
      fi
    } 2>&1 | hide "$ip" | tee ${label:+"$OP/evidence/$label-$(stamp).txt"}
    ;;

  preflight)
    preflight; init
    say "War Room-tagged resources already present:"
    aws resourcegroupstaggingapi get-resources --tag-filters Key=WarRoom,Values=INC-004 \
      --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n' | mask || true
    say "resources in this War Room state: $(managed)"
    collision_check && say "no name collisions"
    ;;

  plan)
    preflight; init
    v="${2:-}"; ops="[\"$WARROOM_ADMIN_CIDR\"]"
    case "$v" in
      baseline)
        if [ "$(managed)" -eq 0 ]; then collision_check; mode=create; else mode=noop; fi
        save_plan "$v-$(stamp)" "$mode" -var "http_ingress_cidrs=$ops" ;;
      fault)   save_plan "$v-$(stamp)" fault   -var-file=env/fault.tfvars ;;
      recover) save_plan "$v-$(stamp)" recover -var "http_ingress_cidrs=[\"$WARROOM_ADMIN_CIDR\",\"$VPN\"]" ;;
      reset)   save_plan "$v-$(stamp)" reset   -var "http_ingress_cidrs=$ops" ;;
      *) die "usage: plan <baseline|fault|recover|reset>" ;;
    esac
    ;;

  apply)
    preflight; init
    p="${2:-}"; [ -n "$p" ] && [ -f "$OP/plans/$p.tfplan" ] || die "usage: apply <plan-name> (from $OP/plans)"
    grep -q '^ALLOWED$' "$OP/plans/$p.txt" || die "plan $p was not allowed by the guard"
    tf apply -input=false -lock-timeout=60s "$OP/plans/$p.tfplan" | tee "$OP/plans/$p.applied.txt"
    v="${p%%-*}"; case "$v" in baseline|fault|recover|reset) echo "$v" > "$OP/current-variant";; destroy) rm -f "$OP/current-variant";; esac
    ;;

  verify)
    preflight; init
    url="$(tf output -raw app_url)"; sg="$(tf output -raw security_group_id)"
    say "port-80 rules now:"; aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" \
      --query 'SecurityGroupRules[?!IsEgress].[FromPort,CidrIpv4,Description]' --output text
    bash "$STACK/healthcheck.sh" "$url" || { say "VERIFY: the users cannot use the app"; exit 1; }
    ;;

  capture)
    phase="${2:-}"; case "$phase" in outage|restored) ;; *) die "usage: capture <outage|restored>";; esac
    preflight; init
    out="$HERE/../../backend/src/warroom/tf_ec2/captured/$phase"; mkdir -p "$out"
    id="$(tf output -raw instance_id)"; url="$(tf output -raw app_url)"; sg="$(tf output -raw security_group_id)"
    ip="${url#http://}"; me="${WARROOM_ADMIN_CIDR%/32}"
    # Redact to the same documentation addresses the simulation uses.
    redact(){ mask | sed -E "s/${ip//./\\.}/192.0.2.44/g; s/${me//./\\.}/203.0.113.10/g; s/$id/i-0c4d2e6f8a1b3c5d7/g; s/$sg/sg-0a7e3c19d2f4b6081/g; s/sgr-[0-9a-f]+/sgr-<id>/g; s/ip-[0-9-]+(\.ec2\.internal)?/<host>/g"; }
    curl -sv -m 10 "$url/api/health" 2>&1 | grep -E 'Trying|Connected|timed out|HTTP/|status' | redact > "$out/curl_public.txt" || true
    echo "$me" | redact > "$out/my_ip.txt"
    aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" \
      --query 'SecurityGroupRules[?!IsEgress].[IpProtocol,FromPort,CidrIpv4,Description]' --output json | jq -c '.[]' | redact > "$out/sg_rules.txt"
    aws ec2 describe-instance-status --instance-ids "$id" \
      --query 'InstanceStatuses[0].[InstanceState.Name,SystemStatus.Status,InstanceStatus.Status]' --output json | jq -c . | redact > "$out/ec2_status.txt"
    ssm_run "$id" 'tail -3 /var/log/postureblog-bootstrap.log'             | redact > "$out/bootstrap_log.txt"
    ssm_run "$id" 'cd /opt/postureblog/app && docker compose -p postureblog ps' | redact > "$out/docker_ps.txt"
    ssm_run "$id" 'curl -s -m 5 http://localhost/api/health'               | redact > "$out/curl_localhost.txt"
    ssm_run "$id" "ss -lntp | grep ':80 '"                                 | redact > "$out/listening.txt"
    ssm_run "$id" 'cd /opt/postureblog/app && docker compose -p postureblog logs --tail 6 frontend' | redact > "$out/app_logs.txt"
    v=$([ "$phase" = outage ] && echo "-var-file=env/fault.tfvars" || echo "-var=http_ingress_cidrs=[\"$WARROOM_ADMIN_CIDR\",\"$VPN\"]")
    tf plan -input=false -no-color -lock-timeout=60s "$v" 2>&1 | grep -E 'Refreshing state|No changes|will be|Plan:' | redact > "$out/plan_now.txt" || true
    tf state list | grep ingress_rule | redact > "$out/state_list.txt"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$out/../CAPTURED_AT"
    say "captured $(ls "$out" | wc -l) evidence files to $out — review them for anything sensitive before committing"
    ;;

  resources)
    preflight
    aws resourcegroupstaggingapi get-resources --tag-filters Key=WarRoom,Values=INC-004 \
      --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n' | mask
    say "War Room instances (any state but terminated):"
    aws ec2 describe-instances --filters Name=tag:WarRoom,Values=INC-004 Name=instance-state-name,Values=pending,running,stopping,stopped \
      --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType,LaunchTime]' --output text
    ;;

  destroy-plan)
    preflight; init
    [ "$(managed)" -gt 0 ] || die "nothing in the War Room state to destroy"
    save_plan "destroy-$(stamp)" destroy -destroy -var "http_ingress_cidrs=[\"$WARROOM_ADMIN_CIDR\"]"
    ;;
  destroy)
    "$0" apply "${2:-}"
    ;;

  *)
    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
