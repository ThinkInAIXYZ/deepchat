# Agent Architecture Design Document

## Overview

This document outlines the proposed architecture for transforming the current LLM provider system into a comprehensive multi-agent framework. The goal is to create a flexible, scalable agent system that can handle multiple concurrent agents with different capabilities, input queuing, and both synchronous and asynchronous tool execution.

## Current Architecture Analysis

### Current Structure

#### ThreadPresenter as Basic Master Loop Agent (`src/main/presenter/threadPresenter/index.ts`)
- **Conversation Management**: Manages conversation state and message flow
- **LLM Coordination**: Coordinates with LLMProviderPresenter for agent execution
- **Session Context**: Maintains conversation context and history
- **Basic Input Handling**: Handles user input and message sequencing

#### LLMProviderPresenter as Single Action Agent (`src/main/presenter/llmProviderPresenter/index.ts`)
- **Single Agent Loop**: Basic agent loop in `startStreamCompletion` method (lines 694-2033)
- **Synchronous Tool Execution**: Tools are executed synchronously within the agent loop
- **No Input Queue**: User input cannot be processed during streaming
- **Limited Concurrency**: Basic rate limiting but no true multi-agent support
- **Provider-Centric**: Focused on LLM providers rather than agent capabilities

### Key Limitations

1. **Blocking During Stream**: Once streaming starts, no new inputs can be processed
2. **Single Agent**: Only one agent can operate per conversation/thread
3. **Synchronous Tools**: All tool execution blocks the agent loop
4. **No Agent Persistence**: Agents are ephemeral and tied to specific conversations
5. **Limited Tool Integration**: Primarily MCP tools with synchronous execution

## Proposed Architecture

### Core Concepts

#### 1. Agent Hierarchy and Management
- **Master Loop Agent**: Central coordinator that manages all sub-agents, input queue, and session state
- **Action Agents**: Specialized agents with specific purposes, tools, and well-defined input/output contracts
- **Agent Orchestration**: Master agent delegates tasks to appropriate action agents based on context

#### 2. Agent Definition
An agent is defined by:
- **Agent Type**: Master, Action, or Specialized
- **Provider Configuration**: Configurable LLM provider and model selection
- **System Prompt**: Clear description of agent purpose, capabilities, and expected outputs
- **Tool Registry**: Available capabilities (MCP, async, custom) with access control
- **Input/Output Contract**: Well-defined input requirements and output specifications
- **State Management**: Persistent state across interactions with isolation boundaries

#### 3. Action Agent Specifications
Action agents have:
- **Single Responsibility**: Focused on specific task types (research, coding, analysis, etc.)
- **Deterministic Output**: Clear final output format without intermediate streaming
- **Process Isolation**: Internal reasoning and tool usage are encapsulated
- **Resource Limits**: Configurable timeouts, token limits, and tool usage constraints
- **Result Caching**: Intelligent caching of completed agent executions

#### 4. Enhanced Tool System
- **Synchronous Tools**: Immediate execution (current MCP tools)
- **Asynchronous Tools**: Background execution with result queuing and callback system
- **Tool Categories**: MCP, CLI, API, Custom with proper sandboxing
- **Tool Lifecycle**: Registration, validation, execution, monitoring, cleanup
- **Provider Integration**: Tools can leverage different LLM providers based on agent configuration

## Architecture Components

### 1. Master Loop Agent Management Strategy

The Master Loop Agent serves as the central coordinator that manages:

#### Input Queue Management
- **Priority-based Input Queue**: User inputs are queued with configurable priority levels
- **Context-aware Processing**: Queue processing considers conversation context and agent availability
- **Non-blocking Input**: Users can provide input during agent processing without blocking
- **Queue Statistics**: Real-time monitoring of queue length, wait times, and processing rates

#### Sub-agent Management
- **Dynamic Agent Registration**: Action agents register with the master agent at runtime
- **Agent Discovery**: Automatic discovery of available action agents with capability matching
- **Resource Allocation**: Intelligent allocation of system resources to action agents
- **Health Monitoring**: Continuous monitoring of agent health and performance

