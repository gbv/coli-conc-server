# coli-conc Server
Home folder, setup, and configuration for [coli-conc](https://coli-conc.gbv.de/) services.

Work in progress.

## Table of Contents
- [Dependencies](#dependencies)
- [Setup](#setup)
- [Service Management](#service-management)
  - [Define a Docker Compose Service](#define-a-docker-compose-service)
  - [Initialize, Start, Stop, Restart, or Update a Service](#initialize-start-stop-restart-or-update-a-service)
  - [Special Service: GitHub Webhook Handler](#special-service-github-webhook-handler)
  - [`srv` Script Dependencies](#srv-script-dependencies)
- [Data Management for JSKOS Server Instances](#data-management-for-jskos-server-instances)
- [Data Management for MongoDB](#data-management-for-mongodb)
  - [Dump Data](#dump-data)
  - [Restore Data](#restore-data)
  - [Access MongoDB from the outside](#access-mongodb-from-the-outside)
- [Other](#other)
  - [Folder Structure](#folder-structure)
  - [Docker Troubleshooting](#docker-troubleshooting)
  - [VSCode Setup](#vscode-setup)
  - [Restrict Access via Basic Authentication](#restrict-access-via-basic-authentication)
  - [Serving Static Files](#serving-static-files)

## Dependencies
- Deno (v2)
- Docker (rootless)

## Setup
See [SETUP.md](./SETUP.md).

## Service Management
Services can be managed through the `srv` script. Run `srv --help` for instructions.

### Define a Docker Compose Service
Create a subdirectory in the `services/` folder with a `docker-compose.yml` file. The folder name defines the service name.

Set up the Compose file as usual, but add the additional environment variables `VIRTUAL_HOST`, `VIRTUAL_PORT` (optional, default: 80), `VIRTUAL_PATH` (optional), and `VIRTUAL_DEST` (optional). The exposed container also needs to be part of the "nginx" Docker network.

Basic example for Cocoda:

```yml
services:
  cocoda:
    image: ghcr.io/gbv/cocoda
    environment:
      - VIRTUAL_HOST=coli-conc.gbv.de
      - VIRTUAL_PATH=/cocoda/app/
      - VIRTUAL_DEST=/
    restart: unless-stopped

networks:
  default:
    external: true
    name: nginx
```

Explanation of additional environment variables for proxy configuration:
- `VIRTUAL_HOST`: The hostname (without protocol or path) under which the service should be accessible. Usually that's `coli-conc.gbv.de`.
- `VIRTUAL_PORT`: The port under which the service is run (this can be found in the service's Docker documentation). Default: 80.
- `VIRTUAL_PATH`: The sub-path under which the service should be accessible. Note that some services, mostly front-end applications, might require a trailing slash to work correctly.
- `VIRTUAL_DEST`: "This environment variable can be used to rewrite the `VIRTUAL_PATH` part of the requested URL to proxied application." (Please refer to [this section](https://github.com/nginx-proxy/nginx-proxy#path-based-routing) of the nginx-proxy documentation.)
  - In most cases, this needs to be set to `/`.[^virtual_dest]

As for environment variables, you can either set them directly in the compose file as in the example above, or you can put them into separate files by specifying `env_file`:

```yml
...
    env_file:
      - $HOME/configs/public.env
      - $HOME/secrets/private.env
...
```

Later entries override earlier entries. You can check the resulting compose file by running `srv configtest my-service`.

**Things to note before committing a new or edited service:**

- Make sure the service name is unique. Duplicate names **will cause issues** with the reverse proxy.
  - You can run `./src/check.js` to check for this issue.
- Make sure all services that need to be accessible via the proxy are in the correct (nginx) network.
- Ideally, set up a local test environment to check whether things work before actually committing a change.

### Initialize, Start, Stop, Restart, or Update a Service
The first time a service is run, it usually needs to be initialize to pull all dependencies:

```sh
srv init name-of-service
```

This will also start the service.

Starting, stopping, and restarting a service is just as easy:

```sh
srv stop name-of-service
srv start name-of-service
srv restart name-of-service
```

Updating a service pulls updates for a Git repository (if applicable), pulls the latest Docker image, updates dependencies, and restarts the application:

```sh
srv update name-of-service
```

You can see logs for a service using `srv logs name-of-service`.

To run a `docker compose exec` command for a specific service, you can use `srv exec name-of-service <arguments>`. This is necessary as `srv` defines certain environment variables that are required for running `docker compose` commands. Note that the name of the Compose service will still need to be specified in the argments. (The equivalent for `docker compose run` is `srv run name-of-service`.)

There is also a wrapper around raw `docker compose` commands: `srv raw name-of-service <arguments>`. For example: `srv raw jskos-server ps`

### Special Service: GitHub Webhook Handler
[GitHub Webhook Handler](https://github.com/gbv/github-webhook-handler) is used to process webhooks from GitHub in order to update services automatically. It is not run via Docker, but defined as a special service with the name `webhook-handler` and run through Deno. Its repository is pulled on `srv init webhook-handler` and it supports the other commands above as well. It has three configuration files:

- `~/configs/webhook-handler.meta.json`: Meta configuration for proxy and Git repo.
- `~/configs/webhook-handler.json`: Configuration for the service itself (will be symlinked into the repo as `config.json`).
- `~/secrets/WEBHOOK_SECRET`: File containing the webhook secret required in GitHub Webhook Handler (will be provided as environment variable).

Note that since we're using Docker for all services, using the `push` event is not advisable as the Docker container for that push will not be deployed yet. Instead, it is possible to use the `workflow_run` event for the completed GitHub workflow that updates the Docker container. For example:

```json
{
  "repository": "gbv/jskos-server",
  "command": "srv update jskos-server-dev",
  "event": "workflow_run",
  "action": "completed",
  "filter": {
    "body.workflow_run.head_branch": "dev",
    "body.workflow_run.path": ".github/workflows/docker.yml",
    "body.workflow_run.conclusion": "success"
  }
}
```

Note that it is not possible to pick out which workflows trigger the `workflow_run` event, so you will get unmatched triggers regularly. For this reason, GitHub Webhook Handler should be configured with `"verbosity": "verbose"` instead of `"verbosity": "all"`.

### `srv` Script Dependencies
Deno will automatically download and cache all dependency when `srv` is first run.

In order to cache dependencies ahead of time, run:

```sh
deno install --entrypoint src/server.js
```

In order to update the dependencies (and therefore the lockfile), run:

```sh
rm deno.lock
deno install --entrypoint src/server.js
```

Make sure everything still works with the updated dependencies, then commit the updated `deno.lock`.

## Data Management for JSKOS Server Instances
Data imports and resets for [JSKOS Server](https://github.com/gbv/jskos-server) instances can be managed through the `data` script. Run `data --help` for instructions.

The basic usage is: `data <command> <service> <arguments for jskos-server import script>` where `<command>` is either "import" or "reset" and `<service>` is any of the services (defined in the `services/` subfolder) that includes a JSKOS Server instance.

Note that local files will be mounted into the container when running the import script. The file argument is expected to be the last argument.

Examples:

```sh
data import jskos-server schemes my-schemes.ndjson
data import jskos-server concordances "https://coli-conc.gbv.de/api/concordances/rvk-ddc-4"
```

In general, vocabulary data for import into one of the JSKOS Server instances should be defined in `configs/vocabularies.txt` in this repository. Running `data import` without the `<service>` parameter then uses this list for importing the data:

```sh
# This imports all of the defined vocabularies. Only new data will be imported.
data import
# This will force all concept data to be imported, even if it already exists.
# Note that existing concepts will be overridden, but if a concept exists in the database, but not in the new data, it will not be deleted.
data import -f
# This RESETS all concept data before import (confirmation needed). It is recommended to run this command only with options `-t` and `-s`.
data import -r
# Resets and reimports all data for vocabulary `http://bartoc.org/en/node/1707` in the target instance `jskos-server`.
data import -t jskos-server -s http://bartoc.org/en/node/1707 -r
```

Data import is currently not integrated with any webhooks and needs to be manually triggered.

## Data Management for MongoDB
The easiest way to dump and restore data with MongoDB running in Docker is using a single-file archive via `--archive`.

### Dump Data
```sh
srv exec mongo mongo mongodump -d "name-of-database" --forceTableScan --gzip --archive > dump.archive
```

### Restore Data
```sh
cat dump.archive | srv exec mongo -iT mongo mongorestore --gzip --nsFrom="name-of-database.*" --nsTo="new-name-of-database-dev.*" --archive
```

Leave out `--nsFrom` and `--nsTo` if the database name should stay the same. Add `--drop` if you would like to drop the tables before import.

### Access MongoDB from the outside

The MongoDB is not accessible from the outside. However, its port (default port `27017`) is forwarded to `localhost`, so to connect to it from the outside, you could set up an SSH tunnel for port `27017`, e.g.: `ssh -NL 27017:localhost:27017 cocoda@your-server`

## Other

### Folder Structure
- `.config/docker/daemon.json` - Docker daemon configuration
- `bin/`
  - `bin/autocompletion.sh` - Bash autocompletion for `srv` script
  - `bin/srv` - Symlink for `srv` script (links to `src/server.js`)
- `configs/` - [Folder for configuration files](./configs/README.md)
  - `configs/webhook-handler.meta.json` - Proxy configuration for [webhook handler](#special-service-github-webhook-handler)
  - `configs/webhook-handler.json` - Actual configuration for [webhook handler](#special-service-github-webhook-handler)
- `data/` - [Folder with persistent data for Docker containers](./data/README.md)
- `secrets/` - [Folder for secrets](./secrets/README.md); its contents (except for `README.md`) are not part of the repo
- `services/` - Folder for services; one subfolder for each service
- `src/` - Source code for `srv` script (TypeScript, run with Deno)
- `.bashrc`/`.bash_profile` - Bash configuration and paths
- `.gitignore` - Files ignored by Git; note that by default, all files are ignored because we expect this repo to be checked out into the home folder
- `README.md` - The file you are currently reading
- `SETUP.md` - Server setup instructions

### Docker Troubleshooting
Some useful Docker commands for troubleshooting:

- `srv configtest <name-of-service>` - show the full Compose project, including expanded environment variables
- `docker compose ls` - list all running Docker Compose projects/services
- `docker ps` - list all running Docker containers
- `srv raw <name-of-service> ps` - list all running containers related to a service (i.e. inside a Docker Compose project)
  - e.g. `srv raw jskos-server ps`
- `srv raw <name-of-service> <compose-command>` - runs [Docker Compose commands](https://docs.docker.com/reference/cli/docker/compose/) for a specific service
  - Note that the `srv` script adds important environment variables without which some commands will not work as expected.
  - e.g. `srv raw jskos-server restart` (this is different from `srv restart jskos-server` which will run `docker compose stop && docker compose up -d --remove-orphans`)

### VSCode Setup
Install the [Deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno) and set up the workspace (once) by running the `Deno: Initialize Workspace Configuration` command.

[^virtual_dest]: If `VIRTUAL_PATH` is set, but `VIRTUAL_DEST` isn't, the requests forwarded to the application will include the whole path. This means that if an application listens to the root path `/`, `VIRTUAL_DEST` NEEDS to be set to `/` as well for the application to work (which should be the case for most APIs). Another caveat is that when `VIRTUAL_PATH` does not end on a slash, requests to that path with a slash appended will result in a double slash. In most cases, it is better to end `VIRTUAL_PATH` in a slash which adds a 301 redirect from the non-slash version.

### Restrict Access via Basic Authentication
Sometimes, it is necessary to restrict access to a certain service with basic authentication. First, we need another dependency if it's not yet installed: `sudo apt install apache2-utils`. Then set up a custom vhost configuration and the password file:

```sh
mkdir -p ~/configs/vhost.d
mkdir -p ~/secrets/htpasswd
htpasswd -cb ~/secrets/htpasswd/my-service some_username some_password
```

For the custom vhost configuration, substitute `VIRUTAL_HOST` and `VIRTUAL_PATH` in the following command:

```sh
touch ~/configs/vhost.d/VIRTUAL_HOST_$(echo -n "VIRTUAL_PATH" | sha1sum | awk '{ print $1 }')_location
```

Add the following content (with your editor of choice), adjusting `my-service` as above:

```
auth_basic "My Service";
auth_basic_user_file /etc/nginx/htpasswd/my-service;
```

Add bind volumes to the nginx container in `~/services/nginx/docker-compose.yml`:

```yml
...
    volumes:
      - /run/user/$UID/docker.sock:/tmp/docker.sock:ro
      - $HOME/configs/vhost.d:/etc/nginx/vhost.d:ro
      - $HOME/secrets/htpasswd:/etc/nginx/htpasswd:ro
...
```

Finally, restart the proxy:

```sh
srv restart nginx
```

### Serving Static Files

In order to serve static files under a certain sub-path, create a new service (e.g. `static-test`) with a `docker-compose.yml` file like this:

```yml
services:
  static-test:
    image: lscr.io/linuxserver/nginx
    volumes:
      # Depending on what kind of static files are served and whether they are part of the repo
      # nginx www data
      - $DATA/static-test:/config/www
      # Required if using fancyindex module
      - $CONFIGS/nginx-fancyindex-theme.conf:/config/nginx/site-confs/default.conf
      - $DATA/nginx-fancyindex-theme/Nginx-Fancyindex-Theme-light:/config/Nginx-Fancyindex-Theme-light
    environment:
      - VIRTUAL_HOST=coli-conc.gbv.de
      - VIRTUAL_PATH=/test/
      - VIRTUAL_DEST=/
    restart: unless-stopped

networks:
  default:
    external: true
    name: nginx
```

Then start it like any other service with `srv init static-test`.
