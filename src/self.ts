/**
 * Note: Expects to be in the correct folder (use `cd` from zx).
 */

import { $, cd } from "npm:zx@7"
import { getEnv } from "../src/utils.ts"

const { basePath, configsPath } = getEnv("")
const absoluteConfigsPath = configsPath.replace(basePath + "/", "") + "/"

export const target = "self"

export async function update() {
  await cd(basePath)
  // Determine updated files before pulling
  const updatedFiles = (await $`git fetch --quiet && git diff --name-only @ @{u}`.quiet()).stdout.split("\n").filter(Boolean)
  // Update repo
  await $`git pull`
  // Determine affected services by update files
  const affectedServices:any = {}
  for (const file of updatedFiles) {
    if (!file.startsWith(absoluteConfigsPath)) {
      continue
    }
    const filename = file.replace(absoluteConfigsPath, "")
    const [, service] = filename.match(/(.*?)[\.|\/]/) || [, filename]
    if (!affectedServices[service]) {
      affectedServices[service] = {
        files: [file]
      }
    } else {
      affectedServices[service].files.push(file)
    }
  }
  // Restart affected services
  for (const service of Object.keys(affectedServices)) {
    console.log(`Restarting ${service} because the following files changed: ${affectedServices[service].files.join(", ")}`)
    try {
      await $`srv restart ${service}`
      console.log(`→ Successfully restarted ${service}.`)
    } catch (_) {
      console.error(`→ Failed to restart ${service}. Maybe automatic name detection failed. Consider adjusting the config file's base name to match its associated service.`)
    }
  }
}
