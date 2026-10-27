/**
 * INC-004 — "The Terraform Apply That Broke Production — EC2 Edition" — scenario DATA.
 *
 * The stack is the lab's own deploy/aws-ec2: one EC2 instance running
 * PostureBlogging with Docker Compose behind ONE security group whose port-80
 * rules are created per CIDR (`for_each = toset(var.http_ingress_cidrs)`).
 *
 * Pure data: evidence, actions, hypotheses, scoring. engine.js applies actions.
 * Simulated addresses are RFC 5737 documentation ranges, never real ones:
 *   users / classroom egress  203.0.113.10      the "new VPN" range  198.51.100.0/24
 *   the lab's public IP       192.0.2.44
 * Evidence `source`: 'simulated' (written for the exercise) or 'captured'
 * (recorded from the dedicated War Room EC2 lab by `warroom/inc004/lab.sh capture`).
 */

const SERVICE = 'postureblog (http://192.0.2.44)';
const SG = 'sg-0a7e3c19d2f4b6081';
const INSTANCE = 'i-0c4d2e6f8a1b3c5d7';
const USERS = '203.0.113.10/32';
const VPN = '198.51.100.0/24';

const EVIDENCE = {
  alert: {
    title: 'Synthetic monitor alert',
    layer: 'monitoring',
    command: 'Monitoring console → postureblog availability (probe runs from the classroom network)',
    output: [
      'ALERT  postureblog availability  SEV-1  firing since T0',
      'check: GET http://192.0.2.44/api/health   result: TIMEOUT after 10s (no response at all)',
      'last success: T-6m   consecutive failures: 11',
      'impact: every learner and instructor gets a hanging page; nothing loads',
    ],
  },
  curl_public: {
    title: 'curl from the classroom',
    layer: 'network',
    command: 'curl -v -m 10 http://192.0.2.44/api/health',
    output: [
      '*   Trying 192.0.2.44:80...',
      '* Connection timed out after 10001 milliseconds',
      'curl: (28) Connection timed out after 10001 milliseconds',
    ],
  },
  my_ip: {
    title: 'Our egress address',
    layer: 'network',
    command: 'curl -s https://checkip.amazonaws.com',
    output: ['203.0.113.10'],
  },
  ec2_status: {
    title: 'aws ec2 describe-instance-status',
    layer: 'aws',
    command: `aws ec2 describe-instance-status --instance-ids ${INSTANCE} --query 'InstanceStatuses[0].[InstanceState.Name,SystemStatus.Status,InstanceStatus.Status]'`,
    output: ['[ "running", "ok", "ok" ]', '(both status checks pass; the instance has been up 2 days)'],
  },
  bootstrap_log: {
    title: 'Bootstrap log (via Session Manager)',
    layer: 'instance',
    command: 'sudo tail -3 /var/log/postureblog-bootstrap.log',
    output: [
      '[2 days ago] 6/7 docker compose up (builds the three images on first boot)',
      '[2 days ago] 7/7 health check: http://localhost/api/health',
      '[2 days ago] HEALTHY — PostureBlogging is serving on port 80 (commit 73922b0)',
    ],
  },
  docker_ps: {
    title: 'docker compose ps (via Session Manager)',
    layer: 'instance',
    command: 'sudo docker compose -p postureblog ps',
    output: [
      'NAME                    SERVICE    STATUS                 PORTS',
      'postureblog-db-1        db         Up 2 days (healthy)    5432/tcp',
      'postureblog-backend-1   backend    Up 2 days (healthy)    5000/tcp',
      'postureblog-frontend-1  frontend   Up 2 days              0.0.0.0:80->8080/tcp',
    ],
  },
  curl_localhost: {
    title: 'curl on the instance itself (via Session Manager)',
    layer: 'instance',
    command: 'curl -s -m 5 http://localhost/api/health',
    output: ['{"status":"ok","message":"PostureSec API is operational 🛡️"}'],
  },
  listening: {
    title: 'Listening sockets (via Session Manager)',
    layer: 'instance',
    command: "sudo ss -lntp | grep ':80 '",
    output: ['LISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:(("docker-proxy",pid=2187,fd=4))'],
  },
  app_logs: {
    title: 'Frontend access log (via Session Manager)',
    layer: 'instance',
    command: 'sudo docker compose -p postureblog logs --tail 6 frontend',
    output: [
      'frontend-1  | 203.0.113.10 - - [T-7m] "GET /api/posts HTTP/1.1" 200 4127',
      'frontend-1  | 203.0.113.10 - - [T-6m] "GET / HTTP/1.1" 200 912',
      'frontend-1  | 127.0.0.1 - - [T-4m] "GET /api/health HTTP/1.1" 200 61',
      'frontend-1  | 127.0.0.1 - - [T-2m] "GET /api/health HTTP/1.1" 200 61',
      '(no request from outside the instance has arrived since T-6m)',
    ],
  },
  sg_rules: {
    title: 'Security group rules',
    layer: 'aws',
    command: `aws ec2 describe-security-group-rules --filters Name=group-id,Values=${SG} --query 'SecurityGroupRules[?!IsEgress].[IpProtocol,FromPort,CidrIpv4,Description]'`,
    output: [
      `[ "tcp", 80, "${VPN}", "HTTP to the frontend container (nginx serves the app and proxies /api)" ]`,
    ],
  },
  cloudtrail: {
    title: 'CloudTrail: recent security group calls',
    layer: 'aws',
    command: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue=${SG}`,
    output: [
      'T-6m   AuthorizeSecurityGroupIngress   principal: postureblog-pipeline   (terraform apply, run #57)',
      'T-6m   RevokeSecurityGroupIngress      principal: postureblog-pipeline   (terraform apply, run #57)',
      'T-2d   CreateSecurityGroup             principal: postureblog-pipeline   (terraform apply, run #51)',
    ],
  },
  git_log: {
    title: 'git log (infrastructure repository)',
    layer: 'terraform',
    command: 'git log --oneline -3 -- deploy/aws-ec2',
    output: [
      'c19d4a7 (HEAD -> main) chore(network): move HTTP ingress to the new VPN egress range (CHG-1042)',
      '96e980d fix: strip CRLF from EC2 user data so Windows checkouts boot',
      'a557502 feat: improve PostureBlogging EC2 deployment verification',
    ],
  },
  tfvars_diff: {
    title: 'git show c19d4a7 (the change)',
    layer: 'terraform',
    command: 'git show c19d4a7 -- deploy/aws-ec2/env/lab.tfvars',
    output: [
      '-http_ingress_cidrs = ["203.0.113.10/32"]',
      '+http_ingress_cidrs = ["198.51.100.0/24"]   # CHG-1042: new VPN egress',
    ],
  },
  last_plan: {
    title: 'The plan that was applied (run #57)',
    layer: 'terraform',
    command: 'terraform show run-57.tfplan',
    output: [
      '  # aws_vpc_security_group_ingress_rule.http["198.51.100.0/24"] will be created',
      '  + resource "aws_vpc_security_group_ingress_rule" "http" {',
      '      + cidr_ipv4 = "198.51.100.0/24"',
      '      + from_port = 80',
      '    }',
      '',
      '  # aws_vpc_security_group_ingress_rule.http["203.0.113.10/32"] will be destroyed',
      '  - resource "aws_vpc_security_group_ingress_rule" "http" {',
      '      - cidr_ipv4 = "203.0.113.10/32" -> null',
      '      - from_port = 80 -> null',
      '    }',
      '',
      'Plan: 1 to add, 0 to change, 1 to destroy.',
    ],
  },
  plan_now: {
    title: 'terraform plan (now)',
    layer: 'terraform',
    command: 'terraform plan -var-file=env/lab.tfvars',
    output: [
      'aws_vpc_security_group_ingress_rule.http["198.51.100.0/24"]: Refreshing state...',
      '',
      'No changes. Your infrastructure matches the configuration.',
    ],
  },
  state_list: {
    title: 'terraform state list',
    layer: 'terraform',
    command: 'terraform state list | grep ingress_rule',
    output: ['aws_vpc_security_group_ingress_rule.http["198.51.100.0/24"]'],
  },
};

// Plans for the candidate Terraform changes a squad may propose.
const PLANS = {
  C1: {
    title: 'terraform plan for change C1',
    output: [
      `  # aws_vpc_security_group_ingress_rule.http["${USERS}"] will be created`,
      '  + resource "aws_vpc_security_group_ingress_rule" "http" {',
      `      + cidr_ipv4 = "${USERS}"`,
      '      + from_port = 80',
      '    }',
      '',
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ],
  },
  C2: {
    title: 'terraform plan for change C2',
    output: [
      '  # aws_vpc_security_group_ingress_rule.https["198.51.100.0/24"] will be created',
      '  + from_port = 443',
      '',
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ],
  },
  C3: {
    title: 'terraform plan for change C3',
    output: [
      '  # aws_vpc_security_group_ingress_rule.http["0.0.0.0/0"] will be created',
      '  + resource "aws_vpc_security_group_ingress_rule" "http" {',
      '      + cidr_ipv4 = "0.0.0.0/0"',
      '      + from_port = 80',
      '    }',
      '',
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ],
  },
  C4: {
    title: 'terraform plan for change C4',
    output: [
      '  # aws_instance.app must be replaced',
      '-/+ resource "aws_instance" "app" {',
      '      ~ public_ip  = "192.0.2.44" -> (known after apply)',
      '      ~ user_data  = "…" -> "…" # forces replacement',
      '    }',
      '',
      'Plan: 1 to add, 0 to change, 1 to destroy.',
    ],
  },
  C5: {
    title: 'terraform plan for change C5',
    output: [
      '  # aws_vpc_security_group_ingress_rule.http["0.0.0.0/0"] will be destroyed',
      '  - resource "aws_vpc_security_group_ingress_rule" "http" {',
      '      - cidr_ipv4 = "0.0.0.0/0" -> null',
      '    }',
      '',
      'Plan: 0 to add, 0 to change, 1 to destroy.',
    ],
  },
};