#### Session State Management
- **Conversation Context**: Maintains shared context across all action agents
- **Agent State Persistence**: Saves and restores agent states across sessions
- **Tool Execution History**: Tracks tool usage and results for intelligent reuse
- **User Preferences**: Stores user-specific agent configuration preferences

#### Delegation and Routing
- **Specification-based Routing**: Routes inputs to appropriate agents based on agent specifications
- **Fallback Strategies**: Automatic fallback to alternative agents when primary agents fail
- **Collaboration Patterns**: Orchestrates multi-agent collaboration for complex tasks
- **Progress Tracking**: Monitors agent execution and provides real-time status updates

### 2. Agent Manager
```typescript
interface AgentManager {
  createAgent(type: string, config: AgentConfig): Agent
  getAgent(agentId: string): Agent | null
  listAgents(): Agent[]
  removeAgent(agentId: string): void
  registerAgentType(type: string, factory: AgentFactory): void
}
```

### 2. Agent Interface
```typescript
interface Agent {
  id: string
  type: 'master' | 'action' | 'specialized'
  state: AgentState
  
  // Core methods
  processInput(input: AgentInput): Promise<AgentOutput>
  queueInput(input: AgentInput): void
  getQueuedInputs(): AgentInput[]
  
  // Tool management
  registerTool(tool: ToolDefinition): void
  executeTool(toolName: string, params: any): Promise<ToolResult>
  
  // Provider configuration
  getProviderConfig(): ProviderConfig
  setProviderConfig(config: Partial<ProviderConfig>): void
  
  // Agent specification
  getSpecification(): AgentSpecification
  updateSpecification(spec: Partial<AgentSpecification>): void
  
  // State management
  getState(): AgentState
  setState(state: Partial<AgentState>): void
  persistState(): Promise<void>
  
  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
}

interface AgentSpecification {
  name: string
  description: string
  purpose: string
  capabilities: string[]
  expectedOutputFormat: string
  systemPrompt: string
  inputRequirements: string
  outputSpecification: string
  constraints: string[]
  timeoutMs: number
  maxTokenUsage: number
  maxIterations: number
  allowedTools: string[]
  providerPreferences: ProviderPreference[]
  
  // Enhanced specification for action agents
  inputContract: {
    requiredFields: string[]
    optionalFields: string[]
    validationRules: ValidationRule[]
    contextRequirements: ContextRequirement[]
  }
  
  outputContract: {
    requiredFields: string[]
    format: 'text' | 'json' | 'markdown' | 'html' | 'structured'
    schema?: JSONSchema
    qualityStandards: QualityStandard[]
  }
  
  // Performance and resource constraints
  resourceLimits: {
    maxMemoryMB: number
    maxExecutionTimeMs: number
    maxConcurrentTools: number
    rateLimits: RateLimitConfig[]
  }
  
  // Monitoring and observability
  metricsToTrack: string[]
  successCriteria: SuccessCriterion[]
  failureConditions: FailureCondition[]
}

interface ProviderConfig {
  providerId: string
  modelId: string
  temperature: number
  maxTokens: number
  contextLength: number
  fallbackProviders: string[]
  
  // Enhanced provider configuration
  providerSpecificConfig: {
    [key: string]: any
  }
  
  // Performance optimization
  cachingEnabled: boolean
  cacheTTL: number
  retryConfig: {
    maxRetries: number
    retryDelayMs: number
    backoffStrategy: 'linear' | 'exponential'
  }
  
  // Cost and usage tracking
  costTracking: {
    costPerToken: number
    costPerRequest: number
    budgetLimit?: number
  }
  
  // Model capabilities
  supportsToolCalling: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  maxParallelRequests: number
}
```

