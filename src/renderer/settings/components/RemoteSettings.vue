<template>
  <ScrollArea class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-4 p-4">
      <div v-if="isLoading" class="text-sm text-muted-foreground">
        {{ t('common.loading') }}
      </div>
      <div
        v-else-if="
          !telegramSettings ||
          !telegramStatus ||
          !feishuSettings ||
          !feishuStatus ||
          !qqbotSettings ||
          !qqbotStatus
        "
        class="text-sm text-muted-foreground"
      >
        {{ t('common.error.requestFailed') }}
      </div>
      <template v-else>
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <div class="text-base font-medium">{{ t('settings.remote.title') }}</div>
            <span v-if="isAnySaving" class="text-xs text-muted-foreground">
              {{ t('common.saving') }}
            </span>
          </div>
          <div class="text-sm text-muted-foreground">
            {{ t('settings.remote.description') }}
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <div
            v-for="channel in implementedChannels"
            :key="channel"
            class="rounded-lg border bg-muted/20 p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="text-sm font-medium">
                  {{ t(`settings.remote.${channel}.title`) }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{
                    t(`settings.remote.status.states.${channelStatus(channel)?.state || 'stopped'}`)
                  }}
                </div>
              </div>
              <div class="flex flex-col items-end gap-2">
                <span
                  :class="[
                    'inline-flex rounded-full px-2 py-1 text-[11px]',
                    statusDotClass(channelStatus(channel)?.state || 'stopped')
                  ]"
                >
                  {{
                    t(`settings.remote.status.states.${channelStatus(channel)?.state || 'stopped'}`)
                  }}
                </span>
                <label class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{{
                    channelEnabled(channel) ? t('common.enabled') : t('common.disabled')
                  }}</span>
                  <Switch
                    :data-testid="`remote-overview-toggle-${channel}`"
                    :model-value="channelEnabled(channel)"
                    :disabled="saving[channel]"
                    @update:model-value="
                      (value) => updateChannelRemoteEnabled(channel, value === true)
                    "
                  />
                </label>
              </div>
            </div>
            <div class="mt-3 text-xs text-muted-foreground">
              {{ formatOverviewLine(channel) }}
            </div>
            <div
              v-if="channelStatus(channel)?.lastError"
              class="mt-2 break-all text-xs text-destructive"
            >
              {{ channelStatus(channel)?.lastError }}
            </div>
          </div>
        </div>

        <Tabs v-model="activeChannel" class="space-y-4">
          <TabsList
            class="grid w-full"
            :style="{ gridTemplateColumns: `repeat(${implementedChannelCount}, minmax(0, 1fr))` }"
          >
            <TabsTrigger
              v-for="channel in implementedChannels"
              :key="`remote-tab-${channel}`"
              :value="channel"
              :data-testid="`remote-tab-${channel}`"
              class="flex items-center gap-2"
            >
              <span
                :class="[
                  'h-2 w-2 rounded-full',
                  statusDotClass(channelStatus(channel)?.state || 'stopped', true)
                ]"
              ></span>
              {{ t(`settings.remote.${channel}.title`) }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="telegram" class="space-y-4">
            <div class="rounded-lg border">
              <div class="space-y-4 p-4">
                <div class="space-y-1">
                  <div class="text-base font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.telegram.description') }}
                  </p>
                </div>

                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.telegram.botToken') }}
                  </Label>
                  <div class="relative w-full">
                    <Input
                      v-model="telegramSettings.botToken"
                      :type="showBotToken ? 'text' : 'password'"
                      :placeholder="t('settings.remote.telegram.botTokenPlaceholder')"
                      class="pr-10"
                      @blur="queueTelegramSettingsPersist"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                      @click="showBotToken = !showBotToken"
                    >
                      <Icon
                        :icon="showBotToken ? 'lucide:eye-off' : 'lucide:eye'"
                        class="h-4 w-4 text-muted-foreground"
                      />
                    </Button>
                  </div>
                </div>

                <div class="rounded-md border bg-muted/30 p-3 text-sm">
                  <div class="font-medium">{{ t('settings.remote.status.title') }}</div>
                  <div class="mt-1 text-muted-foreground">
                    {{ formatStatusLine(telegramStatus) }}
                  </div>
                  <div v-if="telegramStatus.botUser" class="mt-1 text-muted-foreground">
                    {{
                      t('settings.remote.status.botUser', {
                        id: telegramStatus.botUser.id,
                        username: telegramStatus.botUser.username || 'unknown'
                      })
                    }}
                  </div>
                  <div class="mt-1 text-muted-foreground">
                    {{
                      t('settings.remote.status.bindings', {
                        count: telegramStatus.bindingCount,
                        pollOffset: telegramStatus.pollOffset
                      })
                    }}
                  </div>
                  <div v-if="telegramStatus.lastError" class="mt-2 break-all text-destructive">
                    {{ telegramStatus.lastError }}
                  </div>
                </div>
              </div>

              <div class="border-t p-4">
                <div class="mb-3 space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.remoteControl.description') }}
                  </p>
                </div>

                <div
                  v-if="telegramSettings.remoteEnabled"
                  data-testid="remote-control-details"
                  class="space-y-4"
                >
                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.remoteControl.allowedUserIds') }}
                      </Label>
                      <Input
                        data-testid="remote-allowed-user-ids-input"
                        v-model="telegramAllowedUserIdsText"
                        :placeholder="t('settings.remote.remoteControl.allowedUserIdsPlaceholder')"
                        @blur="queueTelegramSettingsPersist"
                      />
                    </div>

                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.remoteControl.defaultAgent') }}
                      </Label>
                      <Select
                        :model-value="telegramSettings.defaultAgentId"
                        @update:model-value="(value) => updateTelegramDefaultAgentId(String(value))"
                      >
                        <SelectTrigger data-testid="remote-default-agent-select" class="h-8!">
                          <SelectValue
                            :placeholder="
                              t('settings.remote.remoteControl.defaultAgentPlaceholder')
                            "
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="agent in defaultAgentOptions(telegramSettings.defaultAgentId)"
                            :key="agent.id"
                            :value="agent.id"
                          >
                            {{ agent.name }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button
                          data-testid="remote-default-workdir-input"
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs"
                          :title="telegramDefaultWorkdirTitle"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ telegramDefaultWorkdirLabel }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in telegramDirectoryOptions"
                          :key="project.path"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="selectDefaultWorkdir('telegram', project.path)"
                        >
                          <Icon
                            icon="lucide:folder"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <div class="min-w-0 flex-1">
                            <div class="truncate">{{ project.name }}</div>
                            <div class="truncate text-[10px] text-muted-foreground">
                              {{ project.path }}
                            </div>
                          </div>
                          <Icon
                            v-if="normalizePath(telegramSettings.defaultWorkdir) === project.path"
                            icon="lucide:check"
                            class="h-3.5 w-3.5 shrink-0"
                          />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          data-testid="remote-default-workdir-open-folder"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="pickDefaultWorkdir('telegram')"
                        >
                          <Icon
                            icon="lucide:folder-open"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>{{ t('common.project.openFolder') }}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          v-if="telegramSettings.defaultWorkdir"
                          data-testid="remote-default-workdir-clear"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="clearDefaultWorkdir('telegram')"
                        >
                          <Icon
                            icon="lucide:x"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>{{ t('common.clear') }}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      data-testid="remote-pair-button"
                      variant="outline"
                      size="sm"
                      @click="generatePairCodeAndOpenDialog('telegram')"
                    >
                      {{ t('settings.remote.remoteControl.openPairDialog') }}
                    </Button>
                    <Button
                      data-testid="remote-bindings-button"
                      variant="outline"
                      size="sm"
                      @click="openBindingsDialog('telegram')"
                    >
                      {{ t('settings.remote.remoteControl.manageBindings') }}
                    </Button>
                  </div>
                </div>
              </div>

              <div class="border-t p-4">
                <div class="mb-3 flex items-start justify-between gap-4">
                  <div class="flex-1">
                    <div class="text-sm font-medium">
                      {{ t('settings.remote.sections.notifications') }}
                    </div>
                    <p class="text-sm text-muted-foreground">
                      {{ t('settings.remote.hooks.description') }}
                    </p>
                  </div>
                  <Switch
                    :model-value="telegramSettings.hookNotifications.enabled"
                    @update:model-value="(value) => updateHookEnabled(value)"
                  />
                </div>

                <div
                  v-if="telegramSettings.hookNotifications.enabled"
                  data-testid="remote-hooks-details"
                  class="space-y-4"
                >
                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.hooks.chatId') }}
                      </Label>
                      <Input
                        v-model="telegramSettings.hookNotifications.chatId"
                        :placeholder="t('settings.remote.hooks.chatIdPlaceholder')"
                        @blur="queueTelegramSettingsPersist"
                      />
                    </div>
                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.hooks.threadId') }}
                      </Label>
                      <Input
                        v-model="telegramSettings.hookNotifications.threadId"
                        :placeholder="t('settings.remote.hooks.threadIdPlaceholder')"
                        @blur="queueTelegramSettingsPersist"
                      />
                    </div>
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.notificationsHooks.events.title') }}
                    </Label>
                    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label
                        v-for="eventName in eventNames"
                        :key="`remote-hook-${eventName}`"
                        class="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          :checked="telegramSettings.hookNotifications.events.includes(eventName)"
                          @update:checked="(value) => updateHookEvent(eventName, value === true)"
                        />
                        <span>{{ eventLabel(eventName) }}</span>
                      </label>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="telegramTesting"
                      @click="runTelegramHookTest"
                    >
                      <Icon
                        :icon="telegramTesting ? 'lucide:loader-2' : 'lucide:send'"
                        :class="['mr-1 h-4 w-4', telegramTesting && 'animate-spin']"
                      />
                      {{
                        telegramTesting
                          ? t('settings.notificationsHooks.test.testing')
                          : t('settings.notificationsHooks.test.button')
                      }}
                    </Button>
                  </div>

                  <div v-if="telegramTestResult" class="space-y-1 text-xs">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        :class="
                          telegramTestResult.success ? 'text-emerald-600' : 'text-destructive'
                        "
                      >
                        {{
                          telegramTestResult.success
                            ? t('settings.notificationsHooks.test.success')
                            : t('settings.notificationsHooks.test.failed')
                        }}
                      </span>
                      <span class="text-muted-foreground">
                        {{
                          t('settings.notificationsHooks.test.duration', {
                            ms: telegramTestResult.durationMs
                          })
                        }}
                      </span>
                      <span
                        v-if="telegramTestResult.statusCode !== undefined"
                        class="text-muted-foreground"
                      >
                        {{
                          t('settings.notificationsHooks.test.statusCode', {
                            code: telegramTestResult.statusCode
                          })
                        }}
                      </span>
                      <span v-if="telegramTestResult.retryAfterMs" class="text-muted-foreground">
                        {{
                          t('settings.notificationsHooks.test.retryAfter', {
                            ms: telegramTestResult.retryAfterMs
                          })
                        }}
                      </span>
                    </div>
                    <div v-if="telegramTestResult.error" class="break-all text-destructive">
                      {{ telegramTestResult.error }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="feishu" class="space-y-4">
            <div class="rounded-lg border">
              <div class="space-y-4 p-4">
                <div class="space-y-1">
                  <div class="text-base font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.feishu.description') }}
                  </p>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.feishu.appId') }}
                    </Label>
                    <Input
                      v-model="feishuSettings.appId"
                      :placeholder="t('settings.remote.feishu.appIdPlaceholder')"
                      @blur="queueFeishuSettingsPersist"
                    />
                  </div>
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.feishu.appSecret') }}
                    </Label>
                    <Input
                      v-model="feishuSettings.appSecret"
                      type="password"
                      :placeholder="t('settings.remote.feishu.appSecretPlaceholder')"
                      @blur="queueFeishuSettingsPersist"
                    />
                  </div>
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.feishu.verificationToken') }}
                    </Label>
                    <Input
                      v-model="feishuSettings.verificationToken"
                      :placeholder="t('settings.remote.feishu.verificationTokenPlaceholder')"
                      @blur="queueFeishuSettingsPersist"
                    />
                  </div>
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.feishu.encryptKey') }}
                    </Label>
                    <Input
                      v-model="feishuSettings.encryptKey"
                      :placeholder="t('settings.remote.feishu.encryptKeyPlaceholder')"
                      @blur="queueFeishuSettingsPersist"
                    />
                  </div>
                </div>

                <div class="rounded-md border bg-muted/30 p-3 text-sm">
                  <div class="font-medium">{{ t('settings.remote.status.title') }}</div>
                  <div class="mt-1 text-muted-foreground">
                    {{ formatStatusLine(feishuStatus) }}
                  </div>
                  <div v-if="feishuStatus.botUser" class="mt-1 text-muted-foreground">
                    {{
                      t('settings.remote.feishu.botUser', {
                        name: feishuStatus.botUser.name || 'unknown',
                        openId: feishuStatus.botUser.openId
                      })
                    }}
                  </div>
                  <div class="mt-1 text-muted-foreground">
                    {{
                      t('settings.remote.feishu.bindings', {
                        count: feishuStatus.bindingCount,
                        pairedUserCount: feishuStatus.pairedUserCount
                      })
                    }}
                  </div>
                  <div v-if="feishuStatus.lastError" class="mt-2 break-all text-destructive">
                    {{ feishuStatus.lastError }}
                  </div>
                </div>
              </div>

              <div class="border-t p-4">
                <div class="mb-3 space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.remoteControl.description') }}
                  </p>
                </div>

                <div
                  v-if="feishuSettings.remoteEnabled"
                  data-testid="feishu-remote-control-details"
                  class="space-y-4"
                >
                  <div
                    class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground"
                  >
                    <div>{{ t('settings.remote.feishu.accessRule1') }}</div>
                    <div class="mt-1">{{ t('settings.remote.feishu.accessRule2') }}</div>
                  </div>

                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.feishu.pairedUserOpenIds') }}
                      </Label>
                      <Input
                        v-model="feishuPairedUserOpenIdsText"
                        data-testid="remote-feishu-paired-user-open-ids-input"
                        :placeholder="t('settings.remote.feishu.pairedUserOpenIdsPlaceholder')"
                        @blur="queueFeishuSettingsPersist"
                      />
                    </div>

                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.remoteControl.defaultAgent') }}
                      </Label>
                      <Select
                        :model-value="feishuSettings.defaultAgentId"
                        @update:model-value="(value) => updateFeishuDefaultAgentId(String(value))"
                      >
                        <SelectTrigger class="h-8!">
                          <SelectValue
                            :placeholder="
                              t('settings.remote.remoteControl.defaultAgentPlaceholder')
                            "
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="agent in defaultAgentOptions(feishuSettings.defaultAgentId)"
                            :key="agent.id"
                            :value="agent.id"
                          >
                            {{ agent.name }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button
                          data-testid="remote-feishu-default-workdir-input"
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs"
                          :title="feishuDefaultWorkdirTitle"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ feishuDefaultWorkdirLabel }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in feishuDirectoryOptions"
                          :key="project.path"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="selectDefaultWorkdir('feishu', project.path)"
                        >
                          <Icon
                            icon="lucide:folder"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <div class="min-w-0 flex-1">
                            <div class="truncate">{{ project.name }}</div>
                            <div class="truncate text-[10px] text-muted-foreground">
                              {{ project.path }}
                            </div>
                          </div>
                          <Icon
                            v-if="normalizePath(feishuSettings.defaultWorkdir) === project.path"
                            icon="lucide:check"
                            class="h-3.5 w-3.5 shrink-0"
                          />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          data-testid="remote-feishu-default-workdir-open-folder"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="pickDefaultWorkdir('feishu')"
                        >
                          <Icon
                            icon="lucide:folder-open"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>{{ t('common.project.openFolder') }}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          v-if="feishuSettings.defaultWorkdir"
                          data-testid="remote-feishu-default-workdir-clear"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="clearDefaultWorkdir('feishu')"
                        >
                          <Icon
                            icon="lucide:x"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>{{ t('common.clear') }}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      data-testid="feishu-pair-button"
                      variant="outline"
                      size="sm"
                      @click="generatePairCodeAndOpenDialog('feishu')"
                    >
                      {{ t('settings.remote.remoteControl.openPairDialog') }}
                    </Button>
                    <Button
                      data-testid="feishu-bindings-button"
                      variant="outline"
                      size="sm"
                      @click="openBindingsDialog('feishu')"
                    >
                      {{ t('settings.remote.remoteControl.manageBindings') }}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="qqbot" class="space-y-4">
            <div class="rounded-lg border">
              <div class="space-y-4 p-4">
                <div class="space-y-1">
                  <div class="text-base font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.qqbot.description') }}
                  </p>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.qqbot.appId') }}
                    </Label>
                    <Input
                      v-model="qqbotSettings.appId"
                      :placeholder="t('settings.remote.qqbot.appIdPlaceholder')"
                      @blur="queueQQBotSettingsPersist"
                    />
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.qqbot.clientSecret') }}
                    </Label>
                    <Input
                      v-model="qqbotSettings.clientSecret"
                      type="password"
                      :placeholder="t('settings.remote.qqbot.clientSecretPlaceholder')"
                      @blur="queueQQBotSettingsPersist"
                    />
                  </div>
                </div>

                <div class="rounded-md border bg-muted/30 p-3 text-sm">
                  <div class="font-medium">{{ t('settings.remote.status.title') }}</div>
                  <div class="mt-1 text-muted-foreground">
                    {{ formatStatusLine(qqbotStatus) }}
                  </div>
                  <div v-if="qqbotStatus.botUser" class="mt-1 text-muted-foreground">
                    {{
                      t('settings.remote.status.botUser', {
                        id: qqbotStatus.botUser.id,
                        username: qqbotStatus.botUser.username || 'unknown'
                      })
                    }}
                  </div>
                  <div class="mt-1 text-muted-foreground">
                    {{
                      t('settings.remote.status.bindingOnly', {
                        count: qqbotStatus.bindingCount,
                        paired: qqbotStatus.pairedUserCount
                      })
                    }}
                  </div>
                  <div v-if="qqbotStatus.lastError" class="mt-2 break-all text-destructive">
                    {{ qqbotStatus.lastError }}
                  </div>
                </div>
              </div>

              <div class="border-t p-4">
                <div class="mb-3 space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.qqbot.remoteControlDescription') }}
                  </p>
                </div>

                <div v-if="qqbotSettings.remoteEnabled" class="space-y-4">
                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.qqbot.pairedUserIds') }}
                      </Label>
                      <Input
                        v-model="qqbotPairedUserIdsText"
                        :placeholder="t('settings.remote.qqbot.pairedUserIdsPlaceholder')"
                        @blur="queueQQBotSettingsPersist"
                      />
                    </div>

                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.remote.remoteControl.defaultAgent') }}
                      </Label>
                      <Select
                        :model-value="qqbotSettings.defaultAgentId"
                        @update:model-value="(value) => updateQQBotDefaultAgentId(String(value))"
                      >
                        <SelectTrigger class="h-8!">
                          <SelectValue
                            :placeholder="
                              t('settings.remote.remoteControl.defaultAgentPlaceholder')
                            "
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="agent in defaultAgentOptions(qqbotSettings.defaultAgentId)"
                            :key="agent.id"
                            :value="agent.id"
                          >
                            {{ agent.name }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs"
                          :title="qqbotDefaultWorkdirTitle"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ qqbotDefaultWorkdirLabel }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in qqbotDirectoryOptions"
                          :key="project.path"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="selectDefaultWorkdir('qqbot', project.path)"
                        >
                          <Icon
                            icon="lucide:folder"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <div class="min-w-0 flex-1">
                            <div class="truncate">{{ project.name }}</div>
                            <div class="truncate text-[10px] text-muted-foreground">
                              {{ project.path }}
                            </div>
                          </div>
                          <Icon
                            v-if="normalizePath(qqbotSettings.defaultWorkdir) === project.path"
                            icon="lucide:check"
                            class="h-3.5 w-3.5 shrink-0"
                          />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="pickDefaultWorkdir('qqbot')"
                        >
                          <Icon
                            icon="lucide:folder-open"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>{{ t('common.project.openFolder') }}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          v-if="qqbotSettings.defaultWorkdir"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="clearDefaultWorkdir('qqbot')"
                        >
                          <Icon
                            icon="lucide:x"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>{{ t('common.clear') }}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      @click="generatePairCodeAndOpenDialog('qqbot')"
                    >
                      {{ t('settings.remote.remoteControl.openPairDialog') }}
                    </Button>
                    <Button variant="outline" size="sm" @click="openBindingsDialog('qqbot')">
                      {{ t('settings.remote.remoteControl.manageBindings') }}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </template>
    </div>
  </ScrollArea>

  <Dialog v-model:open="pairDialogVisible">
    <DialogContent class="sm:max-w-md">
      <div data-testid="remote-pair-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>
            {{
              t('settings.remote.remoteControl.pairDialogTitle', {
                channel: pairDialogChannel ? t(`settings.remote.${pairDialogChannel}.title`) : ''
              })
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              t('settings.remote.remoteControl.pairDialogDescription', {
                channel: pairDialogChannel ? t(`settings.remote.${pairDialogChannel}.title`) : ''
              })
            }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-2">
            <div class="text-xs text-muted-foreground">
              {{ t('settings.remote.remoteControl.pairCode') }}
            </div>
            <div class="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-lg tracking-[0.2em]">
              {{ pairDialogCode || t('settings.remote.remoteControl.noPairCode') }}
            </div>
            <div v-if="pairDialogExpiresAt" class="text-xs text-muted-foreground">
              {{
                t('settings.remote.remoteControl.pairCodeExpiresAt', {
                  time: formatTimestamp(pairDialogExpiresAt)
                })
              }}
            </div>
          </div>

          <div class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm">
            <div class="text-muted-foreground">
              {{
                pairDialogChannel === 'feishu'
                  ? t('settings.remote.remoteControl.pairDialogInstructionFeishu')
                  : pairDialogChannel === 'qqbot'
                    ? t('settings.remote.remoteControl.pairDialogInstructionQQBot')
                    : t('settings.remote.remoteControl.pairDialogInstructionTelegram')
              }}
            </div>
            <div class="mt-2 rounded-md bg-background px-3 py-2 font-mono text-sm">
              /pair {{ pairDialogCode || '------' }}
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <Button variant="outline" @click="cancelPairDialog">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="bindingsDialogOpen">
    <DialogContent class="sm:max-w-lg">
      <div data-testid="remote-bindings-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>
            {{
              t('settings.remote.remoteControl.bindingsDialogTitle', {
                channel: bindingsDialogChannel
                  ? t(`settings.remote.${bindingsDialogChannel}.title`)
                  : ''
              })
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              t('settings.remote.remoteControl.bindingsDialogDescription', {
                channel: bindingsDialogChannel
                  ? t(`settings.remote.${bindingsDialogChannel}.title`)
                  : ''
              })
            }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div v-if="bindingsLoading" class="text-sm text-muted-foreground">
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="bindings.length === 0"
            data-testid="remote-bindings-empty"
            class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
          >
            {{ t('settings.remote.remoteControl.bindingsEmpty') }}
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="binding in bindings"
              :key="binding.endpointKey"
              :data-testid="`remote-binding-${binding.endpointKey}`"
              class="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="truncate text-sm font-medium">{{ binding.sessionId }}</div>
                  <span
                    :class="[
                      'inline-flex rounded-full px-2 py-0.5 text-[11px]',
                      bindingKindClass(binding.kind)
                    ]"
                  >
                    {{ t(`settings.remote.bindingKinds.${binding.kind}`) }}
                  </span>
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  {{ binding.channel }}:{{ binding.chatId
                  }}{{ binding.threadId ? `:${binding.threadId}` : '' }}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                :disabled="bindingRemovingKey === binding.endpointKey"
                @click="removeBinding(binding.endpointKey)"
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <Button variant="outline" @click="bindingsDialogOpen = false">
            {{ t('common.close') }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { usePresenter, useRemoteControlPresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import type { Agent, Project } from '@shared/types/agent-interface'
import type { HookEventName, HookTestResult } from '@shared/hooksNotifications'
import { HOOK_EVENT_NAMES } from '@shared/hooksNotifications'
import type {
  FeishuPairingSnapshot,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelDescriptor,
  RemotePairingSnapshot,
  RemoteRuntimeState,
  QQBotPairingSnapshot,
  QQBotRemoteSettings,
  QQBotRemoteStatus,
  TelegramPairingSnapshot,
  TelegramRemoteSettings,
  TelegramRemoteStatus
} from '@shared/presenter'

const fallbackChannelDescriptors: RemoteChannelDescriptor[] = [
  {
    id: 'telegram',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.telegram.title',
    descriptionKey: 'settings.remote.telegram.description',
    supportsPairing: true,
    supportsNotifications: true
  },
  {
    id: 'feishu',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.feishu.title',
    descriptionKey: 'settings.remote.feishu.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'qqbot',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.qqbot.title',
    descriptionKey: 'settings.remote.qqbot.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'weixin-ilink',
    type: 'builtin',
    implemented: false,
    titleKey: 'settings.remote.weixinIlink.title',
    descriptionKey: 'settings.remote.weixinIlink.description',
    supportsPairing: false,
    supportsNotifications: false
  }
]

const remoteControlPresenter = useRemoteControlPresenter()
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const projectPresenter = usePresenter('projectPresenter')
const { t } = useI18n()
const { toast } = useToast()

const telegramSettings = ref<TelegramRemoteSettings | null>(null)
const feishuSettings = ref<FeishuRemoteSettings | null>(null)
const qqbotSettings = ref<QQBotRemoteSettings | null>(null)
const telegramStatus = ref<TelegramRemoteStatus | null>(null)
const feishuStatus = ref<FeishuRemoteStatus | null>(null)
const qqbotStatus = ref<QQBotRemoteStatus | null>(null)
const channelDescriptors = ref<RemoteChannelDescriptor[]>(fallbackChannelDescriptors)
const isLoading = ref(false)
const showBotToken = ref(false)
const telegramTesting = ref(false)
const telegramTestResult = ref<HookTestResult | null>(null)
const telegramAllowedUserIdsText = ref('')
const feishuPairedUserOpenIdsText = ref('')
const qqbotPairedUserIdsText = ref('')
const availableAgents = ref<Agent[]>([])
const recentProjects = ref<Project[]>([])
const activeChannel = ref<RemoteChannel>('telegram')
const pairDialogChannel = ref<RemoteChannel | null>(null)
const pairDialogOpen = ref(false)
const pairDialogCode = ref<string | null>(null)
const pairDialogExpiresAt = ref<number | null>(null)
const pairDialogExpectedCode = ref<string | null>(null)
const pairDialogInitialPrincipalIds = ref<string[]>([])
const pairDialogCancelling = ref(false)
const bindingsDialogChannel = ref<RemoteChannel | null>(null)
const bindingsDialogOpen = ref(false)
const bindingsLoading = ref(false)
const bindingRemovingKey = ref<string | null>(null)
const bindings = ref<RemoteBindingSummary[]>([])
const saving = reactive<Record<RemoteChannel, boolean>>({
  telegram: false,
  feishu: false,
  qqbot: false
})
const pendingSave = reactive<Record<RemoteChannel, boolean>>({
  telegram: false,
  feishu: false,
  qqbot: false
})
const saveTasks: Record<RemoteChannel, Promise<void> | null> = {
  telegram: null,
  feishu: null,
  qqbot: null
}

let statusRefreshTimer: ReturnType<typeof setInterval> | null = null
let pairDialogRefreshTimer: ReturnType<typeof setInterval> | null = null

const defaultTelegramSettings = (): TelegramRemoteSettings => ({
  botToken: '',
  remoteEnabled: false,
  allowedUserIds: [],
  defaultAgentId: 'deepchat',
  defaultWorkdir: '',
  hookNotifications: {
    enabled: false,
    chatId: '',
    threadId: '',
    events: []
  }
})

const defaultFeishuSettings = (): FeishuRemoteSettings => ({
  appId: '',
  appSecret: '',
  verificationToken: '',
  encryptKey: '',
  remoteEnabled: false,
  defaultAgentId: 'deepchat',
  defaultWorkdir: '',
  pairedUserOpenIds: []
})

const defaultQQBotSettings = (): QQBotRemoteSettings => ({
  appId: '',
  clientSecret: '',
  remoteEnabled: false,
  defaultAgentId: 'deepchat',
  defaultWorkdir: '',
  pairedUserIds: []
})

const defaultFeishuStatus = (): FeishuRemoteStatus => ({
  channel: 'feishu',
  enabled: false,
  state: 'disabled',
  bindingCount: 0,
  pairedUserCount: 0,
  lastError: null,
  botUser: null
})

const defaultQQBotStatus = (): QQBotRemoteStatus => ({
  channel: 'qqbot',
  enabled: false,
  state: 'disabled',
  bindingCount: 0,
  pairedUserCount: 0,
  lastError: null,
  botUser: null
})

const defaultFeishuPairingSnapshot = (): FeishuPairingSnapshot => ({
  pairCode: null,
  pairCodeExpiresAt: null,
  pairedUserOpenIds: []
})

const defaultQQBotPairingSnapshot = (): QQBotPairingSnapshot => ({
  pairCode: null,
  pairCodeExpiresAt: null,
  pairedUserIds: []
})

const normalizeTelegramPairingSnapshot = (
  snapshot: Partial<TelegramPairingSnapshot> | null | undefined
): TelegramPairingSnapshot => ({
  pairCode: snapshot?.pairCode ?? null,
  pairCodeExpiresAt: snapshot?.pairCodeExpiresAt ?? null,
  allowedUserIds: [...(snapshot?.allowedUserIds ?? [])]
})

const normalizeFeishuPairingSnapshot = (
  snapshot: Partial<FeishuPairingSnapshot> | null | undefined
): FeishuPairingSnapshot => ({
  pairCode: snapshot?.pairCode ?? null,
  pairCodeExpiresAt: snapshot?.pairCodeExpiresAt ?? null,
  pairedUserOpenIds: [...(snapshot?.pairedUserOpenIds ?? [])]
})

const normalizeQQBotPairingSnapshot = (
  snapshot: Partial<QQBotPairingSnapshot> | null | undefined
): QQBotPairingSnapshot => ({
  pairCode: snapshot?.pairCode ?? null,
  pairCodeExpiresAt: snapshot?.pairCodeExpiresAt ?? null,
  pairedUserIds: [...(snapshot?.pairedUserIds ?? [])]
})

const presenterCompat = remoteControlPresenter as typeof remoteControlPresenter & {
  listRemoteChannels?: () => Promise<RemoteChannelDescriptor[]>
  getChannelSettings?: (
    channel: RemoteChannel
  ) => Promise<TelegramRemoteSettings | FeishuRemoteSettings | QQBotRemoteSettings>
  saveChannelSettings?: (
    channel: RemoteChannel,
    input: TelegramRemoteSettings | FeishuRemoteSettings | QQBotRemoteSettings
  ) => Promise<TelegramRemoteSettings | FeishuRemoteSettings | QQBotRemoteSettings>
  getChannelStatus?: (
    channel: RemoteChannel
  ) => Promise<TelegramRemoteStatus | FeishuRemoteStatus | QQBotRemoteStatus>
  getChannelBindings?: (channel: RemoteChannel) => Promise<RemoteBindingSummary[]>
  removeChannelBinding?: (channel: RemoteChannel, endpointKey: string) => Promise<void>
  getChannelPairingSnapshot?: (
    channel: RemoteChannel
  ) => Promise<TelegramPairingSnapshot | FeishuPairingSnapshot | QQBotPairingSnapshot>
  createChannelPairCode?: (channel: RemoteChannel) => Promise<{
    code: string
    expiresAt: number
  }>
  clearChannelPairCode?: (channel: RemoteChannel) => Promise<void>
}

const listRemoteChannelsCompat = async (): Promise<RemoteChannelDescriptor[]> => {
  if (presenterCompat.listRemoteChannels) {
    return await presenterCompat.listRemoteChannels()
  }

  return fallbackChannelDescriptors
}

function getChannelSettingsCompat(channel: 'telegram'): Promise<TelegramRemoteSettings>
function getChannelSettingsCompat(channel: 'feishu'): Promise<FeishuRemoteSettings>
function getChannelSettingsCompat(channel: 'qqbot'): Promise<QQBotRemoteSettings>
async function getChannelSettingsCompat(
  channel: RemoteChannel
): Promise<TelegramRemoteSettings | FeishuRemoteSettings | QQBotRemoteSettings> {
  if (presenterCompat.getChannelSettings) {
    return await presenterCompat.getChannelSettings(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.getTelegramSettings()
  }

  if (channel === 'qqbot') {
    return defaultQQBotSettings()
  }

  return defaultFeishuSettings()
}

function saveChannelSettingsCompat(
  channel: 'telegram',
  input: TelegramRemoteSettings
): Promise<TelegramRemoteSettings>
function saveChannelSettingsCompat(
  channel: 'feishu',
  input: FeishuRemoteSettings
): Promise<FeishuRemoteSettings>
function saveChannelSettingsCompat(
  channel: 'qqbot',
  input: QQBotRemoteSettings
): Promise<QQBotRemoteSettings>
async function saveChannelSettingsCompat(
  channel: RemoteChannel,
  input: TelegramRemoteSettings | FeishuRemoteSettings | QQBotRemoteSettings
): Promise<TelegramRemoteSettings | FeishuRemoteSettings | QQBotRemoteSettings> {
  if (presenterCompat.saveChannelSettings) {
    return await presenterCompat.saveChannelSettings(channel, input)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.saveTelegramSettings(input as TelegramRemoteSettings)
  }

  if (channel === 'qqbot') {
    return input as QQBotRemoteSettings
  }

  return input as FeishuRemoteSettings
}

function getChannelStatusCompat(channel: 'telegram'): Promise<TelegramRemoteStatus>
function getChannelStatusCompat(channel: 'feishu'): Promise<FeishuRemoteStatus>
function getChannelStatusCompat(channel: 'qqbot'): Promise<QQBotRemoteStatus>
async function getChannelStatusCompat(
  channel: RemoteChannel
): Promise<TelegramRemoteStatus | FeishuRemoteStatus | QQBotRemoteStatus> {
  if (presenterCompat.getChannelStatus) {
    return await presenterCompat.getChannelStatus(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.getTelegramStatus()
  }

  if (channel === 'qqbot') {
    return defaultQQBotStatus()
  }

  return defaultFeishuStatus()
}

const getChannelBindingsCompat = async (
  channel: RemoteChannel
): Promise<RemoteBindingSummary[]> => {
  if (presenterCompat.getChannelBindings) {
    return await presenterCompat.getChannelBindings(channel)
  }

  if (channel === 'telegram') {
    const bindings = await remoteControlPresenter.getTelegramBindings()
    return bindings.map((binding) => ({
      channel: 'telegram',
      endpointKey: binding.endpointKey,
      sessionId: binding.sessionId,
      chatId: String(binding.chatId),
      threadId: binding.messageThreadId ? String(binding.messageThreadId) : null,
      kind: binding.messageThreadId ? 'topic' : 'dm',
      updatedAt: binding.updatedAt
    }))
  }

  return []
}

const removeChannelBindingCompat = async (
  channel: RemoteChannel,
  endpointKey: string
): Promise<void> => {
  if (presenterCompat.removeChannelBinding) {
    await presenterCompat.removeChannelBinding(channel, endpointKey)
    return
  }

  if (channel === 'telegram') {
    await remoteControlPresenter.removeTelegramBinding(endpointKey)
  }
}

const getChannelPairingSnapshotCompat = async (
  channel: RemoteChannel
): Promise<TelegramPairingSnapshot | FeishuPairingSnapshot | QQBotPairingSnapshot> => {
  if (presenterCompat.getChannelPairingSnapshot) {
    return await presenterCompat.getChannelPairingSnapshot(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.getTelegramPairingSnapshot()
  }

  if (channel === 'qqbot') {
    return defaultQQBotPairingSnapshot()
  }

  return defaultFeishuPairingSnapshot()
}

const createChannelPairCodeCompat = async (
  channel: RemoteChannel
): Promise<{
  code: string
  expiresAt: number
}> => {
  if (presenterCompat.createChannelPairCode) {
    return await presenterCompat.createChannelPairCode(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.createTelegramPairCode()
  }

  return {
    code: '',
    expiresAt: Date.now()
  }
}

const clearChannelPairCodeCompat = async (channel: RemoteChannel): Promise<void> => {
  if (presenterCompat.clearChannelPairCode) {
    await presenterCompat.clearChannelPairCode(channel)
    return
  }

  if (channel === 'telegram') {
    await remoteControlPresenter.clearTelegramPairCode()
  }
}

const eventNames = HOOK_EVENT_NAMES
const implementedChannels = computed(() =>
  channelDescriptors.value
    .filter((descriptor) => descriptor.implemented)
    .map((descriptor) => descriptor.id)
    .filter((channel): channel is RemoteChannel => channel !== 'weixin-ilink')
)
const implementedChannelCount = computed(() => Math.max(1, implementedChannels.value.length))
const isAnySaving = computed(() => saving.telegram || saving.feishu || saving.qqbot)
const normalizePath = (value: string | null | undefined): string => value?.trim() ?? ''
const pathLabel = (value: string) => value.split(/[/\\]/).pop() ?? value
const buildDirectoryOptions = (currentPath: string) => {
  const normalizedCurrentPath = normalizePath(currentPath)
  const options = new Map<string, { path: string; name: string }>()

  if (normalizedCurrentPath) {
    options.set(normalizedCurrentPath, {
      path: normalizedCurrentPath,
      name: pathLabel(normalizedCurrentPath)
    })
  }

  for (const project of recentProjects.value) {
    const normalizedPath = normalizePath(project.path)
    if (!normalizedPath || options.has(normalizedPath)) {
      continue
    }

    options.set(normalizedPath, {
      path: normalizedPath,
      name: project.name || pathLabel(normalizedPath)
    })
  }

  return Array.from(options.values())
}
const telegramDirectoryOptions = computed(() =>
  buildDirectoryOptions(telegramSettings.value?.defaultWorkdir ?? '')
)
const feishuDirectoryOptions = computed(() =>
  buildDirectoryOptions(feishuSettings.value?.defaultWorkdir ?? '')
)
const qqbotDirectoryOptions = computed(() =>
  buildDirectoryOptions(qqbotSettings.value?.defaultWorkdir ?? '')
)
const defaultWorkdirLabel = (value: string | null | undefined) => {
  const normalized = normalizePath(value)
  return normalized
    ? pathLabel(normalized)
    : t('settings.remote.remoteControl.defaultWorkdirPlaceholder')
}
const defaultWorkdirTitle = (value: string | null | undefined) =>
  normalizePath(value) || t('settings.remote.remoteControl.defaultWorkdirPlaceholder')
const telegramDefaultWorkdirLabel = computed(() =>
  defaultWorkdirLabel(telegramSettings.value?.defaultWorkdir)
)
const telegramDefaultWorkdirTitle = computed(() =>
  defaultWorkdirTitle(telegramSettings.value?.defaultWorkdir)
)
const feishuDefaultWorkdirLabel = computed(() =>
  defaultWorkdirLabel(feishuSettings.value?.defaultWorkdir)
)
const feishuDefaultWorkdirTitle = computed(() =>
  defaultWorkdirTitle(feishuSettings.value?.defaultWorkdir)
)
const qqbotDefaultWorkdirLabel = computed(() =>
  defaultWorkdirLabel(qqbotSettings.value?.defaultWorkdir)
)
const qqbotDefaultWorkdirTitle = computed(() =>
  defaultWorkdirTitle(qqbotSettings.value?.defaultWorkdir)
)

const formatAgentOptionName = (agent: Pick<Agent, 'name' | 'type'>) =>
  agent.type === 'acp' ? `${agent.name} (ACP)` : agent.name

const defaultAgentOptions = (currentAgentId: string) => {
  const options = availableAgents.value
    .filter((agent) => agent.enabled)
    .map((agent) => ({
      id: agent.id,
      name: formatAgentOptionName(agent)
    }))

  if (currentAgentId && !options.some((agent) => agent.id === currentAgentId)) {
    options.unshift({
      id: currentAgentId,
      name: currentAgentId
    })
  }

  return options
}

const pairDialogVisible = computed({
  get: () => pairDialogOpen.value,
  set: (open: boolean) => {
    if (open) {
      pairDialogOpen.value = true
      return
    }

    void cancelPairDialog()
  }
})

const parseAllowedUserIds = (value: string): number[] =>
  Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((left, right) => left - right)

const parseOpenIds = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right))

const syncTelegramFields = (snapshot: Partial<TelegramRemoteSettings> | null | undefined) => {
  const fallback = defaultTelegramSettings()
  const hookNotifications = snapshot?.hookNotifications

  telegramSettings.value = {
    ...fallback,
    ...snapshot,
    defaultWorkdir: normalizePath(snapshot?.defaultWorkdir),
    hookNotifications: {
      ...fallback.hookNotifications,
      ...hookNotifications,
      threadId: hookNotifications?.threadId ?? ''
    }
  }
  telegramSettings.value.allowedUserIds = [...(snapshot?.allowedUserIds ?? fallback.allowedUserIds)]
  telegramSettings.value.hookNotifications.events = [
    ...(hookNotifications?.events ?? fallback.hookNotifications.events)
  ]
  telegramAllowedUserIdsText.value = telegramSettings.value.allowedUserIds.join(', ')
}

const syncFeishuFields = (snapshot: Partial<FeishuRemoteSettings> | null | undefined) => {
  const fallback = defaultFeishuSettings()

  feishuSettings.value = {
    ...fallback,
    ...snapshot,
    defaultWorkdir: normalizePath(snapshot?.defaultWorkdir),
    pairedUserOpenIds: [...(snapshot?.pairedUserOpenIds ?? fallback.pairedUserOpenIds)]
  }
  feishuPairedUserOpenIdsText.value = feishuSettings.value.pairedUserOpenIds.join(', ')
}

const syncQQBotFields = (snapshot: Partial<QQBotRemoteSettings> | null | undefined) => {
  const fallback = defaultQQBotSettings()

  qqbotSettings.value = {
    ...fallback,
    ...snapshot,
    defaultWorkdir: normalizePath(snapshot?.defaultWorkdir),
    pairedUserIds: [...(snapshot?.pairedUserIds ?? fallback.pairedUserIds)]
  }
  qqbotPairedUserIdsText.value = qqbotSettings.value.pairedUserIds.join(', ')
}

const channelStatus = (channel: RemoteChannel) =>
  channel === 'telegram'
    ? telegramStatus.value
    : channel === 'feishu'
      ? feishuStatus.value
      : qqbotStatus.value

const getSnapshotPrincipalIds = (
  channel: RemoteChannel,
  snapshot: TelegramPairingSnapshot | FeishuPairingSnapshot | QQBotPairingSnapshot
): string[] =>
  channel === 'telegram'
    ? normalizeTelegramPairingSnapshot(
        snapshot as Partial<TelegramPairingSnapshot>
      ).allowedUserIds.map((value) => String(value))
    : channel === 'feishu'
      ? normalizeFeishuPairingSnapshot(snapshot as Partial<FeishuPairingSnapshot>).pairedUserOpenIds
      : normalizeQQBotPairingSnapshot(snapshot as Partial<QQBotPairingSnapshot>).pairedUserIds

const refreshStatus = async () => {
  const [nextTelegramStatus, nextFeishuStatus, nextQQBotStatus] = await Promise.all([
    getChannelStatusCompat('telegram'),
    getChannelStatusCompat('feishu'),
    getChannelStatusCompat('qqbot')
  ])
  telegramStatus.value = nextTelegramStatus
  feishuStatus.value = nextFeishuStatus
  qqbotStatus.value = nextQQBotStatus
}

const refreshPairingSnapshot = async (channel: RemoteChannel): Promise<RemotePairingSnapshot> => {
  const snapshot = await getChannelPairingSnapshotCompat(channel)
  if (pairDialogChannel.value === channel) {
    pairDialogCode.value = snapshot.pairCode
    pairDialogExpiresAt.value = snapshot.pairCodeExpiresAt
  }
  return snapshot
}

const loadAvailableAgents = async () => {
  availableAgents.value = await agentSessionPresenter.getAgents()
}

const loadRecentProjects = async () => {
  try {
    const result = await projectPresenter.getRecentProjects(8)
    recentProjects.value = Array.isArray(result) ? result : []
  } catch {
    recentProjects.value = []
  }
}

const loadState = async () => {
  isLoading.value = true
  try {
    const [
      loadedChannelDescriptors,
      loadedTelegramSettings,
      loadedFeishuSettings,
      loadedQQBotSettings,
      loadedTelegramStatus,
      loadedFeishuStatus,
      loadedQQBotStatus
    ] = await Promise.all([
      listRemoteChannelsCompat(),
      getChannelSettingsCompat('telegram'),
      getChannelSettingsCompat('feishu'),
      getChannelSettingsCompat('qqbot'),
      getChannelStatusCompat('telegram'),
      getChannelStatusCompat('feishu'),
      getChannelStatusCompat('qqbot'),
      loadAvailableAgents(),
      loadRecentProjects()
    ])

    channelDescriptors.value =
      loadedChannelDescriptors.length > 0 ? loadedChannelDescriptors : fallbackChannelDescriptors
    syncTelegramFields(loadedTelegramSettings)
    syncFeishuFields(loadedFeishuSettings)
    syncQQBotFields(loadedQQBotSettings)
    telegramStatus.value = loadedTelegramStatus
    feishuStatus.value = loadedFeishuStatus
    qqbotStatus.value = loadedQQBotStatus

    if (!implementedChannels.value.includes(activeChannel.value)) {
      activeChannel.value = implementedChannels.value[0] ?? 'telegram'
    }
  } catch (error) {
    console.error('Failed to load remote settings:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isLoading.value = false
  }
}

const buildTelegramDraftSettings = (): TelegramRemoteSettings | null => {
  if (!telegramSettings.value) {
    return null
  }

  return {
    ...telegramSettings.value,
    defaultWorkdir: normalizePath(telegramSettings.value.defaultWorkdir),
    allowedUserIds: parseAllowedUserIds(telegramAllowedUserIdsText.value)
  }
}

const buildFeishuDraftSettings = (): FeishuRemoteSettings | null => {
  if (!feishuSettings.value) {
    return null
  }

  return {
    ...feishuSettings.value,
    defaultWorkdir: normalizePath(feishuSettings.value.defaultWorkdir),
    pairedUserOpenIds: parseOpenIds(feishuPairedUserOpenIdsText.value)
  }
}

const buildQQBotDraftSettings = (): QQBotRemoteSettings | null => {
  if (!qqbotSettings.value) {
    return null
  }

  return {
    ...qqbotSettings.value,
    defaultWorkdir: normalizePath(qqbotSettings.value.defaultWorkdir),
    pairedUserIds: parseOpenIds(qqbotPairedUserIdsText.value)
  }
}

const toastSaveError = (error: unknown) => {
  toast({
    title: t('common.error.operationFailed'),
    description: error instanceof Error ? error.message : String(error),
    variant: 'destructive'
  })
}

const persistChannelSettings = async (channel: RemoteChannel): Promise<void> => {
  pendingSave[channel] = true

  if (saveTasks[channel]) {
    await saveTasks[channel]
    return
  }

  const task = (async () => {
    while (pendingSave[channel]) {
      pendingSave[channel] = false
      saving[channel] = true

      try {
        if (channel === 'telegram') {
          const nextSettings = buildTelegramDraftSettings()
          if (!nextSettings) {
            return
          }

          const saved = await saveChannelSettingsCompat('telegram', nextSettings)
          syncTelegramFields(saved)
        } else if (channel === 'feishu') {
          const nextSettings = buildFeishuDraftSettings()
          if (!nextSettings) {
            return
          }

          const saved = await saveChannelSettingsCompat('feishu', nextSettings)
          syncFeishuFields(saved)
        } else {
          const nextSettings = buildQQBotDraftSettings()
          if (!nextSettings) {
            return
          }

          const saved = await saveChannelSettingsCompat('qqbot', nextSettings)
          syncQQBotFields(saved)
        }

        await Promise.all([refreshStatus(), loadAvailableAgents()])
      } catch (error) {
        console.error(`Failed to save ${channel} remote settings:`, error)
        toastSaveError(error)
        throw error
      } finally {
        saving[channel] = false
      }
    }
  })()

  saveTasks[channel] = task

  try {
    await task
  } finally {
    if (saveTasks[channel] === task) {
      saveTasks[channel] = null
    }
  }
}

const persistTelegramSettings = async () => {
  await persistChannelSettings('telegram')
}

const persistFeishuSettings = async () => {
  await persistChannelSettings('feishu')
}

const persistQQBotSettings = async () => {
  await persistChannelSettings('qqbot')
}

const queueTelegramSettingsPersist = () => {
  void persistTelegramSettings().catch(() => undefined)
}

const queueFeishuSettingsPersist = () => {
  void persistFeishuSettings().catch(() => undefined)
}

const queueQQBotSettingsPersist = () => {
  void persistQQBotSettings().catch(() => undefined)
}

const updateTelegramRemoteEnabled = (value: boolean) => {
  if (!telegramSettings.value) {
    return
  }
  telegramSettings.value.remoteEnabled = Boolean(value)
  queueTelegramSettingsPersist()
}

const updateFeishuRemoteEnabled = (value: boolean) => {
  if (!feishuSettings.value) {
    return
  }
  feishuSettings.value.remoteEnabled = Boolean(value)
  queueFeishuSettingsPersist()
}

const updateQQBotRemoteEnabled = (value: boolean) => {
  if (!qqbotSettings.value) {
    return
  }
  qqbotSettings.value.remoteEnabled = Boolean(value)
  queueQQBotSettingsPersist()
}

const channelEnabled = (channel: RemoteChannel): boolean =>
  channel === 'telegram'
    ? Boolean(telegramSettings.value?.remoteEnabled)
    : channel === 'feishu'
      ? Boolean(feishuSettings.value?.remoteEnabled)
      : Boolean(qqbotSettings.value?.remoteEnabled)

const updateChannelRemoteEnabled = (channel: RemoteChannel, value: boolean) => {
  if (channel === 'telegram') {
    updateTelegramRemoteEnabled(value)
    return
  }

  if (channel === 'feishu') {
    updateFeishuRemoteEnabled(value)
    return
  }

  updateQQBotRemoteEnabled(value)
}

const updateTelegramDefaultAgentId = (value: string) => {
  if (!telegramSettings.value) {
    return
  }
  telegramSettings.value.defaultAgentId = value
  queueTelegramSettingsPersist()
}

const updateFeishuDefaultAgentId = (value: string) => {
  if (!feishuSettings.value) {
    return
  }
  feishuSettings.value.defaultAgentId = value
  queueFeishuSettingsPersist()
}

const updateQQBotDefaultAgentId = (value: string) => {
  if (!qqbotSettings.value) {
    return
  }
  qqbotSettings.value.defaultAgentId = value
  queueQQBotSettingsPersist()
}

const setDefaultWorkdir = (channel: RemoteChannel, value: string) => {
  const normalizedValue = normalizePath(value)

  if (channel === 'telegram') {
    if (!telegramSettings.value) {
      return
    }
    telegramSettings.value.defaultWorkdir = normalizedValue
    queueTelegramSettingsPersist()
    return
  }

  if (channel === 'feishu') {
    if (!feishuSettings.value) {
      return
    }
    feishuSettings.value.defaultWorkdir = normalizedValue
    queueFeishuSettingsPersist()
    return
  }

  if (!qqbotSettings.value) {
    return
  }
  qqbotSettings.value.defaultWorkdir = normalizedValue
  queueQQBotSettingsPersist()
}

const selectDefaultWorkdir = (channel: RemoteChannel, value: string) => {
  setDefaultWorkdir(channel, value)
}

const clearDefaultWorkdir = (channel: RemoteChannel) => {
  setDefaultWorkdir(channel, '')
}

const pickDefaultWorkdir = async (channel: RemoteChannel) => {
  try {
    const selectedPath = await projectPresenter.selectDirectory()
    if (selectedPath) {
      setDefaultWorkdir(channel, selectedPath)
    }
  } catch (error) {
    console.warn('[RemoteSettings] Failed to select remote default workdir:', error)
  }
}

const updateHookEnabled = (value: boolean) => {
  if (!telegramSettings.value) {
    return
  }
  telegramSettings.value.hookNotifications.enabled = Boolean(value)
  queueTelegramSettingsPersist()
}

const updateHookEvent = (eventName: HookEventName, checked: boolean) => {
  if (!telegramSettings.value) {
    return
  }
  const events = new Set(telegramSettings.value.hookNotifications.events)
  if (checked) {
    events.add(eventName)
  } else {
    events.delete(eventName)
  }
  telegramSettings.value.hookNotifications.events = Array.from(events)
  queueTelegramSettingsPersist()
}

const stopPairDialogPolling = () => {
  if (pairDialogRefreshTimer) {
    clearInterval(pairDialogRefreshTimer)
    pairDialogRefreshTimer = null
  }
}

const closePairDialogState = () => {
  stopPairDialogPolling()
  pairDialogOpen.value = false
  pairDialogChannel.value = null
  pairDialogCode.value = null
  pairDialogExpiresAt.value = null
  pairDialogExpectedCode.value = null
  pairDialogInitialPrincipalIds.value = []
}

const pollPairingSnapshot = async () => {
  if (!pairDialogOpen.value || !pairDialogExpectedCode.value || !pairDialogChannel.value) {
    return
  }

  try {
    const snapshot = await refreshPairingSnapshot(pairDialogChannel.value)
    const principalIds = getSnapshotPrincipalIds(pairDialogChannel.value, snapshot)
    const principalsChanged =
      principalIds.join(',') !== pairDialogInitialPrincipalIds.value.join(',')
    const pairCodeConsumed =
      snapshot.pairCode !== pairDialogExpectedCode.value && !snapshot.pairCode?.trim()

    if (!pairCodeConsumed) {
      return
    }

    if (pairDialogChannel.value === 'telegram') {
      telegramAllowedUserIdsText.value = normalizeTelegramPairingSnapshot(
        snapshot as Partial<TelegramPairingSnapshot>
      ).allowedUserIds.join(', ')
    } else if (pairDialogChannel.value === 'feishu') {
      feishuPairedUserOpenIdsText.value = normalizeFeishuPairingSnapshot(
        snapshot as Partial<FeishuPairingSnapshot>
      ).pairedUserOpenIds.join(', ')
    } else {
      qqbotPairedUserIdsText.value = normalizeQQBotPairingSnapshot(
        snapshot as Partial<QQBotPairingSnapshot>
      ).pairedUserIds.join(', ')
    }

    await refreshStatus()

    if (!pairDialogCancelling.value && principalsChanged) {
      toast({
        title: t('settings.remote.remoteControl.pairingSuccessTitle'),
        description: t('settings.remote.remoteControl.pairingSuccessDescription')
      })
    }

    closePairDialogState()
  } catch (error) {
    console.warn('[RemoteSettings] Failed to poll pairing snapshot:', error)
  }
}

const startPairDialogPolling = () => {
  stopPairDialogPolling()
  pairDialogRefreshTimer = setInterval(() => {
    void pollPairingSnapshot()
  }, 2_000)
}

const persistChannelDraftOrAbort = async (channel: RemoteChannel): Promise<boolean> => {
  try {
    if (channel === 'telegram') {
      await persistTelegramSettings()
    } else if (channel === 'feishu') {
      await persistFeishuSettings()
    } else {
      await persistQQBotSettings()
    }
    return true
  } catch {
    return false
  }
}

const generatePairCodeAndOpenDialog = async (channel: RemoteChannel) => {
  if (!(await persistChannelDraftOrAbort(channel))) {
    return
  }

  try {
    const pairCode = await createChannelPairCodeCompat(channel)
    const snapshot = await refreshPairingSnapshot(channel)
    pairDialogChannel.value = channel
    pairDialogExpectedCode.value = pairCode.code
    pairDialogInitialPrincipalIds.value = getSnapshotPrincipalIds(channel, snapshot)
    pairDialogCode.value = pairCode.code
    pairDialogExpiresAt.value = pairCode.expiresAt
    pairDialogCancelling.value = false
    pairDialogOpen.value = true
    startPairDialogPolling()
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const cancelPairDialog = async () => {
  if (!pairDialogChannel.value) {
    return
  }

  stopPairDialogPolling()
  pairDialogOpen.value = false
  pairDialogCancelling.value = true
  try {
    await clearChannelPairCodeCompat(pairDialogChannel.value)
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    pairDialogCancelling.value = false
    closePairDialogState()
  }
}

const loadBindings = async (channel: RemoteChannel) => {
  bindingsLoading.value = true
  try {
    bindings.value = await getChannelBindingsCompat(channel)
  } finally {
    bindingsLoading.value = false
  }
}

const openBindingsDialog = async (channel: RemoteChannel) => {
  if (!(await persistChannelDraftOrAbort(channel))) {
    return
  }

  bindingsDialogChannel.value = channel
  bindingsDialogOpen.value = true
  try {
    await loadBindings(channel)
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const removeBinding = async (endpointKey: string) => {
  if (!bindingsDialogChannel.value) {
    return
  }

  bindingRemovingKey.value = endpointKey
  try {
    await removeChannelBindingCompat(bindingsDialogChannel.value, endpointKey)
    await Promise.all([loadBindings(bindingsDialogChannel.value), refreshStatus()])
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    bindingRemovingKey.value = null
  }
}

const runTelegramHookTest = async () => {
  if (telegramTesting.value) {
    return
  }

  if (!(await persistChannelDraftOrAbort('telegram'))) {
    return
  }

  telegramTesting.value = true
  telegramTestResult.value = null
  try {
    telegramTestResult.value = await remoteControlPresenter.testTelegramHookNotification()
  } catch (error) {
    telegramTestResult.value = {
      success: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    telegramTesting.value = false
  }
}

const eventLabel = (eventName: HookEventName) =>
  t(`settings.notificationsHooks.events.${eventName}`)

const formatTimestamp = (value: number) => new Date(value).toLocaleString()

const formatStatusLine = (value: TelegramRemoteStatus | FeishuRemoteStatus | QQBotRemoteStatus) =>
  t(`settings.remote.status.states.${value.state}`)

const statusDotClass = (state: RemoteRuntimeState, dotOnly = false) => {
  if (state === 'running') {
    return dotOnly ? 'bg-emerald-500' : 'bg-emerald-500/10 text-emerald-600'
  }
  if (state === 'starting' || state === 'backoff') {
    return dotOnly ? 'bg-amber-500' : 'bg-amber-500/10 text-amber-700'
  }
  if (state === 'error') {
    return dotOnly ? 'bg-red-500' : 'bg-red-500/10 text-red-600'
  }
  return dotOnly ? 'bg-muted-foreground/50' : 'bg-muted text-muted-foreground'
}

const bindingKindClass = (kind: RemoteBindingSummary['kind']) => {
  if (kind === 'dm') {
    return 'bg-emerald-500/10 text-emerald-700'
  }
  if (kind === 'topic') {
    return 'bg-blue-500/10 text-blue-700'
  }
  return 'bg-amber-500/10 text-amber-700'
}

const formatOverviewLine = (channel: RemoteChannel) => {
  const status = channelStatus(channel)
  if (!status) {
    return ''
  }

  if (channel === 'telegram') {
    return t('settings.remote.overview.telegram', {
      bindingCount: status.bindingCount,
      pairedCount: status.allowedUserCount,
      hooks: telegramSettings.value?.hookNotifications.enabled
        ? t('settings.remote.overview.hooksOn')
        : t('settings.remote.overview.hooksOff')
    })
  }

  if (channel === 'qqbot') {
    return t('settings.remote.overview.qqbot', {
      bindingCount: status.bindingCount,
      pairedCount: status.pairedUserCount
    })
  }

  return t('settings.remote.overview.feishu', {
    bindingCount: status.bindingCount,
    pairedCount: status.pairedUserCount
  })
}

onMounted(() => {
  void loadState()
  statusRefreshTimer = setInterval(() => {
    void refreshStatus()
  }, 2_000)
})

onUnmounted(() => {
  if (statusRefreshTimer) {
    clearInterval(statusRefreshTimer)
    statusRefreshTimer = null
  }
  stopPairDialogPolling()
})
</script>
