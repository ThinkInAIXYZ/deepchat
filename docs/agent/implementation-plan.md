# Implementation Plan for Multi-Agent Architecture

## Phase 1: Foundation (Weeks 1-3)

### 1.1 Core Agent Framework (Week 1)

#### Tasks:
- [ ] Create `BaseAgent` abstract class
  - Extract loop logic from `startStreamCompletion` 
  - Implement basic input queue system
  - Standardize event interface
  - Add agent lifecycle management

- [ ] Create `InputQueue` class
  - Priority-based queuing system
  - Context-aware dequeue logic
  - Queue event callbacks
  - Statistics and monitoring

- [ ] Define core interfaces
  - `AgentInterface`
  - `AgentInput`/`AgentOutput`
  - `AgentState`
  - `QueueCallbacks`

#### Files to create:
```
src/main/presenter/agent/
├── index.ts                 # Main agent manager
├── BaseAgent.ts             # Abstract base agent class
├── InputQueue.ts            # Input queue implementation
├── interfaces.ts            # Type definitions
└── events.ts                # Agent-specific events
```

#### Implementation details:
```typescript
// src/main/presenter/agent/BaseAgent.ts
export abstract class BaseAgent implements AgentInterface {
  protected id: string
  protected inputQueue: InputQueue
  protected state: AgentState
  protected isRunning: boolean = false
  protected abortController: AbortController

  constructor(protected config: AgentConfig) {
    this.id = config.id || generateAgentId()
    this.inputQueue = new InputQueue()
    this.state = new AgentState(config.initialState)
  }

  // Core methods to be implemented by subclasses
  protected abstract processSingleIteration(
    input: AgentInput, 
    context: ConversationContext
  ): Promise<AgentIterationResult>

  // Main agent loop
  private async runAgentLoop(): Promise<void> {
    while (this.isRunning) {
      const input = this.inputQueue.dequeue()
      if (!input) {
        await sleep(100) // Prevent busy waiting
        continue
      }

      try {
        const result = await this.processSingleIteration(input, this.state.context)
        this.handleIterationResult(result)
      } catch (error) {
        this.handleError(error, input)
      }
    }
  }

  // Input queue management
  public queueInput(input: AgentInput, priority: number = 0): string {
    return this.inputQueue.enqueue(input, priority)
  }

  public getQueuedInputs(): AgentInput[] {
    return this.inputQueue.peekAll()
  }

  // Lifecycle
  public async start(): Promise<void> {
    this.isRunning = true
    this.abortController = new AbortController()
    await this.runAgentLoop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    this.abortController.abort()
    this.inputQueue.clear()
  }
}
```

### 1.2 Agent Manager (Week 1-2)

#### Tasks:
- [ ] Create `AgentManager` class
  - Agent registry and lifecycle management
  - Agent type registration system
  - Concurrency controls and resource limits

- [ ] Implement agent factory pattern
  - Different agent types (ChatAgent, ResearchAgent, CodeAgent)
  - Configurable agent creation

- [ ] Add agent monitoring
  - Performance metrics collection
  - Health checking
  - Error reporting

#### Files to create:
```
src/main/presenter/agent/
├── AgentManager.ts          # Main agent management
├── AgentFactory.ts          # Agent creation
├── AgentRegistry.ts         # Agent type registration
└── AgentMonitor.ts          # Monitoring and metrics
```

### 1.3 Enhanced Tool System (Week 2-3)

#### Implementation details:
```typescript
// src/main/presenter/agent/tools/ToolSystem.ts
export class ToolSystem {
  private toolRegistry: Map<string, ToolDefinition> = new Map()
  private taskManager: TaskManager
  private asyncExecutor: AsyncExecutor
  private providerAdapter: ProviderAwareTools

  // Tool registration
  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.set(tool.name, tool)
    if (tool.async) {
      this.asyncExecutor.registerAsyncTool(tool)
    }
    
    // Register provider adaptations
    this.providerAdapter.registerToolAdaptations(tool)
  }

  // Provider-aware tool execution
  async executeToolWithProvider(
    toolName: string, 
    params: any, 
    providerConfig: ProviderConfig
  ): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolName)
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`)
    }

    // Get provider-specific adaptation
    const adaptedTool = this.providerAdapter.adaptToolForProvider(tool, providerConfig)
    
    if (adaptedTool.async) {
      return this.asyncExecutor.executeAsyncTool(adaptedTool, params, providerConfig)
    } else {
      return await adaptedTool.execute(params, providerConfig)
    }
  }
}
```

- [ ] Implement async tool execution
  - Task management system
  - Result queuing and callbacks
  - Progress tracking

- [ ] Add tool lifecycle management
  - Tool initialization and cleanup
  - Resource management
  - Error handling

#### Files to create:
```
src/main/presenter/agent/tools/
├── ToolSystem.ts            # Tool management
├── ToolRegistry.ts          # Tool registration
├── TaskManager.ts           # Async task management
├── AsyncExecutor.ts         # Async tool execution
└── ToolTypes.ts             # Tool type definitions
```

#### Implementation details:
```typescript
// src/main/presenter/agent/tools/ToolSystem.ts
export class ToolSystem {
  private toolRegistry: Map<string, ToolDefinition> = new Map()
  private taskManager: TaskManager
  private asyncExecutor: AsyncExecutor

