<template>
  <component :is="rootComponent" data-testid="settings-remote-page" class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-4 p-4">
      <div v-if="isLoading" class="flex flex-col gap-4">
        <Skeleton class="h-6 w-48 rounded bg-muted/50" />
        <Skeleton class="h-20 rounded-xl bg-muted/40" />
        <Skeleton class="h-12 rounded-xl bg-muted/30" />
        <Skeleton class="h-80 rounded-xl bg-muted/20" />
      </div>
      <div
        v-else-if="
          !telegramSettings ||
          !telegramStatus ||
          !feishuSettings ||
          !feishuStatus ||
          !qqbotSettings ||
          !qqbotStatus ||
          !discordSettings ||
          !discordStatus ||
          !weixinIlinkSettings ||
          !weixinIlinkStatus
        "
        class="flex flex-col items-start gap-3 text-sm text-muted-foreground"
      >
        <span>{{ t('common.error.requestFailed') }}</span>
        <DcButton variant="outline" size="sm" :disabled="isLoading" @click="loadState">
          {{ t('common.retry') }}
        </DcButton>
      </div>
      <template v-else>
        <div v-if="!props.hideHeader" class="space-y-1">
          <div class="flex items-center gap-2">
            <div class="text-base font-medium">
              {{ singleChannelMode ? channelTitle(activeChannel) : t('settings.remote.title') }}
            </div>
          </div>
          <div class="text-sm text-muted-foreground">
            {{
              singleChannelMode
                ? channelDescription(activeChannel)
                : t('settings.remote.description')
            }}
          </div>
        </div>

        <Tabs v-model="activeChannel" class="space-y-4">
          <TabsList
            v-if="!singleChannelMode"
            class="grid w-full"
            :style="{ gridTemplateColumns: `repeat(${remoteChannelCount}, minmax(0, 1fr))` }"
          >
            <TabsTrigger
              v-for="channel in remoteChannelIds"
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
              {{ channelTitle(channel) }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="telegram" class="space-y-4">
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-base font-medium">{{ channelTitle('telegram') }}</div>
                    <DcStatusPill
                      :status="statusPillStatus(telegramStatus.state)"
                      :label="formatStatusLine(telegramStatus)"
                    />
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.telegram.description') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatOverviewLine('telegram') }}
                  </p>
                  <p v-if="telegramStatus.lastError" class="break-all text-xs text-destructive">
                    {{ telegramStatus.lastError }}
                  </p>
                </div>
                <label
                  v-if="!props.hideChannelToggle"
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span>{{
                    telegramSettings.remoteEnabled ? t('common.enabled') : t('common.disabled')
                  }}</span>
                  <Switch
                    data-testid="remote-channel-toggle-telegram"
                    :model-value="telegramSettings.remoteEnabled"
                    :disabled="saving.telegram"
                    @update:model-value="(value) => updateTelegramRemoteEnabled(value === true)"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.telegram.botTokenDescription') }}
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
                    <DcButton
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                      :tooltip="showBotToken ? t('common.hideValue') : t('common.showValue')"
                      @click="showBotToken = !showBotToken"
                    >
                      <Icon
                        :icon="showBotToken ? 'lucide:eye-off' : 'lucide:eye'"
                        class="h-4 w-4 text-muted-foreground"
                      />
                    </DcButton>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.remoteControl.description') }}
                  </p>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                          :placeholder="t('settings.remote.remoteControl.defaultAgentPlaceholder')"
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
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <DcButton
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 px-2.5 text-xs"
                          :title="defaultWorkdirTitle('telegram')"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ defaultWorkdirLabel('telegram') }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </DcButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in directoryOptions('telegram')"
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
                        <DcDropdownActionItem
                          icon="lucide:folder-open"
                          :label="t('common.project.openFolder')"
                          class="text-xs"
                          @select="pickDefaultWorkdir('telegram')"
                        />
                        <DcDropdownActionItem
                          v-if="telegramSettings.defaultWorkdir"
                          icon="lucide:x"
                          :label="t('common.clear')"
                          class="text-xs"
                          @select="clearDefaultWorkdir('telegram')"
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <DcButton
                    data-testid="remote-pair-button"
                    variant="outline"
                    size="sm"
                    :disabled="
                      !telegramSettings.remoteEnabled ||
                      saving.telegram ||
                      pairDialogCreating ||
                      isChannelActionPending('telegram')
                    "
                    @click="generatePairCodeAndOpenDialog('telegram')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </DcButton>
                  <DcButton
                    data-testid="remote-bindings-button"
                    variant="outline"
                    size="sm"
                    :disabled="saving.telegram"
                    @click="openBindingsDialog('telegram')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </DcButton>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="feishu" class="space-y-4">
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-base font-medium">{{ channelTitle('feishu') }}</div>
                    <DcStatusPill
                      :status="statusPillStatus(feishuStatus.state)"
                      :label="formatStatusLine(feishuStatus)"
                    />
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.feishu.description') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatOverviewLine('feishu') }}
                  </p>
                  <p v-if="feishuStatus.lastError" class="break-all text-xs text-destructive">
                    {{ feishuStatus.lastError }}
                  </p>
                </div>
                <label
                  v-if="!props.hideChannelToggle"
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span>{{
                    feishuSettings.remoteEnabled ? t('common.enabled') : t('common.disabled')
                  }}</span>
                  <Switch
                    data-testid="remote-channel-toggle-feishu"
                    :model-value="feishuSettings.remoteEnabled"
                    :disabled="saving.feishu"
                    @update:model-value="(value) => updateFeishuRemoteEnabled(value === true)"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.feishu.brand') }}
                    </Label>
                    <Select
                      :model-value="feishuSettings.brand"
                      @update:model-value="
                        (value) => {
                          if (!feishuSettings) {
                            return
                          }
                          feishuSettings.brand = String(value) === 'lark' ? 'lark' : 'feishu'
                          queueFeishuSettingsPersist()
                        }
                      "
                    >
                      <SelectTrigger class="h-8!">
                        <SelectValue :placeholder="t('settings.remote.feishu.brand')" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="feishu">
                          {{ t('settings.remote.feishu.brandFeishu') }}
                        </SelectItem>
                        <SelectItem value="lark">
                          {{ t('settings.remote.feishu.brandLark') }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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

                <div class="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div class="font-medium">{{ t('settings.remote.feishu.installTitle') }}</div>
                  <p class="mt-1 text-muted-foreground">
                    {{ t('settings.remote.feishu.installDescription') }}
                  </p>
                  <div v-if="feishuInstallUserCode" class="mt-2 text-xs text-muted-foreground">
                    {{
                      t('settings.remote.feishu.installUserCode', { code: feishuInstallUserCode })
                    }}
                  </div>
                  <div
                    v-if="feishuInstallMessage && !feishuInstallError"
                    class="mt-2 text-xs text-muted-foreground"
                  >
                    {{ feishuInstallMessage }}
                  </div>
                  <div v-if="feishuInstallError" class="mt-2 break-all text-xs text-destructive">
                    {{ feishuInstallError }}
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <DcButton
                      data-testid="feishu-install-open-web-button"
                      variant="default"
                      size="sm"
                      :disabled="feishuInstallBusy || saving.feishu"
                      @click="startFeishuInstall('web')"
                    >
                      <Spinner
                        v-if="feishuInstallBusy && feishuInstallMode === 'web'"
                        class="size-4"
                        data-icon="inline-start"
                      />
                      <Icon
                        v-else
                        icon="lucide:external-link"
                        class="size-4"
                        data-icon="inline-start"
                      />
                      {{
                        feishuInstallBusy && feishuInstallMode === 'web'
                          ? t('settings.remote.feishu.installWaiting')
                          : t('settings.remote.feishu.openInstallWeb')
                      }}
                    </DcButton>
                    <DcButton
                      data-testid="feishu-install-show-qr-button"
                      variant="outline"
                      size="sm"
                      :disabled="feishuInstallBusy || saving.feishu"
                      @click="startFeishuInstall('qr')"
                    >
                      <Spinner
                        v-if="feishuInstallBusy && feishuInstallMode === 'qr'"
                        class="size-4"
                        data-icon="inline-start"
                      />
                      <Icon v-else icon="lucide:qr-code" class="size-4" data-icon="inline-start" />
                      {{
                        feishuInstallBusy && feishuInstallMode === 'qr'
                          ? t('settings.remote.feishu.installWaiting')
                          : t('settings.remote.feishu.showInstallQr')
                      }}
                    </DcButton>
                    <DcButton
                      v-if="feishuInstallBusy"
                      variant="outline"
                      size="sm"
                      @click="cancelFeishuInstall()"
                    >
                      {{ t('common.cancel') }}
                    </DcButton>
                  </div>
                </div>

                <div class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm">
                  <div class="font-medium">{{ t('settings.remote.feishu.manualSetupTitle') }}</div>
                  <p class="mt-1 text-muted-foreground">
                    {{ t('settings.remote.feishu.manualSetupDescription') }}
                  </p>
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>{{ t('settings.remote.feishu.setupStepCreateApp') }}</li>
                    <li>{{ t('settings.remote.feishu.setupStepPermissions') }}</li>
                    <li>{{ t('settings.remote.feishu.setupStepEvents') }}</li>
                    <li>{{ t('settings.remote.feishu.setupStepPublish') }}</li>
                  </ul>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <DcButton variant="outline" size="sm" @click="openFeishuSetupGuide">
                      {{ t('settings.remote.feishu.openSetupGuide') }}
                    </DcButton>
                    <DcButton variant="outline" size="sm" @click="openFeishuDeveloperConsole">
                      {{ t('settings.remote.feishu.openDeveloperConsole') }}
                    </DcButton>
                    <DcButton variant="outline" size="sm" @click="openFeishuBotChat">
                      {{ t('settings.remote.feishu.openBotChat') }}
                    </DcButton>
                  </div>
                </div>

                <div class="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div class="font-medium">{{ t('settings.remote.feishu.userAuthTitle') }}</div>
                  <p class="mt-1 text-muted-foreground">
                    {{ t('settings.remote.feishu.userAuthDescription') }}
                  </p>
                  <div class="mt-3 grid gap-3 md:grid-cols-2">
                    <div class="rounded-md border border-dashed bg-background/60 p-3">
                      <div class="text-xs font-medium text-foreground">
                        {{ t('settings.remote.feishu.pairAuthTitle') }}
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {{ t('settings.remote.feishu.pairAuthDescription') }}
                      </p>
                    </div>
                    <div class="rounded-md border border-dashed bg-background/60 p-3">
                      <div class="text-xs font-medium text-foreground">
                        {{ t('settings.remote.feishu.scanAuthTitle') }}
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {{ t('settings.remote.feishu.scanAuthDescription') }}
                      </p>
                    </div>
                  </div>
                  <div
                    v-if="feishuAuthMessage && !feishuAuthError"
                    class="mt-2 text-xs text-muted-foreground"
                  >
                    {{ feishuAuthMessage }}
                  </div>
                  <div v-if="feishuAuthError" class="mt-2 break-all text-xs text-destructive">
                    {{ feishuAuthError }}
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <DcButton
                      data-testid="feishu-pair-button"
                      variant="outline"
                      size="sm"
                      :disabled="
                        !feishuSettings.remoteEnabled ||
                        saving.feishu ||
                        pairDialogCreating ||
                        isChannelActionPending('feishu')
                      "
                      @click="generatePairCodeAndOpenDialog('feishu')"
                    >
                      <Icon icon="lucide:key-round" class="h-4 w-4" />
                      {{ t('settings.remote.remoteControl.openPairDialog') }}
                    </DcButton>
                    <DcButton
                      data-testid="feishu-scan-auth-button"
                      variant="outline"
                      size="sm"
                      :disabled="feishuAuthBusy || saving.feishu"
                      @click="startFeishuScanAuth"
                    >
                      <Spinner v-if="feishuAuthBusy" class="size-4" data-icon="inline-start" />
                      <Icon
                        v-else
                        icon="lucide:scan-line"
                        class="size-4"
                        data-icon="inline-start"
                      />
                      {{
                        feishuAuthBusy
                          ? t('settings.remote.feishu.scanAuthWaiting')
                          : t('settings.remote.feishu.startScanAuth')
                      }}
                    </DcButton>
                    <DcButton
                      v-if="feishuAuthBusy"
                      variant="outline"
                      size="sm"
                      @click="cancelFeishuScanAuth()"
                    >
                      {{ t('common.cancel') }}
                    </DcButton>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.remoteControl.description') }}
                  </p>
                </div>

                <div
                  class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground"
                >
                  <div>{{ t('settings.remote.feishu.accessRule1') }}</div>
                  <div class="mt-1">{{ t('settings.remote.feishu.accessRule2') }}</div>
                </div>

                <label
                  class="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-3 text-sm"
                >
                  <div class="space-y-1">
                    <div class="font-medium">{{ t('settings.remote.feishu.streamingCards') }}</div>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.feishu.streamingCardsDescription') }}
                    </p>
                  </div>
                  <Switch
                    data-testid="feishu-streaming-cards-toggle"
                    :model-value="feishuSettings.enableStreamingCards"
                    :disabled="saving.feishu"
                    @update:model-value="
                      (value) => {
                        if (!feishuSettings) {
                          return
                        }
                        feishuSettings.enableStreamingCards = value === true
                        queueFeishuSettingsPersist()
                      }
                    "
                  />
                </label>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                          :placeholder="t('settings.remote.remoteControl.defaultAgentPlaceholder')"
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
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <DcButton
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 px-2.5 text-xs"
                          :title="defaultWorkdirTitle('feishu')"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ defaultWorkdirLabel('feishu') }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </DcButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in directoryOptions('feishu')"
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
                        <DcDropdownActionItem
                          icon="lucide:folder-open"
                          :label="t('common.project.openFolder')"
                          class="text-xs"
                          @select="pickDefaultWorkdir('feishu')"
                        />
                        <DcDropdownActionItem
                          v-if="feishuSettings.defaultWorkdir"
                          icon="lucide:x"
                          :label="t('common.clear')"
                          class="text-xs"
                          @select="clearDefaultWorkdir('feishu')"
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <DcButton
                    data-testid="feishu-bindings-button"
                    variant="outline"
                    size="sm"
                    :disabled="saving.feishu"
                    @click="openBindingsDialog('feishu')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </DcButton>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="qqbot" class="space-y-4">
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-base font-medium">{{ channelTitle('qqbot') }}</div>
                    <DcStatusPill
                      :status="statusPillStatus(qqbotStatus.state)"
                      :label="formatStatusLine(qqbotStatus)"
                    />
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.qqbot.description') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatOverviewLine('qqbot') }}
                  </p>
                  <p v-if="qqbotStatus.lastError" class="break-all text-xs text-destructive">
                    {{ qqbotStatus.lastError }}
                  </p>
                </div>
                <label
                  v-if="!props.hideChannelToggle"
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span>{{
                    qqbotSettings.remoteEnabled ? t('common.enabled') : t('common.disabled')
                  }}</span>
                  <Switch
                    data-testid="remote-channel-toggle-qqbot"
                    :model-value="qqbotSettings.remoteEnabled"
                    :disabled="saving.qqbot"
                    @update:model-value="(value) => updateQQBotRemoteEnabled(value === true)"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
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
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.qqbot.remoteControlDescription') }}
                  </p>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                          :placeholder="t('settings.remote.remoteControl.defaultAgentPlaceholder')"
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
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <DcButton
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 px-2.5 text-xs"
                          :title="defaultWorkdirTitle('qqbot')"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ defaultWorkdirLabel('qqbot') }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </DcButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in directoryOptions('qqbot')"
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
                        <DcDropdownActionItem
                          icon="lucide:folder-open"
                          :label="t('common.project.openFolder')"
                          class="text-xs"
                          @select="pickDefaultWorkdir('qqbot')"
                        />
                        <DcDropdownActionItem
                          v-if="qqbotSettings.defaultWorkdir"
                          icon="lucide:x"
                          :label="t('common.clear')"
                          class="text-xs"
                          @select="clearDefaultWorkdir('qqbot')"
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <DcButton
                    variant="outline"
                    size="sm"
                    :disabled="
                      !qqbotSettings.remoteEnabled ||
                      saving.qqbot ||
                      pairDialogCreating ||
                      isChannelActionPending('qqbot')
                    "
                    @click="generatePairCodeAndOpenDialog('qqbot')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </DcButton>
                  <DcButton
                    variant="outline"
                    size="sm"
                    :disabled="saving.qqbot"
                    @click="openBindingsDialog('qqbot')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </DcButton>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="discord" class="space-y-4">
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-base font-medium">{{ channelTitle('discord') }}</div>
                    <DcStatusPill
                      :status="statusPillStatus(discordStatus.state)"
                      :label="formatStatusLine(discordStatus)"
                    />
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.discord.description') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatOverviewLine('discord') }}
                  </p>
                  <p v-if="discordStatus.lastError" class="break-all text-xs text-destructive">
                    {{ discordStatus.lastError }}
                  </p>
                </div>
                <label
                  v-if="!props.hideChannelToggle"
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span>{{
                    discordSettings.remoteEnabled ? t('common.enabled') : t('common.disabled')
                  }}</span>
                  <Switch
                    data-testid="remote-channel-toggle-discord"
                    :model-value="discordSettings.remoteEnabled"
                    :disabled="saving.discord"
                    @update:model-value="(value) => updateDiscordRemoteEnabled(value === true)"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.credentials') }}
                  </div>
                </div>

                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.discord.botToken') }}
                  </Label>
                  <div class="relative w-full">
                    <Input
                      v-model="discordSettings.botToken"
                      :type="showDiscordBotToken ? 'text' : 'password'"
                      :placeholder="t('settings.remote.discord.botTokenPlaceholder')"
                      class="pr-10"
                      @blur="queueDiscordSettingsPersist"
                    />
                    <DcButton
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                      :tooltip="showDiscordBotToken ? t('common.hideValue') : t('common.showValue')"
                      @click="showDiscordBotToken = !showDiscordBotToken"
                    >
                      <Icon
                        :icon="showDiscordBotToken ? 'lucide:eye-off' : 'lucide:eye'"
                        class="h-4 w-4 text-muted-foreground"
                      />
                    </DcButton>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.discord.remoteControlDescription') }}
                  </p>
                </div>

                <div
                  class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground"
                >
                  <div>{{ t('settings.remote.discord.accessRule1') }}</div>
                  <div class="mt-1">{{ t('settings.remote.discord.accessRule2') }}</div>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultAgent') }}
                    </Label>
                    <Select
                      :model-value="discordSettings.defaultAgentId"
                      @update:model-value="(value) => updateDiscordDefaultAgentId(String(value))"
                    >
                      <SelectTrigger class="h-8!">
                        <SelectValue
                          :placeholder="t('settings.remote.remoteControl.defaultAgentPlaceholder')"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="agent in defaultAgentOptions(discordSettings.defaultAgentId)"
                          :key="agent.id"
                          :value="agent.id"
                        >
                          {{ agent.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <DcButton
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 px-2.5 text-xs"
                          :title="defaultWorkdirTitle('discord')"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ defaultWorkdirLabel('discord') }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </DcButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in directoryOptions('discord')"
                          :key="project.path"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="selectDefaultWorkdir('discord', project.path)"
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
                            v-if="normalizePath(discordSettings.defaultWorkdir) === project.path"
                            icon="lucide:check"
                            class="h-3.5 w-3.5 shrink-0"
                          />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DcDropdownActionItem
                          icon="lucide:folder-open"
                          :label="t('common.project.openFolder')"
                          class="text-xs"
                          @select="pickDefaultWorkdir('discord')"
                        />
                        <DcDropdownActionItem
                          v-if="discordSettings.defaultWorkdir"
                          icon="lucide:x"
                          :label="t('common.clear')"
                          class="text-xs"
                          @select="clearDefaultWorkdir('discord')"
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <DcButton
                    data-testid="discord-pair-button"
                    variant="outline"
                    size="sm"
                    :disabled="
                      !discordSettings.remoteEnabled ||
                      saving.discord ||
                      pairDialogCreating ||
                      isChannelActionPending('discord')
                    "
                    @click="generatePairCodeAndOpenDialog('discord')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </DcButton>
                  <DcButton
                    data-testid="discord-bindings-button"
                    variant="outline"
                    size="sm"
                    :disabled="saving.discord"
                    @click="openBindingsDialog('discord')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </DcButton>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="weixin-ilink" class="space-y-4">
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-base font-medium">{{ channelTitle('weixin-ilink') }}</div>
                    <DcStatusPill
                      :status="statusPillStatus(weixinIlinkStatus.state)"
                      :label="formatStatusLine(weixinIlinkStatus)"
                    />
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.weixinIlink.description') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ formatOverviewLine('weixin-ilink') }}
                  </p>
                  <p v-if="weixinIlinkStatus.lastError" class="break-all text-xs text-destructive">
                    {{ weixinIlinkStatus.lastError }}
                  </p>
                </div>
                <label
                  v-if="!props.hideChannelToggle"
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span>{{
                    weixinIlinkSettings.remoteEnabled ? t('common.enabled') : t('common.disabled')
                  }}</span>
                  <Switch
                    data-testid="remote-channel-toggle-weixin-ilink"
                    :model-value="weixinIlinkSettings.remoteEnabled"
                    :disabled="saving['weixin-ilink']"
                    @update:model-value="(value) => updateWeixinIlinkRemoteEnabled(value === true)"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div
                  class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground"
                >
                  <div>{{ t('settings.remote.weixinIlink.loginDescription') }}</div>
                  <div class="mt-1">{{ t('settings.remote.weixinIlink.ownerOnlyNotice') }}</div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <DcButton
                    data-testid="weixin-ilink-connect-button"
                    variant="outline"
                    size="sm"
                    :disabled="
                      weixinIlinkLoginBusy ||
                      saving['weixin-ilink'] ||
                      isChannelActionPending('weixin-ilink')
                    "
                    @click="startWeixinIlinkLogin()"
                  >
                    <Spinner
                      v-if="weixinIlinkLoginBusy"
                      class="mr-1 size-4"
                      data-icon="inline-start"
                    />
                    <Icon
                      v-else
                      icon="lucide:qr-code"
                      class="mr-1 size-4"
                      data-icon="inline-start"
                    />
                    {{ t('settings.remote.weixinIlink.connectButton') }}
                  </DcButton>
                </div>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="mb-3 space-y-1">
                <div class="text-sm font-medium">
                  {{ t('settings.remote.weixinIlink.accountsTitle') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{ t('settings.remote.weixinIlink.accountsDescription') }}
                </p>
              </div>

              <div
                v-if="weixinIlinkStatus.accounts.length === 0"
                class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
              >
                {{ t('settings.remote.weixinIlink.noAccounts') }}
              </div>
              <div v-else class="space-y-3">
                <div
                  v-for="account in weixinIlinkStatus.accounts"
                  :key="account.accountId"
                  class="rounded-lg border p-3"
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium">{{ account.accountId }}</div>
                      <div class="mt-1 text-xs text-muted-foreground">
                        {{
                          t('settings.remote.weixinIlink.ownerUserId', {
                            ownerUserId: account.ownerUserId
                          })
                        }}
                      </div>
                      <div class="mt-1 truncate text-xs text-muted-foreground">
                        {{
                          t('settings.remote.weixinIlink.baseUrl', {
                            baseUrl: account.baseUrl
                          })
                        }}
                      </div>
                    </div>

                    <div class="flex flex-col items-end gap-2">
                      <span
                        :class="[
                          'inline-flex rounded-full px-2 py-1 text-[11px]',
                          statusDotClass(account.state)
                        ]"
                      >
                        {{ t(`settings.remote.status.states.${account.state}`) }}
                      </span>
                      <label class="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{{
                          account.enabled ? t('common.enabled') : t('common.disabled')
                        }}</span>
                        <Switch
                          :model-value="account.enabled"
                          :disabled="saving['weixin-ilink']"
                          @update:model-value="
                            (value) =>
                              toggleWeixinIlinkAccountEnabled(account.accountId, value === true)
                          "
                        />
                      </label>
                    </div>
                  </div>

                  <div class="mt-3 text-xs text-muted-foreground">
                    {{
                      t('settings.remote.weixinIlink.accountBindings', {
                        count: account.bindingCount
                      })
                    }}
                  </div>
                  <div v-if="account.lastError" class="mt-2 break-all text-xs text-destructive">
                    {{ account.lastError }}
                  </div>

                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <DcButton
                      variant="outline"
                      size="sm"
                      :disabled="
                        weixinIlinkAccountActionId === account.accountId ||
                        account.enabled !== true ||
                        saving['weixin-ilink'] ||
                        isChannelActionPending('weixin-ilink')
                      "
                      @click="restartWeixinIlinkAccount(account.accountId)"
                    >
                      {{ t('settings.remote.weixinIlink.restartAccount') }}
                    </DcButton>
                    <DcButton
                      variant="outline"
                      size="sm"
                      class="text-destructive hover:text-destructive"
                      :disabled="
                        weixinIlinkAccountActionId === account.accountId ||
                        saving['weixin-ilink'] ||
                        isChannelActionPending('weixin-ilink')
                      "
                      @click="removeWeixinIlinkAccount(account.accountId)"
                    >
                      {{ t('settings.remote.weixinIlink.removeAccount') }}
                    </DcButton>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-lg border p-4">
              <div class="space-y-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    {{ t('settings.remote.sections.remoteControl') }}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {{ t('settings.remote.weixinIlink.remoteControlDescription') }}
                  </p>
                </div>

                <div class="grid grid-cols-1 gap-4">
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultAgent') }}
                    </Label>
                    <Select
                      :model-value="weixinIlinkSettings.defaultAgentId"
                      @update:model-value="
                        (value) => updateWeixinIlinkDefaultAgentId(String(value))
                      "
                    >
                      <SelectTrigger class="h-8!">
                        <SelectValue
                          :placeholder="t('settings.remote.remoteControl.defaultAgentPlaceholder')"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="agent in defaultAgentOptions(weixinIlinkSettings.defaultAgentId)"
                          :key="agent.id"
                          :value="agent.id"
                        >
                          {{ agent.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdir') }}
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <DcButton
                          variant="outline"
                          size="sm"
                          class="h-8 w-full min-w-0 justify-between gap-1.5 px-2.5 text-xs"
                          :title="defaultWorkdirTitle('weixin-ilink')"
                        >
                          <div class="flex min-w-0 items-center gap-1.5">
                            <Icon
                              icon="lucide:folder"
                              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            <span class="truncate">{{ defaultWorkdirLabel('weixin-ilink') }}</span>
                          </div>
                          <Icon
                            icon="lucide:chevron-down"
                            class="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                        </DcButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-[20rem]">
                        <DropdownMenuItem
                          v-for="project in directoryOptions('weixin-ilink')"
                          :key="project.path"
                          class="gap-2 px-2 py-1.5 text-xs"
                          @select="selectDefaultWorkdir('weixin-ilink', project.path)"
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
                            v-if="
                              normalizePath(weixinIlinkSettings.defaultWorkdir) === project.path
                            "
                            icon="lucide:check"
                            class="h-3.5 w-3.5 shrink-0"
                          />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DcDropdownActionItem
                          icon="lucide:folder-open"
                          :label="t('common.project.openFolder')"
                          class="text-xs"
                          @select="pickDefaultWorkdir('weixin-ilink')"
                        />
                        <DcDropdownActionItem
                          v-if="weixinIlinkSettings.defaultWorkdir"
                          icon="lucide:x"
                          :label="t('common.clear')"
                          class="text-xs"
                          @select="clearDefaultWorkdir('weixin-ilink')"
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <DcButton
                    variant="outline"
                    size="sm"
                    :disabled="saving['weixin-ilink']"
                    @click="openBindingsDialog('weixin-ilink')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </DcButton>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </template>
    </div>
  </component>

  <Dialog v-model:open="pairDialogVisible">
    <DialogContent class="sm:max-w-md">
      <div data-testid="remote-pair-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>
            {{
              t('settings.remote.remoteControl.pairDialogTitle', {
                channel: pairDialogChannel ? channelTitle(pairDialogChannel) : ''
              })
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              t('settings.remote.remoteControl.pairDialogDescription', {
                channel: pairDialogChannel ? channelTitle(pairDialogChannel) : ''
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
                    : pairDialogChannel === 'discord'
                      ? t('settings.remote.remoteControl.pairDialogInstructionDiscord')
                      : t('settings.remote.remoteControl.pairDialogInstructionTelegram')
              }}
            </div>
            <div class="mt-2 rounded-md bg-background px-3 py-2 font-mono text-sm">
              /pair {{ pairDialogCode || '------' }}
            </div>
          </div>
          <DcInlineError v-if="pairDialogError" :error="pairDialogError" />
        </div>

        <div class="flex justify-end">
          <DcButton variant="outline" :disabled="pairDialogCancelling" @click="cancelPairDialog">
            {{ pairDialogCancelling ? t('common.loading') : t('common.cancel') }}
          </DcButton>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="feishuInstallQrDialogVisible">
    <DialogContent class="sm:max-w-md">
      <div data-testid="feishu-install-qr-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>{{ t('settings.remote.feishu.installQrTitle') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.remote.feishu.installQrDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div
            class="rounded-lg border bg-muted/20 p-4 text-center"
            data-testid="feishu-install-qr-code"
            :data-qr-value="feishuInstallQrUrl"
          >
            <img
              v-if="feishuInstallQrDataUrl"
              :src="feishuInstallQrDataUrl"
              :alt="t('settings.remote.feishu.installQrAlt')"
              class="mx-auto h-56 w-56 rounded bg-white p-2"
            />
            <div v-else class="py-16 text-sm text-muted-foreground">
              {{ t('common.loading') }}
            </div>
          </div>
          <div v-if="feishuInstallUserCode" class="text-xs text-muted-foreground">
            {{ t('settings.remote.feishu.installUserCode', { code: feishuInstallUserCode }) }}
          </div>
          <div
            v-if="feishuInstallMessage && !feishuInstallError"
            class="text-xs text-muted-foreground"
          >
            {{ feishuInstallMessage }}
          </div>
          <div v-if="feishuInstallError" class="break-all text-xs text-destructive">
            {{ feishuInstallError }}
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <DcButton
            variant="outline"
            :disabled="!feishuInstallQrUrl"
            @click="openFeishuInstallQrUrl"
          >
            {{ t('settings.remote.feishu.openInstallWeb') }}
          </DcButton>
          <DcButton variant="outline" @click="closeFeishuInstallQrDialog">
            {{ feishuInstallBusy ? t('common.cancel') : t('common.close') }}
          </DcButton>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="bindingsDialogVisible">
    <DialogContent class="sm:max-w-lg">
      <div data-testid="remote-bindings-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>
            {{
              t('settings.remote.remoteControl.bindingsDialogTitle', {
                channel: bindingsDialogChannel ? channelTitle(bindingsDialogChannel) : ''
              })
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              t('settings.remote.remoteControl.bindingsDialogDescription', {
                channel: bindingsDialogChannel ? channelTitle(bindingsDialogChannel) : ''
              })
            }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div v-if="bindingsLoading" class="text-sm text-muted-foreground">
            {{ t('common.loading') }}
          </div>
          <div
            v-if="!bindingsLoading && bindingsDialogError"
            role="alert"
            class="flex items-center gap-2 text-sm text-destructive"
          >
            <span>{{ bindingsDialogError }}</span>
            <DcButton
              v-if="bindingsDialogFailure?.source === 'load'"
              variant="link"
              size="sm"
              class="h-auto px-0 text-xs"
              :disabled="bindingsDialogBusy"
              @click="retryBindingsDialogLoad"
            >
              {{ t('common.retry') }}
            </DcButton>
          </div>
          <template
            v-if="
              !bindingsLoading &&
              (!bindingsDialogError || bindings.length > 0 || authorizedPrincipals.length > 0)
            "
          >
            <div v-if="bindingsDialogSupportsPrincipals" class="space-y-3">
              <div class="space-y-1">
                <div class="text-sm font-medium">
                  {{ t('settings.remote.remoteControl.authorizedPrincipalsTitle') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{
                    t('settings.remote.remoteControl.authorizedPrincipalsDescription', {
                      channel: bindingsDialogChannel ? channelTitle(bindingsDialogChannel) : ''
                    })
                  }}
                </p>
              </div>

              <div
                v-if="authorizedPrincipals.length === 0"
                data-testid="remote-principals-empty"
                class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
              >
                {{ t('settings.remote.remoteControl.authorizedPrincipalsEmpty') }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="principalId in authorizedPrincipals"
                  :key="principalId"
                  :data-testid="`remote-principal-${principalId}`"
                  class="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{{ principalId }}</div>
                  </div>
                  <DcButton
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    :disabled="bindingsDialogBusy"
                    @click="removePrincipal(principalId)"
                  >
                    {{ t('common.delete') }}
                  </DcButton>
                </div>
              </div>
            </div>

            <div class="space-y-3">
              <div class="space-y-1">
                <div class="text-sm font-medium">
                  {{ t('settings.remote.remoteControl.sessionBindingsTitle') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{
                    t('settings.remote.remoteControl.sessionBindingsDescription', {
                      channel: bindingsDialogChannel ? channelTitle(bindingsDialogChannel) : ''
                    })
                  }}
                </p>
              </div>

              <div
                v-if="bindings.length === 0"
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
                  <DcButton
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    :disabled="bindingsDialogBusy"
                    @click="removeBinding(binding.endpointKey)"
                  >
                    {{ t('common.delete') }}
                  </DcButton>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="flex justify-end">
          <DcButton
            variant="outline"
            :disabled="bindingsDialogMutating"
            @click="closeBindingsDialog"
          >
            {{ t('common.close') }}
          </DcButton>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="weixinIlinkLoginVisible">
    <DialogContent class="sm:max-w-lg">
      <div class="space-y-6">
        <DialogHeader>
          <DialogTitle>{{ t('settings.remote.weixinIlink.loginDialogTitle') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.remote.weixinIlink.loginDialogDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="rounded-lg border bg-muted/20 p-3 text-sm">
            <div v-if="!weixinIlinkLoginError" class="text-muted-foreground">
              {{ weixinIlinkLoginMessage }}
            </div>
            <div v-if="weixinIlinkLoginError" class="mt-2 break-all text-destructive">
              {{ weixinIlinkLoginError }}
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <DcButton
            variant="outline"
            :disabled="weixinIlinkLoginBusy"
            @click="restartWeixinIlinkLogin"
          >
            {{ t('settings.remote.weixinIlink.refreshQrCode') }}
          </DcButton>
          <DcButton variant="outline" @click="closeWeixinIlinkLoginDialog">
            {{ t('common.close') }}
          </DcButton>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as QRCode from 'qrcode'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { DcButton } from '@dc-ui/components/button'
import { Label } from '@shadcn/components/ui/label'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import { DcStatusPill } from '@dc-ui/components/status-pill'
import type { DcStatus } from '@dc-ui/components/status-pill'
import { DcInlineError } from '@dc-ui/components/inline-error'
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
import { Spinner } from '@shadcn/components/ui/spinner'
import { createProjectClient } from '@api/ProjectClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import { createSessionClient } from '@api/SessionClient'
import { openRuntimeExternal } from '@api/runtime'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import { isAcpDefaultWorkdirRequiredError } from '@shared/contracts/remoteControlErrors'
import { RemoteChannelSaveCoordinator } from '../lib/remoteChannelSaveCoordinator'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
import type { Agent, Project } from '@shared/types/agent-interface'
import type {
  DiscordPairingSnapshot,
  DiscordRemoteSettings,
  DiscordRemoteStatus,
  FeishuAuthResult,
  FeishuAuthSession,
  FeishuInstallResult,
  FeishuInstallSession,
  FeishuPairingSnapshot,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  PairableRemoteChannel,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelDescriptor,
  RemoteChannelSettings,
  RemotePairingSnapshot,
  RemoteRuntimeState,
  RemoteChannelStatus,
  QQBotPairingSnapshot,
  QQBotRemoteSettings,
  QQBotRemoteStatus,
  TelegramPairingSnapshot,
  TelegramRemoteSettings,
  TelegramRemoteStatus,
  WeixinIlinkLoginResult,
  WeixinIlinkLoginSession,
  WeixinIlinkRemoteSettings,
  WeixinIlinkRemoteStatus
} from '@shared/types/remote'

const remoteControlClient = createRemoteControlClient()
const projectClient = createProjectClient()
const sessionClient = createSessionClient()
const { t } = useI18n()
const props = defineProps<{
  channel?: RemoteChannel
  embedded?: boolean
  hideHeader?: boolean
  hideChannelToggle?: boolean
  singleChannel?: boolean
}>()

const channelI18nKeyMap: Record<RemoteChannel, string> = {
  telegram: 'telegram',
  feishu: 'feishu',
  qqbot: 'qqbot',
  discord: 'discord',
  'weixin-ilink': 'weixinIlink'
}
const REMOTE_CHANNELS = [
  'telegram',
  'feishu',
  'qqbot',
  'discord',
  'weixin-ilink'
] as const satisfies readonly RemoteChannel[]

function channelTitle(channel: RemoteChannel | null | undefined): string {
  if (!channel) {
    return ''
  }
  return t(`settings.remote.${channelI18nKeyMap[channel]}.title`)
}

function channelDescription(channel: RemoteChannel | null | undefined): string {
  if (!channel) {
    return ''
  }
  return t(`settings.remote.${channelI18nKeyMap[channel]}.description`)
}

const telegramSettings = ref<TelegramRemoteSettings | null>(null)
const feishuSettings = ref<FeishuRemoteSettings | null>(null)
const qqbotSettings = ref<QQBotRemoteSettings | null>(null)
const discordSettings = ref<DiscordRemoteSettings | null>(null)
const weixinIlinkSettings = ref<WeixinIlinkRemoteSettings | null>(null)
const telegramStatus = ref<TelegramRemoteStatus | null>(null)
const feishuStatus = ref<FeishuRemoteStatus | null>(null)
const qqbotStatus = ref<QQBotRemoteStatus | null>(null)
const discordStatus = ref<DiscordRemoteStatus | null>(null)
const weixinIlinkStatus = ref<WeixinIlinkRemoteStatus | null>(null)
const channelDescriptors = ref<RemoteChannelDescriptor[]>([])
const isLoading = ref(false)
const showBotToken = ref(false)
const showDiscordBotToken = ref(false)
const availableAgents = ref<Agent[]>([])
const recentProjects = ref<Project[]>([])
const activeChannel = ref<RemoteChannel>('telegram')
const pendingChannelActionIds = ref<Record<RemoteChannel, string | null>>({
  telegram: null,
  feishu: null,
  qqbot: null,
  discord: null,
  'weixin-ilink': null
})
const pairDialogChannel = ref<PairableRemoteChannel | null>(null)
const pairDialogOpen = ref(false)
const pairDialogCode = ref<string | null>(null)
const pairDialogExpiresAt = ref<number | null>(null)
const pairDialogExpectedCode = ref<string | null>(null)
const pairDialogCreating = ref(false)
const pairDialogCancelling = ref(false)
const pairDialogError = ref<string | null>(null)
const bindingsDialogChannel = ref<RemoteChannel | null>(null)
const bindingsDialogOpen = ref(false)
const bindingsLoading = ref(false)
const bindingsDialogFailure = ref<{
  source: 'load' | 'mutation'
  message: string
} | null>(null)
const bindingsDialogError = computed(() => bindingsDialogFailure.value?.message ?? null)
const bindingRemovingKey = ref<string | null>(null)
const principalRemovingId = ref<string | null>(null)
const bindings = ref<RemoteBindingSummary[]>([])
const authorizedPrincipals = ref<string[]>([])
const feishuAuthMessage = ref('')
const feishuAuthError = ref<string | null>(null)
const feishuAuthStarting = ref(false)
const feishuAuthWaiting = ref(false)
const feishuAuthSessionKey = ref<string | null>(null)
const feishuInstallMessage = ref('')
const feishuInstallError = ref<string | null>(null)
const feishuInstallStarting = ref(false)
const feishuInstallWaiting = ref(false)
const feishuInstallSessionKey = ref<string | null>(null)
const feishuInstallUserCode = ref('')
const feishuInstallQrDialogOpen = ref(false)
const feishuInstallQrUrl = ref('')
const feishuInstallQrDataUrl = ref('')
const feishuInstallMode = ref<'web' | 'qr' | null>(null)
const weixinIlinkLoginMessage = ref('')
const weixinIlinkLoginError = ref<string | null>(null)
const weixinIlinkLoginStarting = ref(false)
const weixinIlinkLoginWaiting = ref(false)
const weixinIlinkLoginOpen = ref(false)
const weixinIlinkAccountActionId = ref<string | null>(null)
const persistedTelegramSettings = ref<TelegramRemoteSettings | null>(null)
const persistedFeishuSettings = ref<FeishuRemoteSettings | null>(null)
const persistedQQBotSettings = ref<QQBotRemoteSettings | null>(null)
const persistedDiscordSettings = ref<DiscordRemoteSettings | null>(null)
const persistedWeixinIlinkSettings = ref<WeixinIlinkRemoteSettings | null>(null)
const saving = reactive<Record<RemoteChannel, boolean>>({
  telegram: false,
  feishu: false,
  qqbot: false,
  discord: false,
  'weixin-ilink': false
})

let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
let pairDialogRefreshTimer: ReturnType<typeof setInterval> | null = null
let statusRefreshErrors = 0
let loadStateRequestId = 0
let bindingsLoadRequestId = 0
let pairDialogGeneration = 0
const REMOTE_STATUS_ACTIVE_POLL_MS = 2_000
const REMOTE_STATUS_IDLE_POLL_MS = 30_000

const defaultTelegramSettings = (): TelegramRemoteSettings => ({
  botToken: '',
  remoteEnabled: false,
  defaultAgentId: 'deepchat',
  defaultWorkdir: ''
})

const defaultFeishuSettings = (): FeishuRemoteSettings => ({
  brand: 'feishu',
  appId: '',
  appSecret: '',
  verificationToken: '',
  encryptKey: '',
  remoteEnabled: false,
  enableStreamingCards: false,
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

const defaultDiscordSettings = (): DiscordRemoteSettings => ({
  botToken: '',
  remoteEnabled: false,
  defaultAgentId: 'deepchat',
  defaultWorkdir: '',
  pairedChannelIds: []
})

const defaultWeixinIlinkSettings = (): WeixinIlinkRemoteSettings => ({
  remoteEnabled: false,
  defaultAgentId: 'deepchat',
  defaultWorkdir: '',
  accounts: []
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
  pairedUserIds: [...(snapshot?.pairedUserIds ?? [])],
  pairedGroupIds: [...(snapshot?.pairedGroupIds ?? [])]
})

const normalizeDiscordPairingSnapshot = (
  snapshot: Partial<DiscordPairingSnapshot> | null | undefined
): DiscordPairingSnapshot => ({
  pairCode: snapshot?.pairCode ?? null,
  pairCodeExpiresAt: snapshot?.pairCodeExpiresAt ?? null,
  pairedChannelIds: [...(snapshot?.pairedChannelIds ?? [])]
})

function getChannelSettingsCompat(channel: 'telegram'): Promise<TelegramRemoteSettings>
function getChannelSettingsCompat(channel: 'feishu'): Promise<FeishuRemoteSettings>
function getChannelSettingsCompat(channel: 'qqbot'): Promise<QQBotRemoteSettings>
function getChannelSettingsCompat(channel: 'discord'): Promise<DiscordRemoteSettings>
function getChannelSettingsCompat(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteSettings>
async function getChannelSettingsCompat(channel: RemoteChannel): Promise<RemoteChannelSettings> {
  return await remoteControlClient.getChannelSettings(channel)
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
function saveChannelSettingsCompat(
  channel: 'discord',
  input: DiscordRemoteSettings
): Promise<DiscordRemoteSettings>
function saveChannelSettingsCompat(
  channel: 'weixin-ilink',
  input: WeixinIlinkRemoteSettings
): Promise<WeixinIlinkRemoteSettings>
async function saveChannelSettingsCompat(
  channel: RemoteChannel,
  input: RemoteChannelSettings
): Promise<RemoteChannelSettings> {
  return await remoteControlClient.saveChannelSettings(channel, input)
}

function getChannelStatusCompat(channel: 'telegram'): Promise<TelegramRemoteStatus>
function getChannelStatusCompat(channel: 'feishu'): Promise<FeishuRemoteStatus>
function getChannelStatusCompat(channel: 'qqbot'): Promise<QQBotRemoteStatus>
function getChannelStatusCompat(channel: 'discord'): Promise<DiscordRemoteStatus>
function getChannelStatusCompat(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteStatus>
async function getChannelStatusCompat(channel: RemoteChannel): Promise<RemoteChannelStatus> {
  return await remoteControlClient.getChannelStatus(channel)
}

const getChannelBindingsCompat = async (
  channel: RemoteChannel
): Promise<RemoteBindingSummary[]> => {
  return await remoteControlClient.getChannelBindings(channel)
}

const removeChannelBindingCompat = async (
  channel: RemoteChannel,
  endpointKey: string
): Promise<void> => {
  await remoteControlClient.removeChannelBinding(channel, endpointKey)
}

const removeChannelPrincipalCompat = async (
  channel: PairableRemoteChannel,
  principalId: string
): Promise<void> => {
  await remoteControlClient.removeChannelPrincipal(channel, principalId)
}

const getChannelPairingSnapshotCompat = async (
  channel: PairableRemoteChannel
): Promise<RemotePairingSnapshot> => {
  return await remoteControlClient.getChannelPairingSnapshot(channel)
}

const createChannelPairCodeCompat = async (
  channel: PairableRemoteChannel
): Promise<{
  code: string
  expiresAt: number
}> => {
  return await remoteControlClient.createChannelPairCode(channel)
}

const clearChannelPairCodeCompat = async (channel: PairableRemoteChannel): Promise<void> => {
  await remoteControlClient.clearChannelPairCode(channel)
}

const startFeishuAuthCompat = async (input?: {
  brand?: 'feishu' | 'lark'
  appId?: string
  appSecret?: string
  redirectUri?: string
}): Promise<FeishuAuthSession> => {
  return await remoteControlClient.startFeishuAuth(input)
}

const waitForFeishuAuthCompat = async (input: {
  sessionKey: string
  timeoutMs?: number
}): Promise<FeishuAuthResult> => {
  return await remoteControlClient.waitForFeishuAuth(input)
}

const cancelFeishuAuthCompat = async (sessionKey: string): Promise<void> => {
  await remoteControlClient.cancelFeishuAuth(sessionKey)
}

const startFeishuInstallCompat = async (input?: {
  brand?: 'feishu' | 'lark'
}): Promise<FeishuInstallSession> => {
  return await remoteControlClient.startFeishuInstall(input)
}

const waitForFeishuInstallCompat = async (input: {
  sessionKey: string
  timeoutMs?: number
}): Promise<FeishuInstallResult> => {
  return await remoteControlClient.waitForFeishuInstall(input)
}

const cancelFeishuInstallCompat = async (sessionKey: string): Promise<void> => {
  await remoteControlClient.cancelFeishuInstall(sessionKey)
}

const startWeixinIlinkLoginCompat = async (input?: {
  force?: boolean
}): Promise<WeixinIlinkLoginSession> => {
  return await remoteControlClient.startWeixinIlinkLogin(input)
}

const waitForWeixinIlinkLoginCompat = async (input: {
  sessionKey: string
  timeoutMs?: number
}): Promise<WeixinIlinkLoginResult> => {
  return await remoteControlClient.waitForWeixinIlinkLogin(input)
}

const removeWeixinIlinkAccountCompat = async (accountId: string): Promise<void> => {
  await remoteControlClient.removeWeixinIlinkAccount(accountId)
}

const restartWeixinIlinkAccountCompat = async (accountId: string): Promise<void> => {
  await remoteControlClient.restartWeixinIlinkAccount(accountId)
}

const resolveRemoteMessage = (
  input: {
    message?: string | null
    messageKey?: string | null
  },
  fallbackKey: string
): string => {
  if (input.messageKey?.trim()) {
    return t(input.messageKey.trim())
  }

  if (input.message?.trim()) {
    return input.message.trim()
  }

  return t(fallbackKey)
}

const resolveFeishuAuthMessage = (input: {
  message?: string | null
  messageKey?: string | null
}): string => resolveRemoteMessage(input, 'settings.remote.feishu.authFailed')

const resolveFeishuInstallMessage = (input: {
  message?: string | null
  messageKey?: string | null
}): string => resolveRemoteMessage(input, 'settings.remote.feishu.installFailed')

const resolveWeixinIlinkLoginMessage = (input: {
  message?: string | null
  messageKey?: string | null
}): string => resolveRemoteMessage(input, 'settings.remote.weixinIlink.loginFailed')

const remoteChannelIds = computed(() => channelDescriptors.value.map((descriptor) => descriptor.id))
const remoteChannelCount = computed(() => Math.max(1, remoteChannelIds.value.length))
const rootComponent = computed(() => (props.embedded ? 'div' : ScrollArea))
const singleChannelMode = computed(() => Boolean(props.singleChannel || props.channel))
const isRemoteChannel = (value: unknown): value is RemoteChannel =>
  typeof value === 'string' &&
  channelDescriptors.value.some((descriptor) => descriptor.id === value)
const syncActiveChannelFromProps = () => {
  if (props.channel && isRemoteChannel(props.channel)) {
    activeChannel.value = props.channel
  }
}
const isAnySaving = computed(() => REMOTE_CHANNELS.some((channel) => saving[channel]))
const isChannelActionPending = (channel: RemoteChannel) =>
  pendingChannelActionIds.value[channel] !== null
const bindingsDialogMutating = computed(
  () => bindingRemovingKey.value !== null || principalRemovingId.value !== null
)
const bindingsDialogBusy = computed(() => bindingsLoading.value || bindingsDialogMutating.value)
const feishuAuthBusy = computed(() => feishuAuthStarting.value || feishuAuthWaiting.value)
const feishuInstallBusy = computed(() => feishuInstallStarting.value || feishuInstallWaiting.value)
const feishuInstallQrDialogVisible = computed({
  get: () => feishuInstallQrDialogOpen.value,
  set: (open: boolean) => {
    if (open) {
      feishuInstallQrDialogOpen.value = true
      return
    }

    closeFeishuInstallQrDialog()
  }
})
const isPairableChannel = (
  channel: RemoteChannel | null | undefined
): channel is PairableRemoteChannel =>
  channel === 'telegram' || channel === 'feishu' || channel === 'qqbot' || channel === 'discord'
const bindingsDialogSupportsPrincipals = computed(() =>
  isPairableChannel(bindingsDialogChannel.value)
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
    const aliasMatch = availableAgents.value.find(
      (agent) =>
        agent.enabled && resolveAcpAgentAlias(agent.id) === resolveAcpAgentAlias(currentAgentId)
    )
    options.unshift({
      id: currentAgentId,
      name: aliasMatch ? formatAgentOptionName(aliasMatch) : currentAgentId
    })
  }

  return options
}

const normalizePath = (value: string | null | undefined) => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

const pathLabel = (value: string) => value.split(/[/\\]/).filter(Boolean).pop() || value

const getChannelDefaultWorkdir = (channel: RemoteChannel): string => {
  switch (channel) {
    case 'telegram':
      return telegramSettings.value?.defaultWorkdir ?? ''
    case 'feishu':
      return feishuSettings.value?.defaultWorkdir ?? ''
    case 'qqbot':
      return qqbotSettings.value?.defaultWorkdir ?? ''
    case 'discord':
      return discordSettings.value?.defaultWorkdir ?? ''
    case 'weixin-ilink':
      return weixinIlinkSettings.value?.defaultWorkdir ?? ''
  }
}

const setChannelDefaultWorkdir = (channel: RemoteChannel, value: string) => {
  if (channel === 'telegram' && telegramSettings.value) {
    telegramSettings.value.defaultWorkdir = value
    queueTelegramSettingsPersist()
  } else if (channel === 'feishu' && feishuSettings.value) {
    feishuSettings.value.defaultWorkdir = value
    queueFeishuSettingsPersist()
  } else if (channel === 'qqbot' && qqbotSettings.value) {
    qqbotSettings.value.defaultWorkdir = value
    queueQQBotSettingsPersist()
  } else if (channel === 'discord' && discordSettings.value) {
    discordSettings.value.defaultWorkdir = value
    queueDiscordSettingsPersist()
  } else if (channel === 'weixin-ilink' && weixinIlinkSettings.value) {
    weixinIlinkSettings.value.defaultWorkdir = value
    queueWeixinIlinkSettingsPersist()
  }
}

const directoryOptions = (channel: RemoteChannel) => {
  const normalizedCurrentPath = normalizePath(getChannelDefaultWorkdir(channel))
  const options = new Map<string, { path: string; name: string }>()

  if (normalizedCurrentPath) {
    options.set(normalizedCurrentPath, {
      path: normalizedCurrentPath,
      name: pathLabel(normalizedCurrentPath)
    })
  }

  for (const project of recentProjects.value) {
    const normalized = normalizePath(project.path)
    if (!normalized || options.has(normalized)) {
      continue
    }

    options.set(normalized, {
      path: normalized,
      name: project.name || pathLabel(normalized)
    })
  }

  return Array.from(options.values())
}

const defaultWorkdirLabel = (channel: RemoteChannel) => {
  const normalized = normalizePath(getChannelDefaultWorkdir(channel))
  return normalized
    ? pathLabel(normalized)
    : t('settings.remote.remoteControl.defaultWorkdirPlaceholder')
}

const defaultWorkdirTitle = (channel: RemoteChannel) =>
  normalizePath(getChannelDefaultWorkdir(channel)) ??
  t('settings.remote.remoteControl.defaultWorkdirPlaceholder')

const pickDefaultWorkdir = async (channel: RemoteChannel) => {
  try {
    const selectedPath = await projectClient.selectDirectory()
    if (selectedPath) {
      setChannelDefaultWorkdir(channel, selectedPath)
      void loadRecentProjects()
    }
  } catch (error) {
    console.warn(
      '[RemoteSettings] Failed to select default workdir',
      {
        channel
      },
      error
    )
    if (beginChannelAction(channel)) {
      failChannelAction(
        channel,
        `settings.remote.${channelI18nKeyMap[channel]}.selectDirectoryFailed`
      )
    }
  }
}

const selectDefaultWorkdir = (channel: RemoteChannel, projectPath: string) => {
  setChannelDefaultWorkdir(channel, projectPath)
}

const clearDefaultWorkdir = (channel: RemoteChannel) => {
  setChannelDefaultWorkdir(channel, '')
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

const bindingsDialogVisible = computed({
  get: () => bindingsDialogOpen.value,
  set: (open: boolean) => {
    if (open) {
      bindingsDialogOpen.value = true
      return
    }
    closeBindingsDialog()
  }
})

const weixinIlinkLoginVisible = computed({
  get: () => weixinIlinkLoginOpen.value,
  set: (open: boolean) => {
    if (open) {
      weixinIlinkLoginOpen.value = true
      return
    }

    closeWeixinIlinkLoginDialog()
  }
})
const weixinIlinkLoginBusy = computed(
  () => weixinIlinkLoginStarting.value || weixinIlinkLoginWaiting.value
)

const normalizeTelegramSettings = (
  snapshot: Partial<TelegramRemoteSettings> | null | undefined
): TelegramRemoteSettings => {
  const fallback = defaultTelegramSettings()
  return {
    botToken: snapshot?.botToken ?? fallback.botToken,
    remoteEnabled: snapshot?.remoteEnabled ?? fallback.remoteEnabled,
    defaultAgentId: snapshot?.defaultAgentId ?? fallback.defaultAgentId,
    defaultWorkdir: snapshot?.defaultWorkdir ?? fallback.defaultWorkdir
  }
}

const normalizeFeishuSettings = (
  snapshot: Partial<FeishuRemoteSettings> | null | undefined
): FeishuRemoteSettings => {
  const fallback = defaultFeishuSettings()
  return {
    brand: snapshot?.brand ?? fallback.brand,
    appId: snapshot?.appId ?? fallback.appId,
    appSecret: snapshot?.appSecret ?? fallback.appSecret,
    verificationToken: snapshot?.verificationToken ?? fallback.verificationToken,
    encryptKey: snapshot?.encryptKey ?? fallback.encryptKey,
    remoteEnabled: snapshot?.remoteEnabled ?? fallback.remoteEnabled,
    enableStreamingCards: snapshot?.enableStreamingCards ?? fallback.enableStreamingCards,
    defaultAgentId: snapshot?.defaultAgentId ?? fallback.defaultAgentId,
    defaultWorkdir: snapshot?.defaultWorkdir ?? fallback.defaultWorkdir,
    pairedUserOpenIds: [...(snapshot?.pairedUserOpenIds ?? fallback.pairedUserOpenIds)]
  }
}

const normalizeQQBotSettings = (
  snapshot: Partial<QQBotRemoteSettings> | null | undefined
): QQBotRemoteSettings => {
  const fallback = defaultQQBotSettings()
  return {
    appId: snapshot?.appId ?? fallback.appId,
    clientSecret: snapshot?.clientSecret ?? fallback.clientSecret,
    remoteEnabled: snapshot?.remoteEnabled ?? fallback.remoteEnabled,
    defaultAgentId: snapshot?.defaultAgentId ?? fallback.defaultAgentId,
    defaultWorkdir: snapshot?.defaultWorkdir ?? fallback.defaultWorkdir,
    pairedUserIds: [...(snapshot?.pairedUserIds ?? fallback.pairedUserIds)]
  }
}

const normalizeDiscordSettings = (
  snapshot: Partial<DiscordRemoteSettings> | null | undefined
): DiscordRemoteSettings => {
  const fallback = defaultDiscordSettings()
  return {
    botToken: snapshot?.botToken ?? fallback.botToken,
    remoteEnabled: snapshot?.remoteEnabled ?? fallback.remoteEnabled,
    defaultAgentId: snapshot?.defaultAgentId ?? fallback.defaultAgentId,
    defaultWorkdir: snapshot?.defaultWorkdir ?? fallback.defaultWorkdir,
    pairedChannelIds: [...(snapshot?.pairedChannelIds ?? fallback.pairedChannelIds)]
  }
}

const normalizeWeixinIlinkSettings = (
  snapshot: Partial<WeixinIlinkRemoteSettings> | null | undefined
): WeixinIlinkRemoteSettings => {
  const fallback = defaultWeixinIlinkSettings()
  return {
    remoteEnabled: snapshot?.remoteEnabled ?? fallback.remoteEnabled,
    defaultAgentId: snapshot?.defaultAgentId ?? fallback.defaultAgentId,
    defaultWorkdir: snapshot?.defaultWorkdir ?? fallback.defaultWorkdir,
    accounts: [...(snapshot?.accounts ?? fallback.accounts)].map((account) => ({
      accountId: String(account.accountId ?? '').trim(),
      ownerUserId: String(account.ownerUserId ?? '').trim(),
      baseUrl: String(account.baseUrl ?? '').trim(),
      enabled: account.enabled !== false
    }))
  }
}

const rebaseSettingsDraft = <Settings extends object>(
  current: Settings | null,
  previous: Settings | null,
  next: Settings
): Settings => {
  if (!current || !previous) return next

  const rebased = { ...next }
  for (const key of Object.keys(current) as Array<keyof Settings>) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      rebased[key] = current[key]
    }
  }
  return rebased
}

const settingsSnapshotsMatch = <Settings extends object>(
  left: Settings | null,
  right: Settings | null
) => JSON.stringify(left) === JSON.stringify(right)

const reconcilePersistedSettings = <Settings extends object>(
  current: Settings | null,
  previous: Settings | null,
  next: Settings,
  apply: (persisted: Settings, draft: Settings) => void,
  rebase = rebaseSettingsDraft<Settings>
): boolean => {
  const draft = rebase(current, previous, next)
  apply(next, draft)
  return settingsSnapshotsMatch(draft, next)
}

const rebaseWeixinIlinkAccounts = (
  current: WeixinIlinkRemoteSettings['accounts'],
  previous: WeixinIlinkRemoteSettings['accounts'],
  next: WeixinIlinkRemoteSettings['accounts']
): WeixinIlinkRemoteSettings['accounts'] => {
  const currentById = new Map(current.map((account) => [account.accountId, account]))
  const previousById = new Map(previous.map((account) => [account.accountId, account]))
  const nextIds = new Set(next.map((account) => account.accountId))
  const rebased = next.flatMap((account) => {
    const currentAccount = currentById.get(account.accountId)
    const previousAccount = previousById.get(account.accountId)
    if (!currentAccount) return previousAccount ? [] : [account]
    if (!previousAccount) return [currentAccount]
    return [rebaseSettingsDraft(currentAccount, previousAccount, account)]
  })

  for (const account of current) {
    if (nextIds.has(account.accountId)) continue
    const previousAccount = previousById.get(account.accountId)
    if (!previousAccount || !settingsSnapshotsMatch(account, previousAccount)) {
      rebased.push(account)
    }
  }
  return rebased
}

const rebaseWeixinIlinkDraft = (
  current: WeixinIlinkRemoteSettings | null,
  previous: WeixinIlinkRemoteSettings | null,
  next: WeixinIlinkRemoteSettings
): WeixinIlinkRemoteSettings => {
  if (!current || !previous) return next

  const scalarDraft = rebaseSettingsDraft(
    { ...current, accounts: previous.accounts },
    previous,
    next
  )
  return {
    ...scalarDraft,
    accounts: rebaseWeixinIlinkAccounts(current.accounts, previous.accounts, next.accounts)
  }
}

const acceptPersistedTelegramSettings = (
  snapshot: Partial<TelegramRemoteSettings> | null | undefined,
  applyToDraft = true
) => {
  const normalized = normalizeTelegramSettings(snapshot)
  persistedTelegramSettings.value = normalized
  if (applyToDraft) telegramSettings.value = { ...normalized }
}

const acceptPersistedFeishuSettings = (
  snapshot: Partial<FeishuRemoteSettings> | null | undefined,
  applyToDraft = true
) => {
  const normalized = normalizeFeishuSettings(snapshot)
  persistedFeishuSettings.value = normalized
  if (applyToDraft) feishuSettings.value = normalizeFeishuSettings(normalized)
}

const acceptPersistedQQBotSettings = (
  snapshot: Partial<QQBotRemoteSettings> | null | undefined,
  applyToDraft = true
) => {
  const normalized = normalizeQQBotSettings(snapshot)
  persistedQQBotSettings.value = normalized
  if (applyToDraft) qqbotSettings.value = normalizeQQBotSettings(normalized)
}

const acceptPersistedDiscordSettings = (
  snapshot: Partial<DiscordRemoteSettings> | null | undefined,
  applyToDraft = true
) => {
  const normalized = normalizeDiscordSettings(snapshot)
  persistedDiscordSettings.value = normalized
  if (applyToDraft) discordSettings.value = normalizeDiscordSettings(normalized)
}

const acceptPersistedWeixinIlinkSettings = (
  snapshot: Partial<WeixinIlinkRemoteSettings> | null | undefined,
  applyToDraft = true
) => {
  const normalized = normalizeWeixinIlinkSettings(snapshot)
  persistedWeixinIlinkSettings.value = normalized
  if (applyToDraft) weixinIlinkSettings.value = normalizeWeixinIlinkSettings(normalized)
}

const rebasePersistedTelegramSettings = (
  snapshot: Partial<TelegramRemoteSettings> | null | undefined,
  previous = persistedTelegramSettings.value
): boolean => {
  const normalized = normalizeTelegramSettings(snapshot)
  return reconcilePersistedSettings(
    telegramSettings.value ? normalizeTelegramSettings(telegramSettings.value) : null,
    previous ? normalizeTelegramSettings(previous) : null,
    normalized,
    (persisted, draft) => {
      persistedTelegramSettings.value = persisted
      telegramSettings.value = normalizeTelegramSettings(draft)
    }
  )
}

const rebasePersistedFeishuSettings = (
  snapshot: Partial<FeishuRemoteSettings> | null | undefined,
  previous = persistedFeishuSettings.value
): boolean => {
  const normalized = normalizeFeishuSettings(snapshot)
  return reconcilePersistedSettings(
    feishuSettings.value ? normalizeFeishuSettings(feishuSettings.value) : null,
    previous ? normalizeFeishuSettings(previous) : null,
    normalized,
    (persisted, draft) => {
      persistedFeishuSettings.value = persisted
      feishuSettings.value = normalizeFeishuSettings(draft)
    }
  )
}

const rebasePersistedQQBotSettings = (
  snapshot: Partial<QQBotRemoteSettings> | null | undefined,
  previous = persistedQQBotSettings.value
): boolean => {
  const normalized = normalizeQQBotSettings(snapshot)
  return reconcilePersistedSettings(
    qqbotSettings.value ? normalizeQQBotSettings(qqbotSettings.value) : null,
    previous ? normalizeQQBotSettings(previous) : null,
    normalized,
    (persisted, draft) => {
      persistedQQBotSettings.value = persisted
      qqbotSettings.value = normalizeQQBotSettings(draft)
    }
  )
}

const rebasePersistedDiscordSettings = (
  snapshot: Partial<DiscordRemoteSettings> | null | undefined,
  previous = persistedDiscordSettings.value
): boolean => {
  const normalized = normalizeDiscordSettings(snapshot)
  return reconcilePersistedSettings(
    discordSettings.value ? normalizeDiscordSettings(discordSettings.value) : null,
    previous ? normalizeDiscordSettings(previous) : null,
    normalized,
    (persisted, draft) => {
      persistedDiscordSettings.value = persisted
      discordSettings.value = normalizeDiscordSettings(draft)
    }
  )
}

const rebasePersistedWeixinIlinkSettings = (
  snapshot: Partial<WeixinIlinkRemoteSettings> | null | undefined,
  previous = persistedWeixinIlinkSettings.value
): boolean => {
  const normalized = normalizeWeixinIlinkSettings(snapshot)
  return reconcilePersistedSettings(
    weixinIlinkSettings.value ? normalizeWeixinIlinkSettings(weixinIlinkSettings.value) : null,
    previous ? normalizeWeixinIlinkSettings(previous) : null,
    normalized,
    (persisted, draft) => {
      persistedWeixinIlinkSettings.value = persisted
      weixinIlinkSettings.value = normalizeWeixinIlinkSettings(draft)
    },
    rebaseWeixinIlinkDraft
  )
}

function channelStatus(channel: 'telegram'): TelegramRemoteStatus | null
function channelStatus(channel: 'feishu'): FeishuRemoteStatus | null
function channelStatus(channel: 'qqbot'): QQBotRemoteStatus | null
function channelStatus(channel: 'discord'): DiscordRemoteStatus | null
function channelStatus(channel: 'weixin-ilink'): WeixinIlinkRemoteStatus | null
function channelStatus(channel: RemoteChannel): RemoteChannelStatus | null
function channelStatus(channel: RemoteChannel): RemoteChannelStatus | null {
  if (channel === 'telegram') {
    return telegramStatus.value
  }
  if (channel === 'feishu') {
    return feishuStatus.value
  }
  if (channel === 'qqbot') {
    return qqbotStatus.value
  }
  if (channel === 'discord') {
    return discordStatus.value
  }
  return weixinIlinkStatus.value
}

const getSnapshotPrincipalIds = (
  channel: PairableRemoteChannel,
  snapshot: RemotePairingSnapshot
): string[] =>
  channel === 'telegram'
    ? normalizeTelegramPairingSnapshot(
        snapshot as Partial<TelegramPairingSnapshot>
      ).allowedUserIds.map((value) => String(value))
    : channel === 'feishu'
      ? normalizeFeishuPairingSnapshot(snapshot as Partial<FeishuPairingSnapshot>).pairedUserOpenIds
      : channel === 'qqbot'
        ? normalizeQQBotPairingSnapshot(snapshot as Partial<QQBotPairingSnapshot>).pairedUserIds
        : normalizeDiscordPairingSnapshot(snapshot as Partial<DiscordPairingSnapshot>)
            .pairedChannelIds

const hasEnabledRemoteSettings = () =>
  Boolean(
    telegramSettings.value?.remoteEnabled ||
    feishuSettings.value?.remoteEnabled ||
    qqbotSettings.value?.remoteEnabled ||
    discordSettings.value?.remoteEnabled ||
    weixinIlinkSettings.value?.remoteEnabled ||
    weixinIlinkSettings.value?.accounts?.some((account) => account.enabled)
  )

const clearStatusRefreshTimer = () => {
  if (!statusRefreshTimer) return
  clearTimeout(statusRefreshTimer)
  statusRefreshTimer = null
}

const runStatusRefresh = async () => {
  const refreshed = await refreshStatus()
  statusRefreshErrors = refreshed ? 0 : statusRefreshErrors + 1

  if (remoteSettingsUnmounted || document.visibilityState === 'hidden') return
  const backoffMs = Math.min(30_000, 2_000 * 2 ** statusRefreshErrors)
  scheduleStatusRefresh(
    hasEnabledRemoteSettings()
      ? refreshed
        ? REMOTE_STATUS_ACTIVE_POLL_MS
        : backoffMs
      : REMOTE_STATUS_IDLE_POLL_MS
  )
}

const scheduleStatusRefresh = (delayMs = 0) => {
  clearStatusRefreshTimer()
  if (remoteSettingsUnmounted || document.visibilityState === 'hidden') return

  if (delayMs <= 0) {
    void runStatusRefresh()
    return
  }

  statusRefreshTimer = setTimeout(() => {
    statusRefreshTimer = null
    void runStatusRefresh()
  }, delayMs)
}

const refreshStatus = async (): Promise<boolean> => {
  try {
    const [
      nextTelegramStatus,
      nextFeishuStatus,
      nextQQBotStatus,
      nextDiscordStatus,
      nextWeixinIlinkStatus
    ] = await Promise.all([
      getChannelStatusCompat('telegram'),
      getChannelStatusCompat('feishu'),
      getChannelStatusCompat('qqbot'),
      getChannelStatusCompat('discord'),
      getChannelStatusCompat('weixin-ilink')
    ])
    telegramStatus.value = nextTelegramStatus
    feishuStatus.value = nextFeishuStatus
    qqbotStatus.value = nextQQBotStatus
    discordStatus.value = nextDiscordStatus
    weixinIlinkStatus.value = nextWeixinIlinkStatus
    return true
  } catch (error) {
    console.warn('[RemoteSettings] Failed to refresh remote channel status', error)
    return false
  }
}

const refreshChannelStatus = async (channel: RemoteChannel): Promise<boolean> => {
  try {
    if (channel === 'telegram') {
      telegramStatus.value = await getChannelStatusCompat('telegram')
    } else if (channel === 'feishu') {
      feishuStatus.value = await getChannelStatusCompat('feishu')
    } else if (channel === 'qqbot') {
      qqbotStatus.value = await getChannelStatusCompat('qqbot')
    } else if (channel === 'discord') {
      discordStatus.value = await getChannelStatusCompat('discord')
    } else {
      weixinIlinkStatus.value = await getChannelStatusCompat('weixin-ilink')
    }
    return true
  } catch (error) {
    console.warn(
      '[RemoteSettings] Failed to refresh remote channel status',
      {
        channel
      },
      error
    )
    return false
  }
}

const refreshPairingSnapshot = async (
  channel: PairableRemoteChannel
): Promise<RemotePairingSnapshot> => {
  return await getChannelPairingSnapshotCompat(channel)
}

const loadAvailableAgents = async () => {
  availableAgents.value = await sessionClient.getAgents()
}

const loadRecentProjects = async () => {
  try {
    const result = await projectClient.listRecent(8)
    recentProjects.value = Array.isArray(result) ? result : []
  } catch {
    recentProjects.value = []
  }
}

const loadState = async () => {
  const requestId = ++loadStateRequestId
  isLoading.value = true
  try {
    const [
      loadedChannelDescriptors,
      loadedTelegramSettings,
      loadedFeishuSettings,
      loadedQQBotSettings,
      loadedDiscordSettings,
      loadedWeixinIlinkSettings,
      loadedTelegramStatus,
      loadedFeishuStatus,
      loadedQQBotStatus,
      loadedDiscordStatus,
      loadedWeixinIlinkStatus
    ] = await Promise.all([
      remoteControlClient.listRemoteChannels(),
      getChannelSettingsCompat('telegram'),
      getChannelSettingsCompat('feishu'),
      getChannelSettingsCompat('qqbot'),
      getChannelSettingsCompat('discord'),
      getChannelSettingsCompat('weixin-ilink'),
      getChannelStatusCompat('telegram'),
      getChannelStatusCompat('feishu'),
      getChannelStatusCompat('qqbot'),
      getChannelStatusCompat('discord'),
      getChannelStatusCompat('weixin-ilink'),
      loadAvailableAgents(),
      loadRecentProjects()
    ])

    if (requestId !== loadStateRequestId || remoteSettingsUnmounted) return
    channelDescriptors.value = loadedChannelDescriptors
    acceptPersistedTelegramSettings(loadedTelegramSettings)
    acceptPersistedFeishuSettings(loadedFeishuSettings)
    acceptPersistedQQBotSettings(loadedQQBotSettings)
    acceptPersistedDiscordSettings(loadedDiscordSettings)
    acceptPersistedWeixinIlinkSettings(loadedWeixinIlinkSettings)
    telegramStatus.value = loadedTelegramStatus
    feishuStatus.value = loadedFeishuStatus
    qqbotStatus.value = loadedQQBotStatus
    discordStatus.value = loadedDiscordStatus
    weixinIlinkStatus.value = loadedWeixinIlinkStatus

    syncActiveChannelFromProps()
    if (!remoteChannelIds.value.includes(activeChannel.value)) {
      activeChannel.value = remoteChannelIds.value[0] ?? 'telegram'
    }
    scheduleStatusRefresh(
      hasEnabledRemoteSettings() ? REMOTE_STATUS_ACTIVE_POLL_MS : REMOTE_STATUS_IDLE_POLL_MS
    )
  } catch (error) {
    if (requestId !== loadStateRequestId || remoteSettingsUnmounted) return
    console.error('[RemoteSettings] Failed to load remote settings', error)
  } finally {
    if (requestId === loadStateRequestId) {
      isLoading.value = false
    }
  }
}

const buildTelegramDraftSettings = (): TelegramRemoteSettings | null => {
  if (!telegramSettings.value) {
    return null
  }

  const settings = telegramSettings.value
  return {
    botToken: settings.botToken,
    remoteEnabled: settings.remoteEnabled,
    defaultAgentId: settings.defaultAgentId,
    defaultWorkdir: settings.defaultWorkdir
  }
}

const buildFeishuDraftSettings = (): FeishuRemoteSettings | null => {
  if (!feishuSettings.value) {
    return null
  }

  const settings = feishuSettings.value
  return {
    brand: settings.brand,
    appId: settings.appId,
    appSecret: settings.appSecret,
    verificationToken: settings.verificationToken,
    encryptKey: settings.encryptKey,
    remoteEnabled: settings.remoteEnabled,
    enableStreamingCards: settings.enableStreamingCards,
    defaultAgentId: settings.defaultAgentId,
    defaultWorkdir: settings.defaultWorkdir,
    pairedUserOpenIds: [...(settings.pairedUserOpenIds ?? [])]
  }
}

const buildQQBotDraftSettings = (): QQBotRemoteSettings | null => {
  if (!qqbotSettings.value) {
    return null
  }

  const settings = qqbotSettings.value
  return {
    appId: settings.appId,
    clientSecret: settings.clientSecret,
    remoteEnabled: settings.remoteEnabled,
    defaultAgentId: settings.defaultAgentId,
    defaultWorkdir: settings.defaultWorkdir,
    pairedUserIds: [...(settings.pairedUserIds ?? [])]
  }
}

const buildDiscordDraftSettings = (): DiscordRemoteSettings | null => {
  if (!discordSettings.value) {
    return null
  }

  const settings = discordSettings.value
  return {
    botToken: settings.botToken,
    remoteEnabled: settings.remoteEnabled,
    defaultAgentId: settings.defaultAgentId,
    defaultWorkdir: settings.defaultWorkdir,
    pairedChannelIds: [...(settings.pairedChannelIds ?? [])]
  }
}

const buildWeixinIlinkDraftSettings = (): WeixinIlinkRemoteSettings | null => {
  if (!weixinIlinkSettings.value) {
    return null
  }

  const settings = weixinIlinkSettings.value
  return {
    remoteEnabled: settings.remoteEnabled,
    defaultAgentId: settings.defaultAgentId,
    defaultWorkdir: settings.defaultWorkdir,
    accounts: (settings.accounts ?? []).map((account) => ({
      accountId: String(account.accountId ?? '').trim(),
      ownerUserId: String(account.ownerUserId ?? '').trim(),
      baseUrl: String(account.baseUrl ?? '').trim(),
      enabled: account.enabled !== false
    }))
  }
}

const isChannelDirty = (channel: RemoteChannel): boolean => {
  if (channel === 'telegram') {
    return !settingsSnapshotsMatch(buildTelegramDraftSettings(), persistedTelegramSettings.value)
  }
  if (channel === 'feishu') {
    return !settingsSnapshotsMatch(buildFeishuDraftSettings(), persistedFeishuSettings.value)
  }
  if (channel === 'qqbot') {
    return !settingsSnapshotsMatch(buildQQBotDraftSettings(), persistedQQBotSettings.value)
  }
  if (channel === 'discord') {
    return !settingsSnapshotsMatch(buildDiscordDraftSettings(), persistedDiscordSettings.value)
  }
  return !settingsSnapshotsMatch(
    buildWeixinIlinkDraftSettings(),
    persistedWeixinIlinkSettings.value
  )
}

const hasUnsavedChannelDrafts = computed(() =>
  REMOTE_CHANNELS.some((channel) => isChannelDirty(channel))
)

const refreshAfterChannelSave = async (channel: RemoteChannel) => {
  await refreshChannelStatus(channel)
}

const resolveSaveFailure = (channel: RemoteChannel, error: unknown) => {
  if (isAcpDefaultWorkdirRequiredError(error)) {
    return {
      title: t('settings.remote.remoteControl.acpDefaultWorkdirRequiredTitle'),
      description: t('settings.remote.remoteControl.acpDefaultWorkdirRequiredDescription')
    }
  }
  return {
    title: t('common.error.operationFailed'),
    description: channelTitle(channel)
  }
}

type ChannelSaveCoordinatorPort = Readonly<{
  request(): Promise<boolean>
}>

const createSaveCoordinator = <Settings>(
  channel: RemoteChannel,
  readDraft: () => Settings | null,
  persist: (draft: Settings) => Promise<Settings>,
  reconcilePersisted: (settings: Settings, submitted: Settings) => boolean
): ChannelSaveCoordinatorPort =>
  new RemoteChannelSaveCoordinator({
    readDraft,
    persist,
    commit: (settings, { draft }) => reconcilePersisted(settings, draft),
    onStarted: () => {
      saving[channel] = true
    },
    onSucceeded: ({ isCurrentDraftPersisted }) => {
      saving[channel] = false
      if (isCurrentDraftPersisted) {
        notifyRenderer({
          kind: 'success',
          code: `settings.remote.${channelI18nKeyMap[channel]}.saveSucceeded`,
          title: t('common.saved'),
          description: channelTitle(channel)
        })
      }
      if (!remoteSettingsUnmounted) {
        void refreshAfterChannelSave(channel)
      }
    },
    onFailed: (error) => {
      saving[channel] = false
      console.error(
        '[RemoteSettings] Failed to save channel settings',
        {
          channel
        },
        error
      )
      notifyRenderer({
        kind: 'error',
        code: `settings.remote.${channelI18nKeyMap[channel]}.saveFailed`,
        ...resolveSaveFailure(channel, error)
      })
    }
  })

const saveCoordinators: Record<RemoteChannel, ChannelSaveCoordinatorPort> = {
  telegram: createSaveCoordinator(
    'telegram',
    buildTelegramDraftSettings,
    (settings) => saveChannelSettingsCompat('telegram', settings),
    (settings, submitted) => rebasePersistedTelegramSettings(settings, submitted)
  ),
  feishu: createSaveCoordinator(
    'feishu',
    buildFeishuDraftSettings,
    (settings) => saveChannelSettingsCompat('feishu', settings),
    (settings, submitted) => rebasePersistedFeishuSettings(settings, submitted)
  ),
  qqbot: createSaveCoordinator(
    'qqbot',
    buildQQBotDraftSettings,
    (settings) => saveChannelSettingsCompat('qqbot', settings),
    (settings, submitted) => rebasePersistedQQBotSettings(settings, submitted)
  ),
  discord: createSaveCoordinator(
    'discord',
    buildDiscordDraftSettings,
    (settings) => saveChannelSettingsCompat('discord', settings),
    (settings, submitted) => rebasePersistedDiscordSettings(settings, submitted)
  ),
  'weixin-ilink': createSaveCoordinator(
    'weixin-ilink',
    buildWeixinIlinkDraftSettings,
    (settings) => saveChannelSettingsCompat('weixin-ilink', settings),
    (settings, submitted) => rebasePersistedWeixinIlinkSettings(settings, submitted)
  )
}

const beginChannelAction = (channel: RemoteChannel, label = t('common.loading')): boolean => {
  if (pendingChannelActionIds.value[channel] !== null) return false
  pendingChannelActionIds.value[channel] = label
  return true
}

const failChannelAction = (
  channel: RemoteChannel,
  code: string,
  title = t('common.error.operationFailed'),
  description = channelTitle(channel)
) => {
  pendingChannelActionIds.value[channel] = null
  notifyRenderer({
    kind: 'error',
    code,
    title,
    description
  })
}

const completeObservedChannelAction = (channel: RemoteChannel, code: string, title: string) => {
  pendingChannelActionIds.value[channel] = null
  notifyRenderer({
    kind: 'success',
    code,
    title,
    description: channelTitle(channel)
  })
}

const persistChannelSettings = async (channel: RemoteChannel): Promise<boolean> =>
  await saveCoordinators[channel].request()

const persistTelegramSettings = async () => await persistChannelSettings('telegram')
const persistFeishuSettings = async () => await persistChannelSettings('feishu')
const persistQQBotSettings = async () => await persistChannelSettings('qqbot')
const persistDiscordSettings = async () => await persistChannelSettings('discord')
const persistWeixinIlinkSettings = async () => await persistChannelSettings('weixin-ilink')

const queueTelegramSettingsPersist = () => {
  void persistTelegramSettings()
}

const queueFeishuSettingsPersist = () => {
  void persistFeishuSettings()
}

const queueQQBotSettingsPersist = () => {
  void persistQQBotSettings()
}

const queueDiscordSettingsPersist = () => {
  void persistDiscordSettings()
}

const queueWeixinIlinkSettingsPersist = () => {
  void persistWeixinIlinkSettings()
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

const updateDiscordRemoteEnabled = (value: boolean) => {
  if (!discordSettings.value) {
    return
  }
  discordSettings.value.remoteEnabled = Boolean(value)
  queueDiscordSettingsPersist()
}

const updateWeixinIlinkRemoteEnabled = (value: boolean) => {
  if (!weixinIlinkSettings.value) {
    return
  }
  weixinIlinkSettings.value.remoteEnabled = Boolean(value)
  queueWeixinIlinkSettingsPersist()
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

const updateDiscordDefaultAgentId = (value: string) => {
  if (!discordSettings.value) {
    return
  }
  discordSettings.value.defaultAgentId = value
  queueDiscordSettingsPersist()
}

const updateWeixinIlinkDefaultAgentId = (value: string) => {
  if (!weixinIlinkSettings.value) {
    return
  }
  weixinIlinkSettings.value.defaultAgentId = value
  queueWeixinIlinkSettingsPersist()
}

let feishuAuthRequestId = 0
let feishuInstallRequestId = 0
let weixinIlinkLoginRequestId = 0
let remoteSettingsUnmounted = false

const generateFeishuInstallQrDataUrl = async (installUrl: string): Promise<string> => {
  return await QRCode.toDataURL(installUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
    color: {
      dark: '#000000ff',
      light: '#ffffffff'
    }
  })
}

const waitForFeishuInstallResult = async (requestId: number, sessionKey: string) => {
  if (requestId !== feishuInstallRequestId) {
    return
  }

  feishuInstallWaiting.value = true

  try {
    const result = await waitForFeishuInstallCompat({
      sessionKey,
      timeoutMs: 5 * 60_000
    })
    if (requestId !== feishuInstallRequestId) {
      return
    }

    feishuInstallMessage.value = resolveFeishuInstallMessage(result)
    feishuInstallError.value = result.installed ? null : feishuInstallMessage.value

    if (result.installed) {
      const [settings, status] = await Promise.all([
        getChannelSettingsCompat('feishu'),
        getChannelStatusCompat('feishu')
      ])
      if (requestId !== feishuInstallRequestId) {
        return
      }

      rebasePersistedFeishuSettings(settings)
      feishuStatus.value = status

      feishuInstallQrDialogOpen.value = false
      feishuInstallMode.value = null
    }
  } catch (error) {
    if (requestId !== feishuInstallRequestId) {
      return
    }

    console.error('[RemoteSettings] Failed while waiting for Feishu install', error)
    feishuInstallMessage.value = ''
    feishuInstallError.value = t('settings.remote.feishu.installFailed')
  } finally {
    if (requestId === feishuInstallRequestId) {
      feishuInstallWaiting.value = false
      feishuInstallSessionKey.value = null
      if (!feishuInstallQrDialogOpen.value) {
        feishuInstallMode.value = null
      }
    }
  }
}

const startFeishuInstall = async (mode: 'web' | 'qr') => {
  if (feishuInstallBusy.value || !feishuSettings.value) {
    return
  }
  if (!(await persistChannelDraftOrAbort('feishu')) || remoteSettingsUnmounted) {
    return
  }

  const requestId = ++feishuInstallRequestId
  feishuInstallMode.value = mode
  feishuInstallMessage.value = t('common.loading')
  feishuInstallError.value = null
  feishuInstallUserCode.value = ''
  feishuInstallQrUrl.value = ''
  feishuInstallQrDataUrl.value = ''
  feishuInstallQrDialogOpen.value = mode === 'qr'
  feishuInstallStarting.value = true
  feishuInstallWaiting.value = false

  let sessionKeyToCancel: string | null = null

  try {
    const session = await startFeishuInstallCompat({
      brand: feishuSettings.value.brand
    })
    sessionKeyToCancel = session.sessionKey
    if (requestId !== feishuInstallRequestId) {
      await cancelFeishuInstallCompat(session.sessionKey).catch(() => undefined)
      return
    }

    feishuInstallSessionKey.value = session.sessionKey
    feishuInstallUserCode.value = session.userCode
    feishuInstallMessage.value = resolveFeishuInstallMessage(session)

    if (mode === 'qr') {
      feishuInstallQrUrl.value = session.installUrl
      const qrDataUrl = await generateFeishuInstallQrDataUrl(session.installUrl)
      if (requestId !== feishuInstallRequestId) {
        await cancelFeishuInstallCompat(session.sessionKey).catch(() => undefined)
        return
      }
      feishuInstallQrDataUrl.value = qrDataUrl
    } else {
      await openExternalUrl(session.installUrl)
    }

    void waitForFeishuInstallResult(requestId, session.sessionKey)
  } catch (error) {
    if (requestId !== feishuInstallRequestId) {
      return
    }

    if (sessionKeyToCancel) {
      await cancelFeishuInstallCompat(sessionKeyToCancel).catch(() => undefined)
      feishuInstallSessionKey.value = null
    }
    if (remoteSettingsUnmounted) {
      return
    }
    console.error('[RemoteSettings] Failed to start Feishu install', error)
    feishuInstallMessage.value = ''
    feishuInstallError.value = t('settings.remote.feishu.installFailed')
  } finally {
    if (requestId === feishuInstallRequestId) {
      feishuInstallStarting.value = false
    }
  }
}

const cancelFeishuInstall = async (resetUi = true) => {
  feishuInstallRequestId += 1
  const sessionKey = feishuInstallSessionKey.value
  feishuInstallSessionKey.value = null
  feishuInstallStarting.value = false
  feishuInstallWaiting.value = false
  if (resetUi) {
    feishuInstallUserCode.value = ''
    feishuInstallMessage.value = ''
    feishuInstallError.value = null
    feishuInstallQrUrl.value = ''
    feishuInstallQrDataUrl.value = ''
    feishuInstallQrDialogOpen.value = false
    feishuInstallMode.value = null
  }
  if (sessionKey) {
    await cancelFeishuInstallCompat(sessionKey).catch(() => undefined)
  }
}

const closeFeishuInstallQrDialog = () => {
  if (feishuInstallBusy.value) {
    void cancelFeishuInstall()
    return
  }

  feishuInstallQrDialogOpen.value = false
}

const openFeishuInstallQrUrl = async () => {
  if (!feishuInstallQrUrl.value) {
    return
  }

  try {
    await openExternalUrl(feishuInstallQrUrl.value)
  } catch (error) {
    console.error('[RemoteSettings] Failed to open Feishu install URL', error)
    feishuInstallMessage.value = ''
    feishuInstallError.value = t('common.error.operationFailed')
  }
}

const waitForFeishuAuthResult = async (requestId: number, sessionKey: string) => {
  if (requestId !== feishuAuthRequestId) {
    return
  }

  feishuAuthWaiting.value = true

  try {
    const result = await waitForFeishuAuthCompat({
      sessionKey,
      timeoutMs: 5 * 60_000
    })
    if (requestId !== feishuAuthRequestId) {
      return
    }

    feishuAuthMessage.value = resolveFeishuAuthMessage(result)
    feishuAuthError.value = result.authorized ? null : feishuAuthMessage.value

    if (result.authorized) {
      const [settings, status] = await Promise.all([
        getChannelSettingsCompat('feishu'),
        getChannelStatusCompat('feishu')
      ])
      if (requestId !== feishuAuthRequestId) {
        return
      }

      rebasePersistedFeishuSettings(settings)
      feishuStatus.value = status
    }
  } catch (error) {
    if (requestId !== feishuAuthRequestId) {
      return
    }

    console.error('[RemoteSettings] Failed while waiting for Feishu authorization', error)
    feishuAuthMessage.value = ''
    feishuAuthError.value = t('settings.remote.feishu.authFailed')
  } finally {
    if (requestId === feishuAuthRequestId) {
      feishuAuthWaiting.value = false
      feishuAuthSessionKey.value = null
    }
  }
}

const startFeishuScanAuth = async () => {
  if (feishuAuthBusy.value || !feishuSettings.value) {
    return
  }

  if (!(await persistChannelDraftOrAbort('feishu'))) {
    return
  }
  if (remoteSettingsUnmounted) {
    return
  }

  const requestId = ++feishuAuthRequestId
  feishuAuthMessage.value = t('common.loading')
  feishuAuthError.value = null
  feishuAuthStarting.value = true
  feishuAuthWaiting.value = false

  let sessionKeyToCancel: string | null = null

  try {
    const settings = feishuSettings.value
    const session = await startFeishuAuthCompat({
      brand: settings.brand,
      appId: settings.appId,
      appSecret: settings.appSecret
    })
    sessionKeyToCancel = session.sessionKey
    if (requestId !== feishuAuthRequestId) {
      await cancelFeishuAuthCompat(session.sessionKey).catch(() => undefined)
      return
    }

    feishuAuthSessionKey.value = session.sessionKey
    feishuAuthMessage.value = resolveFeishuAuthMessage(session)
    void waitForFeishuAuthResult(requestId, session.sessionKey)
  } catch (error) {
    if (requestId !== feishuAuthRequestId) {
      return
    }

    if (sessionKeyToCancel) {
      await cancelFeishuAuthCompat(sessionKeyToCancel).catch(() => undefined)
      feishuAuthSessionKey.value = null
    }
    if (remoteSettingsUnmounted) {
      return
    }

    console.error('[RemoteSettings] Failed to start Feishu authorization', error)
    feishuAuthMessage.value = ''
    feishuAuthError.value = t('settings.remote.feishu.authFailed')
  } finally {
    if (requestId === feishuAuthRequestId) {
      feishuAuthStarting.value = false
    }
  }
}

const cancelFeishuScanAuth = async (resetUi = true) => {
  feishuAuthRequestId += 1
  const sessionKey = feishuAuthSessionKey.value
  feishuAuthSessionKey.value = null
  feishuAuthStarting.value = false
  feishuAuthWaiting.value = false
  if (resetUi) {
    feishuAuthMessage.value = ''
    feishuAuthError.value = null
  }
  if (sessionKey) {
    await cancelFeishuAuthCompat(sessionKey).catch(() => undefined)
  }
}

const closeWeixinIlinkLoginDialog = () => {
  weixinIlinkLoginRequestId += 1
  weixinIlinkLoginOpen.value = false
  weixinIlinkLoginMessage.value = ''
  weixinIlinkLoginError.value = null
  weixinIlinkLoginStarting.value = false
  weixinIlinkLoginWaiting.value = false
}

const waitForWeixinIlinkLoginResult = async (requestId: number, sessionKey: string) => {
  weixinIlinkLoginWaiting.value = true

  try {
    const result = await waitForWeixinIlinkLoginCompat({
      sessionKey,
      timeoutMs: 8 * 60_000
    })
    if (requestId !== weixinIlinkLoginRequestId) {
      return
    }

    weixinIlinkLoginMessage.value = resolveWeixinIlinkLoginMessage(result)
    weixinIlinkLoginError.value = result.connected ? null : weixinIlinkLoginMessage.value

    if (result.connected) {
      await Promise.all([
        (async () => {
          const settings = await getChannelSettingsCompat('weixin-ilink')
          rebasePersistedWeixinIlinkSettings(settings)
        })(),
        refreshChannelStatus('weixin-ilink')
      ])

      closeWeixinIlinkLoginDialog()
    }
  } catch (error) {
    if (requestId !== weixinIlinkLoginRequestId) {
      return
    }

    console.error('[RemoteSettings] Failed while waiting for WeChat iLink login', error)
    weixinIlinkLoginMessage.value = ''
    weixinIlinkLoginError.value = t('settings.remote.weixinIlink.loginFailed')
  } finally {
    if (requestId === weixinIlinkLoginRequestId) {
      weixinIlinkLoginWaiting.value = false
    }
  }
}

const startWeixinIlinkLogin = async (force = false) => {
  if (weixinIlinkLoginBusy.value) {
    return
  }

  if (!(await persistChannelDraftOrAbort('weixin-ilink'))) {
    return
  }

  const requestId = ++weixinIlinkLoginRequestId
  weixinIlinkLoginOpen.value = true
  weixinIlinkLoginMessage.value = t('common.loading')
  weixinIlinkLoginError.value = null
  weixinIlinkLoginStarting.value = true
  weixinIlinkLoginWaiting.value = false

  try {
    const session = await startWeixinIlinkLoginCompat({ force })
    if (requestId !== weixinIlinkLoginRequestId) {
      return
    }

    weixinIlinkLoginMessage.value = resolveWeixinIlinkLoginMessage(session)
    void waitForWeixinIlinkLoginResult(requestId, session.sessionKey)
  } catch (error) {
    if (requestId !== weixinIlinkLoginRequestId) {
      return
    }

    console.error('[RemoteSettings] Failed to start WeChat iLink login', error)
    weixinIlinkLoginMessage.value = ''
    weixinIlinkLoginError.value = t('settings.remote.weixinIlink.loginFailed')
  } finally {
    if (requestId === weixinIlinkLoginRequestId) {
      weixinIlinkLoginStarting.value = false
    }
  }
}

const restartWeixinIlinkLogin = async () => {
  await startWeixinIlinkLogin(true)
}

const toggleWeixinIlinkAccountEnabled = (accountId: string, value: boolean) => {
  if (!weixinIlinkSettings.value) {
    return
  }

  weixinIlinkSettings.value.accounts = weixinIlinkSettings.value.accounts.map((account) =>
    account.accountId === accountId ? { ...account, enabled: Boolean(value) } : account
  )
  queueWeixinIlinkSettingsPersist()
}

const removeWeixinIlinkAccount = async (accountId: string) => {
  if (!beginChannelAction('weixin-ilink')) return
  weixinIlinkAccountActionId.value = accountId
  try {
    await removeWeixinIlinkAccountCompat(accountId)
    if (weixinIlinkSettings.value) {
      weixinIlinkSettings.value.accounts = weixinIlinkSettings.value.accounts.filter(
        (account) => account.accountId !== accountId
      )
    }
    if (persistedWeixinIlinkSettings.value) {
      persistedWeixinIlinkSettings.value = {
        ...persistedWeixinIlinkSettings.value,
        accounts: persistedWeixinIlinkSettings.value.accounts.filter(
          (account) => account.accountId !== accountId
        )
      }
    }
    if (weixinIlinkStatus.value) {
      const accounts = weixinIlinkStatus.value.accounts.filter(
        (account) => account.accountId !== accountId
      )
      weixinIlinkStatus.value = {
        ...weixinIlinkStatus.value,
        accounts,
        accountCount: accounts.length,
        connectedAccountCount: accounts.filter((account) => account.connected).length,
        bindingCount: accounts.reduce((total, account) => total + account.bindingCount, 0)
      }
    }
    completeObservedChannelAction(
      'weixin-ilink',
      'settings.remote.weixinIlink.accountRemoved',
      t('settings.remote.weixinIlink.removeAccount')
    )
    void refreshChannelStatus('weixin-ilink')
  } catch (error) {
    console.error('[RemoteSettings] Failed to remove WeChat iLink account', error)
    failChannelAction('weixin-ilink', 'settings.remote.weixinIlink.accountRemoveFailed')
  } finally {
    weixinIlinkAccountActionId.value = null
  }
}

const restartWeixinIlinkAccount = async (accountId: string) => {
  if (!beginChannelAction('weixin-ilink')) return
  weixinIlinkAccountActionId.value = accountId
  try {
    await restartWeixinIlinkAccountCompat(accountId)
    await refreshChannelStatus('weixin-ilink')
    completeObservedChannelAction(
      'weixin-ilink',
      'settings.remote.weixinIlink.accountRestarted',
      t('settings.remote.weixinIlink.restartAccount')
    )
  } catch (error) {
    console.error('[RemoteSettings] Failed to restart WeChat iLink account', error)
    failChannelAction('weixin-ilink', 'settings.remote.weixinIlink.accountRestartFailed')
  } finally {
    weixinIlinkAccountActionId.value = null
  }
}

const stopPairDialogPolling = () => {
  if (pairDialogRefreshTimer) {
    clearInterval(pairDialogRefreshTimer)
    pairDialogRefreshTimer = null
  }
}

const closePairDialogState = () => {
  pairDialogGeneration += 1
  stopPairDialogPolling()
  pairDialogOpen.value = false
  pairDialogChannel.value = null
  pairDialogCode.value = null
  pairDialogExpiresAt.value = null
  pairDialogExpectedCode.value = null
  pairDialogError.value = null
}

const pollPairingSnapshot = async () => {
  const channel = pairDialogChannel.value
  const expectedCode = pairDialogExpectedCode.value
  const generation = pairDialogGeneration
  if (!pairDialogOpen.value || !expectedCode || !channel) return

  try {
    const snapshot = await refreshPairingSnapshot(channel)
    if (
      generation !== pairDialogGeneration ||
      !pairDialogOpen.value ||
      pairDialogChannel.value !== channel ||
      pairDialogExpectedCode.value !== expectedCode
    ) {
      return
    }

    pairDialogCode.value = snapshot.pairCode
    pairDialogExpiresAt.value = snapshot.pairCodeExpiresAt
    const pairCodeConsumed = snapshot.pairCode !== expectedCode && !snapshot.pairCode?.trim()
    if (!pairCodeConsumed) return

    await refreshChannelStatus(channel)
    if (generation !== pairDialogGeneration || pairDialogChannel.value !== channel) return
    if (bindingsDialogChannel.value === channel) {
      await loadBindingsDialogState(channel)
    }
    if (generation !== pairDialogGeneration || pairDialogChannel.value !== channel) return

    closePairDialogState()
  } catch (error) {
    if (generation !== pairDialogGeneration) return
    console.warn(
      '[RemoteSettings] Failed to poll pairing snapshot',
      {
        channel
      },
      error
    )
  }
}

const startPairDialogPolling = () => {
  stopPairDialogPolling()
  if (remoteSettingsUnmounted) return
  pairDialogRefreshTimer = setInterval(() => {
    void pollPairingSnapshot()
  }, 2_000)
}

const persistChannelDraftOrAbort = async (channel: RemoteChannel): Promise<boolean> => {
  if (!saving[channel] && !isChannelDirty(channel)) return true
  return await persistChannelSettings(channel)
}

const generatePairCodeAndOpenDialog = async (channel: PairableRemoteChannel) => {
  if (pairDialogCreating.value || pairDialogOpen.value) return
  pairDialogCreating.value = true

  try {
    if (!(await persistChannelDraftOrAbort(channel)) || remoteSettingsUnmounted) return
    if (!beginChannelAction(channel)) return

    const pairCode = await createChannelPairCodeCompat(channel)
    if (remoteSettingsUnmounted) {
      await clearChannelPairCodeCompat(channel).catch(() => undefined)
      pendingChannelActionIds.value[channel] = null
      return
    }

    pairDialogGeneration += 1
    pairDialogChannel.value = channel
    pairDialogExpectedCode.value = pairCode.code
    pairDialogCode.value = pairCode.code
    pairDialogExpiresAt.value = pairCode.expiresAt
    pairDialogCancelling.value = false
    pairDialogError.value = null
    pairDialogOpen.value = true
    startPairDialogPolling()
    completeObservedChannelAction(
      channel,
      `settings.remote.${channelI18nKeyMap[channel]}.pairCodeCreated`,
      t('settings.remote.remoteControl.pairCode')
    )
  } catch (error) {
    console.error(
      '[RemoteSettings] Failed to create remote pairing code',
      {
        channel
      },
      error
    )
    if (pendingChannelActionIds.value[channel] !== null) {
      failChannelAction(
        channel,
        `settings.remote.${channelI18nKeyMap[channel]}.pairCodeCreateFailed`
      )
    }
  } finally {
    pairDialogCreating.value = false
  }
}

const cancelPairDialog = async () => {
  const channel = pairDialogChannel.value
  if (!channel || pairDialogCancelling.value) return

  pairDialogGeneration += 1
  stopPairDialogPolling()
  pairDialogCancelling.value = true
  pairDialogError.value = null
  try {
    await clearChannelPairCodeCompat(channel)
    closePairDialogState()
  } catch (error) {
    console.error(
      '[RemoteSettings] Failed to cancel remote pairing code',
      {
        channel
      },
      error
    )
    pairDialogError.value = t('common.error.operationFailed')
    startPairDialogPolling()
  } finally {
    pairDialogCancelling.value = false
  }
}

const loadBindingsDialogState = async (channel: RemoteChannel): Promise<boolean> => {
  const requestId = ++bindingsLoadRequestId
  bindingsLoading.value = true
  bindingsDialogFailure.value = null
  try {
    const [nextBindings, nextPrincipals] = await Promise.all([
      getChannelBindingsCompat(channel),
      isPairableChannel(channel)
        ? getChannelPairingSnapshotCompat(channel).then((snapshot) =>
            getSnapshotPrincipalIds(channel, snapshot)
          )
        : Promise.resolve([] as string[])
    ])
    if (
      requestId !== bindingsLoadRequestId ||
      bindingsDialogChannel.value !== channel ||
      !bindingsDialogOpen.value
    ) {
      return false
    }
    bindings.value = nextBindings
    authorizedPrincipals.value = nextPrincipals
    return true
  } catch (error) {
    if (requestId !== bindingsLoadRequestId || bindingsDialogChannel.value !== channel) {
      return false
    }
    console.error(
      '[RemoteSettings] Failed to load remote bindings',
      {
        channel
      },
      error
    )
    bindingsDialogFailure.value = {
      source: 'load',
      message: t('common.error.requestFailed')
    }
    return false
  } finally {
    if (requestId === bindingsLoadRequestId) {
      bindingsLoading.value = false
    }
  }
}

const openBindingsDialog = async (channel: RemoteChannel) => {
  if (!(await persistChannelDraftOrAbort(channel))) {
    return
  }

  bindingsDialogChannel.value = channel
  bindings.value = []
  authorizedPrincipals.value = []
  bindingsDialogFailure.value = null
  bindingsDialogOpen.value = true
  await loadBindingsDialogState(channel)
}

const retryBindingsDialogLoad = async () => {
  const channel = bindingsDialogChannel.value
  if (!channel || bindingsDialogBusy.value) return
  await loadBindingsDialogState(channel)
}

const closeBindingsDialog = () => {
  if (bindingsDialogMutating.value) return
  bindingsLoadRequestId += 1
  bindingsLoading.value = false
  bindingsDialogOpen.value = false
  bindingsDialogChannel.value = null
  bindingsDialogFailure.value = null
  bindings.value = []
  authorizedPrincipals.value = []
}

const removeBinding = async (endpointKey: string) => {
  const channel = bindingsDialogChannel.value
  if (!channel || bindingsDialogBusy.value) return

  bindingRemovingKey.value = endpointKey
  bindingsDialogFailure.value = null
  try {
    await removeChannelBindingCompat(channel, endpointKey)
    bindings.value = bindings.value.filter((binding) => binding.endpointKey !== endpointKey)
    void refreshChannelStatus(channel)
  } catch (error) {
    console.error(
      '[RemoteSettings] Failed to remove remote binding',
      {
        channel
      },
      error
    )
    bindingsDialogFailure.value = {
      source: 'mutation',
      message: t('common.error.operationFailed')
    }
  } finally {
    bindingRemovingKey.value = null
  }
}

const removePrincipal = async (principalId: string) => {
  const channel = bindingsDialogChannel.value
  if (!isPairableChannel(channel) || bindingsDialogBusy.value) return

  principalRemovingId.value = principalId
  bindingsDialogFailure.value = null
  try {
    await removeChannelPrincipalCompat(channel, principalId)
    authorizedPrincipals.value = authorizedPrincipals.value.filter(
      (candidate) => candidate !== principalId
    )
    void refreshChannelStatus(channel)
  } catch (error) {
    console.error(
      '[RemoteSettings] Failed to remove remote principal',
      {
        channel
      },
      error
    )
    bindingsDialogFailure.value = {
      source: 'mutation',
      message: t('common.error.operationFailed')
    }
  } finally {
    principalRemovingId.value = null
  }
}

const formatTimestamp = (value: number) => new Date(value).toLocaleString()

const formatStatusLine = (value: RemoteChannelStatus) =>
  t(`settings.remote.status.states.${value.state}`)

const statusPillStatus = (state: RemoteRuntimeState): DcStatus => {
  if (state === 'running') return 'success'
  if (state === 'starting' || state === 'backoff') return 'warning'
  if (state === 'error') return 'danger'
  return 'neutral'
}

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

const selectedFeishuSetupUrls = computed(() => {
  const brand = feishuSettings.value?.brand === 'lark' ? 'lark' : 'feishu'
  const baseUrl = brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const appId = feishuSettings.value?.appId?.trim() ?? ''
  return {
    tutorial: `${baseUrl}/document/develop-an-echo-bot/introduction`,
    developerConsole: `${baseUrl}/app`,
    botChat:
      brand === 'lark'
        ? `https://applink.larksuite.com/client/bot/open?appId=${encodeURIComponent(appId)}`
        : `https://applink.feishu.cn/client/bot/open?appId=${encodeURIComponent(appId)}`
  }
})

const openExternalUrl = async (url: string) => {
  await openRuntimeExternal(url)
}

const openFeishuExternalLink = async (
  url: string,
  successCode: string,
  failureCode: string,
  title: string
) => {
  if (!beginChannelAction('feishu')) return
  try {
    await openExternalUrl(url)
    completeObservedChannelAction('feishu', successCode, title)
  } catch (error) {
    console.error('[RemoteSettings] Failed to open Feishu external link', error)
    failChannelAction('feishu', failureCode)
  }
}

const openFeishuSetupGuide = async () =>
  await openFeishuExternalLink(
    selectedFeishuSetupUrls.value.tutorial,
    'settings.remote.feishu.setupGuideOpened',
    'settings.remote.feishu.setupGuideOpenFailed',
    t('settings.remote.feishu.openSetupGuide')
  )

const openFeishuDeveloperConsole = async () =>
  await openFeishuExternalLink(
    selectedFeishuSetupUrls.value.developerConsole,
    'settings.remote.feishu.developerConsoleOpened',
    'settings.remote.feishu.developerConsoleOpenFailed',
    t('settings.remote.feishu.openDeveloperConsole')
  )

const openFeishuBotChat = async () => {
  if (!feishuSettings.value?.appId?.trim()) {
    if (!beginChannelAction('feishu')) return
    failChannelAction(
      'feishu',
      'settings.remote.feishu.openBotChatMissingAppId',
      t('settings.remote.feishu.openBotChatMissingAppIdTitle'),
      t('settings.remote.feishu.openBotChatMissingAppIdDescription')
    )
    return
  }

  if (!beginChannelAction('feishu')) return
  try {
    await openExternalUrl(selectedFeishuSetupUrls.value.botChat)
    completeObservedChannelAction(
      'feishu',
      'settings.remote.feishu.botChatOpened',
      t('settings.remote.feishu.openBotChat')
    )
  } catch (error) {
    console.error('[RemoteSettings] Failed to open Feishu bot chat', error)
    failChannelAction('feishu', 'settings.remote.feishu.openBotChatFailed')
  }
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
  if (channel === 'telegram') {
    const status = channelStatus(channel)
    if (!status) {
      return ''
    }
    return t('settings.remote.overview.telegram', {
      bindingCount: status.bindingCount,
      pairedCount: status.allowedUserCount
    })
  }

  if (channel === 'qqbot') {
    const status = channelStatus(channel)
    if (!status) {
      return ''
    }
    return t('settings.remote.overview.qqbot', {
      bindingCount: status.bindingCount,
      pairedCount: status.pairedUserCount
    })
  }

  if (channel === 'discord') {
    const status = channelStatus(channel)
    if (!status) {
      return ''
    }
    return t('settings.remote.overview.discord', {
      bindingCount: status.bindingCount,
      pairedCount: status.pairedChannelCount
    })
  }

  if (channel === 'weixin-ilink') {
    const status = channelStatus(channel)
    if (!status) {
      return ''
    }
    return t('settings.remote.overview.weixinIlink', {
      bindingCount: status.bindingCount,
      accountCount: status.accountCount,
      connectedCount: status.connectedAccountCount
    })
  }

  const status = channelStatus('feishu')
  if (!status) {
    return ''
  }

  return t('settings.remote.overview.feishu', {
    bindingCount: status.bindingCount,
    pairedCount: status.pairedUserCount
  })
}

const isAnyChannelActionPending = computed(() =>
  REMOTE_CHANNELS.some((channel) => isChannelActionPending(channel))
)

const discardChannelDrafts = () => {
  if (persistedTelegramSettings.value) {
    acceptPersistedTelegramSettings(persistedTelegramSettings.value)
  }
  if (persistedFeishuSettings.value) {
    acceptPersistedFeishuSettings(persistedFeishuSettings.value)
  }
  if (persistedQQBotSettings.value) {
    acceptPersistedQQBotSettings(persistedQQBotSettings.value)
  }
  if (persistedDiscordSettings.value) {
    acceptPersistedDiscordSettings(persistedDiscordSettings.value)
  }
  if (persistedWeixinIlinkSettings.value) {
    acceptPersistedWeixinIlinkSettings(persistedWeixinIlinkSettings.value)
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings-remote',
  onDiscard: discardChannelDrafts
})
const stopLeaveRiskSync = watch(
  [isAnySaving, isAnyChannelActionPending, hasUnsavedChannelDrafts],
  ([savePending, actionPending, dirty]) => {
    leaveGuardLease.setRisk(savePending || actionPending ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

watch(() => props.channel, syncActiveChannelFromProps)

const handleRemoteSettingsVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    clearStatusRefreshTimer()
    return
  }

  scheduleStatusRefresh()
}

onMounted(() => {
  remoteSettingsUnmounted = false
  syncActiveChannelFromProps()
  void loadState()
  document.addEventListener('visibilitychange', handleRemoteSettingsVisibilityChange)
})

onUnmounted(() => {
  remoteSettingsUnmounted = true
  loadStateRequestId += 1
  bindingsLoadRequestId += 1
  pairDialogGeneration += 1
  document.removeEventListener('visibilitychange', handleRemoteSettingsVisibilityChange)
  stopLeaveRiskSync()
  leaveGuardLease.release()
  clearStatusRefreshTimer()
  stopPairDialogPolling()
  void cancelFeishuInstall(false)
  void cancelFeishuScanAuth(false)
  closeWeixinIlinkLoginDialog()
})
</script>
