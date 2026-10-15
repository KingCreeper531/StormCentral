#!/usr/bin/env bash
# Keeps trying to create the free Oracle Cloud Ampere server for the Storm
# Central live stream until capacity frees up, then prints how to log in.
#
# Run it in Oracle Cloud Shell (the >_ button in the console's top bar):
#   bash <(curl -fsSL https://raw.githubusercontent.com/KingCreeper531/StormCentral/main/stream/oracle-get-server.sh)
#
# It makes a login key that stays in Cloud Shell (~/.ssh/stream; RSA, since
# Cloud Shell runs in FIPS mode, which refuses ed25519), a network
# with internet access if there isn't one, and then tries every availability
# domain at 4, 2 and 1 OCPUs (all Always Free) every minute.
set -uo pipefail

NAME=stormcentral-stream
SHAPE=VM.Standard.A1.Flex
T="${OCI_TENANCY:-}"
[ -n "$T" ] || { echo "Run this in Oracle Cloud Shell (the >_ button at the top of the console)."; exit 1; }
KEY="$HOME/.ssh/stream"
ERR=$(mktemp)
say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
id_or_empty() { [[ "$1" == ocid1.* ]] && printf '%s' "$1"; }

# Already have one?
have=$(id_or_empty "$(oci compute instance list -c "$T" --display-name "$NAME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output 2>/dev/null)")
if [ -n "$have" ]; then
  ip=$(oci compute instance list-vnics --instance-id "$have" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
  say "You already have the server: ssh -i ~/.ssh/stream ubuntu@$ip"
  exit 0
fi

# Login key, kept in Cloud Shell only.
mkdir -p "$HOME/.ssh"
[ -f "$KEY" ] || { ssh-keygen -q -t rsa -b 4096 -f "$KEY" -N "" -C "$NAME"; say "Made a login key at ~/.ssh/stream"; }

# A public subnet whose network can reach the internet.
ensure_internet() {
  local vcn=$1 rt rules igw
  rt=$(oci network vcn get --vcn-id "$vcn" --query 'data."default-route-table-id"' --raw-output)
  rules=$(oci network route-table get --rt-id "$rt" --query 'data."route-rules"' 2>/dev/null)
  if ! printf '%s' "$rules" | grep -q '0.0.0.0/0'; then
    igw=$(id_or_empty "$(oci network internet-gateway list -c "$T" --vcn-id "$vcn" --query 'data[0].id' --raw-output 2>/dev/null)")
    [ -n "$igw" ] || igw=$(oci network internet-gateway create -c "$T" --vcn-id "$vcn" --is-enabled true --display-name stormcentral-igw --wait-for-state AVAILABLE --query data.id --raw-output 2>/dev/null)
    oci network route-table update --rt-id "$rt" --force \
      --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$igw\"}]" >/dev/null
    say "Connected the network to the internet."
  fi
}
SUBNET=$(id_or_empty "$(oci network subnet list -c "$T" --all --query 'data[?"prohibit-public-ip-on-vnic"==`false`] | [0].id' --raw-output 2>/dev/null)")
if [ -n "$SUBNET" ]; then
  ensure_internet "$(oci network subnet get --subnet-id "$SUBNET" --query 'data."vcn-id"' --raw-output)"
else
  say "Making a network..."
  VCN=$(oci network vcn create -c "$T" --cidr-blocks '["10.0.0.0/16"]' --display-name stormcentral --dns-label stormcentral --wait-for-state AVAILABLE --query data.id --raw-output 2>/dev/null)
  ensure_internet "$VCN"
  SUBNET=$(oci network subnet create -c "$T" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name stormcentral-public --dns-label public --wait-for-state AVAILABLE --query data.id --raw-output 2>/dev/null)
fi
[ -n "$(id_or_empty "$SUBNET")" ] || { say "Couldn't find or make a public subnet."; exit 1; }

# Ubuntu 24.04 for Arm (not Minimal), the newest build.
IMAGE=$(id_or_empty "$(oci compute image list -c "$T" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --limit 1 --query 'data[0].id' --raw-output 2>/dev/null)")
[ -n "$IMAGE" ] || { say "Couldn't find the Ubuntu 24.04 image."; exit 1; }
mapfile -t ADS < <(oci iam availability-domain list -c "$T" --query 'data[].name' | jq -r '.[]')
say "Trying ${#ADS[@]} availability domain(s) every minute. Leave this tab open; Ctrl+C stops it."

round=0
while :; do
  round=$((round + 1))
  for size in "4 24" "2 12" "1 6"; do
    read -r cpu mem <<<"$size"
    for ad in "${ADS[@]}"; do
      id=$(oci compute instance launch -c "$T" --availability-domain "$ad" --shape "$SHAPE" \
        --shape-config "{\"ocpus\":$cpu,\"memoryInGBs\":$mem}" --image-id "$IMAGE" --subnet-id "$SUBNET" \
        --assign-public-ip true --display-name "$NAME" --ssh-authorized-keys-file "$KEY.pub" \
        --query data.id --raw-output 2>"$ERR")
      if [ -n "$(id_or_empty "$id")" ]; then
        say "Got it: $cpu OCPU / $mem GB in ${ad##*:}. Starting up..."
        oci compute instance get --instance-id "$id" --wait-for-state RUNNING >/dev/null 2>&1
        ip=$(oci compute instance list-vnics --instance-id "$id" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
        echo
        echo "Your server is running. Log in with:"
        echo "  ssh -i ~/.ssh/stream ubuntu@$ip"
        exit 0
      fi
      if grep -qi "capacity" "$ERR"; then continue; fi
      if grep -qi "TooManyRequests" "$ERR"; then sleep 60; continue; fi
      say "Oracle said something unexpected; stopping:"; cat "$ERR"; exit 1
    done
  done
  say "Round $round: no free capacity yet, trying again in a minute."
  sleep 60
done
