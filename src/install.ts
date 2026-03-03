import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import * as exec from '@actions/exec'
import { HttpClient } from '@actions/http-client'

const TOOL_NAME = 'stroppy'
const REPO = 'stroppy-io/stroppy'

export async function resolveVersion(version: string): Promise<string> {
  if (version !== 'latest') {
    return version.startsWith('v') ? version : `v${version}`
  }

  const http = new HttpClient('stroppy-action')
  const url = `https://api.github.com/repos/${REPO}/releases/latest`
  const res = await http.getJson<{ tag_name: string }>(url)

  if (!res.result?.tag_name) {
    throw new Error('Failed to resolve latest stroppy version')
  }

  return res.result.tag_name
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
