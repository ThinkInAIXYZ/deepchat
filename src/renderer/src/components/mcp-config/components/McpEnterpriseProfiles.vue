<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { nanoid } from 'nanoid'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Spinner } from '@shadcn/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import type { McpEnterpriseIdentityProfile, McpEnterpriseIdentityStatus } from '@shared/types/mcp'
import { createMcpClient } from '@api/McpClient'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

const { t } = useI18n()
const mcpClient = createMcpClient()

const isOpen = ref(false)
const isLoading = ref(false)
const isSaving = ref(false)
const profiles = ref<McpEnterpriseIdentityProfile[]>([])
const statuses = ref<Record<string, McpEnterpriseIdentityStatus>>({})
const editingProfile = ref<McpEnterpriseIdentityProfile | null>(null)
const clientSecret = ref('')
const callbackProfileId = ref('')
const callbackUrl = ref('')
const pendingRemove = ref<McpEnterpriseIdentityProfile | null>(null)
let unsubscribe: (() => void) | undefined

const blankProfile = (): McpEnterpriseIdentityProfile => ({
  id: `enterprise-${nanoid(10)}`,
  label: '',
  issuer: '',
  clientId: '',
  scopes: ['openid'],
  clientAuthentication: 'none'
})

const loadProfiles = async (): Promise<void> => {
  isLoading.value = true
  try {
    profiles.value = await mcpClient.listEnterpriseProfiles()
    const entries = await Promise.all(
      profiles.value.map(
        async (profile) =>
          [profile.id, await mcpClient.getEnterpriseProfileStatus(profile.id)] as const
      )
    )
    statuses.value = Object.fromEntries(entries)
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.enterpriseProfiles.loadError',
      title: t('settings.mcp.enterpriseProfiles.loadError'),
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    isLoading.value = false
  }
}

const startCreate = (): void => {
  editingProfile.value = blankProfile()
  clientSecret.value = ''
}

const startEdit = (profile: McpEnterpriseIdentityProfile): void => {
  editingProfile.value = {
    ...profile,
    scopes: [...profile.scopes]
  }
  clientSecret.value = ''
}

const saveProfile = async (): Promise<void> => {
  const draft = editingProfile.value
  if (!draft || isSaving.value) return
  isSaving.value = true
  try {
    const saved = await mcpClient.saveEnterpriseProfile({
      ...draft,
      scopes: Array.from(
        new Set(
          draft.scopes
            .flatMap((scope) => scope.split(/[\s,]+/))
            .map((scope) => scope.trim())
            .filter(Boolean)
        )
      )
    })
    if (saved.clientAuthentication === 'client_secret' && clientSecret.value) {
      statuses.value[saved.id] = await mcpClient.setEnterpriseProfileClientSecret(
        saved.id,
        clientSecret.value
      )
    }
    editingProfile.value = null
    clientSecret.value = ''
    await loadProfiles()
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.enterpriseProfiles.saveError',
      title: t('settings.mcp.enterpriseProfiles.saveError'),
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    isSaving.value = false
  }
}

