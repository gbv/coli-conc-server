import { $ } from "npm:zx@7"

export enum TargetTypes {
  DockerCompose,
  WebhookHandler,
  Unknown,
}

export function getEnv(target: string) {
  const homePath = Deno.env.get("HOME")
  const servicePath = `${homePath}/services`
  const targetPath = `${servicePath}/${target}`
  const dataPath = `${homePath}/data`

  return {
    homePath,
    servicePath,
    targetPath,
    dataPath,
    user: Deno.env.get("USER"),
    uid: Deno.uid(),
    gid: Deno.gid(),
  }
}

/**
 * Non-Docker services need to be exposed through the reverse-proxy. For each of those services,
 * an additional Docker container is managed to forward the port and configure the proxy.
 * 
 * This is currently only used for `webhook-handler`.
 */
// deno-lint-ignore no-explicit-any
export async function manageAdditionalService(service: string, action: string, proxy: any) {
  const { servicePath } = getEnv(service)
  const composeFilePath = `${servicePath}/.additional/${service}.yml`

  if (action === "start" || action === "update") {

    if (!proxy) {
      return
    }
    // Set VIRTUAL_DEST to / by default (see README)
    if (proxy.VIRTUAL_DEST === undefined) {
      proxy.VIRTUAL_DEST = "/"
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
${Object.keys(proxy).map(key => `      - ${key}=${proxy[key]}`).join("\n")}
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
