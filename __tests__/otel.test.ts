import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as tc from '../__fixtures__/tool-cache.js'
import * as execFixture from '../__fixtures__/exec.js'

const mockChildProcess = {
  unref: jest.fn(),
  pid: 12345
}
const mockSpawn = jest.fn().mockReturnValue(mockChildProcess)

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  ChildProcess: class {}
}))
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/tool-cache', () => tc)
jest.unstable_mockModule('@actions/exec', () => execFixture)

const {
  buildOtelConfig,
  buildOtelEnv,
  parseOtelMetrics,
  installOtelCol,
  startOtelCol,
  stopOtelCol,
  buildMermaidChart,
  OTEL_PORT
} = await import('../src/otel.js')

describe('otel.ts', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    mockSpawn.mockReturnValue(mockChildProcess)
  })

  describe('buildOtelConfig', () => {
    it('generates valid YAML with metrics file path', () => {
      const config = buildOtelConfig('/tmp/metrics.json')

      expect(config).toContain('otlp:')
      expect(config).toContain('4318')
      expect(config).toContain('/tmp/metrics.json')
      expect(config).toContain('file/metrics')
      expect(config).toContain('pipelines:')
    })

    it('uses the provided metrics file path', () => {
      const config = buildOtelConfig('/custom/path/out.json')
      expect(config).toContain('/custom/path/out.json')
    })
  })

  describe('buildOtelEnv', () => {
    it('returns K6 OTEL environment variables', () => {
      const env = buildOtelEnv()

      expect(env.K6_OTEL_EXPORTER_TYPE).toBe('http')
      expect(env.K6_OTEL_HTTP_EXPORTER_INSECURE).toBe('true')
      expect(env.K6_OTEL_HTTP_EXPORTER_ENDPOINT).toContain('localhost')
      expect(env.K6_OTEL_HTTP_EXPORTER_ENDPOINT).toContain(OTEL_PORT.toString())
      expect(env.K6_OTEL_HTTP_EXPORTER_URL_PATH).toBe('/v1/metrics')
      expect(env.K6_OTEL_METRIC_PREFIX).toBe('k6_')
      expect(env.K6_OTEL_SERVICE_NAME).toBe('stroppy')
    })
  })

  describe('parseOtelMetrics', () => {
    it('returns empty array for missing file', () => {
      const result = parseOtelMetrics('/nonexistent/file.json')
      expect(result).toEqual([])
    })

    it('parses single OTLP JSON line with gauge metric', () => {
      const tmpFile = path.join(os.tmpdir(), 'otel-gauge-test.json')
      const otlpLine = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'k6_vus',
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: '1700000000000000000',
                          asDouble: 10
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
      fs.writeFileSync(tmpFile, JSON.stringify(otlpLine) + '\n')

      const result = parseOtelMetrics(tmpFile)

      expect(result).toEqual([
        {
          name: 'k6_vus',
          type: 'gauge',
          dataPoints: [{ timeUnixNano: '1700000000000000000', value: 10 }]
        }
      ])

      fs.unlinkSync(tmpFile)
    })

    it('parses sum metric', () => {
      const tmpFile = path.join(os.tmpdir(), 'otel-sum-test.json')
      const otlpLine = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'k6_http_reqs',
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: '1700000000000000000',
                          asDouble: 150
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
      fs.writeFileSync(tmpFile, JSON.stringify(otlpLine) + '\n')

      const result = parseOtelMetrics(tmpFile)

      expect(result).toEqual([
        {
          name: 'k6_http_reqs',
          type: 'sum',
          dataPoints: [{ timeUnixNano: '1700000000000000000', value: 150 }]
        }
      ])

      fs.unlinkSync(tmpFile)
    })

    it('parses histogram metric with sum and count', () => {
      const tmpFile = path.join(os.tmpdir(), 'otel-hist-test.json')
      const otlpLine = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'k6_http_req_duration',
                    histogram: {
                      dataPoints: [
                        {
                          timeUnixNano: '1700000000000000000',
                          sum: 1234.5,
                          count: '100',
                          min: 0.5,
                          max: 99.2
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
      fs.writeFileSync(tmpFile, JSON.stringify(otlpLine) + '\n')

      const result = parseOtelMetrics(tmpFile)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('k6_http_req_duration')
      expect(result[0].type).toBe('histogram')
      expect(result[0].dataPoints[0]).toMatchObject({
        timeUnixNano: '1700000000000000000',
        sum: 1234.5,
        count: 100,
        min: 0.5,
        max: 99.2
      })

      fs.unlinkSync(tmpFile)
    })

    it('merges metrics across multiple JSON lines', () => {
      const tmpFile = path.join(os.tmpdir(), 'otel-multi-test.json')
      const line1 = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'k6_vus',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: '1700000000000000000', asDouble: 5 }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
      const line2 = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'k6_vus',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: '1700000005000000000', asDouble: 10 }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
      fs.writeFileSync(
        tmpFile,
        JSON.stringify(line1) + '\n' + JSON.stringify(line2) + '\n'
      )

      const result = parseOtelMetrics(tmpFile)

      const vus = result.find((m) => m.name === 'k6_vus')
      expect(vus).toBeDefined()
      expect(vus!.dataPoints).toHaveLength(2)
      expect(vus!.dataPoints[0].value).toBe(5)
      expect(vus!.dataPoints[1].value).toBe(10)

      fs.unlinkSync(tmpFile)
    })

    it('handles empty file gracefully', () => {
      const tmpFile = path.join(os.tmpdir(), 'otel-empty-test.json')
      fs.writeFileSync(tmpFile, '')

      const result = parseOtelMetrics(tmpFile)
      expect(result).toEqual([])

      fs.unlinkSync(tmpFile)
    })
  })

  describe('installOtelCol', () => {
    it('uses tool cache on hit', async () => {
      tc.find.mockReturnValue('/cached/otelcol')

      await installOtelCol()

      expect(core.addPath).toHaveBeenCalledWith('/cached/otelcol')
      expect(tc.downloadTool).not.toHaveBeenCalled()
    })

    it('downloads and caches on miss', async () => {
      tc.find.mockReturnValue('')
      tc.downloadTool.mockResolvedValue('/tmp/download')
      tc.extractTar.mockResolvedValue('/tmp/extracted')
      tc.cacheDir.mockResolvedValue('/cached/otelcol')

      await installOtelCol()

      expect(tc.downloadTool).toHaveBeenCalledWith(
        expect.stringContaining('otelcol-contrib')
      )
      expect(tc.downloadTool).toHaveBeenCalledWith(
        expect.stringContaining('linux_amd64')
      )
      expect(tc.extractTar).toHaveBeenCalledWith('/tmp/download')
      expect(tc.cacheDir).toHaveBeenCalled()
      expect(core.addPath).toHaveBeenCalledWith('/cached/otelcol')
    })
  })

  describe('startOtelCol', () => {
    it('writes config file and returns session', async () => {
      const metricsFile = '/tmp/otel-test-metrics.json'

      const result = await startOtelCol(metricsFile)

      expect(result.configPath).toBeTruthy()
      expect(result.metricsFile).toBe(metricsFile)

      // Config file should exist on disk
      expect(fs.existsSync(result.configPath)).toBe(true)
      const configContent = fs.readFileSync(result.configPath, 'utf-8')
      expect(configContent).toContain(metricsFile)
      expect(configContent).toContain('otlp:')

      // Should have spawned otelcol-contrib
      expect(mockSpawn).toHaveBeenCalledWith(
        'otelcol-contrib',
        expect.arrayContaining(['--config', result.configPath]),
        expect.objectContaining({ detached: true, stdio: 'ignore' })
      )

      // Cleanup
      if (fs.existsSync(result.configPath)) fs.unlinkSync(result.configPath)
    }, 5000)
  })

  describe('stopOtelCol', () => {
    it('kills otelcol-contrib processes', async () => {
      execFixture.exec.mockResolvedValue(0)

      await stopOtelCol()

      expect(execFixture.exec).toHaveBeenCalledWith(
        'pkill',
        expect.arrayContaining(['otelcol-contrib']),
        expect.objectContaining({ ignoreReturnCode: true })
      )
    })
  })

  describe('buildMermaidChart', () => {
    it('generates xychart-beta with title and data', () => {
      const chart = buildMermaidChart(
        'HTTP Duration (p95)',
        ['0:30', '1:00', '1:30'],
        [120, 135, 128]
      )

      expect(chart).toContain('```mermaid')
      expect(chart).toContain('xychart-beta')
      expect(chart).toContain('HTTP Duration (p95)')
      expect(chart).toContain('"0:30"')
      expect(chart).toContain('"1:00"')
      expect(chart).toContain('"1:30"')
      expect(chart).toContain('line [120')
      expect(chart).toContain('```\n')
    })

    it('returns empty string for empty data', () => {
      const chart = buildMermaidChart('Empty', [], [])
      expect(chart).toBe('')
    })

    it('includes y-axis label when provided', () => {
      const chart = buildMermaidChart('Throughput', ['0:30'], [100], 'req/s')
      expect(chart).toContain('y-axis "req/s"')
    })
  })
})