  // Tool registration
  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.set(tool.name, tool)
    if (tool.async) {
      this.asyncExecutor.registerAsyncTool(tool)
    }
  }

  // Tool execution
  async executeTool(toolName: string, params: any): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolName)
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`)
    }

    if (tool.async) {
      // For async tools, return a task ID immediately
      return this.asyncExecutor.executeAsyncTool(tool, params)
    } else {
      // For sync tools, execute directly
      return await tool.execute(params)
    }
  }

  // Task management for async tools
  getTaskStatus(taskId: string): TaskStatus {
    return this.taskManager.getStatus(taskId)
  }

  getTaskResult(taskId: string): ToolResult | null {
    return this.taskManager.getResult(taskId)
  }
}
```

## Phase 2: Multi-Agent Support (Weeks 4-6)

### 1.4 Provider Configuration System (Week 3)

#### Tasks:
- [ ] Create `ProviderRegistry` class
  - Provider discovery and registration
  - Model management and capability tracking
  - Dynamic provider selection algorithms

- [ ] Implement provider-aware agent configuration
  - Agent-specific provider preferences
  - Cost-based provider selection
  - Performance optimization strategies

- [ ] Add provider fallback mechanisms
  - Automatic failover to alternative providers
  - Provider health monitoring
  - Load balancing across providers

#### Files to create:
```
src/main/presenter/agent/providers/
├── ProviderRegistry.ts       # Provider management
├── ProviderSelector.ts        # Dynamic provider selection
├── ProviderHealthMonitor.ts   # Provider health tracking
├── CostOptimizer.ts           # Cost-based provider selection
├── ProviderAdapter.ts         # Provider-specific adaptations
└── ProviderTypes.ts           # Provider type definitions
```

#### Implementation details:
```typescript
// src/main/presenter/agent/providers/ProviderRegistry.ts
export class ProviderRegistry {
  private providers: Map<string, ProviderDefinition> = new Map()
  private providerHealth: Map<string, ProviderHealth> = new Map()

  registerProvider(provider: ProviderDefinition): void {
    this.providers.set(provider.id, provider)
    this.providerHealth.set(provider.id, {
      successRate: 1.0,
      averageLatency: 0,
      lastError: null,
      isHealthy: true
    })
  }

  findBestProviderForTask(
    taskType: string,
    constraints: ProviderConstraints
  ): ProviderDefinition | null {
    const suitableProviders = this.getSuitableProviders(taskType, constraints)
    
    // Apply selection strategy (cost, performance, reliability)
    return this.applySelectionStrategy(suitableProviders, constraints)
  }

  private applySelectionStrategy(
    providers: ProviderDefinition[],
    constraints: ProviderConstraints
  ): ProviderDefinition | null {
    if (constraints.priority === 'cost') {
      return this.selectByCost(providers)
    } else if (constraints.priority === 'performance') {
      return this.selectByPerformance(providers)
    } else {
      return this.selectByReliability(providers)
    }
  }
}
```

### 2.1 Agent Coordination (Week 4)

#### Tasks:
- [ ] Implement agent-to-agent communication
  - Message passing system
  - Event-based coordination
  - Request/response patterns

- [ ] Add resource sharing
  - Shared context management
  - Tool result sharing
  - State synchronization

- [ ] Create collaboration patterns
  - Master-agent coordination
  - Peer-to-peer collaboration
  - Hierarchical agent structures

#### Files to create:
```
src/main/presenter/agent/coordination/
├── AgentCommunication.ts    # Inter-agent messaging
├── ResourceSharing.ts       # Shared resource management
├── CollaborationPatterns.ts # Pre-defined collaboration modes
└── MessageBus.ts           # Central message routing
```

