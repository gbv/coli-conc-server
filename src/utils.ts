import { exists } from "https://deno.land/std/fs/mod.ts"
import { readJson } from "../src/json.ts"
import { $, cd } from "npm:zx@7"

export enum TargetTypes {
  DockerCompose,
  WebhookHandler,
  Unknown,
}

export function getPaths(target: string) {
  const homePath = `/home/${Deno.env.get("USER")}`
  const servicePath = `${homePath}/services`
  const targetPath = `${servicePath}/${target}`

  return {
    homePath,
    servicePath,
    targetPath,
  }
}

export async function getConfig(target: string) {
  const { homePath, servicePath } = getPaths(target)
  // Read configuration JSON file if it exists
  const configFile = `${servicePath}/${target}.json`
  // deno-lint-ignore no-explicit-any
  let config: any
  if (await exists(configFile)) {
    config = await readJson(configFile)
    // Replace secrets in provided environment variables
    for (const key of Object.keys(config.env || {})) {
      if (config.env[key].startsWith("secret:")) {
        const secretFile = config.env[key].replace("secret:", "") || key
        config.env[key] = await Deno.readTextFile(`${homePath}/secrets/${secretFile}`)
      }
    }
  }
  return config
}

export async function createSymlinks(service: string) {
  const config = await getConfig(service)
  const { homePath, targetPath } = getPaths(service)
  await cd(targetPath)

  // Map files via symlinks
  if (config?.files) {
    for (const targetFile of Object.keys(config.files)) {
      let subfolder = "configs", sourceFile = config.files[targetFile]
      if (sourceFile.startsWith("secret:")) {
        sourceFile = sourceFile.replace("secret:", "")
        subfolder = "secrets"
      }
      sourceFile = `${homePath}/${subfolder}/${sourceFile}`
      await $`ln -sf ${sourceFile} ${targetFile}`
    }
  }
}

/**
 * Non-Docker services need to be exposed through the reverse-proxy. For each of those services,
 * an additional Docker container is managed to forward the port and configure the proxy.
 */
export async function manageAdditionalService(service: string, action: string) {
  const config = await getConfig(service)
  const { servicePath } = getPaths(service)
  const composeFilePath = `${servicePath}/.additional/${service}.yml`

  if (action === "start" || action === "update") {

    if (!config?.proxy) {
      return
    }
    // Set VIRTUAL_DEST to / by default (see README)
    if (config.proxy.VIRTUAL_DEST === undefined) {
      config.proxy.VIRTUAL_DEST = "/"
    }
    // Create or update Docker Compose file in `services/.additional/`
    // TODO: Update extra_hosts, probably by making it configurable
    const composeFile = `version: "3"
services:
  ${service}:
    image: marcnuri/port-forward
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:198.19.249.124"
    environment:
      - REMOTE_HOST=host.docker.internal
${Object.keys(config.proxy).map(key => `      - ${key}=${config.proxy[key]}`).join("\n")}
networks:
  default:
    external: true
    name: nginx`
      
    await Deno.writeTextFile(composeFilePath, composeFile)
    // Start service
    await $`docker compose -f ${composeFilePath} up -d`
  }
  if (action === "restart") {
    await $`docker compose -f ${composeFilePath} restart`
  }
  if (action === "stop") {
    // Stop service
    await $`docker compose -f ${composeFilePath} down`
    // Remove file
    await Deno.remove(composeFilePath)
  }
}
