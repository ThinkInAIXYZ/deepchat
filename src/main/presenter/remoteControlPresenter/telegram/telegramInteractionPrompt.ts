import type {
  RemotePendingInteraction,
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup
} from '../types'
import {
  buildPendingInteractionAllowCallbackData,
  buildPendingInteractionDenyCallbackData,
  buildPendingInteractionOptionCallbackData,
  buildPendingInteractionOtherCallbackData
} from '../types'

const chunkButtons = (
  buttons: TelegramInlineKeyboardButton[],
  rowSize: number
): TelegramInlineKeyboardButton[][] => {
  const rows: TelegramInlineKeyboardButton[][] = []
  for (let index = 0; index < buttons.length; index += rowSize) {
    rows.push(buttons.slice(index, index + rowSize))
  }
  return rows
}

const formatPermissionBody = (interaction: RemotePendingInteraction): string => {
  const permission = interaction.permission
  const lines = ['Permission Required']

  if (permission?.permissionType) {
    lines.push(`Type: ${permission.permissionType}`)
  }

  if (interaction.toolName) {
    lines.push(`Tool: ${interaction.toolName}`)
  }

  const command = permission?.command || permission?.commandInfo?.command || ''
  if (command) {
    lines.push(`Command: ${command}`)
  } else if (interaction.toolArgs.trim()) {
    lines.push(`Arguments: ${interaction.toolArgs.trim()}`)
  }

  if (permission?.serverName) {
    lines.push(`Server: ${permission.serverName}`)
  }

  if (permission?.description?.trim()) {
    lines.push('')
    lines.push(permission.description.trim())
  }

  lines.push('')
  lines.push('Tap a button or reply with ALLOW / DENY.')
  return lines.join('\n')
}

const formatQuestionBody = (interaction: RemotePendingInteraction): string => {
  const question = interaction.question
  const lines = ['Question']

  if (question?.header?.trim()) {
    lines.push(question.header.trim())
  }

  lines.push(question?.question?.trim() || interaction.toolName || 'Answer required')

  if (question?.options?.length) {
    lines.push('')
    lines.push(
      ...question.options.map((option, index) =>
        option.description?.trim()
          ? `${index + 1}. ${option.label} - ${option.description.trim()}`
          : `${index + 1}. ${option.label}`
      )
    )
  }

  lines.push('')
  if (question?.multiple) {
    lines.push('Reply with your answer in plain text.')
  } else if (question?.custom !== false) {
    lines.push('Tap an option, or reply with the option number / label / your own answer.')
  } else {
    lines.push('Tap an option, or reply with the option number / exact label.')
  }

  return lines.join('\n')
}

export const buildTelegramPendingInteractionPrompt = (
  interaction: RemotePendingInteraction,
  token: string
): {
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
} => {
  if (interaction.type === 'permission') {
    return {
      text: formatPermissionBody(interaction),
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: 'Allow',
              callback_data: buildPendingInteractionAllowCallbackData(token)
            },
            {
              text: 'Deny',
              callback_data: buildPendingInteractionDenyCallbackData(token)
            }
          ]
        ]
      }
    }
  }

  const question = interaction.question
  if (!question) {
    return {
      text: formatQuestionBody(interaction)
    }
  }

  if (question.multiple) {
    return {
      text: formatQuestionBody(interaction)
    }
  }

  const optionButtons = chunkButtons(
    question.options.map((option, index) => ({
      text: option.label,
      callback_data: buildPendingInteractionOptionCallbackData(token, index)
    })),
    2
  )

  if (question.custom !== false) {
    optionButtons.push([
      {
        text: 'Other',
        callback_data: buildPendingInteractionOtherCallbackData(token)
      }
    ])
  }

  return {
    text: formatQuestionBody(interaction),
    ...(optionButtons.length ? { replyMarkup: { inline_keyboard: optionButtons } } : {})
  }
}

export const buildTelegramInteractionResolvedText = (params: {
  interaction: RemotePendingInteraction
  responseText: string
  waitingForUserMessage?: boolean
}): string => {
  if (params.waitingForUserMessage) {
    return 'Reply with your answer in a new message.'
  }

  return [
    params.interaction.type === 'permission' ? 'Permission handled.' : 'Answer recorded.',
    params.responseText.trim()
  ]
    .filter(Boolean)
    .join('\n')
}
