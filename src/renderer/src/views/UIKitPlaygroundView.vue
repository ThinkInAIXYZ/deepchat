<template>
  <div class="h-full p-6 overflow-auto">
    <div class="max-w-7xl mx-auto space-y-8">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-foreground mb-2">UI Kit Playground</h1>
        <p class="text-muted-foreground">
          Interactive showcase of AI/Agent UI Kit components
        </p>
      </div>

      <!-- Navigation Tabs -->
      <Tabs 
        :tabs="tabs" 
        :active-tab="activeTab" 
        variant="underline"
        @tab-change="setActiveTab"
      >
        <!-- Chat Components -->
        <TabItem tab-id="chat">
          <div class="space-y-8">
            <section>
              <h2 class="text-xl font-semibold mb-4">Chat Components</h2>
              
              <!-- Chat Container Demo -->
              <div class="bg-card border border-border rounded-lg p-6">
                <h3 class="text-lg font-medium mb-4">ChatContainer with Components</h3>
                <div class="h-96 max-w-2xl mx-auto">
                  <ChatContainer>
                    <ChatHeader 
                      title="AI Assistant"
                      subtitle="Powered by GPT-4"
                    >
                      <template #actions>
                        <Button variant="ghost" size="sm">⚙️</Button>
                      </template>
                    </ChatHeader>

                    <MessageList :messages="sampleMessages" class="flex-1">
                      <template #default="{ messages }">
                        <ChatMessage
                          v-for="message in messages as any"
                          :key="message.id"
                          :message="message"
                          :variant="message.role as any"
                          :name="message.role === 'user' ? 'You' : 'Assistant'"
                          class="group"
                        >
                          <template #default="{ message }">
                            {{ message.content }}
                          </template>
                          
                          <template #actions="{ message }">
                            <MessageToolbar :message="message" @action="handleMessageAction" />
                          </template>
                        </ChatMessage>
                      </template>
                    </MessageList>

                    <PromptInput 
                      placeholder="Type your message..."
                      @send="handleSend"
                    />
                  </ChatContainer>
                </div>
              </div>
            </section>
          </div>
        </TabItem>

        <!-- Message Blocks -->
        <TabItem tab-id="message-blocks">
          <div class="space-y-8">
            <section>
              <h2 class="text-xl font-semibold mb-4">Message Block Components</h2>
              
              <!-- Tool Call Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">MessageBlockToolCall</h3>
                <MessageBlockToolCall 
                  :tool-call="sampleToolCall"
                  @retry="handleToolRetry"
                />
              </div>

              <!-- Search Results Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">MessageBlockSource</h3>
                <MessageBlockSource
                  query="Vue 3 Composition API"
                  :results="sampleSearchResults"
                  :total-results="150"
                  :search-time="245"
                  status="completed"
                  @result-click="handleResultClick"
                />
              </div>

              <!-- Inline Citation Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">InlineCitation</h3>
                <div class="p-4 bg-muted/50 rounded-md">
                  <p class="text-sm">
                    Vue 3 introduced the Composition API 
                    <InlineCitation :citation="sampleCitation" :index="1" />
                    which provides better TypeScript support and code reusability.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </TabItem>

        <!-- Utility Components -->
        <TabItem tab-id="utility">
          <div class="space-y-8">
            <section>
              <h2 class="text-xl font-semibold mb-4">Utility Components</h2>
              
              <!-- Task Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">Task</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                  <Task 
                    v-for="task in sampleTasks"
                    :key="task.id"
                    :task="task"
                    @status-change="handleTaskStatusChange"
                    @edit="handleTaskEdit"
                  />
                </div>
              </div>

              <!-- Provider Selector Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">ProviderSelector</h3>
                <div class="max-w-md">
                  <ProviderSelector
                    :providers="sampleProviders"
                    :selected-provider="selectedProvider"
                    @provider-change="handleProviderChange"
                  />
                </div>
              </div>

              <!-- Tool Output Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">ToolOutput</h3>
                <div class="space-y-4 max-w-2xl">
                  <ToolOutput
                    title="JSON Response"
                    :output="sampleJsonOutput"
                    format="json"
                    status="success"
                  />
                  <ToolOutput
                    title="Error Output"
                    output="Connection timeout after 30 seconds"
                    format="text"
                    status="error"
                  />
                </div>
              </div>
            </section>
          </div>
        </TabItem>

        <!-- Layout Components -->
        <TabItem tab-id="layout">
          <div class="space-y-8">
            <section>
              <h2 class="text-xl font-semibold mb-4">Layout Components</h2>
              
              <!-- Tabs Demo -->
              <div class="space-y-4">
                <h3 class="text-lg font-medium">Tabs Variants</h3>
                
                <!-- Default Tabs -->
                <div class="space-y-2">
                  <h4 class="text-sm font-medium text-muted-foreground">Default</h4>
                  <Tabs :tabs="demoTabs" variant="default" />
                </div>

                <!-- Pills Tabs -->
                <div class="space-y-2">
                  <h4 class="text-sm font-medium text-muted-foreground">Pills</h4>
                  <Tabs :tabs="demoTabs" variant="pills" />
                </div>

                <!-- Underline Tabs -->
                <div class="space-y-2">
                  <h4 class="text-sm font-medium text-muted-foreground">Underline</h4>
                  <Tabs :tabs="demoTabs" variant="underline" />
                </div>
              </div>
            </section>
          </div>
        </TabItem>
      </Tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import {
  ChatContainer,
  ChatHeader,
  ChatMessage,
  MessageList,
  PromptInput,
  MessageToolbar,
  MessageBlockSource,
  MessageBlockToolCall,
  InlineCitation,
  Task,
  ProviderSelector,
  ToolOutput,
  Tabs,
  TabItem,
  type MessageContent,
  type ToolCall,
  type SearchResult,
  type TaskItem
} from '@/components/uikit'

