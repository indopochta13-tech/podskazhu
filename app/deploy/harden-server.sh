#!/usr/bin/env bash
# Усиление VPS SoulVoice: SSH, firewall, fail2ban, автообновления, страж от майнеров.
# Безопасно для Timeweb: Zabbix только с их IP, приложение на 127.0.0.1:8790.
set -euo pipefail

TS=$(date +%Y%m%d_%H%M%S)
BK="/root/backups/harden_${TS}"
ZBX_IPS=(92.53.116.12 92.53.116.111 92.53.116.119)

mkdir -p "$BK"
cp -a /etc/ssh/sshd_config "$BK/" 2>/dev/null || true
cp -a /etc/ssh/sshd_config.d "$BK/" 2>/dev/null || true
ufw status numbered >"$BK/ufw_before.txt" 2>/dev/null || true
cp -a /etc/fail2ban "$BK/" 2>/dev/null || true

echo "==> SSH"
cat >/etc/ssh/sshd_config.d/99-soulvoice-harden.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 30
MaxStartups 10:30:60
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
sshd -t
systemctl reload ssh

echo "==> Автообновления безопасности"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq unattended-upgrades apt-listchanges
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat >/etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable unattended-upgrades
systemctl restart unattended-upgrades

echo "==> UFW"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
while ufw status numbered | grep -qE "10050.*Anywhere"; do
  num=$(ufw status numbered | grep -E "10050.*Anywhere" | tail -1 | sed -n 's/^\[\([0-9]*\)\].*/\1/p')
  [ -n "$num" ] || break
  echo y | ufw delete "$num" || break
done
for ip in "${ZBX_IPS[@]}"; do
  ufw allow from "$ip" to any port 10050 proto tcp comment "zabbix timeweb $ip" 2>/dev/null || true
done
echo y | ufw enable

echo "==> fail2ban"
cat >/etc/fail2ban/jail.d/soulvoice.local <<'EOF'
[DEFAULT]
bantime = 4h
findtime = 10m
maxretry = 4
backend = systemd

[sshd]
enabled = true
port = ssh
maxretry = 3
bantime = 24h

[recidive]
enabled = true
logpath = /var/log/fail2ban.log
banaction = ufw
bantime = 1w
findtime = 1d
maxretry = 3
EOF
systemctl enable fail2ban
systemctl restart fail2ban

echo "==> sysctl"
cat >/etc/sysctl.d/99-soulvoice-harden.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
kernel.kptr_restrict = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF
sysctl --system >/dev/null

echo "==> Caddy: журнал для разбора атак"
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy
ORIGIN=$(grep -o 'https\?://[^ ]*' /etc/systemd/system/voicecapture.service | head -1 | sed 's|https://||' || echo "vc.local")
HOST=$(echo "$ORIGIN" | sed 's|https\?://||')
cat >/etc/caddy/Caddyfile <<EOF
${HOST} {
	encode gzip {
		match {
			header Content-Type text/*
			header Content-Type application/json*
			header Content-Type application/javascript*
			header Content-Type application/manifest+json*
			header Content-Type image/svg+xml*
		}
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}
	log {
		output file /var/log/caddy/access.log {
			roll_size 10MiB
			roll_keep 5
		}
	}
	reverse_proxy 127.0.0.1:8790
}
EOF
systemctl reload caddy

echo "==> Страж от майнеров и лишних cron"
cat >/usr/local/sbin/vc-guard.sh <<'GUARD'
#!/bin/sh
# Ищет типичные майнеры и процессы из /tmp — пишет в syslog и завершает.
LOG=vc-guard
BAD='xmrig|minerd|kdevtmpfsi|kinsing|sysupdate|dbused|cryptonight|x86_64\.kok'
ps ax -o pid=,comm=,args= 2>/dev/null | grep -Ei "$BAD" | grep -v grep | while read -r pid comm _; do
  logger -t "$LOG" "kill suspicious: pid=$pid comm=$comm"
  kill -9 "$pid" 2>/dev/null || true
done
for dir in /tmp /dev/shm /var/tmp; do
  find "$dir" -maxdepth 2 -type f \( -perm -111 -o -name '*.sh' \) -mmin -120 2>/dev/null | while read -r f; do
    case "$f" in
      /tmp/systemd-private-*/*) continue ;;
    esac
    base=$(basename "$f")
    echo "$base" | grep -Eiq "$BAD" && {
      logger -t "$LOG" "remove executable: $f"
      rm -f "$f" 2>/dev/null || true
    }
  done
done
# Неизвестный процесс жрёт CPU из подозрительного каталога
ps ax -o pid=,pcpu=,args= 2>/dev/null | awk '$2+0>=85 {print}' | while read -r pid cpu args; do
  echo "$args" | grep -Eq '/tmp/|/dev/shm/|wget.*\|.*sh|curl.*\|.*sh' || continue
  logger -t "$LOG" "kill high-cpu tmp: pid=$pid cpu=$cpu"
  kill -9 "$pid" 2>/dev/null || true
done
GUARD
chmod 755 /usr/local/sbin/vc-guard.sh
cat >/etc/cron.d/vc-guard <<'EOF'
*/10 * * * * root /usr/local/sbin/vc-guard.sh
EOF
chmod 644 /etc/cron.d/vc-guard

echo "==> Права на секреты"
chmod 600 /etc/voicecapture.env 2>/dev/null || true
chmod 640 /var/lib/voicecapture/db.json 2>/dev/null || true

echo "==> Готово. Резервная копия: $BK"
ufw status verbose | head -20
fail2ban-client status
systemctl is-active voicecapture caddy fail2ban unattended-upgrades
