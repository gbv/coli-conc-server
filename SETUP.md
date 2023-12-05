# Setup
- Requires a sudo-enabled user. Shared user `cocoda` should NOT have sudo rights!
- Non sudo commands should generally be run with user `cocoda`.

## Create a Shared User for Services
```sh
sudo adduser cocoda
```

## Clone Repository
As we are tracking the user's home folder (`/home/cocoda`) with this repository, cloning is not as straight-forward:

```sh
git init
git remote add origin https://github.com/gbv/coli-conc-server.git
git fetch
rm .bashrc
git checkout -b main --track origin/main
source .bashrc
```

## Some Basic Setup
```sh
sudo apt install -y curl wget unzip
# Generate client SSH key if necessary
ssh-keygen -t rsa -b 4096
```

## Deno
https://docs.deno.com/runtime/manual/getting_started/installation

```sh
curl -fsSL https://deno.land/x/install/install.sh | sh
```

Note: Necessary paths are already in `.bashrc`.

## Docker

### Install Docker
https://docs.docker.com/engine/install/ubuntu/

With sudo user:

```sh
# Add Docker's official GPG key:
sudo apt-get update
sudo apt-get install ca-certificates gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository to Apt sources:
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# Install Docker packages
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Check if it's working
sudo docker run hello-world
```

### Setup Rootless Docker for `cocoda` User
https://docs.docker.com/engine/security/rootless/

With sudo user:

```sh
sudo apt-get install -y dbus-user-session uidmap
sudo loginctl enable-linger cocoda
# Enable priviledged ports
sudo setcap cap_net_bind_service=ep $(which rootlesskit)
```

With user `cocoda`:

```sh
dockerd-rootless-setuptool.sh install
# => run commands to add subuid/subgid entries for user, then rerun:
dockerd-rootless-setuptool.sh install
# Note that .bashrc in this repository already has the corrects paths set, so no changes necessary

systemctl --user start docker
systemctl --user enable docker

# Check if it's working
docker run hello-world
```

### Create Docker Networks
```sh
docker network create nginx
docker network create mongo
```

### Set Inheritance ACL for Folders used in Bind Mounts
https://joeeey.com/blog/rootless-docker-avoiding-common-caveats/#storage-fixes

In the default case, the host user won't have access to files created inside containers because they will be mapped to subordinate UIDs/GIDs. To circumvent this issues, we can use an ACL (Access Control List) to give the host user access to all current and future folders and files inside a particular folder:

```sh
# Install acl package
sudo apt install acl
# Always allow rwX permissions for data, configs, and secrets subfolders
# (adjust username and home folder if necessary)
sudo setfacl -Rm d:u:cocoda:rwX,u:cocoda:rwX /home/cocoda/data
sudo setfacl -Rm d:u:cocoda:rwX,u:cocoda:rwX /home/cocoda/configs
sudo setfacl -Rm d:u:cocoda:rwX,u:cocoda:rwX /home/cocoda/secrets
```

## Others

### Docker "Error response from daemon"
https://stackoverflow.com/questions/47580528/error-response-from-daemon-get-https-registry-1-docker-io-v2-dial-tcp-look

This seems to be a DNS issue.

```sh
# With sudo user:
sudo nano /etc/resolv.conf
# Add nameservers, e.g. `nameserver 8.8.8.8`
sudo systemctl daemon-reload

# With user `cocoda`:
systemctl --user restart docker
# Check if it's working
docker run hello-world
```

Note: Might have to restart the server.

### Increase amount of inotify watches
With sudo user:

```sh
cat /proc/sys/fs/inotify/max_user_watches
# If less than 500k, run:
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
```

### Inhibit ESM messages at login
https://askubuntu.com/a/1456185

With sudo user:

```bash
sudo sed -Ezi.orig \
  -e 's/(def _output_esm_service_status.outstream, have_esm_service, service_type.:\n)/\1    return\n/' \
  -e 's/(def _output_esm_package_alert.*?\n.*?\n.:\n)/\1    return\n/' \
  /usr/lib/update-notifier/apt_check.py
# Test it
/usr/lib/update-notifier/apt_check.py --human-readable
# Regenerate cache
sudo /usr/lib/update-notifier/update-motd-updates-available --force
```
