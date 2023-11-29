# coli-conc Server
Home folder, setup, and configuration.

Work in progress.

## To-Dos
- [ ] Document github-webhook-handler
  - [ ] How to provide secret?
- [ ] Add services
- [ ] Add data import into jskos-server instances

## Dependencies
- Deno
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

### Service Configuration File
A service configuration file can be provided in `services/name-of-service.json`. It contains a JSON object with the following (optional) fields:

- `repo` with subfield `url` (required) and `branch` (optional)
  - When given, and the service folder in `services/name-of-service/` does not exist yet, `srv init name-of-service` will also clone the Git repository.
- `proxy`
  - Required if the service should be exposed to the outside world through the reverse proxy.
  - Takes the same enviroment variables as explained [above](#Define-a-Docker-Compose-Service).
  - `VIRTUAL_DEST` will be set to `/` by default because it is necessary for most applications.[^virtual_dest] To override this, provide an empty string.
  - Additionally requires `REMOTE_PORT` as the port under which the service is run (might be automatically discovered from a service's configuration in the future).
- `files`
  - Key-value pairs of files inside the repository folder (keys) that will be symlinked to files in the `configs/` folder (values).

The `files` field also supports [secrets](./secrets/README.md).

Example:
```json
{
  "repo": {
    "url": "https://github.com/gbv/name-of-service.git",
    "branch": "dev"
  },
  "proxy": {
    "VIRTUAL_HOST": "coli-conc.gbv.de",
    "VIRTUAL_PATH": "/my-service",
    "VIRTUAL_DEST": "/",
    "REMOTE_PORT": "2999"
  },
  "files": {
    "config.json": "name-of-service.json"
  }
}
```

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

### `srv` Script Dependencies
Deno will automatically download and cache all dependency when `srv` is first run.

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
