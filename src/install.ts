import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import * as exec from '@actions/exec'
import { HttpClient } from '@actions/http-client'

const TOOL_NAME = 'stroppy'
const REPO = 'stroppy-io/stroppy'

export async function resolveVersion(version: string): Promise<string> {
  if (version === 'latest') {
    const http = new HttpClient('stroppy-action')
    const url = `https://api.github.com/repos/${REPO}/releases/latest`
    const res = await http.getJson<{ tag_name: string }>(url)

    if (!res.result?.tag_name) {
      throw new Error('Failed to resolve latest stroppy version')
    }

    return res.result.tag_name
  }

  const bare = version.replace(/^v/, '')
  const parts = bare.split('.')

  // Exact version (e.g. "4.0.0" or "v4.0.0") — return as-is
  if (parts.length === 3) {
    return `v${bare}`
  }

  // Partial version (e.g. "4" or "4.1") — find latest matching release
  const prefix = `v${bare}.`
  const http = new HttpClient('stroppy-action')
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=100`
  const res = await http.getJson<{ tag_name: string }[]>(url)

  if (!res.result) {
    throw new Error('Failed to fetch stroppy releases')
  }

  const match = res.result.find(
    (r) => r.tag_name === `v${bare}` || r.tag_name.startsWith(prefix)
  )

  if (!match) {
    throw new Error(
      `No stroppy release found matching "${version}". Available: ${res.result
        .slice(0, 5)
        .map((r) => r.tag_name)
        .join(', ')}`
    )
  }

  return match.tag_name
}

export async function installStroppy(version: string): Promise<string> {
  const tag = await resolveVersion(version)
  const semver = tag.replace(/^v/, '')

  core.info(`Installing stroppy ${tag}`)

  let cachedDir = tc.find(TOOL_NAME, semver)

  if (cachedDir) {
    core.info(`Found stroppy ${tag} in tool cache`)
  } else {
    const url = `https://github.com/${REPO}/releases/download/${tag}/stroppy_linux_amd64.tar.gz`
    core.info(`Downloading stroppy from ${url}`)

    const downloadPath = await tc.downloadTool(url)
    const extractedDir = await tc.extractTar(downloadPath)
    cachedDir = await tc.cacheDir(extractedDir, TOOL_NAME, semver)
  }

  core.addPath(cachedDir)

  const exitCode = await exec.exec('stroppy', ['version'])
  if (exitCode !== 0) {
    throw new Error(`stroppy version check failed with exit code ${exitCode}`)
  }

  return tag
}
