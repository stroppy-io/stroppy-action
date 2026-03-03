import { jest } from '@jest/globals'

export const mockUploadArtifact =
  jest.fn<() => Promise<{ id?: number; size?: number }>>()

export class DefaultArtifactClient {
  uploadArtifact = mockUploadArtifact
}
