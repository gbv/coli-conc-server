/**
 * Note: Expects to be in the correct folder (use `cd` from zx).
 */

import { $, cd, fs } from "npm:zx@7"
import path from "node:path"
import { getEnv } from "../src/utils.js"
import * as hooks from "../configs/hooks.js"

const { basePath, configsPath, servicePath } = getEnv("")
const relevantPaths = [configsPath, servicePath].map(path => path.replace(basePath + "/", "") + "/")

export const target = "self"

export async function update() {
  await cd(basePath)
  // Determine updated files before pulling
  const updatedFiles = (await $`git fetch --quiet && git diff --name-only @ @{u}`.quiet()).stdout.split("\n").filter(Boolean)
  // Update repo
  await $`git pull`
  // Determine affected services by update files
  const affectedServices = {}
  for (const file of updatedFiles) {
    const relevantPath = relevantPaths.find(path => file.startsWith(path))
    if (!relevantPath) {
      continue
    }
    const filename = file.replace(relevantPath, "")
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
    // Check if service exists
    if (!await fs.pathExists(path.join(servicePath, service))) {
      continue
    }
    console.log(`Restarting ${service} because the following files changed: ${affectedServices[service].files.join(", ")}`)
    try {
      await $`srv restart ${service}`
      console.log(`→ Successfully restarted ${service}, calling configUpdate hook...`)
      await hooks.configUpdate({ service, updatedFiles: affectedServices[service].files })
    } catch (_) {
      console.error(`→ Failed to restart ${service}. Maybe automatic name detection failed. Consider adjusting the config file's base name to match its associated service.`)
    }
  }
}
