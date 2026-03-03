import { jest } from '@jest/globals'

export const mockGetJson =
  jest.fn<() => Promise<{ result: { tag_name: string } | null }>>()

export class HttpClient {
  getJson = mockGetJson
}
