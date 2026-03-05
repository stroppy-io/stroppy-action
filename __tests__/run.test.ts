import { jest } from '@jest/globals'
import * as execFixture from '../__fixtures__/exec.js'
import * as ioFixture from '../__fixtures__/io.js'

jest.unstable_mockModule('@actions/exec', () => execFixture)
jest.unstable_mockModule('@actions/io', () => ioFixture)
jest.unstable_mockModule('../src/otel.js', () => ({
  buildOtelEnv: () => ({
    K6_OTEL_EXPORTER_TYPE: 'http',
    K6_OTEL_HTTP_EXPORTER_INSECURE: 'true',
    K6_OTEL_HTTP_EXPORTER_ENDPOINT: 'localhost:4318',
    K6_OTEL_HTTP_EXPORTER_URL_PATH: '/v1/metrics',
    K6_OTEL_METRIC_PREFIX: 'k6_',
    K6_OTEL_SERVICE_NAME: 'stroppy'
  })
}))

const { buildK6Args, buildEnv, runStroppy, VALID_PRESETS } =
  await import('../src/run.js')

describe('run.ts', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('VALID_PRESETS', () => {
    it('contains expected presets', () => {
      expect(VALID_PRESETS).toEqual([
        'tpcb',
        'tpcc',
        'tpcds',
        'simple',
        'execute_sql'
      ])
    })
  })

  describe('buildK6Args', () => {
    it('builds args with extra k6 args', () => {
      const args = buildK6Args('--no-summary', '/tmp/results.json')
      expect(args).toEqual([
        '--summary-mode',
        'full',
        '--summary-export',
        '/tmp/results.json',
        '--no-summary'
      ])
    })

    it('builds args with only results file', () => {
      const args = buildK6Args('', '/tmp/results.json')
      expect(args).toEqual([
        '--summary-mode',
        'full',
        '--summary-export',
        '/tmp/results.json'
      ])
    })

    it('splits k6Args by whitespace', () => {
      const args = buildK6Args('--tag env=ci  --quiet', '/tmp/r.json', false)
      expect(args).toEqual([
        '--summary-mode',
        'full',
        '--summary-export',
        '/tmp/r.json',
        '--tag',
        'env=ci',
        '--quiet'
      ])
    })

    it('includes --out experimental-opentelemetry when otel enabled', () => {
      const args = buildK6Args('', '/tmp/r.json', true)
      expect(args).toContain('--out')
      expect(args).toContain('experimental-opentelemetry')
    })

    it('does not include --out when otel disabled', () => {
      const args = buildK6Args('', '/tmp/r.json', false)
      expect(args).not.toContain('--out')
    })
  })

  describe('buildEnv', () => {
    it('sets required env vars', () => {
      const env = buildEnv({
        script: '',
        sqlFile: '',
        preset: 'tpcb',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '',
        duration: '',
        vus: '',
        logLevel: 'info',
        k6Args: '',
        otel: false
      })

      expect(env.DRIVER_URL).toBe('postgres://localhost/test')
      expect(env.LOG_LEVEL).toBe('info')
      expect(env.LOG_MODE).toBe('development')
      expect(env.SCALE_FACTOR).toBeUndefined()
      expect(env.VUS).toBeUndefined()
    })

    it('sets optional env vars when provided', () => {
      const env = buildEnv({
        script: '',
        sqlFile: '',
        preset: 'tpcb',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '10',
        duration: '1h',
        vus: '4',
        logLevel: 'debug',
        k6Args: '',
        otel: false
      })

      expect(env.SCALE_FACTOR).toBe('10')
      expect(env.DURATION).toBe('1h')
      expect(env.VUS).toBe('4')
    })

    it('includes OTEL env vars when otel is enabled', () => {
      const env = buildEnv({
        script: '',
        sqlFile: '',
        preset: 'tpcb',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '',
        duration: '',
        vus: '',
        logLevel: 'info',
        k6Args: '',
        otel: true
      })

      expect(env.K6_OTEL_EXPORTER_TYPE).toBe('http')
      expect(env.K6_OTEL_HTTP_EXPORTER_INSECURE).toBe('true')
      expect(env.K6_OTEL_HTTP_EXPORTER_ENDPOINT).toContain('localhost')
      expect(env.K6_OTEL_METRIC_PREFIX).toBe('k6_')
      expect(env.K6_OTEL_SERVICE_NAME).toBe('stroppy')
    })

    it('does not include OTEL env vars when otel is disabled', () => {
      const env = buildEnv({
        script: '',
        sqlFile: '',
        preset: 'tpcb',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '',
        duration: '',
        vus: '',
        logLevel: 'info',
        k6Args: '',
        otel: false
      })

      expect(env.K6_OTEL_EXPORTER_TYPE).toBeUndefined()
    })
  })

  describe('runStroppy', () => {
    it('runs custom script', async () => {
      execFixture.exec.mockResolvedValue(0)

      const result = await runStroppy({
        script: 'bench.ts',
        sqlFile: 'schema.sql',
        preset: '',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '',
        duration: '5m',
        vus: '2',
        logLevel: 'info',
        k6Args: '',
        otel: false
      })

      expect(result.exitCode).toBe(0)
      expect(execFixture.exec).toHaveBeenCalledTimes(1)

      const [cmd, args] = execFixture.exec.mock.calls[0]
      expect(cmd).toBe('stroppy')
      expect(args).toEqual(
        expect.arrayContaining(['run', 'bench.ts', 'schema.sql', '--'])
      )
    })

    it('runs preset mode', async () => {
      execFixture.exec.mockResolvedValue(0)

      const result = await runStroppy({
        script: '',
        sqlFile: '',
        preset: 'tpcb',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '',
        duration: '',
        vus: '',
        logLevel: 'info',
        k6Args: '',
        otel: false
      })

      expect(result.exitCode).toBe(0)
      // First call is stroppy gen, second is stroppy run
      expect(execFixture.exec).toHaveBeenCalledTimes(2)

      const [genCmd, genArgs] = execFixture.exec.mock.calls[0]
      expect(genCmd).toBe('stroppy')
      expect(genArgs).toEqual(
        expect.arrayContaining(['gen', '--preset', 'tpcb'])
      )
    })

    it('captures non-zero exit code', async () => {
      execFixture.exec.mockResolvedValue(1)

      const result = await runStroppy({
        script: 'bench.ts',
        sqlFile: '',
        preset: '',
        driverUrl: 'postgres://localhost/test',
        scaleFactor: '',
        duration: '',
        vus: '',
        logLevel: 'info',
        k6Args: '',
        otel: false
      })

      expect(result.exitCode).toBe(1)
    })
  })
})
