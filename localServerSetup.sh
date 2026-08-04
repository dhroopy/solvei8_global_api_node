#!/usr/bin/env bash
set -euo pipefail

########################################
# CONFIG - EDIT THESE BEFORE RUNNING
########################################

# --- MySQL ---
MYSQL_ROOT_PASSWORD="ChangeMe_Root123!"
MYSQL_DATABASE="industry_db"
MYSQL_USER="industry_user"
MYSQL_PASSWORD="ChangeMe_User123!"

# --- Mosquitto (MQTT) ---
MQTT_PORT="1883"
MQTT_WS_PORT="9001"          # websocket listener, optional
MQTT_USERNAME="mqttuser"
MQTT_PASSWORD="ChangeMe_Mqtt123!"
MQTT_DATA_DIR="/opt/mosquitto"

# --- Node.js ---
NODE_VERSION="20"            # LTS major version

# --- Docker mode toggles ---
DOCKERIZE_MYSQL="true"       # true = run MySQL in Docker, false = install via apt (host)
MYSQL_DOCKER_DATA_DIR="/opt/mysql"  # only used when DOCKERIZE_MYSQL="true"

########################################
# SCRIPT - no need to edit below
########################################

log()  { echo -e "\n\033[1;32m[+] $1\033[0m"; }
skip() { echo -e "\033[1;33m[skip] $1\033[0m"; }
info() { echo -e "\033[1;34m[i] $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
   echo "Please run as root (sudo)."
   exit 1
fi

log "Checking system"
apt-get update -y

########################################
# 1. Docker - check first
########################################
log "Checking Docker"
if command -v docker &> /dev/null; then
    skip "Docker already installed: $(docker --version)"
else
    info "Docker not found. Installing..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    systemctl enable docker
    systemctl start docker
    log "Docker installed: $(docker --version)"
fi

# make sure docker daemon is running AND enabled on boot, either way
systemctl is-active --quiet docker || systemctl start docker
systemctl enable docker &> /dev/null || true

########################################
# 1b. Ensure non-root user can run docker without sudo
########################################
log "Checking docker group permissions"
TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || echo '')}"

if [[ -n "${TARGET_USER}" && "${TARGET_USER}" != "root" ]]; then
    if id -nG "${TARGET_USER}" | grep -qw docker; then
        skip "User '${TARGET_USER}' is already in the docker group"
    else
        info "Adding '${TARGET_USER}' to the docker group..."
        usermod -aG docker "${TARGET_USER}"
        log "Added. '${TARGET_USER}' must log out/in (or run 'newgrp docker') for it to take effect."
    fi
else
    info "Running as root directly (no sudo user detected) - skipping docker group setup."
fi

########################################
# 2. Mosquitto (MQTT broker) - check container first
########################################
########################################
# Mosquitto container creation (reusable function)
########################################
create_mosquitto_container() {
    mkdir -p "${MQTT_DATA_DIR}/config" "${MQTT_DATA_DIR}/data" "${MQTT_DATA_DIR}/log"

    if [[ ! -f "${MQTT_DATA_DIR}/config/mosquitto.conf" ]]; then
        cat > "${MQTT_DATA_DIR}/config/mosquitto.conf" <<EOF
listener ${MQTT_PORT}
listener ${MQTT_WS_PORT}
protocol websockets

allow_anonymous false
password_file /mosquitto/config/passwd

persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
EOF
    fi

    # Password file MUST exist on disk before mosquitto_passwd runs (it opens
    # the file for read/modify, it will not create one from scratch) and
    # MUST exist before the real container starts (allow_anonymous false +
    # missing password_file = instant crash-loop, exit code 13).
    touch "${MQTT_DATA_DIR}/config/passwd"

    docker run --rm \
      -v "${MQTT_DATA_DIR}/config:/mosquitto/config" \
      eclipse-mosquitto:2 \
      mosquitto_passwd -b /mosquitto/config/passwd "${MQTT_USERNAME}" "${MQTT_PASSWORD}"

    # mosquitto runs as uid/gid 1883 inside the container - host-mounted
    # folders default to root ownership and block it from reading/writing
    # its own config, data, and log files without this.
    chown -R 1883:1883 "${MQTT_DATA_DIR}"

    docker run -d --name mosquitto \
      -p "${MQTT_PORT}:${MQTT_PORT}" \
      -p "${MQTT_WS_PORT}:${MQTT_WS_PORT}" \
      -v "${MQTT_DATA_DIR}/config:/mosquitto/config" \
      -v "${MQTT_DATA_DIR}/data:/mosquitto/data" \
      -v "${MQTT_DATA_DIR}/log:/mosquitto/log" \
      --restart unless-stopped \
      eclipse-mosquitto:2
}