### 2.2 Advanced Tool Integration (Week 5)

#### Tasks:
- [ ] CLI tool execution framework
  - Command line interface tools
  - Output capture and parsing
  - Interactive command handling

- [ ] API tool integration
  - REST API tool support
  - WebSocket tools
  - Authentication and authorization

- [ ] Custom tool development
  - Plugin system for custom tools
  - Tool sandboxing
  - Resource limits and monitoring

#### Files to create:
```
src/main/presenter/agent/tools/
├── CliTools.ts              # CLI tool execution
├── ApiTools.ts              # API tool support
├── CustomTools.ts           # Custom tool framework
└── ToolSandbox.ts           # Tool isolation and security
```

### 2.3 Action Agent Implementation (Week 5-6)

#### Tasks:
- [ ] Create `ActionAgent` base class
  - Input validation against agent specification
  - Internal execution isolation with proper encapsulation
  - Output formatting according to contract
  - Resource limits and timeout enforcement

- [ ] Implement agent specification system
  - Comprehensive agent capability definitions
  - Input/output contract validation
  - Provider preference configuration
  - Quality standards enforcement

- [ ] Add execution monitoring
  - Real-time progress tracking
  - Resource usage monitoring
  - Error handling and recovery
  - Performance metrics collection

#### Files to create:
```
src/main/presenter/agent/action/
├── ActionAgent.ts            # Base action agent class
├── AgentSpecification.ts     # Agent specification system
├── InputValidator.ts         # Input contract validation
├── OutputFormatter.ts        # Output contract enforcement
├── ExecutionMonitor.ts       # Execution monitoring
└── ResourceManager.ts        # Resource limits enforcement
```

#### Implementation details:
```typescript
// src/main/presenter/agent/action/ActionAgent.ts
export abstract class ActionAgent extends BaseAgent {
  protected specification: AgentSpecification
  protected providerConfig: ProviderConfig
  protected executionMonitor: ExecutionMonitor

  constructor(config: ActionAgentConfig) {
    super(config)
    this.specification = config.specification
    this.providerConfig = config.providerConfig
    this.executionMonitor = new ExecutionMonitor(this.specification.resourceLimits)
  }

  async processInput(input: AgentInput): Promise<AgentOutput> {
    // Validate input against specification
    this.validateInput(input)
    
    // Start execution monitoring
    this.executionMonitor.start()
    
    try {
      // Execute with proper isolation
      const internalResult = await this.executeWithIsolation(input)
      
      // Format final output according to specification
      const finalOutput = this.formatFinalOutput(internalResult)
      
      // Validate output meets contract requirements
      this.validateOutput(finalOutput)
      
      return finalOutput
      
    } finally {
      this.executionMonitor.stop()
    }
  }

  private async executeWithIsolation(input: AgentInput): Promise<InternalResult> {
    // Internal execution with full reasoning and tool usage
    // This is completely encapsulated from the master agent
    const context = this.buildExecutionContext(input)
    
    let iteration = 0
    let finalResult: InternalResult | null = null
    
    while (iteration < this.specification.maxIterations && !finalResult) {
      // Check resource limits
      this.executionMonitor.checkLimits()
      
      const iterationResult = await this.executeSingleIteration(context)
      
      if (this.isFinalResult(iterationResult)) {
        finalResult = iterationResult
      } else {
        context.update(iterationResult)
        iteration++
      }
    }
    
    return finalResult || this.createTimeoutResult()
  }
}
```

### 2.4 State Persistence (Week 6)

#### Tasks:
- [ ] Agent state storage
  - Database-backed state persistence
  - State serialization/deserialization
  - Versioning and rollback

- [ ] Conversation context management
  - Context storage and retrieval
  - Context summarization
  - Multi-turn conversation handling

- [ ] Tool execution history
  - Execution log storage
  - Result caching
  - Performance analytics

#### Files to create:
```
src/main/presenter/agent/persistence/
├── StateStorage.ts          # Agent state persistence
├── ConversationContext.ts   # Conversation management
├── ToolHistory.ts           # Tool execution tracking
└── CacheManager.ts          # Result caching
```

## Phase 3: Advanced Features (Weeks 7-10)

### 3.1 Agent Specialization (Weeks 7-8)

#### Tasks:
- [ ] Specialized agent types
  - ResearchAgent (web search, document analysis)
  - CodeAgent (code generation, testing, debugging)
  - AnalysisAgent (data analysis, visualization)
  - CreativeAgent (content generation, brainstorming)