### 3. Enhanced Tool System
```typescript
interface ToolSystem {
  // Tool registration
  registerTool(tool: ToolDefinition): void
  unregisterTool(toolName: string): void
  
  // Tool execution
  executeSync(toolName: string, params: any): ToolResult
  executeAsync(toolName: string, params: any): Promise<string> // returns taskId
  
  // Task management
  getTaskStatus(taskId: string): TaskStatus
  cancelTask(taskId: string): boolean
  
  // Result retrieval
  getTaskResult(taskId: string): ToolResult | null
  subscribeToTask(taskId: string, callback: TaskCallback): void
}

interface ToolDefinition {
  name: string
  description: string
  category: 'mcp' | 'cli' | 'api' | 'custom'
  async: boolean
  timeout?: number
  execute: (params: any) => Promise<any> | any
  validate?: (params: any) => ValidationResult
}
```

### 4. Input Queue System
```typescript
interface InputQueue {
  // Queue management
  enqueue(input: AgentInput, priority?: number): string // returns queueId
  dequeue(): AgentInput | null
  peek(): AgentInput | null
  clear(): void
  
  // Priority handling
  setPriority(queueId: string, priority: number): boolean
  
  // Event system
  onInputAdded(callback: QueueCallback): void
  onInputProcessed(callback: QueueCallback): void
  
  // Statistics
  getQueueLength(): number
  getAverageWaitTime(): number
}
```

### 5. Master Loop Agent with Step Management
```typescript
interface MasterLoopAgent extends Agent {
  // Sub-agent management
  registerSubAgent(agent: Agent): void
  unregisterSubAgent(agentId: string): void
  getSubAgents(): Agent[]
  findSuitableAgent(input: AgentInput): Agent | null
  
  // Input queue management
  processUserInput(input: UserInput): Promise<AgentOutput>
  getInputQueueStatus(): QueueStatus
  prioritizeInput(queueId: string, priority: number): boolean
  
  // Session management
  getSessionState(): SessionState
  updateSessionState(updates: Partial<SessionState>): void
  persistSession(): Promise<void>
  
  // Agent orchestration
  delegateToActionAgent(actionType: string, input: AgentInput): Promise<AgentOutput>
  monitorAgentProgress(agentId: string): AgentProgress
  handleAgentCompletion(agentId: string, result: AgentOutput): void
  handleAgentFailure(agentId: string, error: Error): void
  
  // Todo Task Management for Step Decomposition
  createTodoTask(description: string, dependencies?: string[]): TodoTask
  updateTaskStatus(taskId: string, status: TaskStatus): void
  getActiveTasks(): TodoTask[]
  getTaskById(taskId: string): TodoTask | null
  waitForDependencies(taskId: string): Promise<void>
  markTaskComplete(taskId: string, result?: any): void
  
  // Step Management - prevents loop from proceeding until all action agents complete
  canProceedToNextStep(): boolean
  getAllPendingActionAgents(): string[]
  blockStepProgression(reason: string): void
  unblockStepProgression(): void
}

interface SessionState {
  conversationHistory: ChatMessage[]
  activeAgents: string[]
  completedTasks: CompletedTask[]
  pendingInputs: QueuedInput[]
  resourceUsage: ResourceMetrics
  userPreferences: UserPreferences
  
  // Enhanced session state with todo task tracking
  todoTasks: TodoTask[]
  currentStep: number
  stepStatus: 'running' | 'blocked' | 'completed' | 'failed'
  blockedReason?: string
  pendingActionAgents: string[]
}

interface CompletedTask {
  taskId: string
  agentId: string
  input: AgentInput
  output: AgentOutput
  startTime: number
  endTime: number
  resourceUsage: ResourceUsage
  success: boolean
  error?: string
}

// Todo Task Data Structure for Step Tracking
interface TodoTask {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'
  dependencies: string[] // IDs of tasks that must complete before this task can start
  assignedAgent?: string // ID of the action agent handling this task
  result?: any // Result from the action agent
  error?: string // Error message if task failed
  createdAt: number
  startedAt?: number
  completedAt?: number
  priority: number // 0-10 priority level
  timeoutMs?: number // Optional timeout for task completion
  metadata?: Record<string, any> // Additional task metadata
}

interface TaskStatus {
  taskId: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'
  progress?: number // 0-100 progress percentage
  estimatedRemainingTime?: number // Estimated time remaining in ms
  agentId?: string // ID of the agent working on this task
}
```

### 6. Loop Agent Step Management System

