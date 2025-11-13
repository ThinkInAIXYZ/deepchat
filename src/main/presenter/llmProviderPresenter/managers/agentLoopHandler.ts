import { ChatMessage, IConfigPresenter, LLMAgentEvent, MCPToolCall } from '@shared/presenter'
import { presenter } from '@/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { StreamState } from '../types'
import { RateLimitManager } from './rateLimitManager'

interface AgentLoopHandlerOptions {
  configPresenter: IConfigPresenter
  getProviderInstance: (providerId: string) => BaseLLMProvider
  activeStreams: Map<string, StreamState>
  canStartNewStream: () => boolean
  rateLimitManager: RateLimitManager
}

export class AgentLoopHandler {
  constructor(private readonly options: AgentLoopHandlerOptions) {}

  async *startStreamCompletion(
    providerId: string,
    initialMessages: ChatMessage[],
    modelId: string,
    eventId: string,
    temperature: number = 0.6,
    maxTokens: number = 4096,
    enabledMcpTools?: string[],
    thinkingBudget?: number,
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
    verbosity?: 'low' | 'medium' | 'high',
    enableSearch?: boolean,
    forcedSearch?: boolean,
    searchStrategy?: 'turbo' | 'max'
  ): AsyncGenerator<LLMAgentEvent, void, unknown> {
    console.log(`[Agent Loop] Starting agent loop for event: ${eventId} with model: ${modelId}`)
    if (!this.options.canStartNewStream()) {
      // Instead of throwing, yield an error event
      yield { type: 'error', data: { eventId, error: 'Maximum concurrent stream limit reached' } }
      return
      // throw new Error('Maximum concurrent stream limit reached')
    }

    const provider = this.options.getProviderInstance(providerId)
    const abortController = new AbortController()
    const modelConfig = this.options.configPresenter.getModelConfig(modelId, providerId)

    if (thinkingBudget !== undefined) {
      modelConfig.thinkingBudget = thinkingBudget
    }
    if (reasoningEffort !== undefined) {
      modelConfig.reasoningEffort = reasoningEffort
    }
    if (verbosity !== undefined) {
      modelConfig.verbosity = verbosity
    }
    if (enableSearch !== undefined) {
      modelConfig.enableSearch = enableSearch
    }
    if (forcedSearch !== undefined) {
      modelConfig.forcedSearch = forcedSearch
    }
    if (searchStrategy !== undefined) {
      modelConfig.searchStrategy = searchStrategy
    }

    this.options.activeStreams.set(eventId, {
      isGenerating: true,
      providerId,
      modelId,
      abortController,
      provider
    })

    // Agent Loop Variables
    const conversationMessages: ChatMessage[] = [...initialMessages]
    let needContinueConversation = true
    let toolCallCount = 0
    const MAX_TOOL_CALLS = BaseLLMProvider.getMaxToolCalls()
    const totalUsage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      context_length: number
    } = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      context_length: modelConfig?.contextLength || 0
    }

    try {
      // --- Agent Loop ---
      while (needContinueConversation) {
        if (abortController.signal.aborted) {
          console.log('Agent loop aborted for event:', eventId)
          break
        }

        if (toolCallCount >= MAX_TOOL_CALLS) {
          console.warn('Maximum tool call limit reached for event:', eventId)
          yield {
            type: 'response',
            data: {
              eventId,
              maximum_tool_calls_reached: true
            }
          }

          break
        }

        needContinueConversation = false

        // Prepare for LLM call
        let currentContent = ''
        // let currentReasoning = ''
        const currentToolCalls: Array<{
          id: string
          name: string
          arguments: string
        }> = []
        const currentToolChunks: Record<string, { name: string; arguments_chunk: string }> = {}

        try {
          console.log(`[Agent Loop] Iteration ${toolCallCount + 1} for event: ${eventId}`)
          const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
          const canExecute = this.options.rateLimitManager.canExecuteImmediately(providerId)
          if (!canExecute) {
            const config = this.options.rateLimitManager.getProviderRateLimitConfig(providerId)
            const currentQps = this.options.rateLimitManager.getCurrentQps(providerId)
            const queueLength = this.options.rateLimitManager.getQueueLength(providerId)

            yield {
              type: 'response',
              data: {
                eventId,
                rate_limit: {
                  providerId,
                  qpsLimit: config.qpsLimit,
                  currentQps,
                  queueLength,
                  estimatedWaitTime: Math.max(0, 1000 - (Date.now() % 1000))
                }
              }
            }

            await this.options.rateLimitManager.executeWithRateLimit(providerId)
          } else {
            await this.options.rateLimitManager.executeWithRateLimit(providerId)
          }

          // Call the provider's core stream method, expecting LLMCoreStreamEvent
          const stream = provider.coreStream(
            conversationMessages,
            modelId,
            modelConfig,
            temperature,
            maxTokens,
            mcpTools
          )

          // Process the standardized stream events
          for await (const chunk of stream) {
            if (abortController.signal.aborted) {
              break
            }
            // console.log('presenter chunk', JSON.stringify(chunk), currentContent)

            // --- Event Handling (using LLMCoreStreamEvent structure) ---
            switch (chunk.type) {
              case 'text':
                if (chunk.content) {
                  currentContent += chunk.content
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      content: chunk.content
                    }
                  }
                }
                break
              case 'reasoning':
                if (chunk.reasoning_content) {
                  // currentReasoning += chunk.reasoning_content
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      reasoning_content: chunk.reasoning_content
                    }
                  }
                }
                break
              case 'tool_call_start':
                if (chunk.tool_call_id && chunk.tool_call_name) {
                  currentToolChunks[chunk.tool_call_id] = {
                    name: chunk.tool_call_name,
                    arguments_chunk: ''
                  }
                  // Immediately send the start event to indicate the tool call has begun
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'start',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: chunk.tool_call_name,
                      tool_call_params: '' // Initial parameters are empty
                    }
                  }
                }
                break
              case 'tool_call_chunk':
                if (
                  chunk.tool_call_id &&
                  currentToolChunks[chunk.tool_call_id] &&
                  chunk.tool_call_arguments_chunk
                ) {
                  currentToolChunks[chunk.tool_call_id].arguments_chunk +=
                    chunk.tool_call_arguments_chunk

                  // Send update event to update parameter content in real-time
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'update',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: currentToolChunks[chunk.tool_call_id].name,
                      tool_call_params: currentToolChunks[chunk.tool_call_id].arguments_chunk
                    }
                  }
                }
                break
              case 'tool_call_end':
                if (chunk.tool_call_id && currentToolChunks[chunk.tool_call_id]) {
                  const completeArgs =
                    chunk.tool_call_arguments_complete ??
                    currentToolChunks[chunk.tool_call_id].arguments_chunk
                  currentToolCalls.push({
                    id: chunk.tool_call_id,
                    name: currentToolChunks[chunk.tool_call_id].name,
                    arguments: completeArgs
                  })

                  // Send final update event to ensure parameter completeness
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'update',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: currentToolChunks[chunk.tool_call_id].name,
                      tool_call_params: completeArgs
                    }
                  }

                  delete currentToolChunks[chunk.tool_call_id]
                }
                break
              case 'usage':
                if (chunk.usage) {
                  // console.log('usage', chunk.usage, totalUsage)
                  totalUsage.prompt_tokens += chunk.usage.prompt_tokens
                  totalUsage.completion_tokens += chunk.usage.completion_tokens
                  totalUsage.total_tokens += chunk.usage.total_tokens
                  totalUsage.context_length = modelConfig.contextLength
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      totalUsage: { ...totalUsage } // Yield accumulated usage
                    }
                  }
                }
                break
              case 'image_data':
                if (chunk.image_data) {
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      image_data: chunk.image_data
                    }
                  }

                  currentContent += `\n[Image data received: ${chunk.image_data.mimeType}]\n`
                }
                break
              case 'error':
                console.error(`Provider stream error for event ${eventId}:`, chunk.error_message)
                yield {
                  type: 'error',
                  data: {
                    eventId,
                    error: chunk.error_message || 'Provider stream error'
                  }
                }

                needContinueConversation = false
                break // Break inner loop on provider error
              case 'rate_limit':
                if (chunk.rate_limit) {
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      rate_limit: chunk.rate_limit
                    }
                  }
                }
                break
              case 'stop':
                console.log(
                  `Provider stream stopped for event ${eventId}. Reason: ${chunk.stop_reason}`
                )
                if (chunk.stop_reason === 'tool_use') {
                  // Consolidate any remaining tool call chunks
                  for (const id in currentToolChunks) {
                    currentToolCalls.push({
                      id: id,
                      name: currentToolChunks[id].name,
                      arguments: currentToolChunks[id].arguments_chunk
                    })
                  }

                  if (currentToolCalls.length > 0) {
                    needContinueConversation = true
                  } else {
                    console.warn(
                      `Stop reason was 'tool_use' but no tool calls were fully parsed for event ${eventId}.`
                    )
                    needContinueConversation = false // Don't continue if no tools parsed
                  }
                } else {
                  needContinueConversation = false
                }
                // Stop event itself doesn't need to be yielded here, handled by loop logic
                break
            }
          } // End of inner loop (for await...of stream)

          if (abortController.signal.aborted) break // Break outer loop if aborted

          // --- Post-Stream Processing ---

          // 1. Add Assistant Message
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: currentContent
          }
          // Only add if there's content or tool calls are expected
          if (currentContent || (needContinueConversation && currentToolCalls.length > 0)) {
            conversationMessages.push(assistantMessage)
          }

          // 2. Execute Tool Calls if needed
          if (needContinueConversation && currentToolCalls.length > 0) {
            for (const toolCall of currentToolCalls) {
              if (abortController.signal.aborted) break // Check before each tool call

              if (toolCallCount >= MAX_TOOL_CALLS) {
                console.warn('Max tool calls reached during execution phase for event:', eventId)
                yield {
                  type: 'response',
                  data: {
                    eventId,
                    maximum_tool_calls_reached: true,
                    tool_call_id: toolCall.id,
                    tool_call_name: toolCall.name
                  }
                }

                needContinueConversation = false
                break
              }

              toolCallCount++

              // Find the tool definition to get server info
              const toolDef = (
                await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
              ).find((t) => t.function.name === toolCall.name)

              if (!toolDef) {
                console.error(`Tool definition not found for ${toolCall.name}. Skipping execution.`)
                const errorMsg = `Tool definition for ${toolCall.name} not found.`
                yield {
                  type: 'response',
                  data: {
                    eventId,
                    tool_call: 'error',
                    tool_call_id: toolCall.id,
                    tool_call_name: toolCall.name,
                    tool_call_response: errorMsg
                  }
                }

                // Add error message to conversation history for the LLM
                conversationMessages.push({
                  role: 'user', // or 'tool' with error content? Let's use user for now.
                  content: `Error: ${errorMsg}`
                })
                continue // Skip to next tool call
              }

              // Prepare MCPToolCall object for callTool
              const mcpToolInput: MCPToolCall = {
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments
                },
                server: toolDef.server
              }

              // Yield tool start event
              yield {
                type: 'response',
                data: {
                  eventId,
                  tool_call: 'running',
                  tool_call_id: toolCall.id,
                  tool_call_name: toolCall.name,
                  tool_call_params: toolCall.arguments,
                  tool_call_server_name: toolDef.server.name,
                  tool_call_server_icons: toolDef.server.icons,
                  tool_call_server_description: toolDef.server.description
                }
              }

              try {
                // Execute the tool via McpPresenter
                const toolResponse = await presenter.mcpPresenter.callTool(mcpToolInput)

                if (abortController.signal.aborted) break // Check after tool call returns

                // Check if permission is required
                if (toolResponse.rawData.requiresPermission) {
                  console.log(
                    `[Agent Loop] Permission required for tool ${toolCall.name}, creating permission request`
                  )

                  // Yield permission request event
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'permission-required',
                      tool_call_id: toolCall.id,
                      tool_call_name: toolCall.name,
                      tool_call_params: toolCall.arguments,
                      tool_call_server_name: toolResponse.rawData.permissionRequest?.serverName,
                      tool_call_server_icons: toolDef.server.icons,
                      tool_call_server_description: toolDef.server.description,
                      tool_call_response: toolResponse.content,
                      permission_request: toolResponse.rawData.permissionRequest
                    }
                  }

                  // End the agent loop here - permission handling will trigger a new agent loop
                  console.log(
                    `[Agent Loop] Ending agent loop for permission request, event: ${eventId}`
                  )
                  needContinueConversation = false
                  break
                }

                // Add tool call and response to conversation history for the next LLM iteration
                const supportsFunctionCall = modelConfig?.functionCall || false

                if (supportsFunctionCall) {
                  // Native Function Calling:
                  // Add original tool call message from assistant
                  const lastAssistantMsg = conversationMessages.findLast(
                    (m) => m.role === 'assistant'
                  )
                  if (lastAssistantMsg) {
                    if (!lastAssistantMsg.tool_calls) lastAssistantMsg.tool_calls = []
                    lastAssistantMsg.tool_calls.push({
                      function: {
                        arguments: toolCall.arguments,
                        name: toolCall.name
                      },
                      id: toolCall.id,
                      type: 'function'
                    })
                  } else {
                    // Should not happen if we added assistant message earlier, but as fallback:
                    conversationMessages.push({
                      role: 'assistant',
                      tool_calls: [
                        {
                          function: {
                            arguments: toolCall.arguments,
                            name: toolCall.name
                          },
                          id: toolCall.id,
                          type: 'function'
                        }
                      ]
                    })
                  }

                  // Add tool role message with result
                  conversationMessages.push({
                    role: 'tool',
                    content:
                      typeof toolResponse.content === 'string'
                        ? toolResponse.content
                        : JSON.stringify(toolResponse.content),
                    tool_call_id: toolCall.id
                  })

                  // Yield the 'end' event for ThreadPresenter
                  // ThreadPresenter needs this event to update the structured message state (DB/UI).
                  // Yield tool end event with response
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'end',
                      tool_call_id: toolCall.id,
                      tool_call_response:
                        typeof toolResponse.content === 'string'
                          ? toolResponse.content
                          : JSON.stringify(toolResponse.content), // Simplified content for UI
                      tool_call_name: toolCall.name,
                      tool_call_params: toolCall.arguments, // Original params
                      tool_call_server_name: toolDef.server.name,
                      tool_call_server_icons: toolDef.server.icons,
                      tool_call_server_description: toolDef.server.description,
                      tool_call_response_raw: toolResponse.rawData // Full raw data
                    }
                  }
                } else {
                  // Non-native FC: Add tool execution record to conversation history for next LLM turn.

                  // 1. Format tool execution record (including the function calling request & response) into prompt-defined text.
                  const formattedToolRecordText = `<function_call>${JSON.stringify({ function_call_record: { name: toolCall.name, arguments: toolCall.arguments, response: toolResponse.content } })}</function_call>`

                  // 2. Add a role: 'assistant' message to conversationMessages (containing the full record text).
                  // Find or create the last assistant message to append the record text
                  let lastAssistantMessage = conversationMessages.findLast(
                    (m) => m.role === 'assistant'
                  )

                  if (lastAssistantMessage) {
                    // Append formatted record text to the existing assistant message's content
                    if (typeof lastAssistantMessage.content === 'string') {
                      lastAssistantMessage.content += formattedToolRecordText + '\n'
                    } else if (Array.isArray(lastAssistantMessage.content)) {
                      lastAssistantMessage.content.push({
                        type: 'text',
                        text: formattedToolRecordText + '\n'
                      })
                    } else {
                      // If content is undefined or null, set it as an array with the new text part
                      lastAssistantMessage.content = [
                        { type: 'text', text: formattedToolRecordText + '\n' }
                      ]
                    }
                  } else {
                    // Create a new assistant message just for the tool record feedback
                    conversationMessages.push({
                      role: 'assistant',
                      content: [{ type: 'text', text: formattedToolRecordText + '\n' }] // Content should be an array for multi-part messages
                    })
                    lastAssistantMessage = conversationMessages[conversationMessages.length - 1] // Update lastAssistantMessage reference
                  }

                  // 3. Add a role: 'user' message to conversationMessages (containing prompt text).
                  const userPromptText =
                    '以上是你刚执行的工具调用及其响应信息，已帮你插入，请仔细阅读工具响应，并继续你的回答。'
                  conversationMessages.push({
                    role: 'user',
                    content: [{ type: 'text', text: userPromptText }] // Content should be an array
                  })

                  // Yield tool end event for ThreadPresenter to save the result
                  // This event is separate from the messages added to conversationMessages.
                  // ThreadPresenter uses this to save the raw result into the structured Assistant message block in DB.
                  yield {
                    type: 'response', // Still a response event, but indicates tool execution ended
                    data: {
                      eventId,
                      tool_call: 'end', // Indicate tool execution ended
                      tool_call_id: toolCall.id,
                      tool_call_response: toolResponse.content, // Simplified content for UI/ThreadPresenter
                      tool_call_name: toolCall.name,
                      tool_call_params: toolCall.arguments, // Original params
                      tool_call_server_name: toolDef.server.name,
                      tool_call_server_icons: toolDef.server.icons,
                      tool_call_server_description: toolDef.server.description,
                      tool_call_response_raw: toolResponse.rawData // Full raw data for ThreadPresenter to store
                    }
                  }
                }
              } catch (toolError) {
                if (abortController.signal.aborted) break // Check after tool error

                console.error(
                  `Tool execution error for ${toolCall.name} (event ${eventId}):`,
                  toolError
                )
                const errorMessage =
                  toolError instanceof Error ? toolError.message : String(toolError)

                const supportsFunctionCallInAgent = modelConfig?.functionCall || false
                if (supportsFunctionCallInAgent) {
                  // Native FC Error Handling: Add role: 'tool' message with error
                  conversationMessages.push({
                    role: 'tool',
                    content: `The tool call with ID ${toolCall.id} and name ${toolCall.name} failed to execute: ${errorMessage}`,
                    tool_call_id: toolCall.id
                  })

                  // Yield the 'error' event for ThreadPresenter
                  yield {
                    type: 'response', // Still a response event, but indicates tool error
                    data: {
                      eventId,
                      tool_call: 'error', // Indicate tool execution error
                      tool_call_id: toolCall.id,
                      tool_call_name: toolCall.name,
                      tool_call_params: toolCall.arguments,
                      tool_call_response: errorMessage, // Error message as response
                      tool_call_server_name: toolDef.server.name,
                      tool_call_server_icons: toolDef.server.icons,
                      tool_call_server_description: toolDef.server.description
                    }
                  }
                } else {
                  // Non-native FC Error Handling: Add error to Assistant content and add User prompt.

                  // 1. Construct error text
                  const formattedErrorText = `编号为 ${toolCall.id} 的工具 ${toolCall.name} 调用执行失败: ${errorMessage}`

                  // 2. Add formattedErrorText to Assistant content
                  let lastAssistantMessage = conversationMessages.findLast(
                    (m) => m.role === 'assistant'
                  )
                  if (lastAssistantMessage) {
                    if (typeof lastAssistantMessage.content === 'string') {
                      lastAssistantMessage.content += '\n' + formattedErrorText + '\n'
                    } else if (Array.isArray(lastAssistantMessage.content)) {
                      lastAssistantMessage.content.push({
                        type: 'text',
                        text: '\n' + formattedErrorText + '\n'
                      })
                    } else {
                      lastAssistantMessage.content = [
                        { type: 'text', text: '\n' + formattedErrorText + '\n' }
                      ]
                    }
                  } else {
                    conversationMessages.push({
                      role: 'assistant',
                      content: [{ type: 'text', text: formattedErrorText + '\n' }]
                    })
                  }

                  // 3. Add a role: 'user' message (prompt text)
                  const userPromptText =
                    '以上是你刚调用的工具及其执行的错误信息，已帮你插入，请根据情况继续回答或重新尝试。'
                  conversationMessages.push({
                    role: 'user',
                    content: [{ type: 'text', text: userPromptText }]
                  })

                  // Yield the 'error' event for ThreadPresenter
                  yield {
                    type: 'response', // Still a response event, but indicates tool error
                    data: {
                      eventId,
                      tool_call: 'error', // Indicate tool execution error
                      tool_call_id: toolCall.id,
                      tool_call_name: toolCall.name,
                      tool_call_params: toolCall.arguments,
                      tool_call_response: errorMessage, // Error message as response
                      tool_call_server_name: toolDef.server.name,
                      tool_call_server_icons: toolDef.server.icons,
                      tool_call_server_description: toolDef.server.description
                    }
                  }
                  // Decide if the loop should continue after a tool error.
                  // For now, let's assume it should try to continue if possible.
                  // needContinueConversation might need adjustment based on error type.
                }
              }
            } // End of tool execution loop

            if (abortController.signal.aborted) break // Check after tool loop

            if (!needContinueConversation) {
              // If max tool calls reached or explicit stop, break outer loop
              break
            }
          } else {
            // No tool calls needed or requested, end the loop
            needContinueConversation = false
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            console.log(`Agent loop aborted during inner try-catch for event ${eventId}`)
            break // Break outer loop if aborted here
          }
          console.error(`Agent loop inner error for event ${eventId}:`, error)
          yield {
            type: 'error',
            data: {
              eventId,
              error: error instanceof Error ? error.message : String(error)
            }
          }

          needContinueConversation = false // Stop loop on inner error
        }
      } // --- End of Agent Loop (while) ---

      console.log(
        `[Agent Loop] Agent loop completed for event: ${eventId}, iterations: ${toolCallCount}`
      )
    } catch (error) {
      // Catch errors from the generator setup phase (before the loop)
      if (abortController.signal.aborted) {
        console.log(`Agent loop aborted during outer try-catch for event ${eventId}`)
      } else {
        console.error(`Agent loop outer error for event ${eventId}:`, error)
        yield {
          type: 'error',
          data: {
            eventId,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      }
    } finally {
      // Finalize stream regardless of how the loop ended (completion, error, abort)
      const userStop = abortController.signal.aborted
      if (!userStop) {
        // Yield final aggregated usage if not aborted
        yield {
          type: 'response',
          data: {
            eventId,
            totalUsage
          }
        }
      }
      // Yield the final END event
      yield { type: 'end', data: { eventId, userStop } }

      this.options.activeStreams.delete(eventId)
      console.log('Agent loop finished for event:', eventId, 'User stopped:', userStop)
    }
  }
}
