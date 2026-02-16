# Test Design: L4 Memory System (KURISU-002)

> Test-Driven Development - Define test cases FIRST before implementation
> Coverage Target: 80%+

## Overview

Test suite for the L4 Memory System MVP, covering:
- SessionMemory (瞬时记忆)
- ShortTermMemory (Mem0 adapter)
- ContextBuilder
- HybridMemoryEngine

## Test Files Structure

```
tests/memory/
├── fixtures.ts              # Test data and mocks
├── session-memory.test.ts   # SessionMemory unit tests
├── short-term-memory.test.ts # ShortTermMemory unit tests
├── context-builder.test.ts  # ContextBuilder unit tests
└── hybrid-engine.test.ts    # HybridMemoryEngine integration tests
```

## Test Categories

### 1. SessionMemory Tests (session-memory.test.ts)

#### 1.1 Constructor & Initialization
- [x] Should initialize with empty message list
- [x] Should initialize with session ID
- [x] Should accept optional config (maxSize, ttl)
- [x] Should use default config when not provided

#### 1.2 Message Operations
- [x] Should add message to session
- [x] Should return new SessionMemory instance (immutability)
- [x] Should not mutate original instance when adding
- [x] Should enforce message limit (default 100)
- [x] Should discard oldest messages when limit exceeded
- [x] Should support different message roles (user, assistant, system)
- [x] Should include timestamp automatically

#### 1.3 Query Operations
- [x] Should get all messages
- [x] Should get messages by role
- [x] Should get messages within time range
- [x] Should get recent N messages
- [x] Should return empty array when no messages
- [x] Should return copy of messages (immutability)

#### 1.4 Session Management
- [x] Should clear all messages
- [x] Should return new instance when clearing
- [x] Should get message count
- [x] Should check if session is empty

#### 1.5 Edge Cases
- [x] Should handle null/undefined content gracefully
- [x] Should handle empty string content
- [x] Should handle very long message content (10k+ chars)
- [x] Should handle special characters and emojis
- [x] Should handle concurrent operations safely
- [x] Should validate message structure

#### 1.6 Performance
- [x] Should handle adding 1000+ messages efficiently
- [x] Should handle query operations efficiently

---

### 2. ShortTermMemory Tests (short-term-memory.test.ts)

#### 2.1 Constructor & Configuration
- [x] Should initialize with Mem0 client
- [x] Should use session ID as user_id for isolation
- [x] Should accept custom Mem0 config
- [x] Should throw error if Mem0 client not configured

#### 2.2 Memory Operations (CRUD)
- [x] Should add memory with content
- [x] Should add memory with metadata
- [x] Should include session context in metadata
- [x] Should return memory ID on success
- [x] Should handle Mem0 API errors gracefully
- [x] Should search memories by query
- [x] Should limit search results
- [x] Should isolate memories by session (user_id)
- [x] Should return empty array when no matches
- [x] Should delete memory by ID
- [x] Should handle deletion of non-existent memory

#### 2.3 Memory Metadata
- [x] Should include timestamp in metadata
- [x] Should include importance score
- [x] Should include message role
- [x] Should include session ID
- [x] Should validate metadata structure

#### 2.4 Error Handling
- [x] Should handle network errors
- [x] Should handle invalid API responses
- [x] Should handle timeout errors
- [x] Should retry on transient failures
- [x] Should provide meaningful error messages

#### 2.5 Mock Scenarios
- [x] Should work with mocked Mem0 client
- [x] Should verify correct API calls
- [x] Should handle mock failures

#### 2.6 Edge Cases
- [x] Should handle empty query
- [x] Should handle very long queries
- [x] Should handle special characters in content
- [x] Should handle concurrent add operations
- [x] Should handle concurrent search operations

---

### 3. ContextBuilder Tests (context-builder.test.ts)

#### 3.1 Constructor & Initialization
- [x] Should initialize with dependencies
- [x] Should use default template when not provided
- [x] Should accept custom context template

#### 3.2 Context Building
- [x] Should build context from persona prompt
- [x] Should include session memories
- [x] Should include short-term memories
- [x] Should include recent messages
- [x] Should respect context window limit
- [x] Should prioritize recent and relevant content