const startAuth = async (profileId: string): Promise<void> => {
  try {
    const status = await mcpClient.startEnterpriseProfileAuth(profileId)
    statuses.value[profileId] = status
    if (!status.authenticated) {
      callbackProfileId.value = profileId
      callbackUrl.value = ''
    }
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.enterpriseProfiles.authError',
      title: t('settings.mcp.enterpriseProfiles.authError'),
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

const completeAuth = async (): Promise<void> => {
  if (!callbackProfileId.value || !callbackUrl.value.trim()) return
  try {
    const status = await mcpClient.completeEnterpriseProfileAuth(
      callbackProfileId.value,
      callbackUrl.value.trim()
    )
    statuses.value[callbackProfileId.value] = status
    if (status.authenticated) {
      callbackProfileId.value = ''
      callbackUrl.value = ''
    }
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.enterpriseProfiles.authError',
      title: t('settings.mcp.enterpriseProfiles.authError'),
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

const logout = async (profileId: string): Promise<void> => {
  statuses.value[profileId] = await mcpClient.logoutEnterpriseProfile(profileId)
}

const removeProfile = async (): Promise<void> => {
  const profile = pendingRemove.value
  if (!profile) return
  try {
    await mcpClient.removeEnterpriseProfile(profile.id)
    pendingRemove.value = null
    await loadProfiles()
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.enterpriseProfiles.removeError',
      title: t('settings.mcp.enterpriseProfiles.removeError'),
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

onMounted(() => {
  unsubscribe = mcpClient.onEnterpriseAuthChanged(({ status }) => {
    statuses.value[status.profileId] = status
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <Dialog v-model:open="isOpen" @update:open="(open) => open && loadProfiles()">
    <DialogTrigger as-child>
      <Button variant="outline" size="sm" class="h-8 px-3 text-xs">
        <Icon icon="lucide:building-2" class="mr-1.5 size-3" />
        {{ t('settings.mcp.enterpriseProfiles.title') }}
      </Button>
    </DialogTrigger>
    <DialogContent class="flex h-[80vh] max-h-[680px] w-[95vw] max-w-[620px] flex-col">
      <DialogHeader>
        <DialogTitle>{{ t('settings.mcp.enterpriseProfiles.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.mcp.enterpriseProfiles.description') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="isLoading" class="flex flex-1 items-center justify-center">
        <Spinner class="size-5" />
      </div>

      <form
        v-else-if="editingProfile"
        class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
        @submit.prevent="saveProfile"
      >
        <div class="space-y-2">
          <Label for="enterprise-profile-label">
            {{ t('settings.mcp.enterpriseProfiles.label') }}
          </Label>
          <Input id="enterprise-profile-label" v-model="editingProfile.label" required />
        </div>
        <div class="space-y-2">
          <Label for="enterprise-profile-issuer">
            {{ t('settings.mcp.enterpriseProfiles.issuer') }}
          </Label>
          <Input
            id="enterprise-profile-issuer"
            v-model="editingProfile.issuer"
            placeholder="https://id.example.com"
            required
          />
        </div>
        <div class="space-y-2">
          <Label for="enterprise-profile-client-id">
            {{ t('settings.mcp.enterpriseProfiles.clientId') }}
          </Label>
          <Input id="enterprise-profile-client-id" v-model="editingProfile.clientId" required />
        </div>
        <div class="space-y-2">
          <Label for="enterprise-profile-scopes">
            {{ t('settings.mcp.enterpriseProfiles.scopes') }}
          </Label>
          <Input
            id="enterprise-profile-scopes"
            :model-value="editingProfile.scopes.join(' ')"
            @update:model-value="editingProfile.scopes = String($event).split(/[\s,]+/)"
          />
        </div>
        <div class="space-y-2">
          <Label for="enterprise-profile-client-auth">
            {{ t('settings.mcp.enterpriseProfiles.clientAuthentication') }}
          </Label>
          <Select v-model="editingProfile.clientAuthentication">
            <SelectTrigger id="enterprise-profile-client-auth">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {{ t('settings.mcp.enterpriseProfiles.publicClient') }}
              </SelectItem>
              <SelectItem value="client_secret">
                {{ t('settings.mcp.enterpriseProfiles.confidentialClient') }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div v-if="editingProfile.clientAuthentication === 'client_secret'" class="space-y-2">
          <Label for="enterprise-profile-secret">
            {{ t('settings.mcp.enterpriseProfiles.clientSecret') }}
          </Label>
          <Input
            id="enterprise-profile-secret"
            v-model="clientSecret"
            type="password"
            autocomplete="new-password"
            :placeholder="
              statuses[editingProfile.id]?.clientSecretConfigured
                ? t('settings.mcp.serverForm.credentialConfiguredPlaceholder')
                : ''
            "
          />
        </div>
        <div class="mt-auto flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" @click="editingProfile = null">
            {{ t('common.cancel') }}
          </Button>
          <Button type="submit" :disabled="isSaving">
            <Spinner v-if="isSaving" data-icon="inline-start" />
            {{ t('common.save') }}
          </Button>
        </div>
      </form>

      <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex justify-end">
          <Button size="sm" @click="startCreate">
            <Icon icon="lucide:plus" class="size-4" />
            {{ t('common.add') }}
          </Button>
        </div>

        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <div v-for="profile in profiles" :key="profile.id" class="rounded-md border p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-medium">{{ profile.label }}</div>
                <div class="truncate text-xs text-muted-foreground">{{ profile.issuer }}</div>
                <div class="mt-1 text-xs">
                  {{
                    statuses[profile.id]?.authenticated
                      ? statuses[profile.id]?.subjectLabel ||
                        t('settings.mcp.enterpriseProfiles.authenticated')
                      : t(
                          `settings.mcp.enterpriseProfiles.status.${
                            statuses[profile.id]?.state || 'signed_out'
                          }`
                        )
                  }}
                </div>
                <div
                  v-if="
                    profile.clientAuthentication === 'client_secret' &&
                    !statuses[profile.id]?.clientSecretConfigured
                  "
                  class="mt-1 text-xs text-destructive"
                >
                  {{ t('settings.mcp.enterpriseProfiles.clientSecretMissing') }}
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <Button
                  v-if="statuses[profile.id]?.authenticated"
                  variant="outline"
                  size="sm"
                  @click="logout(profile.id)"
                >
                  {{ t('settings.mcp.enterpriseProfiles.signOut') }}
                </Button>
                <Button
                  v-else
                  size="sm"
                  :disabled="
                    profile.clientAuthentication === 'client_secret' &&
                    !statuses[profile.id]?.clientSecretConfigured
                  "
                  @click="startAuth(profile.id)"
                >
                  {{ t('settings.mcp.enterpriseProfiles.signIn') }}
                </Button>
                <Button variant="ghost" size="icon" @click="startEdit(profile)">
                  <Icon icon="lucide:pencil" class="size-4" />
                </Button>
                <Button variant="ghost" size="icon" @click="pendingRemove = profile">
                  <Icon icon="lucide:trash-2" class="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          </div>
          <div v-if="profiles.length === 0" class="py-10 text-center text-sm text-muted-foreground">
            {{ t('settings.mcp.enterpriseProfiles.empty') }}
          </div>
        </div>

        <div v-if="callbackProfileId" class="space-y-2 rounded-md border p-3">
          <Label for="enterprise-callback-url">
            {{ t('settings.mcp.enterpriseProfiles.callbackUrl') }}
          </Label>
          <Input
            id="enterprise-callback-url"
            v-model="callbackUrl"
            :placeholder="t('settings.mcp.authCallbackPlaceholder')"
          />
          <div class="flex justify-end">
            <Button :disabled="!callbackUrl.trim()" @click="completeAuth">
              {{ t('settings.mcp.completeAuthentication') }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog :open="Boolean(pendingRemove)" @update:open="(open) => !open && (pendingRemove = null)">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.mcp.enterpriseProfiles.removeTitle') }}</DialogTitle>
        <DialogDescription>
          {{
            t('settings.mcp.enterpriseProfiles.removeDescription', {
              name: pendingRemove?.label || ''
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="pendingRemove = null">
          {{ t('common.cancel') }}
        </Button>
        <Button variant="destructive" @click="removeProfile">
          {{ t('common.confirm') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
