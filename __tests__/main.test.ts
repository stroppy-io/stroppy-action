import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

const mockInstallStroppy = jest.fn<() => Promise<string>>()
const mockRunStroppy =
  jest.fn<() => Promise<{ exitCode: number; resultsFile: string }>>()
const mockCollectResults = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/install.js', () => ({
  installStroppy: mockInstallStroppy
}))
jest.unstable_mockModule('../src/run.js', () => ({
  runStroppy: mockRunStroppy,
  VALID_PRESETS: ['tpcb', 'tpcc', 'tpcds', 'simple', 'execute_sql']
}))
jest.unstable_mockModule('../src/results.js', () => ({
  collectResults: mockCollectResults
}))

const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    core.group.mockImplementation(
      async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn()
    )

    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        version: 'latest',
        script: 'bench.ts',
        'sql-file': '',
        preset: '',
        'driver-url': 'postgres://localhost/test',
        'scale-factor': '',
        duration: '5m',
        vus: '2',
        'log-level': 'info',
        'k6-args': '',
        'artifact-name': 'stroppy-results'
      }
      return inputs[name] ?? ''
    })

    mockInstallStroppy.mockResolvedValue('v1.0.0')
    mockRunStroppy.mockResolvedValue({
      exitCode: 0,
      resultsFile: '/tmp/r.json'
    })
    mockCollectResults.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('runs full pipeline successfully', async () => {
    await run()

    expect(mockInstallStroppy).toHaveBeenCalledWith('latest')
    expect(mockRunStroppy).toHaveBeenCalledWith(
      expect.objectContaining({
        script: 'bench.ts',
        driverUrl: 'postgres://localhost/test'
      })
    )
    expect(mockCollectResults).toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails when neither script nor preset provided', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'script') return ''
      if (name === 'preset') return ''
      if (name === 'driver-url') return 'postgres://localhost/test'
      if (name === 'artifact-name') return 'stroppy-results'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Either "script" or "preset"')
    )
  })

  it('fails when both script and preset provided', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'script') return 'bench.ts'
      if (name === 'preset') return 'tpcb'
      if (name === 'driver-url') return 'postgres://localhost/test'
      if (name === 'artifact-name') return 'stroppy-results'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('fails when invalid preset provided', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'preset') return 'invalid-preset'
      if (name === 'script') return ''
      if (name === 'driver-url') return 'postgres://localhost/test'
      if (name === 'artifact-name') return 'stroppy-results'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid preset')
    )
  })

  it('sets failed when benchmark exits non-zero', async () => {
    mockRunStroppy.mockResolvedValue({ exitCode: 1, resultsFile: '' })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('exited with code 1')
    )
  })

  it('catches and reports errors', async () => {
    mockInstallStroppy.mockRejectedValue(new Error('download failed'))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('download failed')
  })
})