The Master Loop Agent includes a sophisticated step management system that prevents progression to the next step until all action agents have completed their current tasks:

#### Step Management Logic
```typescript
// Enhanced Master Loop Agent execution with step control
class EnhancedMasterLoopAgent implements MasterLoopAgent {
  private currentStep: number = 0
  private stepStatus: StepStatus = 'idle'
  private pendingTasks: Map<string, TodoTask> = new Map()
  private taskDependencies: Map<string, string[]> = new Map()
  private stepBlockers: Set<string> = new Set()
  
  async executeTask(task: TodoTask): Promise<void> {
    // Set task status to in_progress
    this.updateTaskStatus(task.id, 'in_progress')
    
    try {
      // Wait for all dependencies to complete
      await this.waitForDependencies(task.id)
      
      // Delegate to appropriate action agent
      const result = await this.delegateToActionAgent(task.assignedAgent!, {
        task: task.description,
        context: this.getCurrentContext(),
        dependencies: task.dependencies.map(depId => this.getTaskById(depId)?.result)
      })
      
      // Mark task complete with result
      this.markTaskComplete(task.id, result)
      
    } catch (error) {
      // Handle task failure
      this.updateTaskStatus(task.id, 'failed', error.message)
      throw error
    }
  }
  
  async waitForDependencies(taskId: string): Promise<void> {
    const task = this.getTaskById(taskId)
    if (!task) return
    
    // Wait for all dependency tasks to complete
    for (const depId of task.dependencies) {
      const depTask = this.getTaskById(depId)
      if (depTask && depTask.status !== 'completed') {
        // Block step progression until dependency completes
        this.blockStepProgression(`Waiting for dependency task: ${depId}`)
        await this.waitForTaskCompletion(depId)
        this.unblockStepProgression()
      }
    }
  }
  
  canProceedToNextStep(): boolean {
    // Check if any action agents are still processing
    const pendingAgents = this.getAllPendingActionAgents()
    const hasPendingTasks = this.pendingTasks.size > 0
    const hasStepBlockers = this.stepBlockers.size > 0
    
    return !hasPendingTasks && !hasStepBlockers && pendingAgents.length === 0
  }
  
  blockStepProgression(reason: string): void {
    this.stepBlockers.add(reason)
    this.stepStatus = 'blocked'
    this.updateSessionState({ blockedReason: reason })
  }
  
  unblockStepProgression(): void {
    this.stepBlockers.clear()
    this.stepStatus = 'running'
    this.updateSessionState({ blockedReason: undefined })
  }
  
  // Enhanced agent completion handler
  handleAgentCompletion(agentId: string, result: AgentOutput): void {
    super.handleAgentCompletion(agentId, result)
    
    // Update any tasks assigned to this agent
    this.pendingTasks.forEach((task, taskId) => {
      if (task.assignedAgent === agentId) {
        this.markTaskComplete(taskId, result)
      }
    })
    
    // Check if we can proceed to next step
    if (this.canProceedToNextStep()) {
      this.advanceToNextStep()
    }
  }
}
```

#### Step Management Benefits
1. **Sequential Task Execution**: Tasks execute in proper order based on dependencies
2. **Blocking Mechanism**: Loop waits for all action agents to complete before proceeding
3. **Dependency Tracking**: Complex task dependencies are properly managed
4. **Progress Visibility**: Real-time tracking of task and step completion
5. **Error Handling**: Failed tasks properly block progression and provide clear error messages
6. **Resource Optimization**: Prevents resource contention by sequential execution

### 7. Action Agent Execution Model

Action agents follow a strict execution model with clear input/output contracts:

#### Input Processing Pipeline
```typescript
interface AgentInput {
  // Required core fields
  task: string
  context: ConversationContext
  
  // Optional enhancement fields
  constraints?: string[]
  qualityRequirements?: QualityRequirement[]
  formatPreferences?: FormatPreference[]
  
  // Execution context
  priority: number
  timeoutMs?: number
  metadata?: Record<string, any>
}

interface ConversationContext {
  history: ChatMessage[]
  sharedState: Record<string, any>
  toolResults: ToolExecutionResult[]
  userPreferences: UserAgentPreferences
}
```

