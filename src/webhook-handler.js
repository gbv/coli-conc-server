/**
 * For initial setup, run with:
 * env UID="$(id -u)" deno run --allow-env --allow-run --allow-sys --allow-read --allow-write src/webhook-handler.js
 * or easier:
 * srv init webhook-handler
 * 
 * TODOs:
 * - Also do a Git checkout in init?
 * - Notify if secret env is missing
 * - We need the port forward Docker container for nginx-proxy
 * - Automatically manage configuration file?
 *   - Might be difficult because we'd need to automatically determine the Git repo for every Docker Container.
 * - Remove support for non-Docker services from server.js
 */

import { $, cd } from "npm:zx@7"
import { getEnv, manageAdditionalService } from "../src/utils.js"
import { readJson } from "../src/json.js"
import { exists } from "jsr:@std/fs@1"

export const target = "webhook-handler"

const { homePath, basePath, targetPath, uid } = getEnv(target)
const serviceFile = `${target}.service`

// Load meta configuration
const metaConfigPath = `${basePath}/configs/webhook-handler.meta.json`
const metaConfig = await readJson(metaConfigPath)

async function cloneRepo() {
  if (metaConfig?.repo?.url && !await exists(targetPath)) {
    const args = ["clone", "--single-branch"]
    if (metaConfig.repo.branch) {
      args.push("-b")
      args.push(metaConfig.repo.branch)
    }
    args.push(metaConfig.repo.url)
    args.push(targetPath)
    await $`git ${args}`
  }
}

async function createConfigSymlink() {
  const sourceFile = `${basePath}/configs/webhook-handler.json`
  const targetFile = "config.json"
  await cd(targetPath)
  await $`ln -sf ${sourceFile} ${targetFile}`
}

export async function init() {
  await cloneRepo()
  await createConfigSymlink()
  const servicePath = `${homePath}/.config/systemd/user/`
  const serviceFilePath = `${servicePath}/${serviceFile}`
  const WEBHOOK_SECRET = await Deno.readTextFile(`${basePath}/secrets/WEBHOOK_SECRET`)
  const serviceFileContent = `
  [Unit]
  Description=webhook-handler (Deno Service)
  
  [Service]
  ExecStart=${homePath}/.deno/bin/deno run --allow-env --allow-read --allow-net --allow-run index.js
  Restart=always
  RestartSec=30
  Environment=PATH=${homePath}/.deno/bin:${basePath}/bin/:/usr/bin
  Environment=WEBHOOK_SECRET=${WEBHOOK_SECRET}
  Environment=COLI_CONC_BASE=${basePath}
  Environment=DOCKER_HOST=unix:///run/user/${uid}/docker.sock
  
  WorkingDirectory=${basePath}/services/webhook-handler
  
  [Install]
  WantedBy=default.target
  `
  
  await $`mkdir -p ${servicePath}`
  await Deno.writeTextFile(serviceFilePath, serviceFileContent)
  await $`systemctl --user daemon-reload`
  await $`systemctl --user enable --now ${serviceFile}`
  await start()
}
export async function start() {
  await $`systemctl --user start ${serviceFile}`
  await manageAdditionalService(target, "start", metaConfig.proxy)
}
export async function status() {
  await $`systemctl --user status ${serviceFile}`
}
export async function restart() {
  await $`systemctl --user restart ${serviceFile}`
  // We don't need to restart the container, but if the configuration changed, it might need to be recreated
  await manageAdditionalService(target, "update", metaConfig.proxy)
}
export async function stop() {
  await $`systemctl --user stop ${serviceFile}`
  await manageAdditionalService(target, "stop", metaConfig.proxy)
}
export async function logs() {
  await $`journalctl --user-unit ${serviceFile} -fq --lines 100`
}
export async function log() {
  await logs()
}
export async function update() {
  await cd(targetPath)
  await $`git pull`
  await restart()
}

if (import.meta.main) {
  await init()
  await status()
}
