# Systemd-capable Ubuntu for exercising infra/bootstrap.sh without a VM.
# Build: docker build -t bootstrap-test --build-arg UBUNTU=26.04 infra/test
ARG UBUNTU=26.04
FROM ubuntu:${UBUNTU}
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y systemd systemd-sysv dbus iproute2 iptables sudo openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && ssh-keygen -q -t ed25519 -N "" -f /root/testkey
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