- [ ] Agent skill system
  - Skill definition and registration
  - Skill-based task routing
  - Skill composition and chaining

- [ ] Custom agent configuration
  - Configurable agent behaviors
  - Prompt template system
  - Personality and style customization

#### Files to create:
```
src/main/presenter/agent/specialized/
├── ResearchAgent.ts         # Research-focused agent
├── CodeAgent.ts             # Code-focused agent
├── AnalysisAgent.ts         # Data analysis agent
├── CreativeAgent.ts         # Creative tasks agent
└── SkillSystem.ts           # Agent skills framework
```

### 3.2 Performance Optimization (Week 9)

#### Tasks:
- [ ] Input queue optimization
  - Smart prioritization algorithms
  - Context-aware queue ordering
  - Batch processing for similar inputs

- [ ] Resource pooling
  - Connection pooling for API tools
  - Model instance reuse
  - Memory management optimization

- [ ] Caching strategies
  - Tool result caching
  - Response caching
  - Pre-computation of common queries

#### Files to create:
```
src/main/presenter/agent/performance/
├── QueueOptimizer.ts        # Queue management optimization
├── ResourcePool.ts          # Resource pooling
├── CacheManager.ts          # Caching strategies
└── PerformanceMonitor.ts    # Performance tracking
```

### 3.3 Monitoring and Analytics (Week 10)

#### Tasks:
- [ ] Comprehensive monitoring
  - Real-time agent metrics
  - Tool usage statistics
  - Performance dashboards

- [ ] Error tracking and debugging
  - Error classification and analysis
  - Debug logging and tracing
  - Performance profiling

- [ ] Analytics and insights
  - Usage pattern analysis
  - Agent performance metrics
  - Optimization recommendations

#### Files to create:
```
src/main/presenter/agent/monitoring/
├── MetricsCollector.ts      # Real-time metrics
├── ErrorTracker.ts          # Error monitoring
├── PerformanceAnalytics.ts  # Performance analysis
└── Dashboard.ts             # Metrics dashboard
```

## Migration Strategy

### Step 0: Current Architecture Analysis

#### Current Component Roles:
- **ThreadPresenter**: Already acts as basic Master Loop Agent
  - Manages conversation state and context
  - Coordinates with LLMProviderPresenter
  - Handles message sequencing and user input

- **LLMProviderPresenter**: Acts as single Action Agent
  - Implements basic agent loop in `startStreamCompletion`
  - Handles tool execution and LLM interactions
  - Limited to single agent per conversation

### Step 1: Enhance ThreadPresenter as Full Master Loop Agent (Week 1)
```typescript
// Enhance ThreadPresenter to become full Master Loop Agent
export class ThreadPresenter implements IThreadPresenter {
  private agentManager: AgentManager
  private inputQueue: InputQueue
  private sessionState: SessionState
  
  constructor(
    sqlitePresenter: ISQLitePresenter,
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter
  ) {
    // Existing initialization
    this.sqlitePresenter = sqlitePresenter
    this.messageManager = new MessageManager(sqlitePresenter)
    this.llmProviderPresenter = llmProviderPresenter
    this.searchManager = new SearchManager()
    this.configPresenter = configPresenter
    
    // New multi-agent components
    this.agentManager = new AgentManager()
    this.inputQueue = new InputQueue()
    this.sessionState = new SessionState()
    
    // Register default chat agent (current LLMProviderPresenter functionality)
    this.registerDefaultAgents()
  }
  
  private registerDefaultAgents(): void {
    // Convert current LLMProviderPresenter into a ChatActionAgent
    const chatAgent = new ChatActionAgent({
      specification: CHAT_AGENT_SPEC,
      providerConfig: this.configPresenter.getAgentConfig('chat'),
      llmProvider: this.llmProviderPresenter
    })
    
    this.agentManager.registerAgent(chatAgent)
  }
  
  // Enhanced input handling with queue
  async processUserInput(input: UserInput): Promise<void> {
    const queueId = this.inputQueue.enqueue(input, this.getInputPriority(input))
    
    // Process queue in background
    this.processInputQueue()
  }
  
  private async processInputQueue(): Promise<void> {
    while (this.inputQueue.hasPendingInputs()) {
      const input = this.inputQueue.dequeue()
      if (!input) continue
      
      const suitableAgent = this.findSuitableAgent(input)
      if (suitableAgent) {
        const result = await suitableAgent.processInput(input)
        this.handleAgentResult(result)
      }
    }
  }
}
```

