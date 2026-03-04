import type * as core from '@actions/core'
import { jest } from '@jest/globals'

export const debug = jest.fn<typeof core.debug>()
export const error = jest.fn<typeof core.error>()
export const info = jest.fn<typeof core.info>()
export const getInput = jest.fn<typeof core.getInput>()
export const setOutput = jest.fn<typeof core.setOutput>()
export const setFailed = jest.fn<typeof core.setFailed>()
export const warning = jest.fn<typeof core.warning>()
export const notice = jest.fn<typeof core.notice>()
export const addPath = jest.fn<typeof core.addPath>()
export const group = jest
  .fn<typeof core.group>()
  .mockImplementation(
    async <T>(_name: string, fn: () => Promise<T>): Promise<T> => {
      return fn()
    }
  )

const summaryMock = {
  addHeading: jest.fn().mockReturnThis(),
  addTable: jest.fn().mockReturnThis(),
  addRaw: jest.fn().mockReturnThis(),
  addCodeBlock: jest.fn().mockReturnThis(),
  addSeparator: jest.fn().mockReturnThis(),
  addBreak: jest.fn().mockReturnThis(),
  write: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
}

export const summary = summaryMock