log "Checking Mosquitto broker"
if docker ps -a --format '{{.Names}}' | grep -qx "mosquitto"; then
    MOSQ_STATUS=$(docker inspect --format '{{.State.Status}}' mosquitto 2>/dev/null || echo "unknown")

    if [[ "${MOSQ_STATUS}" == "running" ]]; then
        # Even if "running" right now, verify it's not about to crash-loop -
        # a container mid-restart-cycle can briefly show "running" between
        # crashes. Check restart count as a second signal.
        MOSQ_RESTARTS=$(docker inspect --format '{{.RestartCount}}' mosquitto 2>/dev/null || echo "0")
        if [[ "${MOSQ_RESTARTS}" -gt 3 ]]; then
            info "Mosquitto container is 'running' but has ${MOSQ_RESTARTS} restarts - looks unstable. Rebuilding..."
            docker rm -f mosquitto &> /dev/null || true
            create_mosquitto_container
            log "Mosquitto rebuilt fresh"
        else
            skip "Mosquitto container already running and healthy"
        fi
    elif [[ "${MOSQ_STATUS}" == "restarting" ]]; then
        info "Mosquitto container found in a crash-loop (status: restarting). Rebuilding from scratch..."
        docker rm -f mosquitto &> /dev/null || true
        create_mosquitto_container
        log "Mosquitto rebuilt fresh"
    else
        info "Mosquitto container exists but stopped (status: ${MOSQ_STATUS}). Starting it..."
        docker start mosquitto
        sleep 3
        MOSQ_STATUS_AFTER=$(docker inspect --format '{{.State.Status}}' mosquitto 2>/dev/null || echo "unknown")
        if [[ "${MOSQ_STATUS_AFTER}" != "running" ]]; then
            info "Container failed to come up cleanly after start. Rebuilding from scratch..."
            docker rm -f mosquitto &> /dev/null || true
            create_mosquitto_container
            log "Mosquitto rebuilt fresh"
        fi
    fi
else
    info "Mosquitto container not found. Setting it up..."
    create_mosquitto_container
    log "Mosquitto installed and running"
fi

########################################
# 3. MySQL - check first
########################################
log "Checking MySQL"

if [[ "${DOCKERIZE_MYSQL}" == "true" ]]; then
    ####################################
    # 3a. MySQL via Docker
    ####################################
    if docker ps -a --format '{{.Names}}' | grep -qx "mysql"; then
        if docker ps --format '{{.Names}}' | grep -qx "mysql"; then
            skip "MySQL container already running"
        else
            info "MySQL container exists but stopped. Starting it..."
            docker start mysql
        fi
    else
        info "MySQL container not found. Setting it up..."
        mkdir -p "${MYSQL_DOCKER_DATA_DIR}/data"

        docker run -d --name mysql \
          -p 3306:3306 \
          -e MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD}" \
          -e MYSQL_DATABASE="${MYSQL_DATABASE}" \
          -e MYSQL_USER="${MYSQL_USER}" \
          -e MYSQL_PASSWORD="${MYSQL_PASSWORD}" \
          -v "${MYSQL_DOCKER_DATA_DIR}/data:/var/lib/mysql" \
          --restart unless-stopped \
          mysql:8.0

        log "MySQL container started"
    fi

    # IMPORTANT: MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE env vars only take
    # effect on the container's very FIRST boot with an empty data directory.
    # If the volume already had data (e.g. from an earlier attempt), those
    # env vars are silently ignored and the app user never gets created.
    # So we always explicitly ensure the db/user exist ourselves, regardless
    # of whether this was a fresh container or a pre-existing one.
    info "Ensuring database and app user exist (idempotent, safe to re-run)..."

    # wait for mysql to actually be ready to accept connections
    MYSQL_READY=false
    for i in $(seq 1 30); do
        if docker exec mysql mysqladmin ping -uroot -p"${MYSQL_ROOT_PASSWORD}" --silent &> /dev/null; then
            MYSQL_READY=true
            break
        fi
        sleep 2
    done

    if [[ "${MYSQL_READY}" == "true" ]]; then
        docker exec -i mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<EOF
CREATE DATABASE IF NOT EXISTS ${MYSQL_DATABASE};
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';
GRANT ALL PRIVILEGES ON ${MYSQL_DATABASE}.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
EOF
        if [[ $? -eq 0 ]]; then
            log "Database '${MYSQL_DATABASE}' and user '${MYSQL_USER}' confirmed present"
        else
            echo -e "\033[1;31m[!] Could not create/verify db+user - root password may not match what's actually set on this container.\033[0m"
            echo "    If this container pre-dates a password change in the script config, connect manually:"
            echo "    sudo docker exec -it mysql mysql -u root -p"
        fi
    else
        echo -e "\033[1;31m[!] MySQL did not become ready within 60s - skipping db/user creation this run.\033[0m"
        echo "    Check: sudo docker logs mysql --tail 50"
    fi
