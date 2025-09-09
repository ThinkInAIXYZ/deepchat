# AI/Agent UI Kit Component System

## Overview

The UI Kit is a comprehensive component library built on top of shadcn/ui components, specifically designed for AI and agent interfaces in DeepChat. It provides specialized, higher-level components that handle common AI chat patterns while maintaining flexibility and customization options.

## Architecture

### Foundation Layer
- **shadcn/ui**: Base UI components providing consistent styling and behavior
- **Radix Vue**: Accessible, unstyled UI primitives
- **Tailwind CSS**: Utility-first styling system

### UI Kit Layer
The UI Kit extends the foundation with AI-specific functionality and patterns:

```
UIKit Components (src/renderer/src/components/uikit/)
├── chat/           # Core chat interface components  
├── message/        # Message-specific block components
├── layout/         # Layout and navigation components
├── utility/        # Specialized utility components
├── form/           # Form components (extensible)
└── types/          # TypeScript definitions
```

## Component Categories

### Core Chat Components (`/chat`)

#### ChatContainer
Main wrapper component for chat interfaces.

**Props:**
- `loading?: boolean` - Shows loading state
- `disabled?: boolean` - Disables interaction
- `class?: string` - Additional CSS classes

**Usage:**
```vue
<ChatContainer>
  <ChatHeader title="AI Assistant" />
  <MessageList />
  <PromptInput />
</ChatContainer>
```

#### ChatHeader
Header component with title, subtitle, and action slots.

**Props:**
- `title?: string` - Main header title
- `subtitle?: string` - Secondary header text
- `loading?: boolean`
- `disabled?: boolean`
- `class?: string`

**Slots:**
- `actions` - Right-side action buttons

#### MessageList
Scrollable container for message history with auto-scroll functionality.

**Props:**
- `messages?: MessageContent[]` - Array of messages
- `autoScroll?: boolean` - Auto-scroll to bottom (default: true)
- `loading?: boolean`
- `disabled?: boolean`
- `class?: string`

**Exposed Methods:**
- `scrollToBottom()` - Manually scroll to bottom

#### ChatMessage
Individual message display with avatar, content, and actions.

**Props:**
- `message: MessageContent` - Message data object
- `variant?: 'user' | 'assistant' | 'system' | 'error'` - Message type
- `avatar?: string` - Avatar image URL
- `name?: string` - Sender name
- `timestamp?: Date | string` - Message timestamp
- `class?: string`

**Slots:**
- `default` - Message content (receives `message` prop)
- `actions` - Message action buttons (receives `message` prop)

#### PromptInput
Input component with send functionality and keyboard shortcuts.

**Props:**
- `placeholder?: string` - Input placeholder text
- `maxRows?: number` - Maximum textarea rows (default: 6)
- `loading?: boolean`
- `disabled?: boolean`
- `class?: string`

**Events:**
- `send: (content: string)` - Emitted when message is sent
- `input: (content: string)` - Emitted on input change

**Slots:**
- `send-icon` - Custom send button icon

**Exposed Methods:**
- `focus()` - Focus the input
- `clear()` - Clear input content
- `setValue(value: string)` - Set input value

### Message Block Components (`/message`)

#### MessageToolbar
Contextual action buttons for messages (copy, edit, regenerate, etc.).

**Props:**
- `message: MessageContent` - Associated message
- `actions?: Action[]` - Custom action definitions
- `class?: string`

**Events:**
- `action: (actionId: string, message: MessageContent)` - Action triggered

**Slots:**
- `icon-{actionId}` - Custom icons for specific actions
- `actions` - Additional custom actions

#### MessageBlockSource
Displays search results with collapsible interface.

**Props:**
- `query?: string` - Search query
- `results?: SearchResult[]` - Search results array
- `totalResults?: number` - Total result count
- `searchTime?: number` - Search duration in ms
- `status?: 'searching' | 'completed' | 'error'` - Current status
- `collapsible?: boolean` - Enable collapse/expand (default: true)
- `defaultCollapsed?: boolean` - Initial collapsed state
- `class?: string`

**Events:**
- `resultClick: (result: SearchResult)` - Search result clicked
- `expandToggle: (expanded: boolean)` - Expand/collapse toggled

#### MessageBlockToolCall
Displays tool execution with arguments, results, and status.

**Props:**
- `toolCall: ToolCall` - Tool execution data
- `showArguments?: boolean` - Show tool arguments (default: true)
- `showResult?: boolean` - Show execution result (default: true)
- `collapsible?: boolean` - Enable collapse/expand (default: true)
- `defaultCollapsed?: boolean` - Initial collapsed state
- `class?: string`

