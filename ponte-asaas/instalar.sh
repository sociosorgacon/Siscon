#!/usr/bin/env bash
# Siscon — "ponte" com IP fixo para a API do Asaas (AWS Lightsail, Ubuntu).
# O Asaas só aceita chamadas da API vindas de IP liberado na borda; o Supabase não tem IP fixo.
# Este servidor recebe as chamadas da Edge Function "asaas" e as repassa ao Asaas saindo sempre pelo mesmo IP.
#
# • HTTPS automático (Caddy + Let's Encrypt) no endereço <ip-com-hifens>.sslip.io — não precisa de domínio.
# • Só repassa chamadas com o cabeçalho X-Ponte-Token correto (não é um proxy aberto).
# • A chave do Asaas NÃO fica aqui: continua só nos Secrets do Supabase.
# Rodar uma vez, DEPOIS de anexar o IP estático à instância:  sudo bash instalar.sh
set -euo pipefail

apt-get update -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg openssl unattended-upgrades
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

IP=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')
HOST="$(echo "$IP" | tr . -).sslip.io"
TOKEN=$(openssl rand -hex 24)

cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
    @autorizado header X-Ponte-Token $TOKEN
    handle @autorizado {
        reverse_proxy https://api.asaas.com {
            header_up Host {upstream_hostport}
            header_up -X-Ponte-Token
        }
    }
    respond "Acesso negado" 403
}
CADDY
chown root:caddy /etc/caddy/Caddyfile; chmod 640 /etc/caddy/Caddyfile   # o Caddy roda como usuário "caddy" e precisa ler o arquivo
systemctl enable caddy
systemctl restart caddy

echo
echo "================ PONTE ASAAS INSTALADA ================"
echo "IP fixo (informar ao atendimento do Asaas): $IP"
echo "Secret ASAAS_BASE_URL   = https://$HOST/v3"
echo "Secret ASAAS_PONTE_TOKEN = $TOKEN"
echo "======================================================="