### Step 2: Create Action Agent Framework (Weeks 2-3)
```typescript
// Create ActionAgent base class that encapsulates current LLMProviderPresenter functionality
export abstract class ActionAgent extends BaseAgent {
  protected llmProvider: ILlmProviderPresenter
  protected specification: AgentSpecification
  
  constructor(config: ActionAgentConfig) {
    super(config)
    this.llmProvider = config.llmProvider
    this.specification = config.specification
  }
  
  async processInput(input: AgentInput): Promise<AgentOutput> {
    // Convert agent input to legacy LLMProviderPresenter format
    const legacyArgs = this.convertToLegacyFormat(input)
    
    // Use existing LLMProviderPresenter but with agent-specific configuration
    const result = await this.llmProvider.startStreamCompletion(
      this.specification.providerPreferences.primaryProvider,
      legacyArgs.messages,
      this.specification.providerPreferences.primaryModel,
      // ... other parameters with agent-specific config
    )
    
    // Convert legacy result to agent output format
    return this.convertToAgentOutput(result)
  }
}

// Specific agent implementations
class ResearchAgent extends ActionAgent {
  // Specialized research capabilities
  // Enhanced tool usage for research tasks
  // Custom provider configuration for research-optimized models
}

class CodeAgent extends ActionAgent {
  // Specialized coding capabilities  
  // Code-specific tool integration
  // Provider preferences for coding-optimized models
}
```

### Step 3: Gradual Agent Integration (Weeks 4-6)
```typescript
// Enhanced ThreadPresenter with multi-agent support
export class ThreadPresenter implements IThreadPresenter {
  // ... existing code
  
  async processUserInput(input: UserInput): Promise<void> {
    // Feature flag for multi-agent routing
    if (this.configPresenter.getFeatureFlag('multi_agent_enabled')) {
      // Use new multi-agent system
      const agentType = this.determineAgentType(input)
      const agent = this.agentManager.getAgent(agentType)
      
      if (agent) {
        const agentInput = this.createAgentInput(input, agentType)
        const result = await agent.processInput(agentInput)
        this.handleAgentResult(result)
      } else {
        // Fallback to legacy chat agent
        await this.legacyProcessInput(input)
      }
    } else {
      // Use legacy single-agent system
      await this.legacyProcessInput(input)
    }
  }
  
  private determineAgentType(input: UserInput): string {
    // Simple agent routing based on content analysis
    if (input.content.includes('research') || input.content.includes('search')) {
      return 'research'
    } else if (input.content.includes('code') || input.content.includes('program')) {
      return 'code'
    } else if (input.content.includes('analyze') || input.content.includes('data')) {
      return 'analysis'
    }
    return 'chat' // Default to chat agent
  }
}

// LLMProviderPresenter becomes specialized Action Agent
export class ChatActionAgent extends ActionAgent {
  // Specialized implementation for chat conversations
  // Uses underlying LLMProviderPresenter but with chat-specific optimizations
}
```

## Testing Strategy

### Unit Testing (Each Phase)
- Test individual components (BaseAgent, InputQueue, ToolSystem)
- Mock external dependencies
- Test error conditions and edge cases

### Integration Testing (Each Phase)
- Test component interactions
- Test agent-to-agent communication
- Test tool execution and result handling

### Performance Testing (Phase 2+)
- Test concurrent agent execution
- Test input queue performance
- Test tool execution efficiency

### End-to-End Testing (Phase 3)
- Test complete user workflows
- Test agent collaboration scenarios
- Test system reliability and recovery

## Success Metrics

### Technical Metrics
- **Input Queue Performance**: <10ms average dequeue time
- **Tool Execution**: 95% success rate for sync tools, 90% for async
- **Agent Concurrency**: Support 50+ concurrent agents
- **Resource Usage**: <2GB memory for 10 active agents

### User Experience Metrics
- **Response Time**: <1s for simple queries, <5s for complex tasks
- **Input Responsiveness**: User can always input during processing
- **Error Recovery**: 99% automatic error recovery
- **Task Completion**: 95% success rate for user requests

### System Metrics
- **Uptime**: 99.9% availability
- **Scalability**: Linear performance scaling with agent count
- **Monitoring**: 100% observability of system state
- **Maintainability**: <50ms build time, 90% test coverage

This implementation plan provides a clear roadmap for transforming the current LLM provider system into a sophisticated multi-agent architecture while maintaining backward compatibility and ensuring a smooth transition.