else
    ####################################
    # 3b. MySQL via apt (host)
    ####################################
    if dpkg -s mysql-server &> /dev/null; then
        skip "MySQL already installed: $(mysql --version 2>/dev/null || echo 'package present')"

        if systemctl is-active --quiet mysql; then
            skip "MySQL service already running"
        else
            info "MySQL installed but not running. Starting it..."
            systemctl start mysql
        fi
        systemctl enable mysql &> /dev/null || true

        info "Skipping root password reset / DB creation to avoid touching an existing setup."
        info "If you need the DB/user created, run the SQL block manually with the correct existing root password."
    else
        info "MySQL not found. Installing..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get install -y mysql-server

        systemctl enable mysql
        systemctl start mysql

        # Fresh install: try socket auth first (default on Ubuntu), fall back gracefully.
        if mysql --user=root <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD}';
CREATE DATABASE IF NOT EXISTS ${MYSQL_DATABASE};
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${MYSQL_PASSWORD}';
GRANT ALL PRIVILEGES ON ${MYSQL_DATABASE}.* TO '${MYSQL_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
        then
            log "MySQL installed, database and user created"
        else
            echo -e "\033[1;31m[!] Could not set root password automatically (unexpected auth state).\033[0m"
            echo "    Run this manually to finish setup:"
            echo "    sudo mysql"
            echo "    Then inside the mysql prompt run the ALTER USER / CREATE DATABASE statements yourself."
        fi
    fi
fi

########################################
# 4. Node.js - check first
########################################
log "Checking Node.js"
if command -v node &> /dev/null; then
    CURRENT_NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "${CURRENT_NODE_MAJOR}" == "${NODE_VERSION}" ]]; then
        skip "Node.js v${NODE_VERSION} already installed: $(node -v)"
    else
        info "Node.js installed but different major version ($(node -v)). Leaving as-is."
        info "Delete/upgrade manually if you specifically need v${NODE_VERSION}."
    fi
else
    info "Node.js not found. Installing v${NODE_VERSION}..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
    log "Node.js installed: $(node -v)"
fi

########################################
# 5. Git - check first
########################################
log "Checking Git"
if command -v git &> /dev/null; then
    skip "Git already installed: $(git --version)"
else
    info "Git not found. Installing..."
    apt-get install -y git
    log "Git installed: $(git --version)"
fi

########################################
# Self-healing check for crash-looping containers
########################################
log "Checking container health"

check_and_heal_container() {
    local name="$1"
    if docker ps -a --format '{{.Names}}' | grep -qx "${name}"; then
        sleep 3   # give it a moment to settle after start/restart
        local status
        status=$(docker inspect --format '{{.State.Status}}' "${name}" 2>/dev/null || echo "unknown")
        local restarts
        restarts=$(docker inspect --format '{{.RestartCount}}' "${name}" 2>/dev/null || echo "0")

        if [[ "${status}" == "restarting" || "${restarts}" -gt 3 ]]; then
            echo -e "\033[1;31m[!] ${name} looks like it's crash-looping (status: ${status}, restarts: ${restarts})\033[0m"
            info "Last 20 log lines from ${name}:"
            docker logs "${name}" --tail 20 || true

            if [[ "${name}" == "mosquitto" ]]; then
                info "Attempting auto-repair: rebuilding mosquitto container from scratch..."
                docker rm -f mosquitto &> /dev/null || true
                create_mosquitto_container
                sleep 3
                status=$(docker inspect --format '{{.State.Status}}' mosquitto 2>/dev/null || echo "unknown")
                if [[ "${status}" == "running" ]]; then
                    log "mosquitto auto-repair successful, now running"
                else
                    echo -e "\033[1;31m[!] Auto-repair did not fix it. Check 'docker logs mosquitto' manually.\033[0m"
                fi
            else
                info "No auto-repair rule for '${name}'. Check 'docker logs ${name}' manually."
            fi
        else
            skip "${name} is healthy (status: ${status}, restarts: ${restarts})"
        fi
    fi
}

check_and_heal_container "mosquitto"
if [[ "${DOCKERIZE_MYSQL}" == "true" ]]; then
    check_and_heal_container "mysql"
fi

########################################
# Summary
########################################
log "SETUP CHECK COMPLETE"
echo "-----------------------------------------"
command -v docker &>/dev/null && echo "Docker      : $(docker --version)" || echo "Docker      : NOT INSTALLED"
docker ps --format '{{.Names}}' 2>/dev/null | grep -qx mosquitto && echo "MQTT broker : running (port ${MQTT_PORT}, ws ${MQTT_WS_PORT}) [restart: unless-stopped]" || echo "MQTT broker : NOT RUNNING"

if [[ "${DOCKERIZE_MYSQL}" == "true" ]]; then
    docker ps --format '{{.Names}}' 2>/dev/null | grep -qx mysql && echo "MySQL       : running in Docker (port 3306) [restart: unless-stopped]" || echo "MySQL       : NOT RUNNING"
else
    command -v mysql &>/dev/null && echo "MySQL       : $(mysql --version) [host service, restart: systemd enabled]" || echo "MySQL       : NOT INSTALLED"
fi

command -v node &>/dev/null && echo "Node.js     : $(node -v)" || echo "Node.js     : NOT INSTALLED"
command -v git &>/dev/null && echo "Git         : $(git --version)" || echo "Git         : NOT INSTALLED"
echo "-----------------------------------------"