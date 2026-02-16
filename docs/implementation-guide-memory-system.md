# Memory System Implementation Guide

Quick reference for implementing the L4 Memory System to pass the test suite.

## File Structure to Create

```
src/memory/
├── types.ts              # Type definitions
├── errors.ts             # Error classes
├── session-memory.ts     # SessionMemory class
├── short-term-memory.ts  # ShortTermMemory class (Mem0 adapter)
├── context-builder.ts    # ContextBuilder class
└── index.ts              # HybridMemoryEngine main class
```

## Implementation Order

### 1. types.ts (Foundation)

```typescript
// Core message type
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// Session configuration
export interface SessionConfig {
  maxMessages: number;
  ttl: number;
}

// Memory metadata
export interface MemoryMetadata {
  timestamp: number;
  importance: number;
  role: 'user' | 'assistant' | 'system';
  sessionId: string;
}

// Memory object
export interface Memory {
  id: string;
  content: string;
  metadata: MemoryMetadata;
  score?: number;
}

// Context metadata
export interface ContextMetadata {
  tokenCount: number;
  sources: {
    persona: boolean;
    sessionMemory: boolean;
    shortTermMemory: boolean;
  };
  truncated: boolean;
}

// Mem0 client interface
export interface Mem0Client {
  add(data: any): Promise<any>;
  search(query: string, options?: any): Promise<any[]>;
  delete(id: string): Promise<void>;
  getAll(options?: any): Promise<any[]>;
}

// Configuration types
export interface HybridMemoryEngineConfig {
  sessionConfig?: Partial<SessionConfig>;
  mem0Config?: {
    apiKey: string;
    baseUrl?: string;
  };
  maxSessions?: number;
}
```

### 2. errors.ts (Error Handling)

```typescript
export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}

export class SessionNotFoundError extends MemoryError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class InvalidSessionIdError extends MemoryError {
  constructor(sessionId: any) {
    super(`Invalid session ID: ${sessionId}`);
    this.name = 'InvalidSessionIdError';
  }
}

export class InvalidMessageError extends MemoryError {
  constructor(reason: string) {
    super(`Invalid message: ${reason}`);
    this.name = 'InvalidMessageError';
  }
}

export class Mem0OperationError extends MemoryError {
  constructor(operation: string, reason: string) {
    super(`Mem0 ${operation} failed: ${reason}`);
    this.name = 'Mem0OperationError';
  }
}

export class SessionLimitExceededError extends MemoryError {
  constructor(maxSessions: number) {
    super(`Session limit exceeded: maximum ${maxSessions} sessions allowed`);
    this.name = 'SessionLimitExceededError';
  }
}

export class DuplicateSessionError extends MemoryError {
  constructor(sessionId: string) {
    super(`Session already exists: ${sessionId}`);
    this.name = 'DuplicateSessionError';
  }
}
```

### 3. session-memory.ts (SessionMemory Class)

**Key Implementation Points:**