const CHANGES = {
  C1: `Add our address back alongside the VPN range: http_ingress_cidrs = ["${USERS}", "${VPN}"]`,
  C2: 'Open HTTPS (443) to the VPN range',
  C3: 'Set allow_http_from_anywhere = true and allow 0.0.0.0/0 on port 80',
  C4: 'Redeploy: bump app_git_ref to the latest application commit',
  C5: 'Set allow_http_from_anywhere = false and remove 0.0.0.0/0 from port 80',
};

const ACTIONS = {
  // investigate — read-only
  view_alert: { kind: 'investigate', label: 'Read the alert', reveals: ['alert'] },
  curl_public: { kind: 'investigate', label: 'curl the site from the classroom', reveals: ['curl_public'] },
  my_ip: { kind: 'investigate', label: 'Find our egress address', reveals: ['my_ip'] },
  ec2_status: { kind: 'investigate', label: 'aws ec2 describe-instance-status', reveals: ['ec2_status'] },
  bootstrap_log: { kind: 'investigate', label: 'Read the bootstrap log (Session Manager)', reveals: ['bootstrap_log'] },
  docker_ps: { kind: 'investigate', label: 'docker compose ps (Session Manager)', reveals: ['docker_ps'] },
  curl_localhost: { kind: 'investigate', label: 'curl localhost on the instance (Session Manager)', reveals: ['curl_localhost'] },
  listening: { kind: 'investigate', label: 'List listening sockets (Session Manager)', reveals: ['listening'] },
  app_logs: { kind: 'investigate', label: 'Read the frontend access log (Session Manager)', reveals: ['app_logs'] },
  sg_rules: { kind: 'investigate', label: 'Inspect the security group rules', reveals: ['sg_rules'] },
  cloudtrail: { kind: 'investigate', label: 'CloudTrail: recent security group calls', reveals: ['cloudtrail'] },
  git_log: { kind: 'investigate', label: 'git log (infrastructure repo)', reveals: ['git_log'] },
  tfvars_diff: { kind: 'investigate', label: 'Show the last infrastructure change', reveals: ['tfvars_diff'] },
  show_last_plan: { kind: 'investigate', label: 'Show the plan that was applied', reveals: ['last_plan'] },
  plan_now: { kind: 'investigate', label: 'Run terraform plan now', reveals: ['plan_now'] },
  state_list: { kind: 'investigate', label: 'terraform state list', reveals: ['state_list'] },

  // directly on the instance or in the console — some useless, some dangerous
  restart_containers: { kind: 'runtime', label: 'docker compose restart' },
  reboot_instance: { kind: 'runtime', label: 'Reboot the instance' },
  console_add_our_ip: { kind: 'runtime', label: 'Add our /32 on port 80 in the AWS console' },
  console_open_world: { kind: 'runtime', label: 'Open port 80 to 0.0.0.0/0 in the AWS console' },
  remove_console_rules: { kind: 'runtime', label: 'Remove the rules added in the console' },
  edit_state: { kind: 'runtime', label: 'Hand-edit terraform.tfstate to restore the old rule' },
  replace_instance: { kind: 'runtime', label: 'terraform apply -replace=aws_instance.app' },

  // through Terraform — propose, review the plan, apply
  propose_C1: { kind: 'remediate', label: CHANGES.C1, change: 'C1' },
  propose_C2: { kind: 'remediate', label: CHANGES.C2, change: 'C2' },
  propose_C3: { kind: 'remediate', label: CHANGES.C3, change: 'C3' },
  propose_C4: { kind: 'remediate', label: CHANGES.C4, change: 'C4' },
  propose_C5: { kind: 'remediate', label: CHANGES.C5, change: 'C5' },
  review_plan: { kind: 'remediate', label: 'Review the plan for the proposed change' },
  apply_plan: { kind: 'remediate', label: 'terraform apply the proposed change' },

  verify: { kind: 'verify', label: 'Verify from the users\' side and check the configuration' },
};