#### Internal Execution Isolation
Action agents encapsulate all internal reasoning and tool execution:
- **Internal Loop**: Multiple iterations with tool usage and reasoning
- **State Isolation**: Internal state not exposed to master agent
- **Tool Execution**: Full tool access within agent boundaries
- **Result Processing**: Only final formatted output is returned

#### Output Contract Enforcement
```typescript
interface AgentOutput {
  // Final content according to specification
  content: string | object
  
  // Execution metadata
  metadata: {
    agentId: string
    executionTimeMs: number
    tokenUsage: number
    toolsUsed: string[]
    iterationCount: number
    success: boolean
    error?: string
  }
  
  // Quality assurance
  validation: {
    meetsSpecification: boolean
    qualityScore: number
    warnings: string[]
  }
}
```

### 7. Action Agent Implementation
```typescript
class ActionAgent extends BaseAgent {
  private specification: AgentSpecification
  private providerConfig: ProviderConfig
  private toolAccess: Set<string>
  
  constructor(config: ActionAgentConfig) {
    super(config)
    this.specification = config.specification
    this.providerConfig = config.providerConfig
    this.toolAccess = new Set(config.specification.allowedTools)
  }

  async processInput(input: AgentInput): Promise<AgentOutput> {
    // Validate input against specification
    this.validateInput(input)
    
    // Execute agent logic with proper isolation
    const result = await this.executeWithIsolation(input)
    
    // Return only final output, internal reasoning is encapsulated
    return this.formatFinalOutput(result)
  }

  private async executeWithIsolation(input: AgentInput): Promise<InternalResult> {
    // Internal execution with full tool access and reasoning
    // This is encapsulated and not exposed to master agent
    const context = this.buildExecutionContext(input)
    
    let iteration = 0
    let finalResult: InternalResult | null = null
    
    while (iteration < this.specification.maxIterations && !finalResult) {
      const iterationResult = await this.executeSingleIteration(context)
      
      if (this.isFinalResult(iterationResult)) {
        finalResult = iterationResult
      } else {
        // Update context and continue
        context.update(iterationResult)
        iteration++
      }
    }
    
    return finalResult || this.createTimeoutResult()
  }

  private formatFinalOutput(internalResult: InternalResult): AgentOutput {
    // Extract only the final output according to specification
    return {
      content: internalResult.finalContent,
      metadata: {
        agentId: this.id,
        executionTime: internalResult.executionTime,
        tokenUsage: internalResult.tokenUsage,
        toolsUsed: internalResult.toolsUsed
      }
    }
  }
}
```

### 8. Provider Configuration Management System

The provider configuration system enables dynamic provider and model selection:

#### Provider Registry
```typescript
interface ProviderRegistry {
  // Provider discovery and registration
  registerProvider(provider: ProviderDefinition): void
  unregisterProvider(providerId: string): void
  getAvailableProviders(): ProviderDefinition[]
  
  // Model management
  getModelsForProvider(providerId: string): ModelDefinition[]
  registerModel(providerId: string, model: ModelDefinition): void
  
  // Capability-based selection
  findProvidersWithCapability(capability: string): ProviderDefinition[]
  findBestProviderForTask(taskType: string, constraints: ProviderConstraints): ProviderDefinition | null
}

interface ProviderDefinition {
  id: string
  name: string
  type: 'cloud' | 'local' | 'hybrid'
  capabilities: string[]
  authentication: AuthenticationConfig
  rateLimits: RateLimitConfig
  costStructure: CostConfig
  supportedModels: ModelDefinition[]
}

interface ModelDefinition {
  id: string
  name: string
  providerId: string
  contextLength: number
  capabilities: {
    toolCalling: boolean
    streaming: boolean
    vision: boolean
    reasoning: 'basic' | 'advanced' | 'expert'
  }
  performance: {
    tokensPerSecond: number
    latencyMs: number
    reliability: number
  }
  cost: {
    inputTokensPerMillion: number
    outputTokensPerMillion: number
  }
}
```

