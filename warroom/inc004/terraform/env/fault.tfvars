# INC-004 FAULT — CHG-1042 "move HTTP ingress to the new VPN egress range".
# Replaces every port-80 rule with this documentation range: nobody real can reach the site.
# Recovery adds the users' address back alongside it (lab.sh plan recover).
http_ingress_cidrs = ["198.51.100.0/24"]
