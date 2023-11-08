# coli-conc Server
Home folder, setup, and configuration.

Work in progress.

## Dependencies
TODO: Add install instructions for each of these

- Deno
- fnm for Node.js
- Docker (rootless)

## Setup
TODO

```sh
docker network create nginx
```

## Service Management
Services can be managed through the `server` script. Run `server --help` for instructions.

### Script Dependencies
Deno will automatically download and cache all dependency when `server` is first run.

In order to cache dependencies ahead of time, run:

```sh
deno cache --reload --lock=deno.lock server
```

In order to update the dependencies (and therefore the lockfile), run:

```sh
deno cache --lock=deno.lock --lock-write server
```

Make sure everything still works with the updated dependencies, then commit the updated `deno.lock`.

## Other

### VSCode Setup
Install the [Deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno) and set up the workspace (once) by running the `Deno: Initialize Workspace Configuration` command.