#### Dynamic Provider Selection
- **Capability Matching**: Select providers based on task requirements
- **Cost Optimization**: Choose most cost-effective provider for task
- **Performance-Based**: Select providers based on performance metrics
- **Fallback Chains**: Automatic fallback to alternative providers
- **Load Balancing**: Distribute requests across available providers

#### Provider-Aware Tool Execution
```typescript
interface ProviderAwareToolSystem extends ToolSystem {
  executeToolWithProvider(
    toolName: string, 
    params: any, 
    providerConfig: ProviderConfig
  ): Promise<ToolResult>
  
  getBestProviderForTool(toolName: string): ProviderDefinition | null
  
  // Provider-specific tool adaptations
  adaptToolForProvider(
    tool: ToolDefinition, 
    provider: ProviderDefinition
  ): AdaptedToolDefinition
}
```

### 9. Event System Enhancement
```typescript
interface EnhancedEventSystem {
  // Standard events
  AGENT_CREATED: 'agent:created'
  AGENT_STARTED: 'agent:started'
  AGENT_STOPPED: 'agent:stopped'
  INPUT_QUEUED: 'input:queued'
  INPUT_PROCESSED: 'input:processed'
  TOOL_EXECUTED: 'tool:executed'
  TOOL_FAILED: 'tool:failed'
  ASYNC_TASK_STARTED: 'async:task:started'
  ASYNC_TASK_COMPLETED: 'async:task:completed'
  
  // Agent-specific events
  ACTION_AGENT_STARTED: 'action:agent:started'
  ACTION_AGENT_COMPLETED: 'action:agent:completed'
  ACTION_AGENT_FAILED: 'action:agent:failed'
  MASTER_DELEGATION: 'master:delegation'
  SESSION_UPDATED: 'session:updated'
  
  // Enhanced event payloads
  interface AgentEvent {
    agentId: string
    timestamp: number
    type: string
    data: any
  }

  interface ActionAgentEvent extends AgentEvent {
    actionType: string
    inputSummary: string
    outputSummary: string
    executionMetrics: ExecutionMetrics
  }
}
```

## Implementation Plan

### Phase 1: Foundation (2-3 weeks)

1. **Extract Core Agent Logic** from current `startStreamCompletion`
   - Create `BaseAgent` class with loop functionality
   - Implement input queue system with priority handling
   - Standardize event interface for agent communication

2. **Create Master Loop Agent Framework with Step Management**
   - Master agent with sub-agent management and todo task tracking
   - Session state management and persistence with step control
   - Input queue orchestration and delegation logic
   - **Todo Task Management System**: Create `TodoTask` data structure with dependencies
   - **Step Blocking Mechanism**: Implement `canProceedToNextStep()` logic
   - **Agent Completion Tracking**: Track pending action agents and block progression

3. **Implement Action Agent Base Class**
   - Agent specification system with provider configuration
   - Input validation and output formatting
   - Internal execution isolation with proper encapsulation
   - **Task Assignment Integration**: Support task ID assignment and completion reporting

4. **Enhanced Tool System**
   - Tool registration with access control
   - Async tool execution framework with callback system
   - Provider-aware tool execution based on agent configuration

### Phase 2: Multi-Agent Support (2-3 weeks)

1. **Agent Coordination and Orchestration**
   - Master agent delegation and routing logic
   - Agent selection based on specification matching
   - Resource sharing with conflict resolution
   - Agent collaboration patterns and task chaining

2. **Advanced Tool Integration**
   - CLI tool execution with proper output capture and parsing
   - Long-running async task management with progress tracking
   - Tool result caching and intelligent reuse strategies
   - Provider-specific tool optimizations

3. **State Persistence and Session Management**
   - Agent state storage with proper isolation boundaries
   - Conversation context management across agent boundaries
   - Tool execution history with performance analytics
   - Session recovery and continuity management

### Phase 3: Advanced Features (3-4 weeks)

1. **Agent Specialization and Configuration**
   - Pre-defined agent types (ResearchAgent, CodeAgent, AnalysisAgent, CreativeAgent)
   - Custom agent configuration with template system
   - Skill-based agent routing and capability matching
   - Dynamic agent specification updates and hot-reloading

