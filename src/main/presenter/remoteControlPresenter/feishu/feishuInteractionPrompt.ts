import type { FeishuInteractiveCardPayload, RemotePendingInteraction } from '../types'

const createMarkdownBlock = (content: string): Record<string, unknown> => ({
  tag: 'markdown',
  content
})

const createDivider = (): Record<string, unknown> => ({
  tag: 'hr'
})

export const buildFeishuPendingInteractionText = (
  interaction: RemotePendingInteraction
): string => {
  if (interaction.type === 'permission') {
    const permission = interaction.permission
    const command = permission?.command || permission?.commandInfo?.command || ''
    return [
      'Permission Required',
      permission?.permissionType ? `Type: ${permission.permissionType}` : '',
      interaction.toolName ? `Tool: ${interaction.toolName}` : '',
      command
        ? `Command: ${command}`
        : interaction.toolArgs
          ? `Arguments: ${interaction.toolArgs}`
          : '',
      permission?.serverName ? `Server: ${permission.serverName}` : '',
      '',
      permission?.description?.trim() || '',
      '',
      'Reply with ALLOW or DENY.'
    ]
      .filter(Boolean)
      .join('\n')
  }

  const question = interaction.question
  return [
    'Question',
    question?.header?.trim() || '',
    question?.question?.trim() || interaction.toolName || 'Answer required',
    '',
    ...(question?.options?.map((option, index) =>
      option.description?.trim()
        ? `${index + 1}. ${option.label} - ${option.description.trim()}`
        : `${index + 1}. ${option.label}`
    ) ?? []),
    '',
    question?.multiple
      ? 'Reply with your answer in plain text.'
      : question?.custom !== false
        ? 'Reply with the option number / label / your own answer.'
        : 'Reply with the option number or exact label.'
  ]
    .filter(Boolean)
    .join('\n')
}

export const buildFeishuPendingInteractionCard = (
  interaction: RemotePendingInteraction
): FeishuInteractiveCardPayload => {
  const fallbackText = buildFeishuPendingInteractionText(interaction)
  const question = interaction.question
  const permission = interaction.permission
  const command = permission?.command || permission?.commandInfo?.command || ''

  const fields: string[] = []
  if (interaction.type === 'permission' && permission?.permissionType) {
    fields.push(`**Type:** ${permission.permissionType}`)
  }
  if (interaction.toolName) {
    fields.push(`**Tool:** ${interaction.toolName}`)
  }
  if (command) {
    fields.push(`**Command:** ${command}`)
  } else if (interaction.toolArgs.trim()) {
    fields.push(`**Arguments:** ${interaction.toolArgs.trim()}`)
  }
  if (permission?.serverName) {
    fields.push(`**Server:** ${permission.serverName}`)
  }

  const instructions =
    interaction.type === 'permission'
      ? 'Reply with `ALLOW` or `DENY`.'
      : question?.multiple
        ? 'Reply in plain text with your answer.'
        : question?.custom !== false
          ? 'Reply with the option number, exact label, or your own answer.'
          : 'Reply with the option number or exact label.'

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true
    },
    header: {
      title: {
        tag: 'plain_text',
        content: interaction.type === 'permission' ? 'Permission Required' : 'Question'
      },
      template: interaction.type === 'permission' ? 'orange' : 'blue'
    },
    elements: [
      ...(fields.length ? [createMarkdownBlock(fields.join('\n'))] : []),
      ...(interaction.type === 'permission' && permission?.description?.trim()
        ? [createDivider(), createMarkdownBlock(permission.description.trim())]
        : []),
      ...(interaction.type === 'question'
        ? [
            ...(question?.header?.trim()
              ? [createMarkdownBlock(`**${question.header.trim()}**`)]
              : []),
            createMarkdownBlock(question?.question?.trim() || 'Answer required'),
            ...(question?.options?.length
              ? [
                  createDivider(),
                  createMarkdownBlock(
                    question.options
                      .map((option, index) =>
                        option.description?.trim()
                          ? `${index + 1}. ${option.label} - ${option.description.trim()}`
                          : `${index + 1}. ${option.label}`
                      )
                      .join('\n')
                  )
                ]
              : [])
          ]
        : []),
      createDivider(),
      createMarkdownBlock(instructions),
      createMarkdownBlock(`\`\`\`\n${fallbackText}\n\`\`\``)
    ]
  }
}