```typescript
export class SessionMemory {
  private _sessionId: string;
  private _messages: Message[];
  private _config: SessionConfig;
  private _createdAt: number;

  constructor(sessionId: string, config?: Partial<SessionConfig>) {
    // Validate session ID
    if (!sessionId || sessionId.trim() === '') {
      throw new InvalidSessionIdError(sessionId);
    }

    this._sessionId = sessionId;
    this._messages = [];
    this._config = { ...DEFAULT_SESSION_CONFIG, ...config };
    this._createdAt = Date.now();
  }

  // CRITICAL: Must return NEW instance (immutability)
  addMessage(message: Omit<Message, 'timestamp'>): SessionMemory {
    // Validate message structure
    if (!message.role || !['user', 'assistant', 'system'].includes(message.role)) {
      throw new InvalidMessageError('Invalid role');
    }
    if (message.content === null || message.content === undefined) {
      throw new InvalidMessageError('Invalid content');
    }

    // Create new message with timestamp
    const newMessage: Message = {
      ...message,
      timestamp: Date.now(),
    };

    // Create new array (immutable)
    const newMessages = [...this._messages, newMessage];

    // Enforce limit by discarding oldest
    if (newMessages.length > this._config.maxMessages) {
      const excess = newMessages.length - this._config.maxMessages;
      newMessages.splice(0, excess);
    }

    // Return NEW instance
    const newSession = new SessionMemory(this._sessionId, this._config);
    newSession._messages = newMessages;
    newSession._createdAt = this._createdAt;
    return newSession;
  }

  // CRITICAL: Must return copy (immutability)
  getMessages(): Message[] {
    return [...this._messages];
  }

  getRecentMessages(count: number): Message[] {
    return this._messages.slice(-count);
  }

  getMessagesByRole(role: Message['role']): Message[] {
    return this._messages.filter(m => m.role === role);
  }

  getMessagesByTimeRange(startTime: number, endTime: number): Message[] {
    return this._messages.filter(
      m => m.timestamp >= startTime && m.timestamp <= endTime
    );
  }

  clear(): SessionMemory {
    const newSession = new SessionMemory(this._sessionId, this._config);
    newSession._createdAt = this._createdAt;
    return newSession;
  }

  getMessageCount(): number {
    return this._messages.length;
  }

  isEmpty(): boolean {
    return this._messages.length === 0;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get config(): SessionConfig {
    return { ...this._config };
  }

  get createdAt(): number {
    return this._createdAt;
  }
}
```

### 4. short-term-memory.ts (Mem0 Adapter)

**Key Implementation Points:**

```typescript
export class ShortTermMemory {
  private _client: Mem0Client;
  private _sessionId: string;

  constructor(config: { mem0Client: Mem0Client; sessionId: string }) {
    // Validate client
    if (!config.mem0Client) {
      throw new MemoryError('Mem0 client is required');
    }

    // Validate required methods
    const requiredMethods = ['add', 'search', 'delete', 'getAll'];
    for (const method of requiredMethods) {
      if (typeof (config.mem0Client as any)[method] !== 'function') {
        throw new MemoryError(`Invalid Mem0 client: missing ${method} method`);
      }
    }

    // Validate session ID
    if (!config.sessionId || config.sessionId.trim() === '') {
      throw new InvalidSessionIdError(config.sessionId);
    }

    this._client = config.mem0Client;
    this._sessionId = config.sessionId;
  }

  async addMemory(
    content: string,
    metadata?: Partial<MemoryMetadata>
  ): Promise<string> {
    // Validate content
    if (content === null || content === undefined) {
      throw new MemoryError('Invalid content: must be non-null');
    }

    // Validate metadata if provided
    if (metadata) {
      if (metadata.importance !== undefined) {
        if (metadata.importance < 0 || metadata.importance > 1) {
          throw new MemoryError('Invalid importance: must be between 0 and 1');
        }
      }
      if (metadata.role && !['user', 'assistant', 'system'].includes(metadata.role)) {
        throw new MemoryError('Invalid role: must be user, assistant, or system');
      }
    }

    try {
      const fullMetadata: MemoryMetadata = {
        timestamp: Date.now(),
        importance: metadata?.importance ?? 0.5,
        role: metadata?.role ?? 'user',
        sessionId: this._sessionId,
      };

      const result = await this._client.add({
        content,
        metadata: fullMetadata,
        user_id: this._sessionId, // CRITICAL: Use for session isolation
      });

      if (!result || !result.id) {
        throw new Mem0OperationError('add', 'Invalid response: missing id');
      }

      return result.id;
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      throw new Mem0OperationError('add', error.message);
    }
  }

  async searchMemory(query: string, limit: number = 10): Promise<Memory[]> {
    if (query === null || query === undefined) {
      throw new MemoryError('Invalid query: must be non-null');
    }

    try {
      const results = await this._client.search(query, {
        limit,
        user_id: this._sessionId, // CRITICAL: Session-scoped search
      });

      return results || [];
    } catch (error) {
      throw new Mem0OperationError('search', error.message);
    }
  }

  async deleteMemory(id: string): Promise<void> {
    if (!id) {
      throw new MemoryError('Invalid memory ID: must be non-empty');
    }

    try {
      await this._client.delete(id);
    } catch (error) {
      // Handle not found gracefully
      if (error.message?.includes('not found')) {
        return; // Silent fail for non-existent memory
      }
      throw new Mem0OperationError('delete', error.message);
    }
  }

  async getAllMemories(): Promise<Memory[]> {
    try {
      const memories = await this._client.getAll({
        user_id: this._sessionId,
      });
      return memories || [];
    } catch (error) {
      throw new Mem0OperationError('getAll', error.message);
    }
  }

  get sessionId(): string {
    return this._sessionId;
  }
}
```

