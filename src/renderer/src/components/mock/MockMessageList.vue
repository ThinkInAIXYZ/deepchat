<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div v-for="msg in messages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" class="flex justify-end mb-6">
          <div class="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5">
            <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>
          </div>
        </div>

        <!-- Assistant message -->
        <div v-else class="flex gap-3 mb-6">
          <div class="shrink-0 mt-1">
            <div class="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
              <ModelIcon model-id="anthropic" custom-class="w-4 h-4" :is-dark="themeStore.isDark" />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted-foreground mb-1">Claude 4 Sonnet</p>
            <div class="text-sm leading-relaxed whitespace-pre-wrap">{{ msg.content }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ModelIcon from '../icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

const messages = [
  {
    id: '1',
    role: 'user',
    content:
      'I\'m getting a login error when users try to sign in with their Google account. The error says "invalid_grant" and it happens intermittently.'
  },
  {
    id: '2',
    role: 'assistant',
    content: `This is a common OAuth2 issue. The "invalid_grant" error typically occurs for a few reasons:

1. Expired refresh token — Google refresh tokens can expire if the user hasn't used your app in 6 months, or if you've exceeded the 50 token limit per user account.

2. Clock skew — If your server's clock is out of sync by more than a few minutes, token validation will fail.

3. Token already used — Refresh tokens are single-use by default. If a retry mechanism sends the same token twice, the second attempt will fail.

Can you share your OAuth configuration and the token refresh logic? That will help me narrow down the root cause.`
  },
  {
    id: '3',
    role: 'user',
    content: `Here's our auth setup:

const oauthConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  grantType: "refresh_token"
}`
  },
  {
    id: '4',
    role: 'assistant',
    content: `I can see a couple of potential issues:

First, you should add retry logic with a fresh token fetch on failure. The intermittent nature suggests it might be a race condition where multiple requests try to refresh the same token simultaneously.

Here's what I'd recommend:
• Add a token refresh mutex/lock to prevent concurrent refresh attempts
• Implement a retry mechanism that fetches a fresh token on "invalid_grant"
• Store the refresh token atomically to prevent stale reads

Second, make sure you're storing the new refresh token returned in each refresh response — Google rotates them on every use.

Want me to write the updated token refresh handler with these fixes?`
  },
  {
    id: '5',
    role: 'user',
    content: 'Yes please, that would be great.'
  },
  {
    id: '6',
    role: 'assistant',
    content: `Here's the updated token refresh handler with mutex locking and retry logic:

The key changes are:
• Added a refresh lock using a simple promise-based mutex to prevent concurrent refresh attempts
• On "invalid_grant" error, the handler invalidates the cached token and retries once with a fresh token
• New refresh tokens from the response are stored atomically before using the access token
• Added exponential backoff for transient network errors

This should resolve the intermittent failures. The mutex ensures that when multiple API calls trigger a refresh simultaneously, only the first one actually performs the refresh and the others wait for its result.

Let me know if you'd like me to also add logging to help debug any remaining issues.`
  }
]
</script>
