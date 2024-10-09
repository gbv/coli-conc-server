/**
 * Note: Expects to be in the correct folder (use `cd` from zx).
 */

import { $ } from "npm:zx@7"
import { getEnv } from "../src/utils.ts"
import process from "node:process"

const { uid, gid, basePath, dataPath, configsPath, secretsPath } = getEnv("")
// Set environment for `docker compose` calls
process.env.UID = uid
process.env.GID = gid
process.env.BASE = basePath
process.env.DATA = dataPath
process.env.CONFIGS = configsPath
process.env.SECRETS = secretsPath

export async function init() {
  await $`docker compose pull`
  await start()
}
export async function start() {
  await $`docker compose up -d --remove-orphans`
}
export async function status() {
  await $`docker compose ps`
}
export async function restart() {
  await $`docker compose stop`
  await $`docker compose up -d --remove-orphans`
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
export async function exec(_target: string, additionalArgs: string[]) {
  await $`docker compose exec ${additionalArgs}`.stdio("inherit", "inherit", "inherit")
}
export async function run(_target: string, additionalArgs: string[]) {
  await $`docker compose run ${additionalArgs}`.stdio("inherit", "inherit", "inherit")
}