### 5. context-builder.ts (ContextBuilder Class)

**Key Implementation Points:**

```typescript
export class ContextBuilder {
  private _personaEngine: PersonaEngine;
  private _maxTokens: number;
  private _template?: string;

  constructor(
    personaEngine: PersonaEngine,
    config?: Partial<{ maxTokens: number; template: string }>
  ) {
    if (!personaEngine) {
      throw new MemoryError('PersonaEngine is required');
    }

    // Validate interface
    if (typeof personaEngine.getHardcodedPersona !== 'function') {
      throw new MemoryError('Invalid PersonaEngine: missing getHardcodedPersona method');
    }

    this._personaEngine = personaEngine;
    this._maxTokens = config?.maxTokens ?? 4096;
    this._template = config?.template;
  }

  async buildContext(
    sessionId: string,
    currentMessage: string,
    sessionMemory?: SessionMemory,
    shortTermMemory?: ShortTermMemory
  ): Promise<{ context: string; metadata: ContextMetadata }> {
    // Validate inputs
    if (!sessionId || sessionId.trim() === '') {
      throw new InvalidSessionIdError(sessionId);
    }
    if (currentMessage === null || currentMessage === undefined) {
      throw new MemoryError('Invalid current message');
    }

    const sections: string[] = [];
    const metadata: ContextMetadata = {
      tokenCount: 0,
      sources: {
        persona: false,
        sessionMemory: false,
        shortTermMemory: false,
      },
      truncated: false,
    };

    // 1. Add persona (highest priority)
    try {
      const persona = this._personaEngine.getHardcodedPersona();
      if (persona?.content) {
        sections.push(persona.content);
        metadata.sources.persona = true;
      }
    } catch (error) {
      // Persona engine error - continue without it
    }

    // 2. Add session memories (recent messages)
    if (sessionMemory) {
      try {
        const recentMessages = sessionMemory.getRecentMessages(10);
        if (recentMessages.length > 0) {
          const messagesSection = this._formatMessages(recentMessages);
          sections.push(messagesSection);
          metadata.sources.sessionMemory = true;
        }
      } catch (error) {
        // Session memory error - continue without it
      }
    }

    // 3. Add short-term memories (if available)
    if (shortTermMemory) {
      try {
        const memories = await shortTermMemory.searchMemory(currentMessage, 5);
        if (memories.length > 0) {
          const memoriesSection = this._formatMemories(memories);
          sections.push(memoriesSection);
          metadata.sources.shortTermMemory = true;
        }
      } catch (error) {
        // Short-term memory error - continue without it
      }
    }

    // 4. Add current message
    sections.push(`\n## Current Message\n${currentMessage}`);

    // 5. Combine and truncate if needed
    let context = sections.join('\n\n---\n\n');
    metadata.tokenCount = this._estimateTokens(context);

    if (metadata.tokenCount > this._maxTokens) {
      context = this._truncateContext(context, sections);
      metadata.truncated = true;
      metadata.tokenCount = this._estimateTokens(context);
    }

    return { context, metadata };
  }

  private _formatMessages(messages: Message[]): string {
    const lines = messages.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    );
    return `## Recent Conversation\n${lines.join('\n')}`;
  }

  private _formatMemories(memories: Memory[]): string {
    const lines = memories.map(m => `- ${m.content}`);
    return `## Relevant Memories\n${lines.join('\n')}`;
  }

  private _estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private _truncateContext(context: string, sections: string[]): string {
    // Simple truncation: keep persona and truncate from end
    // TODO: More sophisticated truncation strategy
    const maxChars = this._maxTokens * 4;
    if (context.length > maxChars) {
      return context.substring(0, maxChars) + '\n\n[...truncated...]';
    }
    return context;
  }

  setMaxTokens(maxTokens: number): ContextBuilder {
    this._maxTokens = maxTokens;
    return this;
  }

  getMaxTokens(): number {
    return this._maxTokens;
  }
}
```

### 6. index.ts (HybridMemoryEngine)

**Key Implementation Points:**

```typescript
export class HybridMemoryEngine {
  private _sessions: Map<string, SessionMemory>;
  private _config: Required<HybridMemoryEngineConfig>;
  private _shortTermMemories: Map<string, ShortTermMemory>;
  private _contextBuilder?: ContextBuilder;
  private _destroyed: boolean;

