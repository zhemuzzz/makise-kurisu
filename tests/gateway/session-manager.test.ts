/**
 * L1 交互网关 - 会话管理器测试
 * 测试会话 CRUD、TTL 清理、并发安全
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/gateway/session-manager';
import { ChannelType, type SessionInfo } from '../../src/gateway/types';
import {
  createMockSession,
  SAMPLE_SESSIONS,
  TIMING_THRESHOLDS,
  BOUNDARY_TEST_DATA,
} from '../fixtures/gateway-fixtures';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager({
      ttl: TIMING_THRESHOLDS.sessionTTL,
    });
  });

  afterEach(() => {
    sessionManager.stopCleanup();
  });

  describe('create', () => {
    it('should create a new session', () => {
      const session = sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(session.sessionId).toBe('test-session-1');
      expect(session.userId).toBe('user-1');
      expect(session.channelType).toBe(ChannelType.CLI);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActiveAt).toBeInstanceOf(Date);
    });

    it('should store created session', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const retrieved = sessionManager.get('test-session-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe('test-session-1');
    });

    it('should accept optional metadata', () => {
      const metadata = { ip: '127.0.0.1', userAgent: 'test-agent' };
      const session = sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.REST,
        metadata,
      });

      expect(session.metadata).toEqual(metadata);
    });

    it('should throw error if session already exists', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(() =>
        sessionManager.create({
          sessionId: 'test-session-1',
          userId: 'user-2',
          channelType: ChannelType.CLI,
        })
      ).toThrow(/already exists/);
    });

    it('should create session for each channel type', () => {
      const channels = [
        ChannelType.CLI,
        ChannelType.REST,
        ChannelType.DISCORD,
        ChannelType.WEBSOCKET,
      ];

      channels.forEach((channelType, index) => {
        const session = sessionManager.create({
          sessionId: `session-${index}`,
          userId: `user-${index}`,
          channelType,
        });

        expect(session.channelType).toBe(channelType);
      });

      expect(sessionManager.count()).toBe(4);
    });

    it('should handle empty session ID with error', () => {
      expect(() =>
        sessionManager.create({
          sessionId: '',
          userId: 'user-1',
          channelType: ChannelType.CLI,
        })
      ).toThrow(/invalid.*sessionId/i);
    });

    it('should handle empty user ID with error', () => {
      expect(() =>
        sessionManager.create({
          sessionId: 'test-session-1',
          userId: '',
          channelType: ChannelType.CLI,
        })
      ).toThrow(/invalid.*userId/i);
    });
  });

  describe('get', () => {
    it('should return session by ID', () => {
      const created = sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const retrieved = sessionManager.get('test-session-1');

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent session', () => {
      const retrieved = sessionManager.get('non-existent');

      expect(retrieved).toBeNull();
    });

    it('should return immutable session copy', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const retrieved1 = sessionManager.get('test-session-1');
      const retrieved2 = sessionManager.get('test-session-1');

      // Should not be the same object reference (deep copy)
      expect(retrieved1).not.toBe(retrieved2);
      expect(retrieved1).toEqual(retrieved2);
    });
  });

  describe('touch', () => {
    it('should update lastActiveAt timestamp', async () => {
      const session = sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const originalActiveAt = session.lastActiveAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = sessionManager.touch('test-session-1');

      expect(updated).not.toBeNull();
      expect(updated?.lastActiveAt.getTime()).toBeGreaterThan(
        originalActiveAt.getTime()
      );
    });

    it('should not modify createdAt', async () => {
      const session = sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const originalCreatedAt = session.createdAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      sessionManager.touch('test-session-1');

      const updated = sessionManager.get('test-session-1');
      expect(updated?.createdAt).toEqual(originalCreatedAt);
    });

    it('should return null for non-existent session', () => {
      const result = sessionManager.touch('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete existing session', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const deleted = sessionManager.delete('test-session-1');

      expect(deleted).toBe(true);
      expect(sessionManager.get('test-session-1')).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = sessionManager.delete('non-existent');

      expect(deleted).toBe(false);
    });

    it('should decrease count after deletion', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(sessionManager.count()).toBe(1);

      sessionManager.delete('test-session-1');

      expect(sessionManager.count()).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for existing session', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(sessionManager.has('test-session-1')).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(sessionManager.has('non-existent')).toBe(false);
    });

    it('should return false after session is deleted', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      sessionManager.delete('test-session-1');

      expect(sessionManager.has('test-session-1')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return 0 for empty manager', () => {
      expect(sessionManager.count()).toBe(0);
    });

    it('should return correct count after creates', () => {
      sessionManager.create({
        sessionId: 'session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });
      expect(sessionManager.count()).toBe(1);

      sessionManager.create({
        sessionId: 'session-2',
        userId: 'user-2',
        channelType: ChannelType.CLI,
      });
      expect(sessionManager.count()).toBe(2);
    });

    it('should return correct count after deletes', () => {
      sessionManager.create({
        sessionId: 'session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });
      sessionManager.create({
        sessionId: 'session-2',
        userId: 'user-2',
        channelType: ChannelType.CLI,
      });

      sessionManager.delete('session-1');

      expect(sessionManager.count()).toBe(1);
    });
  });

  describe('TTL Cleanup', () => {
    it('should not clean up active sessions', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      // Trigger cleanup manually
      sessionManager.cleanup();

      expect(sessionManager.has('test-session-1')).toBe(true);
    });

    it('should clean up expired sessions', async () => {
      // Create manager with very short TTL
      const shortTTLManager = new SessionManager({ ttl: 50 }); // 50ms

      shortTTLManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger cleanup
      shortTTLManager.cleanup();

      expect(shortTTLManager.has('test-session-1')).toBe(false);

      shortTTLManager.stopCleanup();
    });

    it('should preserve touched sessions', async () => {
      const shortTTLManager = new SessionManager({ ttl: 100 });

      shortTTLManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      // Wait half the TTL
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Touch the session to refresh
      shortTTLManager.touch('test-session-1');

      // Wait another half TTL (total > original TTL)
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Trigger cleanup
      shortTTLManager.cleanup();

      // Should still exist because we touched it
      expect(shortTTLManager.has('test-session-1')).toBe(true);

      shortTTLManager.stopCleanup();
    });

    it('should start automatic cleanup interval', () => {
      const startSpy = vi.spyOn(global, 'setInterval');

      const manager = new SessionManager({
        ttl: 60000,
        cleanupInterval: 10000,
      });

      expect(startSpy).toHaveBeenCalledWith(expect.any(Function), 10000);

      manager.stopCleanup();
      startSpy.mockRestore();
    });

    it('should stop cleanup on stopCleanup call', () => {
      const stopSpy = vi.spyOn(global, 'clearInterval');

      const manager = new SessionManager({
        ttl: 60000,
        cleanupInterval: 10000,
      });

      manager.stopCleanup();

      expect(stopSpy).toHaveBeenCalled();

      stopSpy.mockRestore();
    });
  });

  describe('findByUserId', () => {
    it('should find all sessions for a user', () => {
      sessionManager.create({
        sessionId: 'session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });
      sessionManager.create({
        sessionId: 'session-2',
        userId: 'user-1',
        channelType: ChannelType.REST,
      });
      sessionManager.create({
        sessionId: 'session-3',
        userId: 'user-2',
        channelType: ChannelType.CLI,
      });

      const user1Sessions = sessionManager.findByUserId('user-1');

      expect(user1Sessions).toHaveLength(2);
      expect(user1Sessions.map((s) => s.sessionId)).toContain('session-1');
      expect(user1Sessions.map((s) => s.sessionId)).toContain('session-2');
    });

    it('should return empty array for non-existent user', () => {
      const sessions = sessionManager.findByUserId('non-existent');

      expect(sessions).toEqual([]);
    });
  });

  describe('updateMetadata', () => {
    it('should update session metadata', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.REST,
        metadata: { ip: '127.0.0.1' },
      });

      const updated = sessionManager.updateMetadata('test-session-1', {
        userAgent: 'test-agent',
      });

      expect(updated?.metadata).toEqual({
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should merge with existing metadata', () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.REST,
        metadata: { key1: 'value1' },
      });

      sessionManager.updateMetadata('test-session-1', { key2: 'value2' });

      const session = sessionManager.get('test-session-1');
      expect(session?.metadata).toEqual({
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('should return null for non-existent session', () => {
      const result = sessionManager.updateMetadata('non-existent', {
        key: 'value',
      });

      expect(result).toBeNull();
    });
  });

  describe('Boundary Cases', () => {
    it('should handle very long session ID', () => {
      const longId = BOUNDARY_TEST_DATA.veryLongSessionId;

      const session = sessionManager.create({
        sessionId: longId,
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(session.sessionId).toBe(longId);
      expect(sessionManager.has(longId)).toBe(true);
    });

    it('should handle special characters in session ID', () => {
      const specialId = BOUNDARY_TEST_DATA.specialCharSessionId;

      const session = sessionManager.create({
        sessionId: specialId,
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(session.sessionId).toBe(specialId);
    });

    it('should handle unicode in session ID', () => {
      const unicodeId = BOUNDARY_TEST_DATA.unicodeSessionId;

      const session = sessionManager.create({
        sessionId: unicodeId,
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      expect(session.sessionId).toBe(unicodeId);
    });
  });

  describe('Performance', () => {
    it('should handle 1000 sessions efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        sessionManager.create({
          sessionId: `session-${i}`,
          userId: `user-${i % 100}`,
          channelType: ChannelType.CLI,
        });
      }

      const createDuration = performance.now() - start;

      expect(sessionManager.count()).toBe(1000);
      expect(createDuration).toBeLessThan(100); // Should be fast
    });

    it('should retrieve session in constant time', () => {
      // Create many sessions
      for (let i = 0; i < 1000; i++) {
        sessionManager.create({
          sessionId: `session-${i}`,
          userId: `user-${i}`,
          channelType: ChannelType.CLI,
        });
      }

      const start = performance.now();

      // Retrieve from end
      sessionManager.get('session-999');

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1); // O(1) lookup
    });
  });

  describe('Thread Safety (Concurrency)', () => {
    it('should handle concurrent creates safely', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(
          sessionManager.create({
            sessionId: `concurrent-session-${i}`,
            userId: `user-${i}`,
            channelType: ChannelType.CLI,
          })
        )
      );

      await Promise.all(promises);

      expect(sessionManager.count()).toBe(100);
    });

    it('should handle concurrent reads safely', async () => {
      sessionManager.create({
        sessionId: 'test-session-1',
        userId: 'user-1',
        channelType: ChannelType.CLI,
      });

      const promises = Array.from({ length: 100 }, () =>
        Promise.resolve(sessionManager.get('test-session-1'))
      );

      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result?.sessionId).toBe('test-session-1');
      });
    });
  });
});
