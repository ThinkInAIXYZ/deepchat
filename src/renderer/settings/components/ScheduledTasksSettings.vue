<template>
  <SettingsPageShell
    data-testid="settings-scheduled-tasks-page"
    :title="t('settings.scheduledTasks.title')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    :description="t('settings.scheduledTasks.description')"
  >
    <template v-if="settings && !isLoading" #actions>
      <span
        v-if="isSaving"
        class="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      >
        {{ t('common.saving') }}
      </span>
      <Button data-testid="scheduled-tasks-add" size="sm" @click="addTask">
        <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
        {{ t('settings.scheduledTasks.newTask') }}
      </Button>
    </template>

    <div v-if="isLoading" class="text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="!settings" class="text-sm text-muted-foreground">
      {{ t('common.error.requestFailed') }}
    </div>
    <template v-else>
      <p class="-mt-1 text-xs leading-5 text-muted-foreground">
        {{ t('settings.scheduledTasks.hint') }}
      </p>

      <div class="rounded-lg border bg-card/30 p-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Icon icon="lucide:activity" class="h-4 w-4 text-muted-foreground" />
              <span>{{ t('settings.scheduledTasks.scheduler.title') }}</span>
              <span
                :class="[
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  schedulerStatus?.state === 'running'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : schedulerStatus?.state === 'crashed'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-muted-foreground'
                ]"
              >
                {{ getSchedulerStateLabel(schedulerStatus?.state) }}
              </span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {{
                  t('settings.scheduledTasks.scheduler.enabledTasks', {
                    count: schedulerStatus?.enabledTaskCount ?? 0
                  })
                }}
              </span>
              <span>
                {{
                  t('settings.scheduledTasks.scheduler.nextRun', {
                    time: formatOptionalDate(schedulerStatus?.nextRunAt ?? null)
                  })
                }}
              </span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="isSchedulerActionRunning"
              @click="reconcileScheduler"
            >
              <Icon icon="lucide:refresh-cw" class="mr-1 h-4 w-4" />
              {{ t('settings.scheduledTasks.scheduler.reconcileNow') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="isSchedulerActionRunning"
              @click="restartScheduler"
            >
              <Icon icon="lucide:rotate-cw" class="mr-1 h-4 w-4" />
              {{ t('settings.scheduledTasks.scheduler.restart') }}
            </Button>
          </div>
        </div>
      </div>

      <div
        v-if="settings.tasks.length === 0"
        class="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/30 px-6 py-12 text-center"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Icon icon="lucide:clock-9" class="h-5 w-5" />
        </div>
        <div class="text-sm font-medium">{{ t('settings.scheduledTasks.empty') }}</div>
        <Button variant="outline" size="sm" class="mt-2" @click="addTask">
          <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
          {{ t('settings.scheduledTasks.newTask') }}
        </Button>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div class="flex items-center justify-between px-1">
          <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {{ t('settings.scheduledTasks.listTitle') }}
          </div>
          <div class="text-xs text-muted-foreground">
            {{ settings.tasks.length }}
          </div>
        </div>

        <div class="overflow-hidden rounded-xl border bg-card/30">
          <Collapsible
            v-for="(task, index) in settings.tasks"
            :key="task.id"
            v-slot="{ open }"
            :open="openTaskIds.includes(task.id)"
            @update:open="(value) => setTaskOpen(task.id, value)"
          >
            <div
              :class="[
                'border-b last:border-b-0 transition-colors',
                openTaskIds.includes(task.id) ? 'bg-muted/30' : 'hover:bg-muted/20'
              ]"
            >
              <div class="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
                <CollapsibleTrigger as-child>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
                    :aria-label="open ? t('common.collapse') : t('common.expand')"
                  >
                    <Icon
                      icon="lucide:chevron-right"
                      class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
                      :class="open ? 'rotate-90' : ''"
                    />
                    <div
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary"
                    >
                      {{ index + 1 }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <div class="truncate text-sm font-medium">
                          {{ task.name || t('settings.scheduledTasks.defaults.name') }}
                        </div>
                        <span
                          :class="[
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            getActionKindClass(task.action.kind)
                          ]"
                        >
                          {{ getActionKindLabel(task.action.kind) }}
                        </span>
                      </div>
                      <div class="truncate text-xs text-muted-foreground">
                        {{ getTriggerSummary(task.trigger) }}
                      </div>
                      <div
                        v-if="getLatestRun(task.id)"
                        class="truncate text-[11px] text-muted-foreground"
                      >
                        {{
                          t('settings.scheduledTasks.run.latest', {
                            status: getRunStatusLabel(getLatestRun(task.id)?.status),
                            time: formatOptionalDate(getLatestRun(task.id)?.createdAt ?? null)
                          })
                        }}
                      </div>
                      <div
                        v-if="getLatestRun(task.id)?.error"
                        class="truncate text-[11px] text-destructive"
                      >
                        {{
                          t('settings.scheduledTasks.run.error', {
                            error: getLatestRun(task.id)?.error
                          })
                        }}
                      </div>
                      <div
                        v-if="getLatestRun(task.id)?.sessionId"
                        class="truncate text-[11px] text-muted-foreground"
                      >
                        {{
                          t('settings.scheduledTasks.run.session', {
                            id: getLatestRun(task.id)?.sessionId
                          })
                        }}
                      </div>
                      <div
                        v-if="getLatestRun(task.id)?.outputPreview"
                        class="truncate text-[11px] text-muted-foreground"
                      >
                        {{
                          t('settings.scheduledTasks.run.output', {
                            output: getLatestRun(task.id)?.outputPreview
                          })
                        }}
                      </div>
                    </div>
                  </button>
                </CollapsibleTrigger>

                <div class="flex shrink-0 items-center gap-1">
                  <Button
                    v-if="getLatestRun(task.id)?.sessionId"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    :disabled="openingSessionId === getLatestRun(task.id)?.sessionId"
                    :title="t('settings.scheduledTasks.run.openSession')"
                    @click="openRunSession(getLatestRun(task.id)?.sessionId)"
                  >
                    <Icon
                      :icon="
                        openingSessionId === getLatestRun(task.id)?.sessionId
                          ? 'lucide:loader-2'
                          : 'lucide:message-square-more'
                      "
                      :class="[
                        'h-4 w-4',
                        openingSessionId === getLatestRun(task.id)?.sessionId
                          ? 'animate-spin text-muted-foreground'
                          : ''
                      ]"
                    />
                  </Button>
                  <Switch
                    :model-value="task.enabled"
                    :aria-label="task.enabled ? t('common.enabled') : t('common.disabled')"
                    @update:model-value="(value) => toggleTask(task.id, value === true)"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    :disabled="firingId === task.id"
                    :title="t('settings.scheduledTasks.fireNow')"
                    @click="runTaskNow(task.id)"
                  >
                    <Icon
                      :icon="firingId === task.id ? 'lucide:loader-2' : 'lucide:play'"
                      :class="[
                        'h-4 w-4',
                        firingId === task.id ? 'animate-spin text-muted-foreground' : ''
                      ]"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    :aria-label="t('common.delete')"
                    :title="t('common.delete')"
                    @click="deleteTask(task.id)"
                  >
                    <Icon icon="lucide:trash-2" class="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <CollapsibleContent>
                <div class="border-t bg-background/60 px-4 py-4 sm:px-5 sm:py-5">
                  <div class="mb-4 space-y-2">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.scheduledTasks.namePlaceholder') }}
                    </Label>
                    <Input
                      :model-value="task.name"
                      :placeholder="t('settings.scheduledTasks.namePlaceholder')"
                      class="h-8!"
                      @update:model-value="(value) => updateField(index, 'name', String(value))"
                      @blur="commitTask(index)"
                    />
                  </div>

                  <div class="grid items-start gap-4 lg:grid-cols-2">
                    <section class="space-y-3 rounded-lg border bg-card/40 p-4">
                      <div class="flex items-center gap-2">
                        <Icon icon="lucide:calendar-clock" class="h-4 w-4 text-muted-foreground" />
                        <div class="text-sm font-medium">
                          {{ t('settings.scheduledTasks.trigger.title') }}
                        </div>
                      </div>

                      <div class="space-y-3">
                        <div class="space-y-1.5">
                          <Label class="text-xs text-muted-foreground">
                            {{ t('settings.scheduledTasks.trigger.kind') }}
                          </Label>
                          <Select
                            :model-value="task.trigger.kind"
                            @update:model-value="
                              (value) => updateTriggerKind(index, value as TriggerKind)
                            "
                          >
                            <SelectTrigger class="h-8! w-full min-w-0">
                              <SelectValue class="min-w-0 truncate" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="once">
                                {{ t('settings.scheduledTasks.trigger.kindOnce') }}
                              </SelectItem>
                              <SelectItem value="daily">
                                {{ t('settings.scheduledTasks.trigger.kindDaily') }}
                              </SelectItem>
                              <SelectItem value="weekly">
                                {{ t('settings.scheduledTasks.trigger.kindWeekly') }}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div v-if="task.trigger.kind === 'once'" class="space-y-1.5">
                          <Label class="text-xs text-muted-foreground">
                            {{ t('settings.scheduledTasks.trigger.firesAt') }}
                          </Label>
                          <Input
                            type="datetime-local"
                            class="h-8!"
                            :model-value="onceInputValues[index] ?? ''"
                            @update:model-value="(value) => updateOnceInput(index, String(value))"
                            @blur="commitTask(index)"
                          />
                        </div>

                        <template
                          v-if="task.trigger.kind === 'daily' || task.trigger.kind === 'weekly'"
                        >
                          <div v-if="task.trigger.kind === 'weekly'" class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.trigger.dayOfWeek') }}
                            </Label>
                            <Select
                              :model-value="String((task.trigger as WeeklyTrigger).dayOfWeek)"
                              @update:model-value="(value) => updateWeeklyDay(index, Number(value))"
                            >
                              <SelectTrigger class="h-8! w-full min-w-0">
                                <SelectValue class="min-w-0 truncate" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  v-for="(label, value) in DAY_OF_WEEK_OPTIONS"
                                  :key="value"
                                  :value="String(value)"
                                >
                                  {{ t(label) }}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.trigger.time') }}
                            </Label>
                            <Input
                              type="time"
                              class="h-8!"
                              :model-value="recurringTimeValues[index] ?? '09:00'"
                              @update:model-value="
                                (value) => updateRecurringTime(index, String(value))
                              "
                              @blur="commitTask(index)"
                            />
                          </div>
                        </template>
                      </div>
                    </section>

                    <section class="space-y-3 rounded-lg border bg-card/40 p-4">
                      <div class="flex items-center gap-2">
                        <Icon icon="lucide:send" class="h-4 w-4 text-muted-foreground" />
                        <div class="text-sm font-medium">
                          {{ t('settings.scheduledTasks.action.title') }}
                        </div>
                      </div>

                      <div class="space-y-3">
                        <div class="grid gap-3 sm:grid-cols-2">
                          <div class="min-w-0 space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.kind') }}
                            </Label>
                            <Select
                              :model-value="task.action.kind"
                              @update:model-value="
                                (value) => updateActionKind(index, value as ActionKind)
                              "
                            >
                              <SelectTrigger class="h-8! w-full min-w-0">
                                <SelectValue class="min-w-0 truncate" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="notify">
                                  {{ t('settings.scheduledTasks.action.kindNotify') }}
                                </SelectItem>
                                <SelectItem value="prompt">
                                  {{ t('settings.scheduledTasks.action.kindPrompt') }}
                                </SelectItem>
                                <SelectItem value="agent_run">
                                  {{ t('settings.scheduledTasks.action.kindAgentRun') }}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div class="min-w-0 space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.titleField') }}
                            </Label>
                            <Input
                              :model-value="task.action.title"
                              class="h-8!"
                              :placeholder="t('settings.scheduledTasks.action.titlePlaceholder')"
                              @update:model-value="
                                (value) => updateActionField(index, 'title', String(value))
                              "
                              @blur="commitTask(index)"
                            />
                          </div>
                        </div>

                        <div v-if="task.action.kind === 'notify'" class="space-y-1.5">
                          <Label class="text-xs text-muted-foreground">
                            {{ t('settings.scheduledTasks.action.body') }}
                          </Label>
                          <textarea
                            :value="(task.action as NotifyAction).body"
                            class="min-h-20 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            rows="3"
                            @input="
                              (event) =>
                                updateActionField(
                                  index,
                                  'body',
                                  (event.target as HTMLTextAreaElement).value
                                )
                            "
                            @blur="commitTask(index)"
                          />
                        </div>

                        <div v-if="task.action.kind === 'prompt'" class="space-y-3">
                          <div class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.message') }}
                            </Label>
                            <textarea
                              :value="(task.action as PromptAction).message"
                              class="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              rows="3"
                              @input="
                                (event) =>
                                  updateActionField(
                                    index,
                                    'message',
                                    (event.target as HTMLTextAreaElement).value
                                  )
                              "
                              @blur="commitTask(index)"
                            />
                          </div>

                          <div class="grid gap-3 sm:grid-cols-2">
                            <div class="min-w-0 space-y-1.5">
                              <Label class="text-xs text-muted-foreground">
                                {{ t('settings.scheduledTasks.action.agentId') }}
                              </Label>
                              <Select
                                :model-value="(task.action as PromptAction).agentId ?? 'deepchat'"
                                @update:model-value="
                                  (value) => updateAgentSelection(index, String(value))
                                "
                              >
                                <SelectTrigger class="h-8! w-full min-w-0">
                                  <SelectValue
                                    class="min-w-0 truncate"
                                    :placeholder="
                                      t('settings.scheduledTasks.action.agentIdPlaceholder')
                                    "
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem
                                    v-for="agent in enabledAgents"
                                    :key="agent.id"
                                    :value="agent.id"
                                  >
                                    <span class="block max-w-[18rem] truncate">
                                      {{ agent.name }} ({{ agent.id }})
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div class="min-w-0 space-y-1.5">
                              <Label class="text-xs text-muted-foreground">
                                {{ t('settings.scheduledTasks.action.modelId') }}
                              </Label>
                              <Popover
                                :open="modelPickerOpen[task.id] ?? false"
                                @update:open="(value) => setModelPickerOpen(task.id, value)"
                              >
                                <PopoverTrigger as-child>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    class="h-8! w-full min-w-0 justify-between px-3 text-left font-normal"
                                  >
                                    <span class="flex min-w-0 items-center gap-2">
                                      <ModelIcon
                                        v-if="
                                          getSelectedModelProviderId(task.action as PromptAction)
                                        "
                                        :model-id="
                                          getSelectedModelProviderId(task.action as PromptAction)
                                        "
                                        class="h-4 w-4 shrink-0"
                                      />
                                      <span class="truncate">
                                        {{ getModelLabel(task.action as PromptAction) }}
                                      </span>
                                    </span>
                                    <Icon
                                      icon="lucide:chevron-down"
                                      class="h-4 w-4 shrink-0 opacity-50"
                                    />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  class="w-[min(22rem,calc(100vw-2rem))] p-0"
                                >
                                  <ModelSelect
                                    :exclude-providers="['acp']"
                                    :respect-chat-mode="false"
                                    :selected-provider-id="
                                      (task.action as PromptAction).providerId ?? ''
                                    "
                                    :selected-model-id="(task.action as PromptAction).modelId ?? ''"
                                    @update:model="
                                      (model, providerId) =>
                                        updateModelSelection(index, task.id, model, providerId)
                                    "
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>

                          <div class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.systemPrompt') }}
                            </Label>
                            <textarea
                              :value="(task.action as PromptAction).systemPrompt ?? ''"
                              class="min-h-20 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              rows="2"
                              @input="
                                (event) =>
                                  updateActionField(
                                    index,
                                    'systemPrompt',
                                    (event.target as HTMLTextAreaElement).value
                                  )
                              "
                              @blur="commitTask(index)"
                            />
                          </div>

                          <label
                            class="flex w-fit items-center gap-2 text-xs text-muted-foreground"
                          >
                            <input
                              type="checkbox"
                              :checked="(task.action as PromptAction).autoSend"
                              @change="
                                (event) =>
                                  updateActionField(
                                    index,
                                    'autoSend',
                                    (event.target as HTMLInputElement).checked
                                  )
                              "
                              @blur="commitTask(index)"
                            />
                            {{ t('settings.scheduledTasks.action.autoSend') }}
                          </label>
                        </div>

                        <div v-if="task.action.kind === 'agent_run'" class="space-y-3">
                          <div class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.prompt') }}
                            </Label>
                            <textarea
                              :value="(task.action as AgentRunAction).prompt"
                              class="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              rows="3"
                              @input="
                                (event) =>
                                  updateActionField(
                                    index,
                                    'prompt',
                                    (event.target as HTMLTextAreaElement).value
                                  )
                              "
                              @blur="commitTask(index)"
                            />
                          </div>

                          <div class="grid gap-3 sm:grid-cols-2">
                            <div class="min-w-0 space-y-1.5">
                              <Label class="text-xs text-muted-foreground">
                                {{ t('settings.scheduledTasks.action.agentId') }}
                              </Label>
                              <Select
                                :model-value="task.execution.agentId ?? 'deepchat'"
                                @update:model-value="
                                  (value) => updateAgentSelection(index, String(value))
                                "
                              >
                                <SelectTrigger class="h-8! w-full min-w-0">
                                  <SelectValue
                                    class="min-w-0 truncate"
                                    :placeholder="
                                      t('settings.scheduledTasks.action.agentIdPlaceholder')
                                    "
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem
                                    v-for="agent in enabledAgents"
                                    :key="agent.id"
                                    :value="agent.id"
                                  >
                                    <span class="block max-w-[18rem] truncate">
                                      {{ agent.name }} ({{ agent.id }})
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div class="min-w-0 space-y-1.5">
                              <Label class="text-xs text-muted-foreground">
                                {{ t('settings.scheduledTasks.action.modelId') }}
                              </Label>
                              <Popover
                                :open="modelPickerOpen[`${task.id}:agent_run`] ?? false"
                                @update:open="
                                  (value) => setModelPickerOpen(`${task.id}:agent_run`, value)
                                "
                              >
                                <PopoverTrigger as-child>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    class="h-8! w-full min-w-0 justify-between px-3 text-left font-normal"
                                  >
                                    <span class="flex min-w-0 items-center gap-2">
                                      <ModelIcon
                                        v-if="getSelectedModelProviderId(task.execution)"
                                        :model-id="getSelectedModelProviderId(task.execution)"
                                        class="h-4 w-4 shrink-0"
                                      />
                                      <span class="truncate">
                                        {{ getModelLabel(task.execution) }}
                                      </span>
                                    </span>
                                    <Icon
                                      icon="lucide:chevron-down"
                                      class="h-4 w-4 shrink-0 opacity-50"
                                    />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  class="w-[min(22rem,calc(100vw-2rem))] p-0"
                                >
                                  <ModelSelect
                                    :exclude-providers="['acp']"
                                    :respect-chat-mode="false"
                                    :selected-provider-id="task.execution.providerId ?? ''"
                                    :selected-model-id="task.execution.modelId ?? ''"
                                    @update:model="
                                      (model, providerId) =>
                                        updateModelSelection(
                                          index,
                                          `${task.id}:agent_run`,
                                          model,
                                          providerId
                                        )
                                    "
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>

                          <div class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.systemPrompt') }}
                            </Label>
                            <textarea
                              :value="task.execution.systemPrompt ?? ''"
                              class="min-h-20 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              rows="2"
                              @input="
                                (event) =>
                                  updateExecutionField(
                                    index,
                                    'systemPrompt',
                                    (event.target as HTMLTextAreaElement).value
                                  )
                              "
                              @blur="commitTask(index)"
                            />
                          </div>

                          <div class="grid gap-3 sm:grid-cols-2">
                            <div class="min-w-0 space-y-1.5">
                              <Label class="text-xs text-muted-foreground">
                                {{ t('settings.scheduledTasks.action.workdir') }}
                              </Label>
                              <Input
                                :model-value="task.context.workdir ?? ''"
                                class="h-8!"
                                :placeholder="
                                  t('settings.scheduledTasks.action.workdirPlaceholder')
                                "
                                @update:model-value="
                                  (value) => updateContextField(index, 'workdir', String(value))
                                "
                                @blur="commitTask(index)"
                              />
                            </div>

                            <div class="min-w-0 space-y-1.5">
                              <Label class="text-xs text-muted-foreground">
                                {{ t('settings.scheduledTasks.action.permissionProfile') }}
                              </Label>
                              <Select
                                :model-value="task.execution.permissionProfile"
                                @update:model-value="
                                  (value) =>
                                    updateExecutionField(
                                      index,
                                      'permissionProfile',
                                      value as ScheduledTaskPermissionProfile
                                    )
                                "
                              >
                                <SelectTrigger class="h-8! w-full min-w-0">
                                  <SelectValue class="min-w-0 truncate" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem
                                    v-for="profile in permissionProfileOptions"
                                    :key="profile"
                                    :value="profile"
                                  >
                                    {{ t(`settings.scheduledTasks.permission.${profile}`) }}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div class="space-y-1.5">
                            <Label class="text-xs text-muted-foreground">
                              {{ t('settings.scheduledTasks.action.skillIds') }}
                            </Label>
                            <Input
                              :model-value="task.context.skillIds.join(', ')"
                              class="h-8!"
                              :placeholder="t('settings.scheduledTasks.action.skillIdsPlaceholder')"
                              @update:model-value="
                                (value) => updateContextSkillIds(index, String(value))
                              "
                              @blur="commitTask(index)"
                            />
                          </div>

                          <div class="grid gap-2 sm:grid-cols-2">
                            <label class="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                :checked="task.delivery.targets.includes('desktop')"
                                @change="
                                  (event) =>
                                    updateDeliveryTarget(
                                      index,
                                      'desktop',
                                      (event.target as HTMLInputElement).checked
                                    )
                                "
                                @blur="commitTask(index)"
                              />
                              {{ t('settings.scheduledTasks.action.deliveryDesktop') }}
                            </label>
                            <label class="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                :checked="task.delivery.suppressSuccess"
                                @change="
                                  (event) =>
                                    updateDeliveryField(
                                      index,
                                      'suppressSuccess',
                                      (event.target as HTMLInputElement).checked
                                    )
                                "
                                @blur="commitTask(index)"
                              />
                              {{ t('settings.scheduledTasks.action.suppressSuccess') }}
                            </label>
                            <label class="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                :checked="task.delivery.notifyOnFailure"
                                @change="
                                  (event) =>
                                    updateDeliveryField(
                                      index,
                                      'notifyOnFailure',
                                      (event.target as HTMLInputElement).checked
                                    )
                                "
                                @blur="commitTask(index)"
                              />
                              {{ t('settings.scheduledTasks.action.notifyOnFailure') }}
                            </label>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </div>
    </template>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useToast } from '@/components/use-toast'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useModelStore } from '@/stores/modelStore'