  constructor(config?: HybridMemoryEngineConfig) {
    this._sessions = new Map();
    this._shortTermMemories = new Map();
    this._destroyed = false;

    // Validate and merge config
    this._config = {
      sessionConfig: {
        maxMessages: config?.sessionConfig?.maxMessages ?? 100,
        ttl: config?.sessionConfig?.ttl ?? 3600000,
      },
      mem0Config: config?.mem0Config ?? { apiKey: '' },
      maxSessions: config?.maxSessions ?? 100,
    };

    // Validate config values
    if (this._config.maxSessions < 1) {
      throw new MemoryError('Invalid maxSessions: must be >= 1');
    }
    if (this._config.sessionConfig.maxMessages < 1) {
      throw new MemoryError('Invalid maxMessages: must be >= 1');
    }
  }

  createSession(sessionId?: string): string {
    this._checkDestroyed();

    const id = sessionId ?? this._generateSessionId();

    // Validate session ID
    if (!id || id.trim() === '') {
      throw new InvalidSessionIdError(id);
    }

    // Check for duplicate
    if (this._sessions.has(id)) {
      throw new DuplicateSessionError(id);
    }

    // Check session limit
    if (this._sessions.size >= this._config.maxSessions) {
      throw new SessionLimitExceededError(this._config.maxSessions);
    }

    // Create new session
    const session = new SessionMemory(id, this._config.sessionConfig);
    this._sessions.set(id, session);

    return id;
  }

  getSession(sessionId: string): SessionMemory | undefined {
    this._checkDestroyed();
    return this._sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this._sessions.has(sessionId);
  }

  clearSession(sessionId: string): void {
    this._checkDestroyed();

    const session = this._sessions.get(sessionId);
    if (!session) {
      return; // Silent fail if not found
    }

    const clearedSession = session.clear();
    this._sessions.set(sessionId, clearedSession);
  }

  listSessions(): string[] {
    return Array.from(this._sessions.keys());
  }

  addMessage(sessionId: string, message: Omit<Message, 'timestamp'>): SessionMemory {
    this._checkDestroyed();

    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const updatedSession = session.addMessage(message);
    this._sessions.set(sessionId, updatedSession);

    return updatedSession;
  }

  getMessages(sessionId: string): Message[] {
    this._checkDestroyed();

    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    return session.getMessages();
  }

  getRecentMessages(sessionId: string, count: number): Message[] {
    this._checkDestroyed();

    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    return session.getRecentMessages(count);
  }

