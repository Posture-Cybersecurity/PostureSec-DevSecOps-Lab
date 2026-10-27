#!/usr/bin/env bash
# =============================================================================
# INC-004 SQUAD lab script — what the squad's control plane (driver-real.js) runs. ONE lab per
# squad. Members never call it directly: they act in the War Room, which calls it for them.
#
#   squad-lab.sh preflight                 identity (root only if authorized for THIS account), account, region, isolation
#   squad-lab.sh plan <baseline|current|destroy>   saved plan + guard (create | recover | destroy)
#   squad-lab.sh apply <plan-name>         apply a SAVED plan the guard ALLOWED, once
#   squad-lab.sh show-plan <plan-name>     the reviewed plan's text
#   squad-lab.sh set-config <cidr,...>     write the squad's ingress configuration (validated)
#   squad-lab.sh inject-fault              "pipeline run #57": commit CHG-1042 and apply it (guard: fault)
#   squad-lab.sh observe                   ONE line of JSON: what the platform can see (read-only)
#   squad-lab.sh evidence <id>             one allow-listed, read-only view
#   squad-lab.sh tag <WarRoomPhase|WarRoomScore>=<value> ...   the instructor's progress tags
#   squad-lab.sh remaining                 ONE line of JSON: this squad's resources still present
#
# INC-005 "console hotfix drift" (WARROOM_SCENARIO=drift) runs on the same lab, differently:
#   * the DESIRED configuration (desired.tfvars: the squad's addresses + the AMI pinned at deploy)
#     is written ONCE, at the baseline, and its sha256 recorded; nothing may change it afterwards;
#   squad-lab.sh inject-drift              delete the squad's REAL Terraform-managed port-80 rule
#                                          through the AWS API (not Terraform); state is untouched
#   squad-lab.sh plan restore              saved plan of the unchanged configuration (guard: drift —
#                                          exactly one create, the squad's own rule, nothing else)
#   set-config / inject-fault / tag are refused: no input changes, no out-of-band tags.
#
# Environment (set by the control plane, never a file in git):
#   WARROOM_SQUAD_ID              e.g. alpha — the lab is postureblog-ec2-warroom-<squad>*
#   WARROOM_SQUAD_CIDRS           the squad's approved addresses, comma-separated (e.g. a.b.c.d/32,...)
#   WARROOM_EXPECTED_ACCOUNT_ID   the lab account; any other is refused
#   AWS_PROFILE                   the SQUAD's least-privilege identity. Root is refused unless
#   WARROOM_ALLOW_ROOT_FOR_LAB    is exactly "dedicated-lab-<account id>" for the expected account
#                                 (an explicit owner authorization for a dedicated lab account).
#   WARROOM_ACTOR                 the member acting (attribution in the config history)
#   WARROOM_SCENARIO              inc004 (default) | drift (INC-005)
#
# Isolation on one control-plane host: Terraform workspace = squad (its own state file), its own
# ingress file, plans and history under .operator/squads/<squad>/. Every plan goes through the guard
# with the squad name, so a plan that touches another squad's resources is refused.
# No credential is ever read, printed or stored here.
# =============================================================================
set -Eeuo pipefail
HERE="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"     # warroom/inc004
TF="$HERE/terraform"
STACK="$HERE/../../deploy/aws-ec2"
REGION="us-east-1"
VPN="198.51.100.0/24"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER="" TF_IN_AUTOMATION=1

die(){ echo "REFUSED: $*" >&2; exit 1; }
mask(){ sed -E 's/[0-9]{8}([0-9]{4})/********\1/g'; }
stamp(){ date -u +%Y%m%dT%H%M%SZ; }
tf(){ terraform -chdir="$TF" "$@"; }

SQUAD="${WARROOM_SQUAD_ID:-}"
[[ "$SQUAD" =~ ^[a-z0-9][a-z0-9-]{1,14}$ ]] || die "WARROOM_SQUAD_ID must be 2-15 lowercase letters, digits, hyphens"
NAME="postureblog-ec2-warroom-$SQUAD"
# WARROOM_OPERATOR_DIR: tests point this at a temporary directory.
SQ="${WARROOM_OPERATOR_DIR:-$HERE/.operator}/squads/$SQUAD"
SCENARIO="${WARROOM_SCENARIO:-inc004}"
case "$SCENARIO" in
  inc004) CONFIG="$SQ/ingress.tfvars"; INCIDENT=INC-004 ;;
  drift)  CONFIG="$SQ/desired.tfvars"; INCIDENT=INC-005 ;;
  *) die "WARROOM_SCENARIO must be inc004 or drift" ;;