import { createConfigClient } from '@api/ConfigClient'
import { createScheduledTasksClient } from '@api/ScheduledTasksClient'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import {
  SCHEDULED_TASK_PERMISSION_PROFILES,
  createDefaultScheduledTaskContext,
  createDefaultScheduledTaskDelivery,
  createDefaultScheduledTaskExecution
} from '@shared/scheduledTasks'
import type {
  ScheduledTask,
  ScheduledTaskAction,
  ScheduledTaskDeliveryTarget,
  ScheduledTaskExecutionPolicy,
  ScheduledTaskPermissionProfile,
  ScheduledTaskRun,
  ScheduledTaskTrigger,
  ScheduledTasksSettings,
  SchedulerProcessStatus
} from '@shared/scheduledTasks'
import type { Agent } from '@shared/types/agent-interface'
import type { RENDERER_MODEL_META } from '@shared/presenter'

type TriggerKind = ScheduledTaskTrigger['kind']
type ActionKind = ScheduledTaskAction['kind']
type NotifyAction = Extract<ScheduledTaskAction, { kind: 'notify' }>
type PromptAction = Extract<ScheduledTaskAction, { kind: 'prompt' }>
type AgentRunAction = Extract<ScheduledTaskAction, { kind: 'agent_run' }>
type WeeklyTrigger = Extract<ScheduledTaskTrigger, { kind: 'weekly' }>
type ModelSelectionTarget = Pick<ScheduledTaskExecutionPolicy, 'providerId' | 'modelId'>

