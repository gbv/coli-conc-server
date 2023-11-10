# coli-conc Server
Home folder, setup, and configuration.

Work in progress.

## To-Dos
- [ ] Use user "cocoda"
- [ ] Add install instructions for dependencies
- [ ] Extend setup section

## Dependencies
- Deno
- fnm for Node.js
- Docker (rootless)

## Setup

```sh
docker network create nginx
```

## Service Management
Services can be managed through the `server` script. Run `server --help` for instructions.

### Define a Docker Compose Service
Create a subdirectory in the `services/` folder with a `docker-compose.yml` file. The folder name defines the service name.

Set up the Compose file as usual, but add the additional environment variables `VIRTUAL_HOST`, `VIRTUAL_PORT` (optional, default: 80), `VIRTUAL_PATH` (optional), and `VIRTUAL_DEST` (optional). The exposed container also needs to be part of the "nginx" Docker network.

Basic example for Cocoda:

```yml
version: "3"

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

### Define a Non-Docker Service
Currently, only Node.js services are supported, and it is assumed that they contain a `ecosystem.example.json` file in the repository. This file is adjusted to build the configuration for PM2.

Non-Docker services also reside in a subdirectory in the `services/` folder. Usually, this is a Git repository, so the initial step will be checking it out:

```sh
git checkout https://github.com/user/repo services/name-of-service
```

In most cases, you will need to create a configuration file for the service itself (please refer to the services docs).

If your service should be exposed to the outside world through the reverse proxy, you'll need to add an additional file in `services/name-of-service.json`:

```json
{
  "VIRTUAL_HOST": "coli-conc.gbv.de",
  "VIRTUAL_PATH": "/my-service",
  "REMOTE_PORT": "2999"
}
```

In addition to the environment variables explain above (for Docker Compose services), `REMOTE_PORT` is required as the port under which the service is run. In the future, this port might be automatically discovered from the service's configuration.

### Initialize, Start, Stop, Restart, or Update a Service
The first time a service is run, it usually needs to be initialize to pull all dependencies:

```sh
server init name-of-service
```

This will also start the service.

Starting, stopping, and restarting a service is just as easy:

```sh
server stop name-of-service
server start name-of-service
server restart name-of-service
```

Updating a service pulls updates for a Git repository (if applicable), pulls the latest Docker image, updates dependencies, and restarts the application:

```sh
server update name-of-service
```

### `server` Script Dependencies
Deno will automatically download and cache all dependency when `server` is first run.

In order to cache dependencies ahead of time, run:

```sh
cd src; deno cache --reload --lock=deno.lock server.ts
```

In order to update the dependencies (and therefore the lockfile), run:

```sh
cd src; deno cache --lock=deno.lock --lock-write server.ts
```

Make sure everything still works with the updated dependencies, then commit the updated `deno.lock`.

## Other

### VSCode Setup
Install the [Deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno) and set up the workspace (once) by running the `Deno: Initialize Workspace Configuration` command.