**Events:**
- `retry: (toolCall: ToolCall)` - Retry execution requested
- `expandToggle: (expanded: boolean)` - Expand/collapse toggled

#### InlineCitation
Hoverable citation references with preview cards.

**Props:**
- `citation: Citation` - Citation data object
- `index?: number` - Citation number/index
- `inline?: boolean` - Inline display mode (default: true)
- `class?: string`

**Events:**
- `click: (citation: Citation)` - Citation clicked
- `navigate: (url: string)` - Navigation requested

### Layout Components (`/layout`)

#### Tabs
Tab container with support for closable tabs and badges.

**Props:**
- `tabs: Tab[]` - Tab definitions
- `activeTab?: string` - Currently active tab ID
- `variant?: 'default' | 'pills' | 'underline'` - Tab style variant
- `class?: string`

**Events:**
- `tabChange: (tabId: string)` - Tab selection changed
- `tabClose: (tabId: string)` - Tab close requested

#### TabItem
Individual tab content panel with lazy loading support.

**Props:**
- `tabId: string` - Unique tab identifier
- `lazy?: boolean` - Enable lazy loading (default: false)
- `class?: string`

**Slots:**
- `default` - Tab content (receives `isActive` prop)

### Utility Components (`/utility`)

#### ToolOutput
Formatted display for tool execution results.

**Props:**
- `title?: string` - Output title
- `output: any` - Output content
- `format?: 'text' | 'json' | 'code' | 'html' | 'markdown'` - Output format
- `language?: string` - Code language for syntax highlighting
- `status?: 'success' | 'error' | 'warning' | 'info'` - Status indicator
- `class?: string`

**Slots:**
- `actions` - Custom action buttons (receives `output` and `format` props)

#### ProviderSelector
Dropdown selector for AI providers with status indicators.

**Props:**
- `providers: Provider[]` - Available providers
- `selectedProvider?: string` - Currently selected provider ID
- `placeholder?: string` - Placeholder text
- `showStatus?: boolean` - Show connection status (default: true)
- `class?: string`

**Events:**
- `providerChange: (providerId: string, provider: Provider)` - Provider selected

**Slots:**
- `provider-details` - Custom provider details (receives `provider` prop)

#### SettingsPanel
Two-column settings interface with navigation sidebar.

**Props:**
- `sections?: SettingsSection[]` - Settings sections
- `activeSection?: string` - Currently active section
- `class?: string`

**Events:**
- `sectionChange: (sectionId: string)` - Section navigation

**Slots:**
- `header` - Panel header content
- `default` - Main settings content (receives `activeSection` and `sections` props)

#### Task
Task card with status, progress, and action management.

**Props:**
- `task: TaskItem` - Task data object
- `compact?: boolean` - Compact display mode (default: false)
- `showProgress?: boolean` - Show progress bar (default: true)
- `showActions?: boolean` - Show action buttons (default: true)
- `class?: string`

**Events:**
- `statusChange: (taskId: string, status: TaskStatus)` - Task status changed
- `edit: (task: TaskItem)` - Edit task requested
- `delete: (task: TaskItem)` - Delete task requested

**Slots:**
- `actions` - Custom action buttons

## Type Definitions

### Core Types

```typescript
interface BaseComponentProps {
  class?: string;
}

interface ChatComponentProps extends BaseComponentProps {
  loading?: boolean;
  disabled?: boolean;
}

interface MessageComponentProps extends BaseComponentProps {
  variant?: 'user' | 'assistant' | 'system' | 'error';
}

interface BlockComponentProps extends BaseComponentProps {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}
```

### Data Types

```typescript
interface MessageContent {
  id: string;
  type: 'text' | 'code' | 'image' | 'file' | 'tool_call' | 'search' | 'thinking';
  content: any;
  metadata?: Record<string, any>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
  error?: string;
}

interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface Citation {
  id: string;
  title: string;
  url?: string;
  excerpt?: string;
  source?: string;
  timestamp?: Date | string;
}

interface Provider {
  id: string;
  name: string;
  type: 'cloud' | 'local' | 'api';
  status?: 'connected' | 'disconnected' | 'error';
  models?: string[];
  description?: string;
  icon?: string;
}

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  progress?: number;
  assignee?: string;
  dueDate?: Date;
}
```

## Usage Examples

### Basic Chat Interface