  async addMemory(
    sessionId: string,
    content: string,
    metadata?: Partial<MemoryMetadata>
  ): Promise<string> {
    this._checkDestroyed();

    if (!this._sessions.has(sessionId)) {
      throw new SessionNotFoundError(sessionId);
    }

    // Get or create ShortTermMemory for this session
    let shortTermMemory = this._shortTermMemories.get(sessionId);
    if (!shortTermMemory && this._config.mem0Config.apiKey) {
      // Create Mem0 client (implementation depends on Mem0 SDK)
      const mem0Client = this._createMem0Client();
      shortTermMemory = new ShortTermMemory({
        mem0Client,
        sessionId,
      });
      this._shortTermMemories.set(sessionId, shortTermMemory);
    }

    if (!shortTermMemory) {
      throw new MemoryError('ShortTermMemory not configured');
    }

    return shortTermMemory.addMemory(content, metadata);
  }

  async searchMemory(
    sessionId: string,
    query: string,
    limit?: number
  ): Promise<Memory[]> {
    this._checkDestroyed();

    const shortTermMemory = this._shortTermMemories.get(sessionId);
    if (!shortTermMemory) {
      return []; // Return empty if no memories
    }

    return shortTermMemory.searchMemory(query, limit);
  }

  async buildContext(sessionId: string, currentMessage: string): Promise<string> {
    this._checkDestroyed();

    const session = this._sessions.get(sessionId);
    const shortTermMemory = this._shortTermMemories.get(sessionId);

    // Create context builder if not exists
    if (!this._contextBuilder) {
      // This would need a PersonaEngine instance
      // For now, use a simple implementation
      this._contextBuilder = new ContextBuilder(
        this._createPersonaEngine(),
        { maxTokens: 4096 }
      );
    }

    const result = await this._contextBuilder.buildContext(
      sessionId,
      currentMessage,
      session,
      shortTermMemory
    );

    return result.context;
  }

  destroy(): void {
    this._sessions.clear();
    this._shortTermMemories.clear();
    this._destroyed = true;
  }

  private _generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  private _checkDestroyed(): void {
    if (this._destroyed) {
      throw new MemoryError('Engine has been destroyed');
    }
  }

  private _createMem0Client(): Mem0Client {
    // Implementation depends on Mem0 SDK
    // This is a placeholder
    throw new Error('Mem0 client creation not implemented');
  }

  private _createPersonaEngine(): PersonaEngine {
    // Implementation depends on PersonaEngine
    // This is a placeholder
    throw new Error('PersonaEngine creation not implemented');
  }
}
```

## Testing Strategy

Run tests incrementally:

```bash
# Test only SessionMemory
npm test tests/memory/session-memory.test.ts

# Test only ShortTermMemory
npm test tests/memory/short-term-memory.test.ts

# Test only ContextBuilder
npm test tests/memory/context-builder.test.ts

# Test only HybridMemoryEngine
npm test tests/memory/hybrid-engine.test.ts

# Test all memory modules
npm test tests/memory/

# Generate coverage report
npm run test:coverage -- tests/memory/
```

## Common Pitfalls to Avoid

1. **Mutating State**: Always return new instances
2. **Missing Validation**: Validate all inputs at boundaries
3. **Forgetting Session ID**: Always use sessionId for Mem0 user_id
4. **Not Handling Errors**: Wrap all async operations in try-catch
5. **Hardcoding Values**: Use config for all configurable values
6. **Missing Timestamps**: Auto-generate timestamps in addMessage
7. **Not Enforcing Limits**: Check message/session limits
8. **Forgetting Immutability**: Copy arrays before returning

## Success Checklist

- [ ] types.ts created with all interfaces
- [ ] errors.ts created with all error classes
- [ ] session-memory.ts passes all 50 tests
- [ ] short-term-memory.ts passes all 55 tests
- [ ] context-builder.ts passes all 58 tests
- [ ] index.ts passes all 63 tests
- [ ] All 226 tests passing
- [ ] Coverage >= 80%
- [ ] No hardcoded secrets
- [ ] Code review completed
- [ ] Security review completed

Good luck with the implementation!