const { t } = useI18n()
const { toast } = useToast()
const client = createScheduledTasksClient()
const configClient = createConfigClient()
const modelStore = useModelStore()

const settings = ref<ScheduledTasksSettings | null>(null)
const agents = ref<Agent[]>([])
const saveCounter = ref(0)
const isLoading = ref(false)
const isSaving = ref(false)
const firingId = ref<string | null>(null)
const openingSessionId = ref<string | null>(null)
const isSchedulerActionRunning = ref(false)
const modelPickerOpen = ref<Record<string, boolean>>({})
const openTaskIds = ref<string[]>([])
const schedulerStatus = ref<SchedulerProcessStatus | null>(null)
const taskRuns = ref<Record<string, ScheduledTaskRun[]>>({})

const onceInputValues = ref<string[]>([])
const recurringTimeValues = ref<string[]>([])

const DAY_OF_WEEK_OPTIONS: Record<number, string> = {
  0: 'settings.scheduledTasks.weekday.sun',
  1: 'settings.scheduledTasks.weekday.mon',
  2: 'settings.scheduledTasks.weekday.tue',
  3: 'settings.scheduledTasks.weekday.wed',
  4: 'settings.scheduledTasks.weekday.thu',
  5: 'settings.scheduledTasks.weekday.fri',
  6: 'settings.scheduledTasks.weekday.sat'
}
const permissionProfileOptions = SCHEDULED_TASK_PERMISSION_PROFILES.filter(
  (profile) => profile !== 'notify_only'
)

