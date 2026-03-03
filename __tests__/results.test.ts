import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import {
  DefaultArtifactClient,
  mockUploadArtifact
} from '../__fixtures__/artifact.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/artifact', () => ({ DefaultArtifactClient }))

const { collectResults } = await import('../src/results.js')

describe('results.ts', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('sets exit-code output', async () => {
    await collectResults({ exitCode: 0, resultsFile: '' }, 'stroppy-results')

    expect(core.setOutput).toHaveBeenCalledWith('exit-code', '0')
  })

  it('warns when no results file', async () => {
    await collectResults({ exitCode: 0, resultsFile: '' }, 'stroppy-results')

    expect(core.warning).toHaveBeenCalledWith('No results file was produced')
    expect(mockUploadArtifact).not.toHaveBeenCalled()
  })

  it('uploads artifact when results file exists', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-results.json')
    fs.writeFileSync(tmpFile, '{}')

    mockUploadArtifact.mockResolvedValueOnce({ id: 42, size: 100 })

    await collectResults(
      { exitCode: 0, resultsFile: tmpFile },
      'stroppy-results'
    )

    expect(core.setOutput).toHaveBeenCalledWith('results-file', tmpFile)
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      'stroppy-results',
      [tmpFile],
      path.dirname(tmpFile)
    )
    expect(core.setOutput).toHaveBeenCalledWith('artifact-id', '42')
    expect(core.notice).toHaveBeenCalled()

    fs.unlinkSync(tmpFile)
  })

  it('warns on upload failure without failing', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-results-fail.json')
    fs.writeFileSync(tmpFile, '{}')

    mockUploadArtifact.mockRejectedValueOnce(new Error('upload failed'))

    await collectResults(
      { exitCode: 0, resultsFile: tmpFile },
      'stroppy-results'
    )

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('upload failed')
    )
    expect(core.setFailed).not.toHaveBeenCalled()

    fs.unlinkSync(tmpFile)
  })
})