```vue
<template>
  <ChatContainer class="h-full">
    <ChatHeader 
      title="AI Assistant"
      subtitle="Powered by GPT-4"
    >
      <template #actions>
        <Button variant="ghost" size="sm">Settings</Button>
      </template>
    </ChatHeader>

    <MessageList 
      :messages="messages"
      class="flex-1"
    >
      <template #default="{ messages }">
        <ChatMessage
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :variant="message.role"
          :name="message.role === 'user' ? 'You' : 'Assistant'"
          :timestamp="message.timestamp"
        >
          <template #default="{ message }">
            {{ message.content }}
          </template>
          
          <template #actions="{ message }">
            <MessageToolbar :message="message" @action="handleAction" />
          </template>
        </ChatMessage>
      </template>
    </MessageList>

    <PromptInput 
      placeholder="Type your message..."
      @send="sendMessage"
    />
  </ChatContainer>
</template>
```

### Tool Call Display

```vue
<template>
  <MessageBlockToolCall 
    :tool-call="toolCall"
    :show-arguments="true"
    :show-result="true"
    @retry="retryTool"
    @expand-toggle="onExpandToggle"
  />
</template>

<script setup>
const toolCall = {
  id: '1',
  name: 'web_search',
  arguments: { query: 'Vue 3 composition API' },
  status: 'completed',
  result: { results: [...] }
}
</script>
```

### Search Results

```vue
<template>
  <MessageBlockSource
    query="Vue 3 features"
    :results="searchResults"
    :total-results="150"
    :search-time="245"
    status="completed"
    @result-click="openResult"
  />
</template>
```

### Tabbed Interface

```vue
<template>
  <Tabs 
    :tabs="tabs"
    :active-tab="activeTab"
    variant="pills"
    @tab-change="setActiveTab"
    @tab-close="closeTab"
  >
    <TabItem
      v-for="tab in tabs"
      :key="tab.id"
      :tab-id="tab.id"
      :lazy="true"
    >
      <component :is="tab.component" />
    </TabItem>
  </Tabs>
</template>
```

## Design Principles

### Modularity
Each component is self-contained with clear interfaces and minimal dependencies.

### Customization
Components accept props for styling and behavior, with slot-based content customization.

### Accessibility
Built on Radix Vue primitives ensuring ARIA compliance and keyboard navigation.

### Type Safety
Full TypeScript support with comprehensive type definitions.

### Performance
Lazy loading, efficient re-rendering, and optimized bundle size.

### Consistency
Unified design patterns and naming conventions across all components.

## Styling Guidelines

### Theme Variables
Components use CSS custom properties for theming:
- `--foreground` / `--background`
- `--primary` / `--primary-foreground`
- `--muted` / `--muted-foreground`
- `--border` / `--accent`

### Responsive Design
All components are mobile-friendly with responsive breakpoints:
- Mobile: `< 768px`
- Tablet: `768px - 1024px`
- Desktop: `> 1024px`

### Dark Mode
Automatic dark mode support through CSS variables and `dark:` utility classes.

## Extension Guidelines

### Adding New Components

1. **Create component file** in appropriate category folder
2. **Define TypeScript interfaces** for props and events
3. **Export from category index.ts** file
4. **Update main index.ts** if adding new category
5. **Add comprehensive JSDoc** comments
6. **Include usage examples** in documentation

### Component Structure Template

```vue
<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { BaseComponentProps } from '../types'

interface Props extends BaseComponentProps {
  // Component-specific props
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  // Default values
})

const emit = defineEmits<{
  // Event definitions
}>()

const classes = computed(() => 
  cn(
    // Base classes
    props.class
  )
)
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
```

## Integration with Existing Codebase

### Import Path
```typescript
import { ChatContainer, MessageList, PromptInput } from '@/components/uikit'
```

### Migration Strategy
1. **Gradual adoption** - Replace existing components incrementally
2. **Coexistence** - UI Kit can work alongside existing components
3. **Customization** - Override styles and behavior as needed
4. **Testing** - Comprehensive test coverage for all components

### Performance Considerations
- **Tree shaking** - Only imported components are included in bundle
- **Code splitting** - Components can be lazy-loaded
- **SSR compatibility** - Components work with server-side rendering

## Future Enhancements

### Planned Components
- **CodeEditor** - Syntax-highlighted code input/display
- **FileUpload** - Drag-and-drop file handling
- **VoiceInput** - Speech-to-text integration  
- **ModelSelector** - AI model selection interface
- **ParameterSlider** - AI parameter adjustment
- **ThinkingIndicator** - Visual thinking/processing states

### Advanced Features
- **Component variants** - Additional styling variants
- **Animation presets** - Built-in transition animations
- **Keyboard shortcuts** - Global hotkey support
- **Context menus** - Right-click context actions
- **Drag and drop** - Inter-component drag operations

This UI Kit provides a solid foundation for building sophisticated AI/agent interfaces while maintaining flexibility for future requirements and customizations.