const tasks = computed(() => settings.value?.tasks ?? [])
const enabledAgents = computed(() => agents.value.filter((agent) => agent.enabled))

const getSelectedModelProviderId = (target: ModelSelectionTarget): string => target.providerId ?? ''

const getModelLabel = (target: ModelSelectionTarget): string => {
  if (!target.modelId) {
    return t('settings.scheduledTasks.action.modelIdPlaceholder')
  }

  const provider = modelStore.enabledModels.find((entry) => entry.providerId === target.providerId)
  const model = provider?.models.find((entry) => entry.id === target.modelId)
  return model?.name ?? target.modelId
}

const getActionKindLabel = (kind: ActionKind): string => {
  switch (kind) {
    case 'notify':
      return t('settings.scheduledTasks.action.kindNotify')
    case 'prompt':
      return t('settings.scheduledTasks.action.kindPrompt')
    case 'agent_run':
      return t('settings.scheduledTasks.action.kindAgentRun')
  }
}

const getActionKindClass = (kind: ActionKind): string => {
  if (kind === 'agent_run') {
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
  return kind === 'prompt' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
}

const getTriggerSummary = (trigger: ScheduledTaskTrigger): string => {
  switch (trigger.kind) {
    case 'once':
      return t('settings.scheduledTasks.summary.once', {
        time: new Date(trigger.firesAt).toLocaleString()
      })
    case 'daily':
      return t('settings.scheduledTasks.summary.daily', {
        time: `${padTwo(trigger.hour)}:${padTwo(trigger.minute)}`
      })
    case 'weekly':
      return t('settings.scheduledTasks.summary.weekly', {
        day: t(DAY_OF_WEEK_OPTIONS[trigger.dayOfWeek]),
        time: `${padTwo(trigger.hour)}:${padTwo(trigger.minute)}`
      })
  }
}

const getLatestRun = (taskId: string): ScheduledTaskRun | undefined => taskRuns.value[taskId]?.[0]

const getSchedulerStateLabel = (state: SchedulerProcessStatus['state'] | undefined): string => {
  return t(`settings.scheduledTasks.scheduler.state.${state ?? 'stopped'}`)
}

const getRunStatusLabel = (status: ScheduledTaskRun['status'] | undefined): string => {
  return t(`settings.scheduledTasks.run.status.${status ?? 'queued'}`)
}

const formatOptionalDate = (timestamp: number | null): string => {
  return timestamp
    ? new Date(timestamp).toLocaleString()
    : t('settings.scheduledTasks.scheduler.none')
}

const setTaskOpen = (taskId: string, open: boolean) => {
  if (open) {
    if (!openTaskIds.value.includes(taskId)) {
      openTaskIds.value = [...openTaskIds.value, taskId]
    }
  } else {
    openTaskIds.value = openTaskIds.value.filter((id) => id !== taskId)
  }
}

const setModelPickerOpen = (taskId: string, open: boolean) => {
  modelPickerOpen.value = { ...modelPickerOpen.value, [taskId]: open }
}

const padTwo = (value: number): string => value.toString().padStart(2, '0')

const formatDateTimeLocal = (timestamp: number): string => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = padTwo(date.getMonth() + 1)
  const day = padTwo(date.getDate())
  const hour = padTwo(date.getHours())
  const minute = padTwo(date.getMinutes())
  return `${year}-${month}-${day}T${hour}:${minute}`
}

