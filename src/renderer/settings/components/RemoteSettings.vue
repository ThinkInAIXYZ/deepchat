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
          !qqbotStatus ||
          !discordSettings ||
          !discordStatus ||
          !weixinIlinkSettings ||
          !weixinIlinkStatus
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
              {{ channelTitle(channel) }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="telegram" class="space-y-4">
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-base font-medium">{{ channelTitle('telegram') }}</div>
                    <span
                      :class="[
                        'inline-flex rounded-full px-2 py-1 text-[11px]',
                        statusDotClass(telegramStatus.state)
                      ]"
                    >
                      {{ formatStatusLine(telegramStatus) }}
                    </span>
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
                <label class="flex items-center gap-2 text-sm text-muted-foreground">
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
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    data-testid="remote-pair-button"
                    variant="outline"
                    size="sm"
                    :disabled="!telegramSettings.remoteEnabled || saving.telegram"
                    @click="generatePairCodeAndOpenDialog('telegram')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </Button>
                  <Button
                    data-testid="remote-bindings-button"
                    variant="outline"
                    size="sm"
                    :disabled="saving.telegram"
                    @click="openBindingsDialog('telegram')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </Button>
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
                    <span
                      :class="[
                        'inline-flex rounded-full px-2 py-1 text-[11px]',
                        statusDotClass(feishuStatus.state)
                      ]"
                    >
                      {{ formatStatusLine(feishuStatus) }}
                    </span>
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
                <label class="flex items-center gap-2 text-sm text-muted-foreground">
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
                    <Input
                      v-model="feishuSettings.defaultWorkdir"
                      :placeholder="t('settings.remote.remoteControl.defaultWorkdirPlaceholder')"
                      @blur="queueFeishuSettingsPersist"
                    />
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    data-testid="feishu-pair-button"
                    variant="outline"
                    size="sm"
                    :disabled="!feishuSettings.remoteEnabled || saving.feishu"
                    @click="generatePairCodeAndOpenDialog('feishu')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </Button>
                  <Button
                    data-testid="feishu-bindings-button"
                    variant="outline"
                    size="sm"
                    :disabled="saving.feishu"
                    @click="openBindingsDialog('feishu')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </Button>
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
                    <span
                      :class="[
                        'inline-flex rounded-full px-2 py-1 text-[11px]',
                        statusDotClass(qqbotStatus.state)
                      ]"
                    >
                      {{ formatStatusLine(qqbotStatus) }}
                    </span>
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
                <label class="flex items-center gap-2 text-sm text-muted-foreground">
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
                    <Input
                      v-model="qqbotSettings.defaultWorkdir"
                      :placeholder="t('settings.remote.remoteControl.defaultWorkdirPlaceholder')"
                      @blur="queueQQBotSettingsPersist"
                    />
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!qqbotSettings.remoteEnabled || saving.qqbot"
                    @click="generatePairCodeAndOpenDialog('qqbot')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="saving.qqbot"
                    @click="openBindingsDialog('qqbot')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </Button>
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
                    <span
                      :class="[
                        'inline-flex rounded-full px-2 py-1 text-[11px]',
                        statusDotClass(discordStatus.state)
                      ]"
                    >
                      {{ formatStatusLine(discordStatus) }}
                    </span>
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
                <label class="flex items-center gap-2 text-sm text-muted-foreground">
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
                    <Button
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                      @click="showDiscordBotToken = !showDiscordBotToken"
                    >
                      <Icon
                        :icon="showDiscordBotToken ? 'lucide:eye-off' : 'lucide:eye'"
                        class="h-4 w-4 text-muted-foreground"
                      />
                    </Button>
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
                    <Input
                      v-model="discordSettings.defaultWorkdir"
                      :placeholder="t('settings.remote.remoteControl.defaultWorkdirPlaceholder')"
                      @blur="queueDiscordSettingsPersist"
                    />
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    data-testid="discord-pair-button"
                    variant="outline"
                    size="sm"
                    :disabled="!discordSettings.remoteEnabled || saving.discord"
                    @click="generatePairCodeAndOpenDialog('discord')"
                  >
                    {{ t('settings.remote.remoteControl.openPairDialog') }}
                  </Button>
                  <Button
                    data-testid="discord-bindings-button"
                    variant="outline"
                    size="sm"
                    :disabled="saving.discord"
                    @click="openBindingsDialog('discord')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </Button>
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
                    <span
                      :class="[
                        'inline-flex rounded-full px-2 py-1 text-[11px]',
                        statusDotClass(weixinIlinkStatus.state)
                      ]"
                    >
                      {{ formatStatusLine(weixinIlinkStatus) }}
                    </span>
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
                <label class="flex items-center gap-2 text-sm text-muted-foreground">
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
                  <Button
                    data-testid="weixin-ilink-connect-button"
                    variant="outline"
                    size="sm"
                    :disabled="weixinIlinkLoginBusy"
                    @click="startWeixinIlinkLogin()"
                  >
                    <Icon
                      :icon="weixinIlinkLoginBusy ? 'lucide:loader-2' : 'lucide:qr-code'"
                      :class="['mr-1 h-4 w-4', weixinIlinkLoginBusy && 'animate-spin']"
                    />
                    {{ t('settings.remote.weixinIlink.connectButton') }}
                  </Button>
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
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="
                        weixinIlinkAccountActionId === account.accountId || account.enabled !== true
                      "
                      @click="restartWeixinIlinkAccount(account.accountId)"
                    >
                      {{ t('settings.remote.weixinIlink.restartAccount') }}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      class="text-destructive hover:text-destructive"
                      :disabled="weixinIlinkAccountActionId === account.accountId"
                      @click="removeWeixinIlinkAccount(account.accountId)"
                    >
                      {{ t('settings.remote.weixinIlink.removeAccount') }}
                    </Button>
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
                    <Input
                      v-model="weixinIlinkSettings.defaultWorkdir"
                      :placeholder="t('settings.remote.remoteControl.defaultWorkdirPlaceholder')"
                      @blur="queueWeixinIlinkSettingsPersist"
                    />
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.remote.remoteControl.defaultWorkdirHelper') }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="saving['weixin-ilink']"
                    @click="openBindingsDialog('weixin-ilink')"
                  >
                    {{ t('settings.remote.remoteControl.manageBindings') }}
                  </Button>
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
          <template v-else>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    :disabled="principalRemovingId === principalId"
                    @click="removePrincipal(principalId)"
                  >
                    {{ t('common.delete') }}
                  </Button>
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
          </template>
        </div>

        <div class="flex justify-end">
          <Button variant="outline" @click="bindingsDialogOpen = false">
            {{ t('common.close') }}
          </Button>
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
            <div class="text-muted-foreground">{{ weixinIlinkLoginMessage }}</div>
            <div v-if="weixinIlinkLoginError" class="mt-2 break-all text-destructive">
              {{ weixinIlinkLoginError }}
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button
            variant="outline"
            :disabled="weixinIlinkLoginBusy"
            @click="restartWeixinIlinkLogin"
          >
            {{ t('settings.remote.weixinIlink.refreshQrCode') }}
          </Button>
          <Button variant="outline" @click="closeWeixinIlinkLoginDialog">
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
import type { Agent } from '@shared/types/agent-interface'
import type {
  DiscordPairingSnapshot,
  DiscordRemoteSettings,
  DiscordRemoteStatus,
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
} from '@shared/presenter'

