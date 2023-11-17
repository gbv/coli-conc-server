/**
 * For initial setup, run with:
 * env UID="$(id -u)" deno run --allow-env --allow-run --allow-sys --allow-read --allow-write src/webhook-handler.ts
 * or easier:
 * srv init webhook-handler
 * 
 * TODOs:
 * - Also do a Git checkout in init?
 * - Notify if secret env is missing
 * - We need the port forward Docker container for nginx-proxy
 * - Automatically manage configuration file?
 *   - Might be difficult because we'd need to automatically determine the Git repo for every Docker Container.
 * - Remove support for non-Docker services from server.ts
 */

import { $, cd } from "npm:zx@7"

const user = Deno.env.get("USER"), uid = Deno.env.get("UID")
const homePath = `/home/${user}`
const serviceFile = "webhook-handler.service"

export async function init() {
  const servicePath = `${homePath}/.config/systemd/user/`
  const serviceFilePath = `${servicePath}/${serviceFile}`
  const WEBHOOK_SECRET = await Deno.readTextFile(`${homePath}/secrets/WEBHOOK_SECRET`)
  const serviceFileContent = `
  [Unit]
  Description=webhook-handler (Deno Service)
  
  [Service]
  ExecStart=${homePath}/.deno/bin/deno run --allow-env --allow-read --allow-net --allow-run index.js
  Restart=always
  RestartSec=30
  Environment=PATH=/home/${user}/.deno/bin:/home/${user}/bin/:/usr/bin
  Environment=WEBHOOK_SECRET=${WEBHOOK_SECRET}
  Environment=DOCKER_HOST=unix:///run/user/${uid}/docker.sock
  
  WorkingDirectory=/home/${user}/services/webhook-handler
  
  [Install]
  WantedBy=default.target
  `
  
  await $`mkdir -p ${servicePath}`
  await Deno.writeTextFile(serviceFilePath, serviceFileContent)
  await $`systemctl --user daemon-reload`
  await $`systemctl --user enable --now ${serviceFile}`
}

export async function status() {
  await $`systemctl --user status ${serviceFile}`
}
export async function restart() {
  await $`systemctl --user restart ${serviceFile}`
}
export async function stop() {
  await $`systemctl --user stop ${serviceFile}`
}
export async function logs() {
  await $`journalctl --user-unit ${serviceFile}`
}
export async function log() {
  await logs()
}
export async function update() {
  // TODO: Should it stay there?
  await cd(`${homePath}/services/webhook-handler`)
  await $`git pull`
  await restart()
}

if (import.meta.main) {
  await init()
  await status()
}