const parseDateTimeLocal = (value: string): number | null => {
  if (!value) {
    return null
  }
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

const cloneForIpc = <T>(value: T): T => structuredClone(toRaw(value))

const applySettingsResponse = (nextSettings: ScheduledTasksSettings, requestId: number): void => {
  if (requestId !== saveCounter.value) {
    return
  }
  settings.value = nextSettings
  refreshFormBuffers()
  void loadSchedulerSnapshot(nextSettings.tasks)
}

const refreshFormBuffers = () => {
  onceInputValues.value = tasks.value.map((task) =>
    task.trigger.kind === 'once' ? formatDateTimeLocal(task.trigger.firesAt) : ''
  )
  recurringTimeValues.value = tasks.value.map((task) => {
    if (task.trigger.kind === 'daily' || task.trigger.kind === 'weekly') {
      return `${padTwo(task.trigger.hour)}:${padTwo(task.trigger.minute)}`
    }
    return '09:00'
  })
}

watch(
  () => tasks.value.map((task) => task.id).join('|'),
  () => {
    refreshFormBuffers()
    const ids = new Set(tasks.value.map((task) => task.id))
    openTaskIds.value = openTaskIds.value.filter((id) => ids.has(id))
  }
)

const loadSettings = async () => {
  isLoading.value = true
  try {
    const [nextSettings, nextAgents, nextStatus] = await Promise.all([
      client.list(),
      configClient.listAgents(),
      client.getSchedulerStatus()
    ])
    settings.value = nextSettings
    agents.value = nextAgents
    schedulerStatus.value = nextStatus
    refreshFormBuffers()
    await loadTaskRuns(nextSettings.tasks)
  } catch (error) {
    console.error('[ScheduledTasks] Failed to load settings:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isLoading.value = false
  }
}

const loadTaskRuns = async (taskList: ScheduledTask[]): Promise<void> => {
  const entries = await Promise.all(
    taskList.map(async (task) => [task.id, await client.listRuns(task.id, 1)] as const)
  )
  taskRuns.value = Object.fromEntries(entries)
}

const loadSchedulerSnapshot = async (taskList: ScheduledTask[] = tasks.value): Promise<void> => {
  try {
    const [nextStatus] = await Promise.all([client.getSchedulerStatus(), loadTaskRuns(taskList)])
    schedulerStatus.value = nextStatus
  } catch (error) {
    console.error('[ScheduledTasks] Failed to load scheduler snapshot:', error)
  }
}

const persistTask = async (task: ScheduledTask): Promise<void> => {
  const requestId = ++saveCounter.value
  isSaving.value = true
  try {
    const response = await client.upsert({
      id: task.id,
      name: task.name,
      enabled: task.enabled,
      trigger: cloneForIpc(task.trigger),
      action: cloneForIpc(task.action),
      context: cloneForIpc(task.context),
      execution: cloneForIpc(task.execution),
      delivery: cloneForIpc(task.delivery)
    })
    applySettingsResponse(response.settings, requestId)
  } catch (error) {
    console.error('[ScheduledTasks] Failed to persist task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSaving.value = false
  }
}

const commitTask = async (index: number) => {
  const task = tasks.value[index]
  if (!task) {
    return
  }
  await persistTask(task)
}

const updateField = (index: number, field: 'name', value: string) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  next[index] = { ...target, [field]: value }
  settings.value = { ...settings.value, tasks: next }
}

const updateTriggerKind = (index: number, kind: TriggerKind) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  let trigger: ScheduledTaskTrigger
  switch (kind) {
    case 'once': {
      const future = Date.now() + 60 * 60 * 1000
      trigger = { kind: 'once', firesAt: future }
      break
    }
    case 'daily':
      trigger = { kind: 'daily', hour: 9, minute: 0 }
      break
    case 'weekly':
      trigger = { kind: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 }
      break
  }
  next[index] = { ...target, trigger }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateOnceInput = (index: number, value: string) => {
  onceInputValues.value[index] = value
  const parsed = parseDateTimeLocal(value)
  if (!parsed || !settings.value) {
    return
  }
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target || target.trigger.kind !== 'once') return
  next[index] = { ...target, trigger: { kind: 'once', firesAt: parsed } }
  settings.value = { ...settings.value, tasks: next }
}

const updateRecurringTime = (index: number, value: string) => {
  recurringTimeValues.value[index] = value
  const [hourString, minuteString] = value.split(':')
  const hour = Number(hourString)
  const minute = Number(minuteString)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !settings.value) {
    return
  }
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  if (target.trigger.kind === 'daily') {
    next[index] = { ...target, trigger: { kind: 'daily', hour, minute } }
  } else if (target.trigger.kind === 'weekly') {
    next[index] = {
      ...target,
      trigger: { kind: 'weekly', dayOfWeek: target.trigger.dayOfWeek, hour, minute }
    }
  } else {
    return
  }
  settings.value = { ...settings.value, tasks: next }
}