// Tab navigation
const activeTab = ref('chat')
const tabs = [
  { id: 'chat', label: 'Chat Components' },
  { id: 'message-blocks', label: 'Message Blocks' },
  { id: 'utility', label: 'Utility Components' },
  { id: 'layout', label: 'Layout Components' }
]

const setActiveTab = (tabId: string) => {
  activeTab.value = tabId
}

// Sample data
const sampleMessages: (MessageContent & { role: string })[] = [
  {
    id: '1',
    type: 'text',
    content: 'Hello! How can I help you today?',
    role: 'user'
  },
  {
    id: '2',
    type: 'text',
    content: 'Hi there! I can help you with a variety of tasks. What would you like to know?',
    role: 'assistant'
  }
]

const sampleToolCall: ToolCall = {
  id: 'tool-1',
  name: 'web_search',
  arguments: { query: 'Vue 3 Composition API benefits' },
  status: 'completed',
  result: {
    results: [
      { title: 'Vue 3 Composition API Guide', url: 'https://vuejs.org/guide/', snippet: 'Learn about the powerful Composition API...' }
    ]
  }
}

const sampleSearchResults: SearchResult[] = [
  {
    id: 'result-1',
    title: 'Vue 3 Composition API: Complete Guide',
    url: 'https://vuejs.org/guide/composition-api.html',
    snippet: 'The Composition API provides a more flexible way to compose component logic...',
    source: 'Vue.js Official'
  },
  {
    id: 'result-2',
    title: 'Why Vue 3 Composition API is Better',
    url: 'https://blog.vuejs.org/posts/composition-api.html',
    snippet: 'Better TypeScript support, improved code reusability, and cleaner organization...',
    source: 'Vue.js Blog'
  }
]

const sampleCitation = {
  id: 'cite-1',
  title: 'Vue 3 Composition API RFC',
  url: 'https://github.com/vuejs/rfcs/blob/master/active-rfcs/0013-composition-api.md',
  excerpt: 'A new API for component logic composition that provides better TypeScript support...',
  source: 'Vue.js RFC',
  timestamp: new Date('2023-01-01')
}

const sampleTasks: TaskItem[] = [
  {
    id: 'task-1',
    title: 'Implement UI Kit Components',
    description: 'Create reusable components for AI interfaces',
    status: 'completed',
    progress: 100,
    assignee: 'Developer'
  },
  {
    id: 'task-2',
    title: 'Add Component Documentation',
    description: 'Write comprehensive docs with examples',
    status: 'in_progress',
    progress: 75,
    assignee: 'Technical Writer'
  },
  {
    id: 'task-3',
    title: 'Create Playground Interface',
    description: 'Build interactive demo environment',
    status: 'pending',
    progress: 0,
    dueDate: new Date('2024-12-31')
  }
]

const sampleProviders = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud' as const,
    status: 'connected' as const,
    description: 'GPT-4 and other OpenAI models',
    models: ['gpt-4', 'gpt-3.5-turbo'],
    icon: '🤖'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'cloud' as const,
    status: 'connected' as const,
    description: 'Claude models for AI assistance',
    models: ['claude-3-opus', 'claude-3-sonnet'],
    icon: '🧠'
  },
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'local' as const,
    status: 'disconnected' as const,
    description: 'Local model hosting',
    models: ['llama2', 'codellama'],
    icon: '🏠'
  }
]

const selectedProvider = ref('openai')

const sampleJsonOutput = {
  success: true,
  data: {
    message: 'Operation completed successfully',
    items: ['item1', 'item2', 'item3'],
    count: 3
  },
  timestamp: new Date().toISOString()
}

const demoTabs = [
  { id: 'tab1', label: 'Overview' },
  { id: 'tab2', label: 'Documentation', badge: '12' },
  { id: 'tab3', label: 'Examples', closable: true },
  { id: 'tab4', label: 'Settings', disabled: true }
]

// Event handlers
const handleSend = (content: string) => {
  console.log('Send message:', content)
}

const handleMessageAction = (actionId: string, message: MessageContent) => {
  console.log('Message action:', actionId, message)
}

const handleToolRetry = (toolCall: ToolCall) => {
  console.log('Retry tool:', toolCall)
}

const handleResultClick = (result: SearchResult) => {
  console.log('Result clicked:', result)
}

const handleTaskStatusChange = (taskId: string, status: TaskItem['status']) => {
  console.log('Task status change:', taskId, status)
}

const handleTaskEdit = (task: TaskItem) => {
  console.log('Edit task:', task)
}

const handleProviderChange = (providerId: string, provider: any) => {
  selectedProvider.value = providerId
  console.log('Provider changed:', provider)
}
</script>