#### 3.3 Template Rendering
- [x] Should render persona section
- [x] Should render memories section
- [x] Should render recent messages section
- [x] Should handle empty sections gracefully
- [x] Should use correct formatting

#### 3.4 Memory Integration
- [x] Should integrate with SessionMemory
- [x] Should integrate with ShortTermMemory
- [x] Should merge multiple memory sources
- [x] Should deduplicate memories
- [x] Should order memories by relevance/recency

#### 3.5 Context Truncation
- [x] Should truncate to fit context window
- [x] Should preserve persona prompt (highest priority)
- [x] Should preserve recent messages (high priority)
- [x] Should truncate memories first (lower priority)
- [x] Should add truncation indicator

#### 3.6 Edge Cases
- [x] Should handle empty session memory
- [x] Should handle empty short-term memory
- [x] Should handle very long persona prompt
- [x] Should handle special characters in context
- [x] Should handle missing dependencies gracefully

#### 3.7 Output Validation
- [x] Should return string context
- [x] Should return context metadata (token count, sources)
- [x] Should validate context structure

---

### 4. HybridMemoryEngine Tests (hybrid-engine.test.ts)

#### 4.1 Constructor & Initialization
- [x] Should initialize all memory components
- [x] Should accept custom configuration
- [x] Should create SessionMemory instances on demand
- [x] Should reuse existing SessionMemory instances

#### 4.2 Session Management
- [x] Should create new session
- [x] Should get existing session
- [x] Should handle non-existent session
- [x] Should clear session
- [x] Should list active sessions
- [x] Should enforce session limit

#### 4.3 Message Flow (Happy Path)
- [x] Should add user message to session
- [x] Should add assistant message to session
- [x] Should store message in short-term memory
- [x] Should retrieve session messages
- [x] Should build complete context

#### 4.4 Memory Search
- [x] Should search across all memory layers
- [x] Should return relevant memories
- [x] Should limit search results
- [x] Should handle no results
- [x] Should prioritize recent memories

#### 4.5 Context Building Integration
- [x] Should build context with all components
- [x] Should include persona from PersonaEngine
- [x] Should include session memories
- [x] Should include short-term memories
- [x] Should handle missing components gracefully

#### 4.6 Error Handling
- [x] Should handle SessionMemory errors
- [x] Should handle ShortTermMemory errors
- [x] Should handle PersonaEngine errors
- [x] Should provide meaningful error messages
- [x] Should log errors with context

#### 4.7 Immutability
- [x] Should not mutate session state
- [x] Should return new instances on updates
- [x] Should preserve history

#### 4.8 Performance
- [x] Should handle concurrent sessions
- [x] Should handle rapid message additions
- [x] Should handle large context building

#### 4.9 Edge Cases
- [x] Should handle empty session ID
- [x] Should handle special characters in session ID
- [x] Should handle very long sessions
- [x] Should handle memory overflow
- [x] Should handle network failures gracefully

#### 4.10 Integration Scenarios
- [x] Should complete full conversation cycle
- [x] Should maintain context across multiple turns
- [x] Should handle multi-user scenarios
- [x] Should handle session expiration

---

## Test Data Fixtures (fixtures.ts)

### Message Fixtures
```typescript
export const SAMPLE_MESSAGES = {
  user: {
    role: 'user',
    content: '你好，Kurisu',
    timestamp: Date.now()
  },
  assistant: {
    role: 'assistant',
    content: '哼，有什么事吗？',
    timestamp: Date.now()
  },
  system: {
    role: 'system',
    content: 'System message',
    timestamp: Date.now()
  }
};

export const LONG_MESSAGE = {
  role: 'user',
  content: '测试'.repeat(10000),
  timestamp: Date.now()
};
```

### Session Fixtures
```typescript
export const SAMPLE_SESSION_ID = 'session-123';
export const SAMPLE_SESSIONS = [
  'session-user-1',
  'session-user-2',
  'session-user-3'
];
```