const updateWeeklyDay = (index: number, dayOfWeek: number) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target || target.trigger.kind !== 'weekly') return
  next[index] = {
    ...target,
    trigger: { ...target.trigger, dayOfWeek }
  }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateActionKind = (index: number, kind: ActionKind) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  let action: ScheduledTaskAction
  if (kind === 'notify') {
    action = {
      kind: 'notify',
      title: target.action.title || target.name || t('settings.scheduledTasks.defaults.title'),
      body: ''
    }
  } else {
    if (kind === 'agent_run') {
      const prompt =
        target.action.kind === 'prompt'
          ? target.action.message
          : target.action.kind === 'notify'
            ? target.action.body
            : target.action.prompt
      action = {
        kind: 'agent_run',
        title: target.action.title || target.name || t('settings.scheduledTasks.defaults.title'),
        prompt
      }
      next[index] = {
        ...target,
        action,
        context: target.context ?? createDefaultScheduledTaskContext(),
        execution: {
          ...createDefaultScheduledTaskExecution(),
          ...target.execution,
          agentId:
            target.action.kind === 'prompt'
              ? (target.action.agentId ?? 'deepchat')
              : (target.execution.agentId ?? 'deepchat'),
          providerId:
            target.action.kind === 'prompt'
              ? target.action.providerId
              : target.execution.providerId,
          modelId:
            target.action.kind === 'prompt' ? target.action.modelId : target.execution.modelId
        },
        delivery: target.delivery ?? createDefaultScheduledTaskDelivery()
      }
      settings.value = { ...settings.value, tasks: next }
      void commitTask(index)
      return
    }
    action = {
      kind: 'prompt',
      title: target.action.title || target.name || t('settings.scheduledTasks.defaults.title'),
      message:
        target.action.kind === 'notify'
          ? target.action.body
          : target.action.kind === 'agent_run'
            ? target.action.prompt
            : '',
      autoSend: false,
      agentId: 'deepchat'
    }
  }
  next[index] = { ...target, action }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateActionField = (
  index: number,
  field: keyof PromptAction | keyof NotifyAction | keyof AgentRunAction,
  value: string | boolean
) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  const updatedAction = { ...target.action, [field]: value } as ScheduledTaskAction
  next[index] = { ...target, action: updatedAction }
  settings.value = { ...settings.value, tasks: next }
}

