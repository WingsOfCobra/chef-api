import { describe, it, expect, beforeEach } from 'vitest'
import { errorRing, ErrorEntry } from './error-ring'

describe('ErrorRing', () => {
  beforeEach(() => {
    errorRing.clear()
  })

  it('should start empty', () => {
    expect(errorRing.size()).toBe(0)
    expect(errorRing.getRecent()).toEqual([])
  })

  it('should add errors', () => {
    const error: ErrorEntry = {
      timestamp: new Date().toISOString(),
      service: 'docker',
      message: 'Test error',
    }

    errorRing.add(error)
    expect(errorRing.size()).toBe(1)
    expect(errorRing.getRecent()).toEqual([error])
  })

  it('should return errors newest first', () => {
    const error1: ErrorEntry = {
      timestamp: '2026-03-23T10:00:00Z',
      service: 'docker',
      message: 'First error',
    }
    const error2: ErrorEntry = {
      timestamp: '2026-03-23T10:01:00Z',
      service: 'github',
      message: 'Second error',
    }

    errorRing.add(error1)
    errorRing.add(error2)

    const recent = errorRing.getRecent()
    expect(recent[0]).toEqual(error2)
    expect(recent[1]).toEqual(error1)
  })

  it('should limit to 5 errors', () => {
    for (let i = 0; i < 10; i++) {
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'test',
        message: `Error ${i}`,
      })
    }

    expect(errorRing.size()).toBe(5)
    const recent = errorRing.getRecent()
    expect(recent[0].message).toBe('Error 9')
    expect(recent[4].message).toBe('Error 5')
  })

  it('should evict oldest when full', () => {
    for (let i = 0; i < 6; i++) {
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'test',
        message: `Error ${i}`,
      })
    }

    const recent = errorRing.getRecent()
    expect(recent.length).toBe(5)
    expect(recent.some((e) => e.message === 'Error 0')).toBe(false)
    expect(recent.some((e) => e.message === 'Error 5')).toBe(true)
  })

  it('should clear all errors', () => {
    errorRing.add({
      timestamp: new Date().toISOString(),
      service: 'test',
      message: 'Test',
    })

    expect(errorRing.size()).toBe(1)
    errorRing.clear()
    expect(errorRing.size()).toBe(0)
    expect(errorRing.getRecent()).toEqual([])
  })

  it('should include optional fields', () => {
    const error: ErrorEntry = {
      timestamp: new Date().toISOString(),
      service: 'http',
      message: 'GET /api/fail → 500',
      statusCode: 500,
      method: 'GET',
      url: '/api/fail',
    }

    errorRing.add(error)
    const recent = errorRing.getRecent()
    expect(recent[0]).toEqual(error)
    expect(recent[0].statusCode).toBe(500)
    expect(recent[0].method).toBe('GET')
  })
})