### Memory Fixtures
```typescript
export const SAMPLE_MEMORIES = [
  {
    id: 'mem-1',
    content: 'User asked about time travel',
    metadata: {
      timestamp: Date.now(),
      importance: 0.8,
      role: 'user',
      sessionId: 'session-123'
    }
  },
  {
    id: 'mem-2',
    content: 'Kurisu explained quantum mechanics',
    metadata: {
      timestamp: Date.now(),
      importance: 0.9,
      role: 'assistant',
      sessionId: 'session-123'
    }
  }
];
```

### Mock Configurations
```typescript
export const MOCK_MEM0_CONFIG = {
  apiKey: 'test-api-key',
  baseUrl: 'https://api.mem0.ai/v1'
};

export const MOCK_CONTEXT_CONFIG = {
  maxTokens: 4096,
  template: 'default'
};
```

---

## Test Coverage Goals

| Module | Target Coverage | Critical Paths |
|--------|----------------|----------------|
| SessionMemory | 90% | Message operations, immutability |
| ShortTermMemory | 85% | Mem0 integration, error handling |
| ContextBuilder | 85% | Context building, truncation |
| HybridMemoryEngine | 85% | Integration, session management |

## Test Execution Strategy

### Unit Tests (Fast)
```bash
npm test tests/memory/
```

### Coverage Report
```bash
npm run test:coverage -- tests/memory/
```

### Watch Mode (TDD)
```bash
npm test tests/memory/ -- --watch
```

---

## TDD Workflow for Implementation

### Phase 1: RED (Write Failing Tests)
1. Write tests for SessionMemory
2. Run tests → All should FAIL
3. Write tests for ShortTermMemory
4. Run tests → All should FAIL
5. Write tests for ContextBuilder
6. Run tests → All should FAIL
7. Write tests for HybridMemoryEngine
8. Run tests → All should FAIL

### Phase 2: GREEN (Make Tests Pass)
1. Implement SessionMemory (minimal code)
2. Run tests → All should PASS
3. Implement ShortTermMemory (minimal code)
4. Run tests → All should PASS
5. Implement ContextBuilder (minimal code)
6. Run tests → All should PASS
7. Implement HybridMemoryEngine (minimal code)
8. Run tests → All should PASS

### Phase 3: REFACTOR (Improve Code)
1. Refactor for performance
2. Refactor for readability
3. Refactor for maintainability
4. Run tests → All should still PASS

### Phase 4: VERIFY
1. Check coverage report
2. Ensure 80%+ coverage
3. Review missed branches
4. Add tests if needed

---

## Mock Strategy

### Mem0 Client Mock
```typescript
export const createMockMem0Client = () => ({
  add: vi.fn(),
  search: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn()
});
```

### PersonaEngine Mock
```typescript
export const createMockPersonaEngine = () => ({
  getHardcodedPersona: vi.fn(),
  getMentalModel: vi.fn(),
  buildRPPrompt: vi.fn()
});
```

---

## Edge Cases Checklist

### Input Validation
- [x] Null/undefined values
- [x] Empty strings
- [x] Very long strings (10k+ chars)
- [x] Special characters (Unicode, emojis)
- [x] SQL injection attempts
- [x] XSS attempts
- [x] Invalid types

### Boundary Values
- [x] Min/max message limit
- [x] Min/max session count
- [x] Zero-length arrays
- [x] Maximum token limits

### Error Scenarios
- [x] Network failures
- [x] API timeouts
- [x] Invalid responses
- [x] Rate limiting
- [x] Authentication errors

### Concurrency
- [x] Parallel message additions
- [x] Parallel session access
- [x] Race conditions

---

## Success Criteria

1. All test files created and passing
2. Coverage >= 80% for all modules
3. All edge cases covered
4. All error paths tested
5. No hardcoded secrets in tests
6. Mocks used for external dependencies
7. Tests are independent (no shared state)
8. Tests follow existing patterns from persona tests

---

## Next Steps

1. Create test files with failing tests (RED phase)
2. Run tests to verify they fail
3. Implement source code to pass tests (GREEN phase)
4. Verify coverage
5. Refactor if needed
6. Document any additional test cases discovered during implementation