const fallbackChannelDescriptors: RemoteChannelDescriptor[] = [
  {
    id: 'telegram',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.telegram.title',
    descriptionKey: 'settings.remote.telegram.description',
    supportsPairing: true,
    supportsNotifications: false
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
    id: 'discord',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.discord.title',
    descriptionKey: 'settings.remote.discord.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'weixin-ilink',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.weixinIlink.title',
    descriptionKey: 'settings.remote.weixinIlink.description',
    supportsPairing: false,
    supportsNotifications: false
  }
]

const remoteControlPresenter = useRemoteControlPresenter()
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const { t } = useI18n()
const { toast } = useToast()

const channelI18nKeyMap: Record<RemoteChannel, string> = {
  telegram: 'telegram',
  feishu: 'feishu',
  qqbot: 'qqbot',
  discord: 'discord',
  'weixin-ilink': 'weixinIlink'
}

function channelTitle(channel: RemoteChannel | null | undefined): string {
  if (!channel) {
    return ''
  }
  return t(`settings.remote.${channelI18nKeyMap[channel]}.title`)
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
const channelDescriptors = ref<RemoteChannelDescriptor[]>(fallbackChannelDescriptors)
const isLoading = ref(false)
const showBotToken = ref(false)
const showDiscordBotToken = ref(false)
const availableAgents = ref<Agent[]>([])
const activeChannel = ref<RemoteChannel>('telegram')
const pairDialogChannel = ref<PairableRemoteChannel | null>(null)
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
const principalRemovingId = ref<string | null>(null)
const bindings = ref<RemoteBindingSummary[]>([])
const authorizedPrincipals = ref<string[]>([])
const weixinIlinkLoginMessage = ref('')
const weixinIlinkLoginError = ref<string | null>(null)
const weixinIlinkLoginStarting = ref(false)
const weixinIlinkLoginWaiting = ref(false)
const weixinIlinkLoginOpen = ref(false)
const weixinIlinkAccountActionId = ref<string | null>(null)
const saving = reactive<Record<RemoteChannel, boolean>>({
  telegram: false,
  feishu: false,
  qqbot: false,
  discord: false,
  'weixin-ilink': false
})
const pendingSave = reactive<Record<RemoteChannel, boolean>>({
  telegram: false,
  feishu: false,
  qqbot: false,
  discord: false,
  'weixin-ilink': false
})
const saveTasks: Record<RemoteChannel, Promise<void> | null> = {
  telegram: null,
  feishu: null,
  qqbot: null,
  discord: null,
  'weixin-ilink': null
}

let statusRefreshTimer: ReturnType<typeof setInterval> | null = null
let pairDialogRefreshTimer: ReturnType<typeof setInterval> | null = null

const defaultTelegramSettings = (): TelegramRemoteSettings => ({
  botToken: '',
  remoteEnabled: false,
  defaultAgentId: 'deepchat'
})

const defaultFeishuSettings = (): FeishuRemoteSettings => ({
  brand: 'feishu',
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

const defaultDiscordStatus = (): DiscordRemoteStatus => ({
  channel: 'discord',
  enabled: false,
  state: 'disabled',
  bindingCount: 0,
  pairedChannelCount: 0,
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

const defaultDiscordPairingSnapshot = (): DiscordPairingSnapshot => ({
  pairCode: null,
  pairCodeExpiresAt: null,
  pairedChannelIds: []
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

const normalizeDiscordPairingSnapshot = (
  snapshot: Partial<DiscordPairingSnapshot> | null | undefined
): DiscordPairingSnapshot => ({
  pairCode: snapshot?.pairCode ?? null,
  pairCodeExpiresAt: snapshot?.pairCodeExpiresAt ?? null,
  pairedChannelIds: [...(snapshot?.pairedChannelIds ?? [])]
})

const presenterCompat = remoteControlPresenter as typeof remoteControlPresenter & {
  listRemoteChannels?: () => Promise<RemoteChannelDescriptor[]>
  getChannelSettings?: (channel: RemoteChannel) => Promise<RemoteChannelSettings>
  saveChannelSettings?: (
    channel: RemoteChannel,
    input: RemoteChannelSettings
  ) => Promise<RemoteChannelSettings>
  getChannelStatus?: (channel: RemoteChannel) => Promise<RemoteChannelStatus>
  getChannelBindings?: (channel: RemoteChannel) => Promise<RemoteBindingSummary[]>
  removeChannelBinding?: (channel: RemoteChannel, endpointKey: string) => Promise<void>
  removeChannelPrincipal?: (channel: PairableRemoteChannel, principalId: string) => Promise<void>
  getChannelPairingSnapshot?: (channel: PairableRemoteChannel) => Promise<RemotePairingSnapshot>
  createChannelPairCode?: (channel: PairableRemoteChannel) => Promise<{
    code: string
    expiresAt: number
  }>
  clearChannelPairCode?: (channel: PairableRemoteChannel) => Promise<void>
  startWeixinIlinkLogin?: (input?: { force?: boolean }) => Promise<WeixinIlinkLoginSession>
  waitForWeixinIlinkLogin?: (input: {
    sessionKey: string
    timeoutMs?: number
  }) => Promise<WeixinIlinkLoginResult>
  removeWeixinIlinkAccount?: (accountId: string) => Promise<void>
  restartWeixinIlinkAccount?: (accountId: string) => Promise<void>
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
function getChannelSettingsCompat(channel: 'discord'): Promise<DiscordRemoteSettings>
function getChannelSettingsCompat(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteSettings>
async function getChannelSettingsCompat(channel: RemoteChannel): Promise<RemoteChannelSettings> {
  if (presenterCompat.getChannelSettings) {
    return await presenterCompat.getChannelSettings(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.getTelegramSettings()
  }

  if (channel === 'qqbot') {
    return defaultQQBotSettings()
  }

  if (channel === 'discord') {
    return defaultDiscordSettings()
  }

  if (channel === 'weixin-ilink') {
    return await remoteControlPresenter.getWeixinIlinkSettings()
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
  if (presenterCompat.saveChannelSettings) {
    return await presenterCompat.saveChannelSettings(channel, input)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.saveTelegramSettings(input as TelegramRemoteSettings)
  }

  if (channel === 'qqbot') {
    return input as QQBotRemoteSettings
  }

  if (channel === 'discord') {
    return input as DiscordRemoteSettings
  }

  if (channel === 'weixin-ilink') {
    return await remoteControlPresenter.saveWeixinIlinkSettings(input as WeixinIlinkRemoteSettings)
  }

  return input as FeishuRemoteSettings
}

function getChannelStatusCompat(channel: 'telegram'): Promise<TelegramRemoteStatus>
function getChannelStatusCompat(channel: 'feishu'): Promise<FeishuRemoteStatus>
function getChannelStatusCompat(channel: 'qqbot'): Promise<QQBotRemoteStatus>
function getChannelStatusCompat(channel: 'discord'): Promise<DiscordRemoteStatus>
function getChannelStatusCompat(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteStatus>
async function getChannelStatusCompat(channel: RemoteChannel): Promise<RemoteChannelStatus> {
  if (presenterCompat.getChannelStatus) {
    return await presenterCompat.getChannelStatus(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.getTelegramStatus()
  }

  if (channel === 'qqbot') {
    return defaultQQBotStatus()
  }

  if (channel === 'discord') {
    return defaultDiscordStatus()
  }

  if (channel === 'weixin-ilink') {
    return await remoteControlPresenter.getWeixinIlinkStatus()
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

const removeChannelPrincipalCompat = async (
  channel: PairableRemoteChannel,
  principalId: string
): Promise<void> => {
  if (presenterCompat.removeChannelPrincipal) {
    await presenterCompat.removeChannelPrincipal(channel, principalId)
    return
  }

  throw new Error('removeChannelPrincipal is not available.')
}

const getChannelPairingSnapshotCompat = async (
  channel: PairableRemoteChannel
): Promise<RemotePairingSnapshot> => {
  if (presenterCompat.getChannelPairingSnapshot) {
    return await presenterCompat.getChannelPairingSnapshot(channel)
  }

  if (channel === 'telegram') {
    return await remoteControlPresenter.getTelegramPairingSnapshot()
  }

  if (channel === 'qqbot') {
    return defaultQQBotPairingSnapshot()
  }

  if (channel === 'discord') {
    return defaultDiscordPairingSnapshot()
  }

  return defaultFeishuPairingSnapshot()
}

const createChannelPairCodeCompat = async (
  channel: PairableRemoteChannel
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

const clearChannelPairCodeCompat = async (channel: PairableRemoteChannel): Promise<void> => {
  if (presenterCompat.clearChannelPairCode) {
    await presenterCompat.clearChannelPairCode(channel)
    return
  }

  if (channel === 'telegram') {
    await remoteControlPresenter.clearTelegramPairCode()
  }
}

const startWeixinIlinkLoginCompat = async (input?: {
  force?: boolean
}): Promise<WeixinIlinkLoginSession> => {
  if (presenterCompat.startWeixinIlinkLogin) {
    return await presenterCompat.startWeixinIlinkLogin(input)
  }

  return await remoteControlPresenter.startWeixinIlinkLogin(input)
}

const waitForWeixinIlinkLoginCompat = async (input: {
  sessionKey: string
  timeoutMs?: number
}): Promise<WeixinIlinkLoginResult> => {
  if (presenterCompat.waitForWeixinIlinkLogin) {
    return await presenterCompat.waitForWeixinIlinkLogin(input)
  }

  return await remoteControlPresenter.waitForWeixinIlinkLogin(input)
}

const removeWeixinIlinkAccountCompat = async (accountId: string): Promise<void> => {
  if (presenterCompat.removeWeixinIlinkAccount) {
    await presenterCompat.removeWeixinIlinkAccount(accountId)
    return
  }

  await remoteControlPresenter.removeWeixinIlinkAccount(accountId)
}

const restartWeixinIlinkAccountCompat = async (accountId: string): Promise<void> => {
  if (presenterCompat.restartWeixinIlinkAccount) {
    await presenterCompat.restartWeixinIlinkAccount(accountId)
    return
  }

  await remoteControlPresenter.restartWeixinIlinkAccount(accountId)
}

const resolveWeixinIlinkLoginMessage = (input: {
  message?: string | null
  messageKey?: string | null
}): string => {
  if (input.messageKey?.trim()) {
    return t(input.messageKey.trim())
  }

  if (input.message?.trim()) {
    return input.message.trim()
  }

  return t('settings.remote.weixinIlink.loginFailed')
}

const implementedChannels = computed(() =>
  channelDescriptors.value
    .filter((descriptor) => descriptor.implemented)
    .map((descriptor) => descriptor.id)
)
const implementedChannelCount = computed(() => Math.max(1, implementedChannels.value.length))
const isAnySaving = computed(
  () => saving.telegram || saving.feishu || saving.qqbot || saving.discord || saving['weixin-ilink']
)
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

const syncTelegramFields = (snapshot: Partial<TelegramRemoteSettings> | null | undefined) => {
  const fallback = defaultTelegramSettings()

  telegramSettings.value = {
    ...fallback,
    ...snapshot
  }
}

const syncFeishuFields = (snapshot: Partial<FeishuRemoteSettings> | null | undefined) => {
  const fallback = defaultFeishuSettings()

  feishuSettings.value = {
    ...fallback,
    ...snapshot
  }
}

const syncQQBotFields = (snapshot: Partial<QQBotRemoteSettings> | null | undefined) => {
  const fallback = defaultQQBotSettings()

  qqbotSettings.value = {
    ...fallback,
    ...snapshot
  }
}

const syncDiscordFields = (snapshot: Partial<DiscordRemoteSettings> | null | undefined) => {
  const fallback = defaultDiscordSettings()

  discordSettings.value = {
    ...fallback,
    ...snapshot
  }
}

const syncWeixinIlinkFields = (snapshot: Partial<WeixinIlinkRemoteSettings> | null | undefined) => {
  const fallback = defaultWeixinIlinkSettings()

  weixinIlinkSettings.value = {
    ...fallback,
    ...snapshot,
    accounts: [...(snapshot?.accounts ?? fallback.accounts)].map((account) => ({
      accountId: String(account.accountId ?? '').trim(),
      ownerUserId: String(account.ownerUserId ?? '').trim(),
      baseUrl: String(account.baseUrl ?? '').trim(),
      enabled: account.enabled !== false
    }))
  }
}

const channelStatus = (channel: RemoteChannel) =>
  channel === 'telegram'
    ? telegramStatus.value
    : channel === 'feishu'
      ? feishuStatus.value
      : channel === 'qqbot'
        ? qqbotStatus.value
        : channel === 'discord'
          ? discordStatus.value
          : weixinIlinkStatus.value

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

const refreshStatus = async () => {
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
}

const refreshPairingSnapshot = async (
  channel: PairableRemoteChannel
): Promise<RemotePairingSnapshot> => {
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

const loadState = async () => {
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
      listRemoteChannelsCompat(),
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
      loadAvailableAgents()
    ])

    channelDescriptors.value =
      loadedChannelDescriptors.length > 0 ? loadedChannelDescriptors : fallbackChannelDescriptors
    syncTelegramFields(loadedTelegramSettings)
    syncFeishuFields(loadedFeishuSettings)
    syncQQBotFields(loadedQQBotSettings)
    syncDiscordFields(loadedDiscordSettings)
    syncWeixinIlinkFields(loadedWeixinIlinkSettings)
    telegramStatus.value = loadedTelegramStatus
    feishuStatus.value = loadedFeishuStatus
    qqbotStatus.value = loadedQQBotStatus
    discordStatus.value = loadedDiscordStatus
    weixinIlinkStatus.value = loadedWeixinIlinkStatus

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
    ...telegramSettings.value
  }
}

const buildFeishuDraftSettings = (): FeishuRemoteSettings | null => {
  if (!feishuSettings.value) {
    return null
  }

  return {
    ...feishuSettings.value
  }
}

const buildQQBotDraftSettings = (): QQBotRemoteSettings | null => {
  if (!qqbotSettings.value) {
    return null
  }

  return {
    ...qqbotSettings.value
  }
}

const buildDiscordDraftSettings = (): DiscordRemoteSettings | null => {
  if (!discordSettings.value) {
    return null
  }

  return {
    ...discordSettings.value
  }
}

const buildWeixinIlinkDraftSettings = (): WeixinIlinkRemoteSettings | null => {
  if (!weixinIlinkSettings.value) {
    return null
  }

  return {
    ...weixinIlinkSettings.value,
    accounts: weixinIlinkSettings.value.accounts.map((account) => ({
      accountId: String(account.accountId ?? '').trim(),
      ownerUserId: String(account.ownerUserId ?? '').trim(),
      baseUrl: String(account.baseUrl ?? '').trim(),
      enabled: account.enabled !== false
    }))
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
        } else if (channel === 'qqbot') {
          const nextSettings = buildQQBotDraftSettings()
          if (!nextSettings) {
            return
          }

          const saved = await saveChannelSettingsCompat('qqbot', nextSettings)
          syncQQBotFields(saved)
        } else if (channel === 'discord') {
          const nextSettings = buildDiscordDraftSettings()
          if (!nextSettings) {
            return
          }

          const saved = await saveChannelSettingsCompat('discord', nextSettings)
          syncDiscordFields(saved)
        } else {
          const nextSettings = buildWeixinIlinkDraftSettings()
          if (!nextSettings) {
            return
          }

          const saved = await saveChannelSettingsCompat('weixin-ilink', nextSettings)
          syncWeixinIlinkFields(saved)
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

const persistDiscordSettings = async () => {
  await persistChannelSettings('discord')
}

const persistWeixinIlinkSettings = async () => {
  await persistChannelSettings('weixin-ilink')
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

const queueDiscordSettingsPersist = () => {
  void persistDiscordSettings().catch(() => undefined)
}

const queueWeixinIlinkSettingsPersist = () => {
  void persistWeixinIlinkSettings().catch(() => undefined)
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

let weixinIlinkLoginRequestId = 0

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
          syncWeixinIlinkFields(settings)
        })(),
        refreshStatus(),
        loadAvailableAgents()
      ])

      toast({
        title: t('settings.remote.weixinIlink.loginSuccessTitle'),
        description: result.account
          ? t('settings.remote.weixinIlink.loginSuccessDescription', {
              accountId: result.account.accountId
            })
          : weixinIlinkLoginMessage.value
      })

      closeWeixinIlinkLoginDialog()
    }
  } catch (error) {
    if (requestId !== weixinIlinkLoginRequestId) {
      return
    }

    weixinIlinkLoginError.value = error instanceof Error ? error.message : String(error)
    weixinIlinkLoginMessage.value = t('settings.remote.weixinIlink.loginFailed')
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

    weixinIlinkLoginError.value = error instanceof Error ? error.message : String(error)
    weixinIlinkLoginMessage.value = t('settings.remote.weixinIlink.loginFailed')
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
  weixinIlinkAccountActionId.value = accountId
  try {
    await removeWeixinIlinkAccountCompat(accountId)
    const [settings, status] = await Promise.all([
      getChannelSettingsCompat('weixin-ilink'),
      getChannelStatusCompat('weixin-ilink')
    ])
    syncWeixinIlinkFields(settings)
    weixinIlinkStatus.value = status
  } catch (error) {
    toastSaveError(error)
  } finally {
    weixinIlinkAccountActionId.value = null
  }
}

const restartWeixinIlinkAccount = async (accountId: string) => {
  weixinIlinkAccountActionId.value = accountId
  try {
    await restartWeixinIlinkAccountCompat(accountId)
    await refreshStatus()
  } catch (error) {
    toastSaveError(error)
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

    await refreshStatus()
    if (bindingsDialogChannel.value === pairDialogChannel.value) {
      await loadBindingsDialogState(pairDialogChannel.value)
    }

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
    } else if (channel === 'qqbot') {
      await persistQQBotSettings()
    } else if (channel === 'discord') {
      await persistDiscordSettings()
    } else {
      await persistWeixinIlinkSettings()
    }
    return true
  } catch {
    return false
  }
}

const generatePairCodeAndOpenDialog = async (channel: PairableRemoteChannel) => {
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

const loadBindingsDialogState = async (channel: RemoteChannel) => {
  bindingsLoading.value = true
  try {
    const [nextBindings, nextPrincipals] = await Promise.all([
      getChannelBindingsCompat(channel),
      isPairableChannel(channel)
        ? getChannelPairingSnapshotCompat(channel).then((snapshot) =>
            getSnapshotPrincipalIds(channel, snapshot)
          )
        : Promise.resolve([] as string[])
    ])
    bindings.value = nextBindings
    authorizedPrincipals.value = nextPrincipals
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
    await loadBindingsDialogState(channel)
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
    await Promise.all([loadBindingsDialogState(bindingsDialogChannel.value), refreshStatus()])
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

const removePrincipal = async (principalId: string) => {
  if (!isPairableChannel(bindingsDialogChannel.value)) {
    return
  }

  principalRemovingId.value = principalId
  try {
    await removeChannelPrincipalCompat(bindingsDialogChannel.value, principalId)
    await Promise.all([loadBindingsDialogState(bindingsDialogChannel.value), refreshStatus()])
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    principalRemovingId.value = null
  }
}

const formatTimestamp = (value: number) => new Date(value).toLocaleString()

const formatStatusLine = (value: RemoteChannelStatus) =>
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
      pairedCount: status.allowedUserCount
    })
  }

  if (channel === 'qqbot') {
    return t('settings.remote.overview.qqbot', {
      bindingCount: status.bindingCount,
      pairedCount: status.pairedUserCount
    })
  }

  if (channel === 'discord') {
    return t('settings.remote.overview.discord', {
      bindingCount: status.bindingCount,
      pairedCount: status.pairedChannelCount
    })
  }

  if (channel === 'weixin-ilink') {
    return t('settings.remote.overview.weixinIlink', {
      bindingCount: status.bindingCount,
      accountCount: status.accountCount,
      connectedCount: status.connectedAccountCount
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
  closeWeixinIlinkLoginDialog()
})
</script>