esac
drift(){ [ "$SCENARIO" = drift ]; }

valid_cidrs(){ node -e "const S=require(process.argv[1]); process.exit(S.validCidrs(process.argv[2].split(',')) ? 0 : 1)" "$HERE/squad/scenario-live.js" "$1"; }
as_hcl(){ node -e "console.log('http_ingress_cidrs = ' + JSON.stringify(process.argv[1].split(',')))" "$1"; }

identity(){
  for t in aws terraform node jq curl; do command -v "$t" >/dev/null || die "missing tool: $t"; done
  [ -n "${WARROOM_EXPECTED_ACCOUNT_ID:-}" ] || die "WARROOM_EXPECTED_ACCOUNT_ID is not set"
  valid_cidrs "${WARROOM_SQUAD_CIDRS:-}" || die "WARROOM_SQUAD_CIDRS: 1-10 canonical IPv4 CIDRs, /24 or narrower, comma-separated"
  local who acct arn
  who="$(aws sts get-caller-identity --output json 2>/dev/null)" || die "AWS credentials unavailable or rejected (sts get-caller-identity failed)"
  acct="$(echo "$who" | jq -r .Account)"; arn="$(echo "$who" | jq -r .Arn)"
  [ "$acct" = "$WARROOM_EXPECTED_ACCOUNT_ID" ] || die "caller account $(echo "$acct" | mask) is not the expected lab account"
  local precreated=true
  if [[ "$arn" == *":root" ]]; then
    # Root only with an acknowledgement bound to THIS account; every other check still applies.
    [ "${WARROOM_ALLOW_ROOT_FOR_LAB:-}" = "dedicated-lab-$acct" ] || die "the root user is never a squad identity unless authorized for this dedicated lab account (WARROOM_ALLOW_ROOT_FOR_LAB=dedicated-lab-<account id>)"
    echo "WARNING: running as the ROOT user of account $(echo "$acct" | mask), as authorized for this dedicated lab" >&2
    precreated=false            # no instructor-made profile: the stack creates the squad's own (tagged, destroyed with the lab)
  fi
  ! grep -qE '^\s*backend\s+"' "$TF"/*.tf "$STACK"/*.tf || die "a backend block appeared; squad state must stay local and per squad"
  export TF_VAR_expected_account_id="$acct" TF_VAR_squad_id="$SQUAD" TF_VAR_use_precreated_profile="$precreated" TF_VAR_warroom_incident="$INCIDENT"
  ARN="$arn"
}

workspace(){
  mkdir -p "$SQ/plans"                                   # only after the inputs and identity checked out
  tf init -input=false >/dev/null
  if ! TF_WORKSPACE= tf workspace list | tr -d ' *' | grep -qx "$SQUAD"; then TF_WORKSPACE= tf workspace new "$SQUAD" >/dev/null; fi
  export TF_WORKSPACE="$SQUAD"
  drift && return 0                                       # drift: desired.tfvars is written once, at the baseline
  [ -f "$CONFIG" ] || { as_hcl "$WARROOM_SQUAD_CIDRS" > "$CONFIG"; echo "$(date -u +%FT%TZ) ${WARROOM_ACTOR:-platform} initial ${WARROOM_SQUAD_CIDRS}" >> "$SQ/config-history.log"; }
}

sha(){ sha256sum "$1" | cut -d' ' -f1; }
# drift: the desired configuration is exactly what was deployed (its hash was recorded at the baseline).
desired_intact(){ [ -f "$CONFIG" ] && [ -f "$CONFIG.sha256" ] && [ "$(sha "$CONFIG")" = "$(cat "$CONFIG.sha256")" ]; }
write_desired(){
  local ami
  ami="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)"
  [[ "$ami" =~ ^ami-[0-9a-f]{8,17}$ ]] || die "could not resolve the Ubuntu AMI to pin"
  { echo "# INC-005 desired configuration: written once at deploy; the incident never changes it."
    as_hcl "$WARROOM_SQUAD_CIDRS"; echo "ami_id = \"$ami\""; } > "$CONFIG"
  sha "$CONFIG" > "$CONFIG.sha256"
  echo "$(date -u +%FT%TZ) ${WARROOM_ACTOR:-platform} desired ${WARROOM_SQUAD_CIDRS} ${ami}" >> "$SQ/config-history.log"
}

managed(){ tf state list 2>/dev/null | wc -l | tr -d ' '; }

save_plan(){   # kind guard-mode [terraform plan args...]
  local kind="$1" mode="$2"; shift 2
  local name="$kind-$SQUAD-$(stamp)" base
  base="$SQ/plans/$name"
  if ! tf plan -input=false -no-color -lock-timeout=120s -out="$base.tfplan" "$@" > "$base.txt" 2>&1; then
    echo "PLAN $name ERROR $(grep -m1 -E 'Error' "$base.txt" | cut -c1-200)"; return 0
  fi
  tf show -json "$base.tfplan" > "$base.json"
  if node "$HERE/plan-guard.js" "$base.json" "$mode" "$SQUAD" "--tag=$INCIDENT" "--cidrs=$WARROOM_SQUAD_CIDRS" >> "$base.txt" 2>&1; then
    echo "PLAN $name ALLOWED $(grep -m1 -E '^Plan:|No changes' "$base.txt")"
  else
    # The guard's first reason is the line after its "REFUSED (n):" header (plan text also has "  - " lines).
    echo "PLAN $name REFUSED $(sed -n '/REFUSED ([0-9]*):/{n;s/^ *- //p;q}' "$base.txt")"
  fi
}

ssm_run(){
  local id="$1" cmd="$2" params cid st
  case "$cmd" in *'{{'*) die "refusing an SSM command containing {{ }}";; esac
  params="$(mktemp)"; jq -n --arg c "$cmd" '{commands: [$c]}' > "$params"
  [ -n "$(command -v cygpath)" ] && params="$(cygpath -m "$params")"
  cid="$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript --parameters "file://$params" --query Command.CommandId --output text)"
  for _ in $(seq 20); do
    st="$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query Status --output text 2>/dev/null || true)"
    case "$st" in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 2
  done
  aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query StandardOutputContent --output text 2>/dev/null || true
}

out(){ tf output -raw "$1" 2>/dev/null || true; }

identity
workspace
cmd="${1:-}"; shift || true

case "$cmd" in
  preflight)
    echo "identity: $(echo "$ARN" | mask)  squad: $SQUAD  region: $REGION  workspace: $TF_WORKSPACE  resources: $(managed)"
    ;;

  plan)
    case "${1:-}" in
      baseline)
        [ "$(managed)" -eq 0 ] || die "the squad lab is already deployed"
        sg="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME" --query 'SecurityGroups[].GroupId' --output text)"
        [ -z "$sg" ] || die "resources named $NAME already exist outside this squad's state; investigate first"
        if drift; then write_desired; fi
        save_plan baseline create -var-file="$CONFIG" ;;
      current) drift && die "plan current belongs to INC-004; the drift scenario restores with: plan restore"
               save_plan current recover -var-file="$CONFIG" ;;
      restore) drift || die "plan restore belongs to the drift scenario (INC-005)"
               desired_intact || die "the desired configuration changed since deployment; refusing to plan"
               save_plan restore drift -var-file="$CONFIG" ;;
      destroy) [ "$(managed)" -gt 0 ] || die "nothing in this squad's state to destroy"
               # Cleanup must always be possible: recreate the inputs if missing (a destroy plan ignores them).
               [ -f "$CONFIG" ] || as_hcl "$WARROOM_SQUAD_CIDRS" > "$CONFIG"
               save_plan destroy destroy -destroy -var-file="$CONFIG" ;;
      *) die "plan <baseline|current|restore|destroy>" ;;
    esac
    ;;

  apply)
    p="${1:-}"; [[ "$p" =~ ^(baseline|current|restore|destroy|fault)-$SQUAD-[0-9TZ]+$ ]] || die "apply <plan-name of this squad>"
    [ -f "$SQ/plans/$p.tfplan" ] || die "no such saved plan (or it was already applied)"
    grep -q '^ALLOWED$' "$SQ/plans/$p.txt" || die "plan $p was not allowed by the guard"
    if tf apply -input=false -no-color -lock-timeout=120s "$SQ/plans/$p.tfplan" > "$SQ/plans/$p.applied.txt" 2>&1; then
      rm -f "$SQ/plans/$p.tfplan"; echo "APPLIED $p $(grep -m1 -E '^Apply complete' "$SQ/plans/$p.applied.txt")"
    else
      rm -f "$SQ/plans/$p.tfplan"; echo "APPLY $p FAILED $(grep -m1 -E 'Error' "$SQ/plans/$p.applied.txt" | cut -c1-240)"; exit 3
    fi
    ;;

  show-plan)
    p="${1:-}"; [[ "$p" =~ ^(baseline|current|restore|destroy|fault)-$SQUAD-[0-9TZ]+$ ]] || die "show-plan <plan-name of this squad>"
    sed -n '/^Terraform will perform/,/^plan-guard/p' "$SQ/plans/$p.txt" | mask
    ;;

  set-config)
    drift && die "set-config is not part of the drift scenario: the desired configuration never changes"
    c="${1:-}"; valid_cidrs "$c" || die "1-10 canonical IPv4 CIDRs, /24 or narrower (never 0.0.0.0/0)"
    as_hcl "$c" > "$CONFIG"
    echo "$(date -u +%FT%TZ) ${WARROOM_ACTOR:-unknown} set ${c}" >> "$SQ/config-history.log"
    echo "CONFIG $(cat "$CONFIG")"
    ;;

  inject-fault)
    drift && die "inject-fault belongs to INC-004; the drift scenario uses inject-drift"
    # The squad's "pipeline" commits CHG-1042 to the squad's configuration and applies it.
    printf '# CHG-1042: move HTTP ingress to the new VPN egress range (pipeline run #57)\nhttp_ingress_cidrs = ["%s"]\n' "$VPN" > "$CONFIG"
    echo "$(date -u +%FT%TZ) pipeline CHG-1042 ${VPN}" >> "$SQ/config-history.log"
    line="$(save_plan fault fault -var-file="$CONFIG")"
    name="$(echo "$line" | awk '{print $2}')"
    case "$line" in *" ALLOWED "*) "$0" apply "$name" >/dev/null && echo "FAULT ALLOWED $name" || echo "FAULT FAILED $name" ;;
                    *) echo "FAULT REFUSED ${line#* * }" ;; esac
    ;;

  inject-drift)
    # "Console hotfix": the squad's real Terraform-managed port-80 rule is deleted through the AWS
    # API. The configuration and the state are untouched — that is the drift. Idempotent: if the
    # rule is already gone (a retry after a crash), nothing else is deleted.
    drift || die "inject-drift belongs to the drift scenario (INC-005)"
    desired_intact || die "the desired configuration changed since deployment; refusing to inject"
    sg="$(out security_group_id)"; [[ "$sg" =~ ^sg-[0-9a-f]+$ ]] || die "no deployed lab in this squad's state"
    probe="$(curl -s -m 10 https://checkip.amazonaws.com | tr -d '\r\n ')"
    # The rule recorded in STATE for the squad address the platform probes from (so users notice).
    rules="$(tf show -json | jq -c '[.values.root_module.child_modules[]?.resources[]? | select(.address | startswith("module.lab.aws_vpc_security_group_ingress_rule.http[")) | {address, id: .values.security_group_rule_id, cidr: .values.cidr_ipv4, sg: .values.security_group_id}]')"
    pick="$(node -e "const D=require(process.argv[1]); const r=JSON.parse(process.argv[2]).filter((x) => process.argv[4].split(',').includes(x.cidr) && D.cidrContains(x.cidr, process.argv[3])); console.log(r.length === 1 ? JSON.stringify(r[0]) : '')" "$HERE/squad/scenario-drift.js" "$rules" "$probe" "$WARROOM_SQUAD_CIDRS")"
    [ -n "$pick" ] || { echo "DRIFT REFUSED no single Terraform-managed squad rule covers the control plane's address"; exit 0; }
    id="$(echo "$pick" | jq -r .id)"; cidr="$(echo "$pick" | jq -r .cidr)"
    { [[ "$id" =~ ^sgr-[0-9a-f]+$ ]] && [ "$(echo "$pick" | jq -r .sg)" = "$sg" ]; } || { echo "DRIFT REFUSED the state's rule does not belong to the lab's security group"; exit 0; }
    # Ownership in AWS, not just in state: the group must carry this squad's and this incident's tags.
    aws ec2 describe-security-groups --group-ids "$sg" --query 'SecurityGroups[0].Tags' --output json \
      | jq -e --arg s "$SQUAD" 'from_entries | .WarRoomSquad == $s and .WarRoom == "INC-005"' >/dev/null \
      || { echo "DRIFT REFUSED the security group is not tagged WarRoomSquad=$SQUAD, WarRoom=INC-005"; exit 0; }
    live="$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" --query "SecurityGroupRules[?SecurityGroupRuleId=='$id']" --output json)"
    if [ "$(echo "$live" | jq length)" = 0 ]; then echo "DRIFT DELETED $id $cidr already-absent"; exit 0; fi
    echo "$live" | jq -e --arg c "$cidr" '.[0] | (.IsEgress | not) and .IpProtocol == "tcp" and .FromPort == 80 and .ToPort == 80 and .CidrIpv4 == $c' >/dev/null \
      || { echo "DRIFT REFUSED rule $id is not the tcp/80 rule for the squad's address"; exit 0; }
    aws ec2 revoke-security-group-ingress --group-id "$sg" --security-group-rule-ids "$id" >/dev/null \
      || { echo "DRIFT FAILED revoke-security-group-ingress $id"; exit 0; }
    left="$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" --query "length(SecurityGroupRules[?SecurityGroupRuleId=='$id'])" --output text)"
    if [ "$left" = 0 ]; then echo "DRIFT DELETED $id $cidr"; else echo "DRIFT FAILED rule $id still present after the revoke"; fi
    ;;

  observe)
    id="$(out instance_id)"; url="$(out app_url)"; sg="$(out security_group_id)"
    if [ -z "$id" ]; then echo '{"instance":null}'; exit 0; fi
    intact=true; if drift && ! desired_intact; then intact=false; fi
    inst="$(aws ec2 describe-instance-status --instance-ids "$id" --include-all-instances \
      --query 'InstanceStatuses[0].{id:InstanceId,state:InstanceState.Name,system:SystemStatus.Status,instance:InstanceStatus.Status}' --output json)"
    ssm="$(aws ssm describe-instance-information --filters Key=InstanceIds,Values="$id" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
    inside=false; [ "$ssm" = Online ] && ssm_run "$id" 'curl -s -m 5 http://localhost/api/health' | grep -q '"status":"ok"' && inside=true
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url/api/health" || true)"; code="${code:-0}"
    probe="$(curl -s -m 10 https://checkip.amazonaws.com | tr -d '\r\n ')/32"
    aws_rules="$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" \
      --query 'SecurityGroupRules[?!IsEgress && FromPort==`80`].{id:SecurityGroupRuleId,cidr:CidrIpv4}' --output json)"
    state_ids="$(tf show -json | jq -c '[.values.root_module.child_modules[]?.resources[]? | select(.type=="aws_vpc_security_group_ingress_rule") | .values.security_group_rule_id]')"
    tf plan -input=false -lock-timeout=120s -detailed-exitcode -var-file="$CONFIG" >/dev/null 2>&1 && noop=true || noop=false
    jq -cn --argjson inst "$inst" --arg ssm "$ssm" --argjson inside "$inside" --argjson code "$((10#$code))" \
       --arg cidrs "$WARROOM_SQUAD_CIDRS" --arg probe "$probe" --argjson rules "$aws_rules" --argjson ids "$state_ids" --argjson noop "$noop" --argjson intact "$intact" '
      ($rules | map({cidr, managed: (.id as $i | $ids | index($i) != null)})) as $r |
      { instance: $inst, ssm_online: ($ssm == "Online"), app_health_inside: $inside, http_from_squad: $code,
        squad_cidrs: ($cidrs | split(",")), probe_cidr: $probe, rules: $r, plan_noop: $noop, config_intact: $intact,
        console_rules: ($r | any(.managed | not)), world_open: ($r | any(.cidr == "0.0.0.0/0")) }'
    ;;

  evidence)
    # Validate first: inside the masked pipeline below, a refusal would land on stdout.
    case "${1:-}" in http_from_squad|services|ec2_status|sg_rules|state_rules|config|plan_now|change_history) ;;
      *) die "evidence <http_from_squad|services|ec2_status|sg_rules|state_rules|config|plan_now|change_history>" ;; esac
    id="$(out instance_id)"; url="$(out app_url)"; sg="$(out security_group_id)"
    case "${1:-}" in
      http_from_squad) curl -sv -m 10 "$url/api/health" 2>&1 | grep -E 'Trying|Connected|timed out|refused|HTTP/|status' || true ;;
      services)        ssm_run "$id" 'cd /opt/postureblog/app && docker compose -p postureblog ps; echo; echo "GET http://localhost/api/health ->"; curl -s -m 5 http://localhost/api/health' ;;
      ec2_status)      aws ec2 describe-instance-status --instance-ids "$id" --include-all-instances \
                         --query 'InstanceStatuses[0].{state:InstanceState.Name,system:SystemStatus.Status,instance:InstanceStatus.Status}' --output table ;;
      sg_rules)        aws ec2 describe-security-group-rules --filters Name=group-id,Values="$sg" \
                         --query 'SecurityGroupRules[?!IsEgress].[SecurityGroupRuleId,IpProtocol,FromPort,CidrIpv4,Description]' --output text ;;
      state_rules)     tf show -json | jq -r '.values.root_module.child_modules[]?.resources[]? | select(.type=="aws_vpc_security_group_ingress_rule") | "\(.address)  \(.values.security_group_rule_id)  \(.values.cidr_ipv4)"' ;;
      config)          echo "--- $(basename "$CONFIG")"; cat "$CONFIG"
                       if drift; then if desired_intact; then echo "(unchanged since deployment)"; else echo "(CHANGED since deployment)"; fi; fi
                       echo "--- history"; tail -20 "$SQ/config-history.log" ;;
      plan_now)        tf plan -input=false -no-color -lock-timeout=120s -var-file="$CONFIG" 2>&1 | grep -E 'will be|must be|Plan:|No changes' || true ;;
      change_history)  aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue="$sg" --max-results 10 \
                         --query 'Events[].[EventTime,EventName,Username]' --output text ;;
      *) die "evidence <http_from_squad|services|ec2_status|sg_rules|state_rules|config|plan_now|change_history>" ;;
    esac 2>&1 | mask
    ;;

  tag)
    drift && die "tag: the drift scenario never tags AWS resources out of band (that would be drift too)"
    [ $# -gt 0 ] || die "tag <WarRoomPhase|WarRoomScore>=<value> ..."
    id="$(out instance_id)"; [ -n "$id" ] || die "no instance to tag"
    args=()
    for kv in "$@"; do
      case "$kv" in
        WarRoomPhase=armed|WarRoomPhase=incident|WarRoomPhase=completed) ;;
        WarRoomScore=*) [[ "${kv#*=}" =~ ^[0-9]{1,3}$ ]] || die "WarRoomScore must be 0-100" ;;
        *) die "tag: only WarRoomPhase=<armed|incident|completed> and WarRoomScore=<0-100>" ;;
      esac
      args+=("Key=${kv%%=*},Value=${kv#*=}")
    done
    aws ec2 create-tags --resources "$id" --tags "${args[@]}" && echo "TAGGED ${*}"
    ;;

  remaining)
    inst="$(aws ec2 describe-instances --filters Name=tag:WarRoomSquad,Values="$SQUAD" Name=instance-state-name,Values=pending,running,stopping,stopped \
      --query 'Reservations[].Instances[].InstanceId' --output json)"
    sgs="$(aws ec2 describe-security-groups --filters Name=tag:WarRoomSquad,Values="$SQUAD" --query 'SecurityGroups[].GroupId' --output json)"
    jq -cn --argjson i "$inst" --argjson s "$sgs" --argjson n "$(managed)" '[($i[] | "instance " + .), ($s[] | "security-group " + .)] + (if $n > 0 then ["state: \($n) resources"] else [] end)'
    ;;

  *)
    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
