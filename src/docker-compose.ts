/**
 * Note: Expects to be in the correct folder (use `cd` from zx).
 */

import { $ } from "npm:zx@7"
import { TargetTypes } from "../src/utils.ts"

export const targetType = TargetTypes.DockerCompose

export async function init() {
  await $`docker compose pull`
  await start()
}
export async function start() {
  await $`env UID="$(id -u)" GID="$(id -g)" HOME="$HOME" docker compose up -d`
}
export async function status() {
  await $`docker compose ps`
}
export async function restart() {
  await $`docker compose stop`
  await $`env UID="$(id -u)" GID="$(id -g)" HOME="$HOME" docker compose up -d`
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
  await $`env UID="$(id -u)" GID="$(id -g)" HOME="$HOME" docker compose config`
}