const updateAgentSelection = (index: number, agentId: string) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target || (target.action.kind !== 'prompt' && target.action.kind !== 'agent_run')) return

  const agent = enabledAgents.value.find((entry) => entry.id === agentId)
  const preset = agent?.config?.defaultModelPreset
  if (target.action.kind === 'agent_run') {
    next[index] = {
      ...target,
      execution: {
        ...target.execution,
        agentId,
        ...(preset ? { providerId: preset.providerId, modelId: preset.modelId } : {})
      }
    }
    settings.value = { ...settings.value, tasks: next }
    void commitTask(index)
    return
  }

  const action: PromptAction = {
    ...target.action,
    agentId,
    ...(preset ? { providerId: preset.providerId, modelId: preset.modelId } : {})
  }
  next[index] = { ...target, action }
  settings.value = { ...settings.value, tasks: next }
  void commitTask(index)
}

const updateModelSelection = (
  index: number,
  taskId: string,
  model: RENDERER_MODEL_META,
  providerId: string
) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target || (target.action.kind !== 'prompt' && target.action.kind !== 'agent_run')) return

  if (target.action.kind === 'agent_run') {
    next[index] = {
      ...target,
      execution: {
        ...target.execution,
        providerId,
        modelId: model.id
      }
    }
    settings.value = { ...settings.value, tasks: next }
    setModelPickerOpen(taskId, false)
    void commitTask(index)
    return
  }

  const action: PromptAction = {
    ...target.action,
    providerId,
    modelId: model.id
  }
  next[index] = { ...target, action }
  settings.value = { ...settings.value, tasks: next }
  setModelPickerOpen(taskId, false)
  void commitTask(index)
}

