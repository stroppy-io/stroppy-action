import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as tc from '../__fixtures__/tool-cache.js'
import * as execFixture from '../__fixtures__/exec.js'
import { HttpClient, mockGetJson } from '../__fixtures__/http-client.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/tool-cache', () => tc)
jest.unstable_mockModule('@actions/exec', () => execFixture)
jest.unstable_mockModule('@actions/http-client', () => ({ HttpClient }))

const { resolveVersion, installStroppy } = await import('../src/install.js')

describe('install.ts', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('resolveVersion', () => {
    it('returns tag with v prefix for explicit version', async () => {
      expect(await resolveVersion('1.2.3')).toBe('v1.2.3')
    })

    it('preserves existing v prefix', async () => {
      expect(await resolveVersion('v1.2.3')).toBe('v1.2.3')
    })

    it('resolves latest from GitHub API', async () => {
      mockGetJson.mockResolvedValueOnce({
        result: { tag_name: 'v0.5.0' }
      })

      const tag = await resolveVersion('latest')
      expect(tag).toBe('v0.5.0')
      expect(mockGetJson).toHaveBeenCalledTimes(1)
    })

    it('throws when API returns no result', async () => {
      mockGetJson.mockResolvedValueOnce({ result: null })

      await expect(resolveVersion('latest')).rejects.toThrow(
        'Failed to resolve latest stroppy version'
      )
    })

    it('resolves major-only version to latest matching release', async () => {
      mockGetJson.mockResolvedValueOnce({
        result: [
          { tag_name: 'v4.1.0' },
          { tag_name: 'v4.0.0' },
          { tag_name: 'v3.1.0' }
        ]
      })

      const tag = await resolveVersion('4')
      expect(tag).toBe('v4.1.0')
    })

    it('resolves major.minor version to latest matching release', async () => {
      mockGetJson.mockResolvedValueOnce({
        result: [
          { tag_name: 'v4.1.2' },
          { tag_name: 'v4.1.1' },
          { tag_name: 'v4.0.0' }
        ]
      })

      const tag = await resolveVersion('v4.1')
      expect(tag).toBe('v4.1.2')
    })

    it('throws when no release matches partial version', async () => {
      mockGetJson.mockResolvedValueOnce({
        result: [{ tag_name: 'v3.1.0' }, { tag_name: 'v3.0.0' }]
      })

      await expect(resolveVersion('4')).rejects.toThrow(
        'No stroppy release found matching "4"'
      )
    })
  })

  describe('installStroppy', () => {
    beforeEach(() => {
      mockGetJson.mockResolvedValue({
        result: { tag_name: 'v1.0.0' }
      })
      execFixture.exec.mockResolvedValue(0)
    })

    it('uses tool cache on hit', async () => {
      tc.find.mockReturnValue('/cached/stroppy')

      const tag = await installStroppy('latest')

      expect(tag).toBe('v1.0.0')
      expect(core.addPath).toHaveBeenCalledWith('/cached/stroppy')
      expect(tc.downloadTool).not.toHaveBeenCalled()
    })

    it('downloads and caches on miss', async () => {
      tc.find.mockReturnValue('')
      tc.downloadTool.mockResolvedValue('/tmp/download')
      tc.extractTar.mockResolvedValue('/tmp/extracted')
      tc.cacheDir.mockResolvedValue('/cached/stroppy')

      const tag = await installStroppy('v1.0.0')

      expect(tag).toBe('v1.0.0')
      expect(tc.downloadTool).toHaveBeenCalledWith(
        expect.stringContaining('stroppy_linux_amd64.tar.gz')
      )
      expect(tc.extractTar).toHaveBeenCalledWith('/tmp/download')
      expect(tc.cacheDir).toHaveBeenCalledWith(
        '/tmp/extracted',
        'stroppy',
        '1.0.0'
      )
      expect(core.addPath).toHaveBeenCalledWith('/cached/stroppy')
    })

    it('throws when version check fails', async () => {
      tc.find.mockReturnValue('/cached/stroppy')
      execFixture.exec.mockResolvedValue(1)

      await expect(installStroppy('v1.0.0')).rejects.toThrow(
        'stroppy version check failed'
      )
    })
  })
})