2. **Performance Optimization and Resource Management**
   - Intelligent input queue prioritization based on context
   - Resource pooling with provider-specific optimizations
   - Efficient tool execution with result caching and reuse
   - Adaptive resource allocation based on agent requirements

3. **Comprehensive Monitoring and Analytics**
   - Agent performance metrics with provider-specific benchmarks
   - Tool usage statistics and cost optimization
   - System health monitoring with predictive analytics
   - User experience metrics and quality of service tracking

## Migration Strategy

### Step 1: Backward Compatibility with Master Agent Wrapper
- Keep existing `LLMProviderPresenter` interface unchanged
- Create `MasterLoopAgent` that wraps legacy functionality
- Route calls through master agent with proper input/output conversion
- Maintain current event structure with additional agent-specific events

### Step 2: Gradual Agent Migration
- Implement new action agents alongside existing code
- Feature flag system for gradual agent adoption
- Parallel execution with legacy system for comparison
- Progressive migration of tool execution to new framework

### Step 3: Full Transition to Multi-Agent System
- Deprecate old single-agent implementation
- Migrate all functionality to master+action agent architecture
- Remove legacy code after comprehensive testing
- Optimize performance based on multi-agent metrics

## Key Technical Challenges

### 1. Master Agent Orchestration
- **Challenge**: Efficient delegation and routing between multiple action agents
- **Solution**: Specification-based agent matching with context awareness
- **Implementation**: Intelligent agent selection algorithm with fallback strategies

### 2. Loop Agent Step Management and Blocking
- **Challenge**: Ensuring loop agent waits for all action agents to complete before proceeding to next step or task
- **Solution**: Todo task data structure with dependency tracking and step blocking mechanism
- **Implementation**: `canProceedToNextStep()` checks pending agents, tasks, and blockers; `blockStepProgression()` prevents premature advancement
- **Key Requirements**:
  - Track all pending action agents via `getAllPendingActionAgents()`
  - Manage task dependencies through `TodoTask.dependencies` array
  - Block progression until all tasks complete or fail
  - Provide clear visibility into blocking reasons

### 3. Action Agent Isolation
- **Challenge**: Encapsulating internal reasoning while exposing only final outputs
- **Solution**: Strict input/output contracts with validation layers
- **Implementation**: Execution context isolation with controlled tool access

### 4. Provider Configuration Management
- **Challenge**: Dynamic provider and model selection per agent
- **Solution**: Provider preference system with fallback mechanisms
- **Implementation**: Provider-aware tool execution with automatic failover

### 5. Async Tool Integration with Agent Context
- **Challenge**: Managing long-running tasks across agent boundaries
- **Solution**: Task registry with agent context preservation
- **Implementation**: Context-aware callback system with state recovery

### 6. Resource Contention and Optimization
- **Challenge**: Multiple agents competing for limited provider resources
- **Solution**: Provider-aware resource pooling with priority scheduling
- **Implementation**: Adaptive resource allocation based on agent requirements

## Benefits of New Architecture

1. **True Multi-Agent Support**: Multiple agents can operate concurrently
2. **Non-Blocking Input**: Users can provide input during agent processing
3. **Enhanced Tool Capabilities**: Both sync and async tool execution
4. **Better Resource Management**: Efficient use of system resources
5. **Improved Scalability**: Horizontal scaling of agent instances
6. **Enhanced Monitoring**: Comprehensive observability of agent behavior
7. **Flexible Deployment**: Agents can be distributed across processes/nodes
8. **Reliable Step Management**: Loop agent properly waits for all action agents to complete
   - **Task Dependency Management**: Complex task hierarchies with proper sequencing
   - **Progress Visibility**: Real-time tracking of task completion and blocking reasons
   - **Error Isolation**: Failed tasks don't affect unrelated tasks but properly block dependent ones
   - **Predictable Execution**: No race conditions or premature step advancement

## Next Steps