const HYPOTHESES = {
  H1: 'A Terraform change removed the network path the users depended on',
  H2: 'The application containers crashed or became unhealthy',
  H3: 'The EC2 instance failed (host or status-check failure)',
  H4: 'Terraform state drifted away from the real infrastructure',
  H5: 'The bootstrap / user data failed after a rebuild',
  H6: 'An AWS regional service event',
};

const RUBRIC = {
  evidence: {
    // 10 points for each group in which at least one item was examined.
    symptom: ['curl_public', 'curl_localhost', 'app_logs', 'listening'],
    platform: ['sg_rules', 'my_ip', 'cloudtrail'],
    change: ['git_log', 'tfvars_diff', 'last_plan'],
    pointsPerGroup: 10,
  },
  diagnosis: { correct: 'H1', points: 30 },
  remediation: { reviewed: 20, unreviewed: 15 },
  verification: 10,
  report: { points: 10, minSummary: 40 },
  penalties: {
    console_add_our_ip: 10,
    console_open_world: 15,
    edit_state: 20,
    replace_instance: 25,
    apply_wrong_change: 5,
    apply_world_open: 15,
  },
};

module.exports = {
  SERVICE, SG, INSTANCE, USERS, VPN, EVIDENCE, PLANS, CHANGES, ACTIONS, HYPOTHESES, RUBRIC,
};
