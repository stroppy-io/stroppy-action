import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import {
  DefaultArtifactClient,
  mockUploadArtifact
} from '../__fixtures__/artifact.js'
import type { RunConfig } from '../src/run.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/artifact', () => ({ DefaultArtifactClient }))

const { collectResults } = await import('../src/results.js')

const baseConfig: RunConfig = {
  script: '',
  sqlFile: '',
  preset: 'tpcb',
  driverUrl: 'postgres://user:pass@localhost/test',
  scaleFactor: '',
  duration: '10s',
  vusScale: '',
  poolSize: '',
  logLevel: 'info',
  k6Args: ''
}

describe('results.ts', () => {
  beforeEach(() => {
    core.summary.addHeading.mockReturnValue(core.summary)
    core.summary.addTable.mockReturnValue(core.summary)
    core.summary.addRaw.mockReturnValue(core.summary)
    core.summary.addCodeBlock.mockReturnValue(core.summary)
    core.summary.addSeparator.mockReturnValue(core.summary)
    core.summary.write.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('sets exit-code output', async () => {
    await collectResults(
      baseConfig,
      { exitCode: 0, resultsFile: '' },
      'stroppy-results',
      'v1.0.0'
    )

    expect(core.setOutput).toHaveBeenCalledWith('exit-code', '0')
  })

  it('warns when no results file', async () => {
    await collectResults(
      baseConfig,
      { exitCode: 0, resultsFile: '' },
      'stroppy-results',
      'v1.0.0'
    )

    expect(core.warning).toHaveBeenCalledWith('No results file was produced')
    expect(mockUploadArtifact).not.toHaveBeenCalled()
  })

  it('uploads artifact when results file exists', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-results.json')
    fs.writeFileSync(tmpFile, '{"metrics": "ok"}')

    mockUploadArtifact.mockResolvedValueOnce({ id: 42, size: 100 })

    await collectResults(
      baseConfig,
      { exitCode: 0, resultsFile: tmpFile },
      'stroppy-results',
      'v1.0.0'
    )

    expect(core.setOutput).toHaveBeenCalledWith('results-file', tmpFile)
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      'stroppy-results',
      [tmpFile],
      path.dirname(tmpFile)
    )
    expect(core.setOutput).toHaveBeenCalledWith('artifact-id', '42')

    fs.unlinkSync(tmpFile)
  })

  it('warns on upload failure without failing', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-results-fail.json')
    fs.writeFileSync(tmpFile, '{}')

    mockUploadArtifact.mockRejectedValueOnce(new Error('upload failed'))

    await collectResults(
      baseConfig,
      { exitCode: 0, resultsFile: tmpFile },
      'stroppy-results',
      'v1.0.0'
    )

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('upload failed')
    )
    expect(core.setFailed).not.toHaveBeenCalled()

    fs.unlinkSync(tmpFile)
  })

  it('writes job summary with parsed metrics tables', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-summary.json')
    const results = {
      metrics: {
        iterations: { count: 44302, rate: 2946.44 },
        iteration_duration: {
          avg: 22.38,
          min: 0.28,
          med: 1.81,
          max: 9612.75,
          'p(90)': 13.66,
          'p(95)': 32.26
        },
        vus: { value: 54, min: 0, max: 99 },
        insert_error_rate: { passes: 0, fails: 5, value: 0 }
      }
    }
    fs.writeFileSync(tmpFile, JSON.stringify(results))

    mockUploadArtifact.mockResolvedValueOnce({ id: 7, size: 50 })

    await collectResults(
      baseConfig,
      { exitCode: 0, resultsFile: tmpFile },
      'stroppy-results',
      'v2.3.0'
    )

    expect(core.summary.addHeading).toHaveBeenCalledWith(
      'Stroppy Benchmark Results',
      2
    )
    // Config table + throughput + latency + other = 4 addTable calls
    expect(core.summary.addTable).toHaveBeenCalledTimes(4)
    expect(core.summary.addHeading).toHaveBeenCalledWith('Throughput', 3)
    expect(core.summary.addHeading).toHaveBeenCalledWith('Latency (ms)', 3)
    expect(core.summary.addHeading).toHaveBeenCalledWith('Other', 3)
    expect(core.summary.write).toHaveBeenCalled()

    fs.unlinkSync(tmpFile)
  })

  it('masks password in driver URL summary', async () => {
    await collectResults(
      baseConfig,
      { exitCode: 1, resultsFile: '' },
      'stroppy-results',
      'v1.0.0'
    )

    const tableCall = core.summary.addTable.mock.calls[0][0] as string[][]
    const urlRow = tableCall.find((r) => r[0] === 'Driver URL')
    expect(urlRow).toBeDefined()
    expect(urlRow![1]).not.toContain('pass')
    expect(urlRow![1]).toContain('***')
  })
})