1. **Review and Feedback**: Discuss this design with the team
2. **Prototype Implementation**: Build basic agent framework
3. **Testing Strategy**: Develop comprehensive test plan
4. **Performance Benchmarks**: Establish baseline metrics
5. **Rollout Plan**: Phased deployment strategy

## Architecture Diagrams

### Current Architecture Flow
```
┌─────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
│   User Input    │───▶│   ThreadPresenter    │───▶│  LLMProviderPresenter │
│                 │    │ (Basic Master Agent) │    │  (Single Action Agent)│
└─────────────────┘    └─────────────────────┘    └──────────────────────┘
                                 │                           │
                                 ▼                           ▼
                         ┌───────────────┐           ┌─────────────────┐
                         │ Conversation  │           │ Tool Execution  │
                         │   State       │           │   & LLM Calls   │
                         └───────────────┘           └─────────────────┘
```

### Proposed Multi-Agent Architecture Flow
```
┌─────────────────┐    ┌─────────────────────────────────────────────────┐
│   User Input    │───▶│               Master Loop Agent                 │
│                 │    │           (Enhanced ThreadPresenter)            │
└─────────────────┘    ├─────────────────────────────────────────────────┤
                       │  • Input Queue with Priority Handling           │
                       │  • Agent Discovery & Routing                   │
                       │  • Session State Management                    │
                       │  • Resource Allocation & Monitoring            │
                       └───────────────┬─────────────────────────────────┘
                                       │
                                       │ Delegates to appropriate agent
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Action Agent Registry                              │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Research    │  │   Code      │  │  Analysis   │  │  Creative   │    │
│  │   Agent     │  │   Agent     │  │   Agent     │  │   Agent     │    │
│  │             │  │             │  │             │  │             │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                         │
│  Each agent:                                                            │
│  • Has specific capabilities & tools                                   │
│  • Configurable provider preferences                                   │
│  • Internal execution isolation                                        │
│  • Well-defined input/output contracts                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Agent Execution Sequence Diagram
```
┌───────┐    ┌───────────────┐    ┌─────────────┐    ┌─────────────┐    ┌───────┐
│ User  │    │ Master Agent  │    │ Action Agent│    │ Tool System │    │ LLM   │
│       │    │ (ThreadPres)  │    │ Registry    │    │             │    │Provider│
└───┬───┘    └───────┬───────┘    └──────┬──────┘    └──────┬──────┘    └───┬───┘
    │     Input       │                   │                  │               │
    │───────────────▶│                   │                  │               │
    │                │  Find suitable    │                  │               │
    │                │─────agent───────▶│                  │               │
    │                │                   │                  │               │
    │                │    Return agent   │                  │               │
    │                │◀─────handle───────│                  │               │
    │                │                   │                  │               │
    │                │  Delegate task    │                  │               │
    │                │─────────────────▶│                  │               │
    │                │                   │  Execute with    │               │
    │                │                   │───isolation────▶│               │
    │                │                   │                  │  Call tools   │
    │                │                   │                  │─────────────▶│
    │                │                   │                  │               │
    │                │                   │                  │  Tool results │
    │                │                   │                  │◀──────────────│
    │                │                   │  Return final    │               │
    │                │◀───output─────────│                  │               │
    │    Response    │                   │                  │               │
    │◀───────────────│                   │                  │               │
└───┴───┘    └───────┴───────┘    └──────┴──────┘    └──────┴──────┘    └───┴───┘
```

### Provider Configuration Flow
```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Provider Selection Algorithm                        │
│                                                                         │
│  Input: Task requirements, constraints, agent preferences               │
│                                                                         │
│  1. Filter providers by capabilities                                    │
│  2. Check provider health & availability                                │
│  3. Apply selection strategy:                                           │
│     • Cost optimization                                                 │
│     • Performance optimization                                          │
│     • Reliability optimization                                          │
│  4. Select best provider                                                │
│  5. Configure provider-specific tool adaptations                         │
│                                                                         │
│  Output: Configured provider with fallback chain                        │
└─────────────────────────────────────────────────────────────────────────┘
```

This architecture provides a solid foundation for building a sophisticated multi-agent system that addresses the limitations of the current implementation while maintaining backward compatibility and enabling future enhancements.