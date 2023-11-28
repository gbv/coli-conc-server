/**
 * Note: Expects to be in the correct folder (use `cd` from zx).
 */

import { $ } from "npm:zx@7"
import { TargetTypes, createSymlinks } from "../src/utils.ts"

export const targetType = TargetTypes.DockerCompose

export async function init(target: string) {
  await createSymlinks(target)
  await $`docker compose pull`
  await start()
}
export async function start() {
  await $`env UID="$(id -u)" GID="$(id -g)" docker compose up -d`
}
export async function status() {
  await $`docker compose ps`
}
export async function restart(target: string) {
  await createSymlinks(target)
  await $`docker compose stop`
  await $`env UID="$(id -u)" GID="$(id -g)" docker compose up -d`
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
export async function update(target: string) {
  await $`docker compose pull`
  await restart(target)
}