const updateContextField = (index: number, field: 'workdir', value: string) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  next[index] = {
    ...target,
    context: {
      ...target.context,
      [field]: value.trim() || undefined
    }
  }
  settings.value = { ...settings.value, tasks: next }
}

const updateContextSkillIds = (index: number, value: string) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  next[index] = {
    ...target,
    context: {
      ...target.context,
      skillIds: value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
  }
  settings.value = { ...settings.value, tasks: next }
}

const updateExecutionField = <K extends keyof ScheduledTaskExecutionPolicy>(
  index: number,
  field: K,
  value: ScheduledTaskExecutionPolicy[K]
) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  next[index] = {
    ...target,
    execution: {
      ...target.execution,
      [field]: typeof value === 'string' && value.trim() === '' ? undefined : value
    }
  }
  settings.value = { ...settings.value, tasks: next }
}

const updateDeliveryField = (
  index: number,
  field: 'suppressSuccess' | 'notifyOnFailure',
  value: boolean
) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  next[index] = {
    ...target,
    delivery: {
      ...target.delivery,
      [field]: value
    }
  }
  settings.value = { ...settings.value, tasks: next }
}

const updateDeliveryTarget = (
  index: number,
  targetName: ScheduledTaskDeliveryTarget,
  enabled: boolean
) => {
  if (!settings.value) return
  const next = settings.value.tasks.slice()
  const target = next[index]
  if (!target) return
  const targets = new Set(target.delivery.targets)
  if (enabled) {
    targets.add(targetName)
  } else {
    targets.delete(targetName)
  }
  targets.add('inbox')
  next[index] = {
    ...target,
    delivery: {
      ...target.delivery,
      targets: [...targets]
    }
  }
  settings.value = { ...settings.value, tasks: next }
}

const addTask = async () => {
  const requestId = ++saveCounter.value
  isSaving.value = true
  try {
    const response = await client.upsert({
      name: t('settings.scheduledTasks.defaults.name'),
      enabled: false,
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      action: {
        kind: 'notify',
        title: t('settings.scheduledTasks.defaults.title'),
        body: t('settings.scheduledTasks.defaults.body')
      },
      context: createDefaultScheduledTaskContext(),
      execution: createDefaultScheduledTaskExecution(),
      delivery: createDefaultScheduledTaskDelivery()
    })
    applySettingsResponse(response.settings, requestId)
    if (requestId === saveCounter.value && response.task) {
      setTaskOpen(response.task.id, true)
    }
  } catch (error) {
    console.error('[ScheduledTasks] Failed to add task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSaving.value = false
  }
}

const toggleTask = async (id: string, enabled: boolean) => {
  const requestId = ++saveCounter.value
  try {
    const response = await client.toggle(id, enabled)
    applySettingsResponse(response.settings, requestId)
  } catch (error) {
    console.error('[ScheduledTasks] Failed to toggle task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const deleteTask = async (id: string) => {
  const requestId = ++saveCounter.value
  try {
    const response = await client.remove(id)
    applySettingsResponse(response, requestId)
  } catch (error) {
    console.error('[ScheduledTasks] Failed to delete task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const runTaskNow = async (id: string) => {
  const requestId = ++saveCounter.value
  firingId.value = id
  try {
    const response = await client.fireNow(id)
    applySettingsResponse(response.settings, requestId)
    toast({
      title: t('settings.scheduledTasks.fireNowSuccess'),
      description: response.task.name
    })
  } catch (error) {
    console.error('[ScheduledTasks] Failed to fire task:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    firingId.value = null
  }
}

const openRunSession = async (sessionId: string | undefined) => {
  if (!sessionId) return
  openingSessionId.value = sessionId
  try {
    const opened = await client.openRunSession(sessionId)
    if (!opened) {
      throw new Error(t('settings.scheduledTasks.run.openSessionFailed'))
    }
  } catch (error) {
    console.error('[ScheduledTasks] Failed to open run session:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    openingSessionId.value = null
  }
}

const reconcileScheduler = async () => {
  isSchedulerActionRunning.value = true
  try {
    schedulerStatus.value = await client.reconcileNow()
    await loadTaskRuns(tasks.value)
  } catch (error) {
    console.error('[ScheduledTasks] Failed to reconcile scheduler:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSchedulerActionRunning.value = false
  }
}

const restartScheduler = async () => {
  isSchedulerActionRunning.value = true
  try {
    schedulerStatus.value = await client.restartScheduler()
    await loadTaskRuns(tasks.value)
  } catch (error) {
    console.error('[ScheduledTasks] Failed to restart scheduler:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSchedulerActionRunning.value = false
  }
}

onMounted(() => {
  void loadSettings()
})
</script>
