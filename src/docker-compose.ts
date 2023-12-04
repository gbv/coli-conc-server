/**
 * Note: Expects to be in the correct folder (use `cd` from zx).
 */

import { $ } from "npm:zx@7"
import { getEnv } from "../src/utils.ts"
import process from "node:process"

const { uid, gid, homePath, dataPath, configsPath, secretsPath } = getEnv("")
// Set environment for `docker compose` calls
process.env.UID = uid
process.env.GID = gid
process.env.HOME = homePath
process.env.DATA = dataPath
process.env.CONFIGS = configsPath
process.env.SECRETS = secretsPath

export async function init() {
  await $`docker compose pull`
  await start()
}
export async function start() {
  await $`docker compose up -d`
}
export async function status() {
  await $`docker compose ps`
}
export async function restart() {
  await $`docker compose stop`
  await $`docker compose up -d`
}
export async function stop() {
  await $`docker compose stop`
}
export async function logs() {
  await $`docker compose logs --follow --tail 100`
}
export async function log() {
  await logs()
}
export async function update() {
  await $`docker compose pull`
  await restart()
}
export async function configtest() {
  await $`docker compose config`
}
