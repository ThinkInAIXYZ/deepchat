<template>
  <div :class="['w-full', props.maxWidthClass]">
    <div class="flex w-full items-center justify-between px-1 py-2">
      <div class="flex min-w-0 items-center gap-1">
        <template v-if="isAcpAgent">
          <div
            class="acp-agent-badge flex h-6 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground backdrop-blur-lg"
          >
            <ModelIcon
              :model-id="acpAgentIconId"
              custom-class="w-3.5 h-3.5 shrink-0"
              :is-dark="themeStore.isDark"
            />
            <span class="truncate">{{ acpAgentLabel }}</span>
            <Icon
              v-if="isAcpConfigLoading"
              icon="lucide:loader-2"
              class="acp-agent-loading-indicator h-3 w-3 shrink-0 animate-spin"
            />
          </div>

          <Popover
            v-for="option in acpInlineOptions"
            :key="option.id"
            :open="acpInlineOpenOptionId === option.id"
            @update:open="onAcpInlineOptionOpenChange(option.id, $event)"
          >
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                :title="getAcpOptionDisplayValue(option)"
                :data-option-id="option.id"
                class="acp-inline-option h-6 max-w-[9rem] min-w-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
                :disabled="acpConfigReadOnly || isAcpOptionSaving(option.id)"
              >
                <span class="truncate">{{ getAcpOptionDisplayValue(option) }}</span>
                <Icon icon="lucide:chevron-down" class="h-3 w-3 shrink-0" />
              </Button>
            </PopoverTrigger>

            <PopoverContent align="start" class="w-56 overflow-hidden p-0">
              <div class="border-b px-3 py-2">
                <div
                  :data-option-id="option.id"
                  class="acp-inline-option-title text-sm font-medium"
                >
                  {{ option.label }}
                </div>
              </div>

              <div
                v-if="(option.options?.length ?? 0) > 0"
                class="max-h-60 overflow-y-auto px-2 py-2"
              >
                <button
                  v-for="entry in option.options ?? []"
                  :key="`${option.id}-${entry.value}`"
                  type="button"
                  :data-option-id="option.id"
                  :data-value="entry.value"
                  :disabled="
                    acpConfigReadOnly ||
                    isAcpOptionSaving(option.id) ||
                    String(option.currentValue) === entry.value
                  "
                  :class="[
                    'acp-inline-option-item flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-60',
                    String(option.currentValue) === entry.value
                      ? 'bg-muted/60 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  ]"
                  @click="onAcpSelectOption(option.id, entry.value)"
                >
                  {{ entry.value }}
                </button>
              </div>

              <div v-else class="px-3 py-4 text-xs text-muted-foreground">
                {{ t('chat.modelPicker.empty') }}
              </div>
            </PopoverContent>
          </Popover>
        </template>

        <Popover v-else-if="showModelPopover" v-model:open="isModelPanelOpen">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
            >
              <ModelIcon
                :model-id="displayIconId"
                custom-class="w-3.5 h-3.5"
                :is-dark="themeStore.isDark"
              />
              <span>{{ displayModelText }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            :class="[
              'max-w-[calc(100vw-1rem)] overflow-hidden p-0',
              isModelSettingsExpanded ? 'w-[38rem]' : 'w-[20rem]'
            ]"
          >
            <div class="flex max-h-[28rem]">
              <div
                :class="[
                  'flex min-w-0 flex-col',
                  isModelSettingsExpanded ? 'w-[18rem] border-r' : 'w-full'
                ]"
              >
                <div class="border-b px-2.5 py-2">
                  <Input
                    data-model-search-input="true"
                    v-model="modelSearchKeyword"
                    class="h-7 border-0 bg-transparent px-3 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    :placeholder="t('model.search.placeholder')"
                  />
                </div>

                <div class="max-h-[24rem] overflow-y-auto px-2 py-2">
                  <div
                    v-if="filteredModelGroups.length === 0"
                    class="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    {{ t('chat.modelPicker.empty') }}
                  </div>

                  <div v-else class="space-y-3">
                    <div
                      v-for="group in filteredModelGroups"
                      :key="group.providerId"
                      class="space-y-1"
                    >
                      <div
                        class="px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        {{ group.providerName }}
                      </div>

                      <div class="space-y-1">
                        <div
                          v-for="model in group.models"
                          :key="`${group.providerId}-${model.id}`"
                          class="flex items-center gap-1"
                        >
                          <button
                            type="button"
                            :class="[
                              'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                              isModelSelected(group.providerId, model.id)
                                ? 'bg-muted/60 text-foreground'
                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                            ]"
                            @click="handleModelQuickSelect(group.providerId, model.id)"
                          >
                            <ModelIcon
                              :model-id="resolveModelIconId(group.providerId, model.id)"
                              custom-class="w-3.5 h-3.5 shrink-0"
                              :is-dark="themeStore.isDark"
                            />
                            <span class="min-w-0 flex-1 truncate font-medium">{{ model.id }}</span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            class="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                            :aria-label="t('chat.advancedSettings.button')"
                            :title="t('chat.advancedSettings.button')"
                            @click.stop="openModelSettings(group.providerId, model.id)"
                          >
                            <Icon icon="lucide:chevron-right" class="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="isModelSettingsExpanded" class="flex w-[21rem] min-w-0 flex-col">
                <div class="border-b px-3 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium">{{ t('settings.model.title') }}</div>
                      <div class="mt-1 truncate text-xs font-medium">
                        {{ modelSettingsModelName }}
                      </div>
                      <div class="truncate text-[11px] text-muted-foreground">
                        {{ modelSettingsProviderText }}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                      :aria-label="t('common.close')"
                      :title="t('common.close')"
                      @click="collapseModelSettings"
                    >
                      <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div class="max-h-[24rem] overflow-y-auto px-3 py-3">
                  <div
                    v-if="!isModelSettingsReady"
                    class="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    {{ t('common.loading') }}
                  </div>

                  <div v-else-if="localSettings" class="space-y-4">
                    <div class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('chat.advancedSettings.temperature')
                      }}</label>
                      <div class="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="temperature"
                          data-setting-action="decrement"
                          :aria-label="
                            t('chat.advancedSettings.decreaseValue', {
                              label: t('chat.advancedSettings.temperature')
                            })
                          "
                          :disabled="hasNumericInputError('temperature')"
                          @click="stepTemperature(-1)"
                        >
                          <Icon icon="lucide:minus" class="h-3 w-3" />
                        </Button>
                        <Input
                          :class="[
                            'h-8 flex-1 text-xs tabular-nums',
                            hasNumericInputError('temperature') ? 'border-destructive' : ''
                          ]"
                          data-setting-control="temperature"
                          type="number"
                          :step="TEMPERATURE_STEP"
                          :aria-invalid="hasNumericInputError('temperature')"
                          :model-value="temperatureInputValue"
                          @focus="startNumericInputEdit('temperature')"
                          @update:model-value="onTemperatureInput"
                          @blur="commitTemperatureInput"
                          @keydown.enter.prevent="commitTemperatureInput"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="temperature"
                          data-setting-action="increment"
                          :aria-label="
                            t('chat.advancedSettings.increaseValue', {
                              label: t('chat.advancedSettings.temperature')
                            })
                          "
                          :disabled="hasNumericInputError('temperature')"
                          @click="stepTemperature(1)"
                        >
                          <Icon icon="lucide:plus" class="h-3 w-3" />
                        </Button>
                      </div>
                      <p
                        v-if="getNumericInputErrorMessage('temperature')"
                        class="text-[11px] text-destructive"
                      >
                        {{ getNumericInputErrorMessage('temperature') }}
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('chat.advancedSettings.contextLength')
                      }}</label>
                      <div class="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="contextLength"
                          data-setting-action="decrement"
                          :aria-label="
                            t('chat.advancedSettings.decreaseValue', {
                              label: t('chat.advancedSettings.contextLength')
                            })
                          "
                          :disabled="
                            hasNumericInputError('contextLength') ||
                            localSettings.contextLength <= 0
                          "
                          @click="stepContextLength(-1)"
                        >
                          <Icon icon="lucide:minus" class="h-3 w-3" />
                        </Button>
                        <Input
                          :class="[
                            'h-8 flex-1 text-xs tabular-nums',
                            hasNumericInputError('contextLength') ? 'border-destructive' : ''
                          ]"
                          data-setting-control="contextLength"
                          type="number"
                          :step="CONTEXT_LENGTH_STEP"
                          :aria-invalid="hasNumericInputError('contextLength')"
                          :model-value="contextLengthInputValue"
                          @focus="startNumericInputEdit('contextLength')"
                          @update:model-value="onContextLengthInput"
                          @blur="commitContextLengthInput"
                          @keydown.enter.prevent="commitContextLengthInput"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="contextLength"
                          data-setting-action="increment"
                          :aria-label="
                            t('chat.advancedSettings.increaseValue', {
                              label: t('chat.advancedSettings.contextLength')
                            })
                          "
                          :disabled="hasNumericInputError('contextLength')"
                          @click="stepContextLength(1)"
                        >
                          <Icon icon="lucide:plus" class="h-3 w-3" />
                        </Button>
                      </div>
                      <p
                        v-if="getNumericInputErrorMessage('contextLength')"
                        class="text-[11px] text-destructive"
                      >
                        {{ getNumericInputErrorMessage('contextLength') }}
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('chat.advancedSettings.maxTokens')
                      }}</label>
                      <div class="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="maxTokens"
                          data-setting-action="decrement"
                          :aria-label="
                            t('chat.advancedSettings.decreaseValue', {
                              label: t('chat.advancedSettings.maxTokens')
                            })
                          "
                          :disabled="
                            hasNumericInputError('maxTokens') || localSettings.maxTokens <= 0
                          "
                          @click="stepMaxTokens(-1)"
                        >
                          <Icon icon="lucide:minus" class="h-3 w-3" />
                        </Button>
                        <Input
                          :class="[
                            'h-8 flex-1 text-xs tabular-nums',
                            hasNumericInputError('maxTokens') ? 'border-destructive' : ''
                          ]"
                          data-setting-control="maxTokens"
                          type="number"
                          :step="MAX_TOKENS_STEP"
                          :aria-invalid="hasNumericInputError('maxTokens')"
                          :model-value="maxTokensInputValue"
                          @focus="startNumericInputEdit('maxTokens')"
                          @update:model-value="onMaxTokensInput"
                          @blur="commitMaxTokensInput"
                          @keydown.enter.prevent="commitMaxTokensInput"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="maxTokens"
                          data-setting-action="increment"
                          :aria-label="
                            t('chat.advancedSettings.increaseValue', {
                              label: t('chat.advancedSettings.maxTokens')
                            })
                          "
                          :disabled="hasNumericInputError('maxTokens')"
                          @click="stepMaxTokens(1)"
                        >
                          <Icon icon="lucide:plus" class="h-3 w-3" />
                        </Button>
                      </div>
                      <p
                        v-if="getNumericInputErrorMessage('maxTokens')"
                        class="text-[11px] text-destructive"
                      >
                        {{ getNumericInputErrorMessage('maxTokens') }}
                      </p>
                    </div>

                    <div v-if="showReasoningEffort" class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('settings.model.modelConfig.reasoningEffort.label')
                      }}</label>
                      <Select
                        :model-value="localSettings.reasoningEffort ?? effortOptions[0]?.value"
                        @update:model-value="onReasoningEffortSelect($event as string)"
                      >
                        <SelectTrigger class="h-8 text-xs">
                          <SelectValue
                            :placeholder="
                              t('settings.model.modelConfig.reasoningEffort.placeholder')
                            "
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="option in effortOptions"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div v-if="showVerbosity" class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('settings.model.modelConfig.verbosity.label')
                      }}</label>
                      <Select
                        :model-value="localSettings.verbosity ?? verbosityOptions[0]?.value"
                        @update:model-value="onVerbositySelect($event as string)"
                      >
                        <SelectTrigger class="h-8 text-xs">
                          <SelectValue
                            :placeholder="t('settings.model.modelConfig.verbosity.placeholder')"
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="option in verbosityOptions"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div v-if="showThinkingBudget" class="space-y-1.5">
                      <div class="flex items-center justify-between">
                        <label class="text-xs font-medium">{{
                          t('chat.advancedSettings.thinkingBudget')
                        }}</label>
                        <div class="flex items-center gap-2">
                          <span v-if="thinkingBudgetHint" class="text-[11px] text-muted-foreground">
                            {{ thinkingBudgetHint }}
                          </span>
                          <Switch
                            data-setting-control="thinkingBudget-toggle"
                            :model-value="isThinkingBudgetEnabled"
                            :aria-label="
                              t('chat.advancedSettings.toggleValue', {
                                label: t('chat.advancedSettings.thinkingBudget')
                              })
                            "
                            @update:model-value="onThinkingBudgetToggle(Boolean($event))"
                          />
                        </div>
                      </div>
                      <div v-if="isThinkingBudgetEnabled" class="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="thinkingBudget"
                          data-setting-action="decrement"
                          :aria-label="
                            t('chat.advancedSettings.decreaseValue', {
                              label: t('chat.advancedSettings.thinkingBudget')
                            })
                          "
                          :disabled="
                            hasNumericInputError('thinkingBudget') ||
                            (localSettings.thinkingBudget ?? 0) <= 0
                          "
                          @click="stepThinkingBudget(-1)"
                        >
                          <Icon icon="lucide:minus" class="h-3 w-3" />
                        </Button>
                        <Input
                          :class="[
                            'h-8 flex-1 text-xs tabular-nums',
                            hasNumericInputError('thinkingBudget') ? 'border-destructive' : ''
                          ]"
                          data-setting-control="thinkingBudget"
                          type="number"
                          :step="THINKING_BUDGET_STEP"
                          :aria-invalid="hasNumericInputError('thinkingBudget')"
                          :model-value="thinkingBudgetInputValue"
                          @focus="startNumericInputEdit('thinkingBudget')"
                          @update:model-value="onThinkingBudgetInput"
                          @blur="commitThinkingBudgetInput"
                          @keydown.enter.prevent="commitThinkingBudgetInput"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          class="h-8 w-8 shrink-0"
                          data-setting-control="thinkingBudget"
                          data-setting-action="increment"
                          :aria-label="
                            t('chat.advancedSettings.increaseValue', {
                              label: t('chat.advancedSettings.thinkingBudget')
                            })
                          "
                          :disabled="hasNumericInputError('thinkingBudget')"
                          @click="stepThinkingBudget(1)"
                        >
                          <Icon icon="lucide:plus" class="h-3 w-3" />
                        </Button>
                      </div>
                      <p
                        v-if="getNumericInputErrorMessage('thinkingBudget')"
                        class="text-[11px] text-destructive"
                      >
                        {{ getNumericInputErrorMessage('thinkingBudget') }}
                      </p>
                    </div>

                    <div class="space-y-1.5">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <label class="text-xs font-medium">
                            {{ t('chat.advancedSettings.forceInterleavedThinkingCompat') }}
                          </label>
                          <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            {{
                              t('chat.advancedSettings.forceInterleavedThinkingCompatDescription')
                            }}
                          </p>
                        </div>
                        <Switch
                          data-setting-control="forceInterleavedThinkingCompat-toggle"
                          :model-value="isInterleavedThinkingEnabled"
                          :aria-label="
                            t('chat.advancedSettings.toggleValue', {
                              label: t('chat.advancedSettings.forceInterleavedThinkingCompat')
                            })
                          "
                          @update:model-value="onInterleavedThinkingToggle(Boolean($event))"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          v-else
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          :disabled="true"
        >
          <ModelIcon
            :model-id="displayIconId"
            custom-class="w-3.5 h-3.5"
            :is-dark="themeStore.isDark"
          />
          <span>{{ displayModelText }}</span>
        </Button>
      </div>

      <div class="flex items-center gap-1">
        <Popover v-if="isAcpAgent && acpOverflowOptions.length > 0">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="acp-overflow-button h-6 w-6 px-0 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
              :title="t('chat.advancedSettings.button')"
              :aria-label="t('chat.advancedSettings.button')"
            >
              <Icon icon="lucide:settings-2" class="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="end" class="w-[18rem] p-0">
            <div class="border-b px-3 py-3">
              <div class="text-sm font-medium">{{ t('chat.advancedSettings.title') }}</div>
            </div>

            <div class="max-h-[24rem] space-y-3 overflow-y-auto px-3 py-3">
              <div
                v-for="option in acpOverflowOptions"
                :key="option.id"
                :data-option-id="option.id"
                class="acp-overflow-option flex items-center justify-between gap-3"
              >
                <label class="min-w-0 flex-1 truncate text-xs font-medium">
                  {{ option.label }}
                </label>

                <Select
                  v-if="option.type === 'select'"
                  :model-value="String(option.currentValue)"
                  @update:model-value="onAcpSelectOption(option.id, $event as string)"
                >
                  <SelectTrigger
                    :disabled="acpConfigReadOnly || isAcpOptionSaving(option.id)"
                    class="h-8 w-[9rem] text-xs"
                  >
                    <span class="truncate">{{ getAcpOptionDisplayValue(option) }}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="entry in option.options ?? []"
                      :key="`${option.id}-${entry.value}`"
                      :value="entry.value"
                    >
                      {{ entry.value }}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  v-else
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-8 min-w-[6rem] text-xs"
                  :disabled="acpConfigReadOnly || isAcpOptionSaving(option.id)"
                  @click="onAcpBooleanOption(option.id, !Boolean(option.currentValue))"
                >
                  <span class="truncate">{{ getAcpOptionDisplayValue(option) }}</span>
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <McpIndicator
          :show-system-prompt-section="showSystemPromptSection"
          :system-prompt-options="systemPromptMenuOptions"
          :selected-system-prompt-id="selectedSystemPromptId"
          :show-custom-system-prompt-badge="selectedSystemPromptId === '__custom__'"
          :show-subagent-toggle="showSubagentToggle"
          :subagent-enabled="subagentEnabled"
          :subagent-toggle-pending="isSubagentToggleUpdating"
          @select-system-prompt="onSystemPromptSelect"
          @open-change="handleSessionPanelOpenChange"
          @toggle-subagents="onSubagentToggle"
        />

        <DropdownMenu v-if="!isAcpAgent">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              :class="[
                'h-6 px-2 gap-1.5 text-xs backdrop-blur-lg',
                permissionMode === 'full_access'
                  ? 'text-orange-500 hover:text-orange-600'
                  : 'text-muted-foreground hover:text-foreground'
              ]"
            >
              <Icon :icon="permissionIcon" class="w-3.5 h-3.5" />
              <span>{{ permissionModeLabel }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-48">
            <DropdownMenuItem
              v-for="option in permissionOptions"
              :key="option.value"
              class="gap-2 text-xs py-1.5 px-2"
              @select="selectPermissionMode(option.value)"
            >
              <Icon :icon="option.icon" :class="['h-3.5 w-3.5 shrink-0', option.iconClass]" />
              <span class="flex-1">{{ option.label }}</span>
              <Icon
                v-if="permissionMode === option.value"
                icon="lucide:check"
                class="h-3.5 w-3.5 shrink-0"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Input } from '@shadcn/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
import type {
  AcpConfigOption,
  AcpConfigState,
  RENDERER_MODEL_META,
  SystemPrompt
} from '@shared/presenter'
import type {
  DeepChatAgentConfig,
  PermissionMode,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'
import type { ReasoningPortrait } from '@shared/types/model-db'
import {
  normalizeLegacyThinkingBudgetValue,
  parseFiniteNumericValue,
  toValidNonNegativeInteger,
  type GenerationNumericField,
  type GenerationNumericValidationCode,
  validateGenerationNumericField
} from '@shared/utils/generationSettingsValidation'
import McpIndicator from '@/components/chat-input/McpIndicator.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'
import { useThemeStore } from '@/stores/theme'
import { useAgentStore } from '@/stores/ui/agent'
import { useDraftStore } from '@/stores/ui/draft'
import { useProjectStore } from '@/stores/ui/project'
import { useSessionStore } from '@/stores/ui/session'
import { ACP_WORKSPACE_EVENTS } from '@/events'

const props = withDefaults(
  defineProps<{
    acpDraftSessionId?: string | null
    maxWidthClass?: string
  }>(),
  {
    acpDraftSessionId: null,
    maxWidthClass: 'max-w-2xl'
  }
)

type ModelSelection = {
  providerId: string
  modelId: string
}

type SystemPromptOption = {
  id: string
  label: string
  content: string
  disabled?: boolean
}

type GroupedModelList = {
  providerId: string
  providerName: string
  models: RENDERER_MODEL_META[]
}

const TEMPERATURE_STEP = 0.1
const CONTEXT_LENGTH_STEP = 1024
const MAX_TOKENS_STEP = 128
const THINKING_BUDGET_STEP = 128
const ACP_INLINE_OPTION_LIMIT = 3
const DEFAULT_REASONING_EFFORT_OPTIONS: SessionGenerationSettings['reasoningEffort'][] = [
  'minimal',
  'low',
  'medium',
  'high'
]
const DEFAULT_VERBOSITY_OPTIONS: SessionGenerationSettings['verbosity'][] = [
  'low',
  'medium',
  'high'
]

const themeStore = useThemeStore()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const projectStore = useProjectStore()
const configPresenter = usePresenter('configPresenter')
const llmproviderPresenter = usePresenter('llmproviderPresenter')
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const { t } = useI18n()

const draftModelSelection = ref<ModelSelection | null>(null)
const permissionMode = ref<PermissionMode>('full_access')
const subagentEnabled = ref(false)
const localSettings = ref<SessionGenerationSettings | null>(null)
const loadedSettingsSelection = ref<ModelSelection | null>(null)
const systemPromptList = ref<SystemPrompt[]>([])
const isModelPanelOpen = ref(false)
const isModelSettingsExpanded = ref(false)
const modelSearchKeyword = ref('')
const modelSettingsSelection = ref<ModelSelection | null>(null)
const acpConfigState = ref<AcpConfigState | null>(null)
const acpConfigLoadedRequestKey = ref<string | null>(null)
const acpConfigLoadingRequestKey = ref<string | null>(null)
const acpInlineOpenOptionId = ref<string | null>(null)
const acpOptionSavingIds = ref<string[]>([])
const acpConfigCacheByAgent = new Map<string, AcpConfigState>()
const activeNumericInput = ref<GenerationNumericField | null>(null)
const numericInputDrafts = ref<Record<GenerationNumericField, string>>({
  temperature: '',
  contextLength: '',
  maxTokens: '',
  thinkingBudget: ''
})
const numericInputErrors = ref<
  Record<GenerationNumericField, GenerationNumericValidationCode | null>
>({
  temperature: null,
  contextLength: null,
  maxTokens: null,
  thinkingBudget: null
})

const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityReasoningPortrait = ref<ReasoningPortrait | null>(null)

let draftModelSyncToken = 0
let permissionSyncToken = 0
let generationSyncToken = 0
let acpConfigSyncToken = 0
let generationPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingGenerationPatch: Partial<SessionGenerationSettings> = {}
let generationPersistRequestToken = 0
let generationLocalRevision = 0
const isSubagentToggleUpdating = ref(false)

const hasActiveSession = computed(() => sessionStore.hasActiveSession)
const availableAgents = computed(() => (Array.isArray(agentStore.agents) ? agentStore.agents : []))
const inferAgentType = (agentId: string | null | undefined): 'deepchat' | 'acp' | null => {
  if (!agentId) {
    return null
  }

  const matchedAgent = availableAgents.value.find((agent) => agent.id === agentId)
  const selectedAgent =
    agentStore.selectedAgent && agentStore.selectedAgent.id === agentId
      ? agentStore.selectedAgent
      : null
  const explicitType = matchedAgent?.agentType ?? matchedAgent?.type ?? selectedAgent?.type
  if (explicitType === 'deepchat' || explicitType === 'acp') {
    return explicitType
  }

  return agentId === 'deepchat' ? 'deepchat' : 'acp'
}

const resolveDeepChatAgentConfig = async (agentId: string): Promise<DeepChatAgentConfig> => {
  if (typeof configPresenter.resolveDeepChatAgentConfig === 'function') {
    return configPresenter.resolveDeepChatAgentConfig(agentId)
  }

  const defaultSystemPrompt =
    (typeof configPresenter.getDefaultSystemPrompt === 'function'
      ? await configPresenter.getDefaultSystemPrompt()
      : await configPresenter.getSetting?.('default_system_prompt')) ?? ''

  return normalizeDeepChatSubagentConfig({
    defaultModelPreset: undefined,
    systemPrompt: typeof defaultSystemPrompt === 'string' ? defaultSystemPrompt : '',
    permissionMode: 'full_access',
    disabledAgentTools: []
  })
}

const selectedAgentType = computed<'deepchat' | 'acp' | null>(() => {
  return inferAgentType(agentStore.selectedAgentId)
})
const selectedDeepChatAgentId = computed(() => {
  if (selectedAgentType.value === 'acp') {
    return null
  }
  return agentStore.selectedAgentId ?? 'deepchat'
})

const isAcpAgent = computed(() => {
  if (hasActiveSession.value) {
    return sessionStore.activeSession?.providerId === 'acp'
  }
  return selectedAgentType.value === 'acp'
})

const activeAcpAgentId = computed(() => {
  if (hasActiveSession.value && sessionStore.activeSession?.providerId === 'acp') {
    return sessionStore.activeSession.modelId || null
  }
  const selectedAgentId = agentStore.selectedAgentId
  return selectedAgentType.value === 'acp' ? selectedAgentId : null
})

const activeAcpSessionId = computed(() => {
  if (hasActiveSession.value && sessionStore.activeSession?.providerId === 'acp') {
    return sessionStore.activeSessionId
  }
  const draftSessionId = props.acpDraftSessionId?.trim()
  return draftSessionId ? draftSessionId : null
})

const acpWorkspacePath = computed(() => {
  if (hasActiveSession.value && sessionStore.activeSession?.providerId === 'acp') {
    return sessionStore.activeSession.projectDir?.trim() || null
  }
  return projectStore.selectedProject?.path?.trim() || null
})

const lockedAcpModelId = computed(() => {
  if (hasActiveSession.value && sessionStore.activeSession?.providerId === 'acp') {
    return sessionStore.activeSession.modelId || null
  }
  const selectedAgentId = agentStore.selectedAgentId
  return selectedAgentType.value === 'acp' ? selectedAgentId : null
})

const isModelSelectionLocked = computed(() => isAcpAgent.value && Boolean(lockedAcpModelId.value))
const showModelPopover = computed(
  () => !isAcpAgent.value || Boolean(activeAcpSessionId.value || acpWorkspacePath.value)
)

const activeSessionSelection = computed<ModelSelection | null>(() => {
  const active = sessionStore.activeSession
  if (!active?.providerId || !active?.modelId) return null
  return {
    providerId: active.providerId,
    modelId: active.modelId
  }
})

const effectiveModelSelection = computed<ModelSelection | null>(() => {
  if (hasActiveSession.value) {
    return activeSessionSelection.value
  }
  if (isAcpAgent.value) {
    const agentId = agentStore.selectedAgentId
    return selectedAgentType.value === 'acp' && agentId
      ? { providerId: 'acp', modelId: agentId }
      : null
  }
  return draftModelSelection.value
})

const canSelectPermissionMode = computed(() => !isAcpAgent.value)
const showSubagentToggle = computed(() => {
  if (isAcpAgent.value) {
    return false
  }

  if (hasActiveSession.value) {
    return (
      sessionStore.activeSession?.sessionKind === 'regular' &&
      inferAgentType(sessionStore.activeSession?.agentId) === 'deepchat'
    )
  }

  return selectedAgentType.value === 'deepchat'
})

const providerNameMap = computed(() => {
  const map = new Map<string, string>()
  providerStore.sortedProviders.forEach((provider) => {
    map.set(provider.id, provider.name)
  })
  return map
})

const modelGroups = computed<GroupedModelList[]>(() => {
  const groupsById = new Map(
    modelStore.enabledModels
      .filter((group) => group.providerId !== 'acp')
      .map((group) => [group.providerId, group.models] as const)
  )

  const result: GroupedModelList[] = []

  providerStore.sortedProviders
    .filter((provider) => provider.enable && provider.id !== 'acp')
    .forEach((provider) => {
      const models = groupsById.get(provider.id)
      if (!models || models.length === 0) {
        return
      }
      result.push({
        providerId: provider.id,
        providerName: provider.name,
        models
      })
      groupsById.delete(provider.id)
    })

  Array.from(groupsById.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([providerId, models]) => {
      result.push({
        providerId,
        providerName: providerNameMap.value.get(providerId) ?? providerId,
        models
      })
    })

  return result
})

const filteredModelGroups = computed<GroupedModelList[]>(() => {
  const keyword = modelSearchKeyword.value.trim().toLowerCase()
  if (!keyword) {
    return modelGroups.value
  }

  return modelGroups.value
    .map((group) => {
      const providerMatched = `${group.providerName} ${group.providerId}`
        .toLowerCase()
        .includes(keyword)
      return {
        ...group,
        models: providerMatched
          ? group.models
          : group.models.filter((model) =>
              `${model.name} ${model.id}`.toLowerCase().includes(keyword)
            )
      }
    })
    .filter((group) => group.models.length > 0)
})

const modelSettingsTarget = computed<ModelSelection | null>(() => {
  return modelSettingsSelection.value ?? effectiveModelSelection.value
})

const acpConfigCacheKey = computed(() => {
  if (!isAcpAgent.value || activeAcpSessionId.value) {
    return null
  }
  return activeAcpAgentId.value
})

const acpConfigRequestKey = computed(() => {
  if (!isAcpAgent.value) {
    return null
  }
  if (activeAcpSessionId.value) {
    return `session:${activeAcpSessionId.value}`
  }
  if (acpConfigCacheKey.value && acpWorkspacePath.value) {
    return `process:${acpConfigCacheKey.value}::${acpWorkspacePath.value}`
  }
  if (acpConfigCacheKey.value) {
    return `agent:${acpConfigCacheKey.value}`
  }
  return null
})

const getCachedAcpConfigState = (agentId?: string | null): AcpConfigState | null => {
  if (!agentId) {
    return null
  }
  return acpConfigCacheByAgent.get(agentId) ?? null
}

const setCachedAcpConfigState = (
  agentId: string | null | undefined,
  state: AcpConfigState | null | undefined
): void => {
  if (!agentId || !hasAcpConfigStateData(state)) {
    return
  }
  acpConfigCacheByAgent.set(agentId, state)
}

const acpConfigOptions = computed(() => acpConfigState.value?.options ?? [])
const isAcpConfigLoading = computed(() => {
  if (!isAcpAgent.value || activeAcpSessionId.value) {
    return false
  }

  const requestKey = acpConfigRequestKey.value
  return Boolean(requestKey && acpConfigLoadingRequestKey.value === requestKey)
})
const isAcpSessionConfigLoaded = computed(() => {
  if (!activeAcpSessionId.value) {
    return false
  }

  return acpConfigLoadedRequestKey.value === acpConfigRequestKey.value
})

const acpConfigReadOnly = computed(() => {
  if (!isAcpAgent.value) {
    return false
  }

  if (!activeAcpSessionId.value) {
    return true
  }

  return !isAcpSessionConfigLoaded.value
})
const acpInlineOptions = computed(() =>
  acpConfigOptions.value
    .filter((option) => option.type === 'select')
    .slice(0, ACP_INLINE_OPTION_LIMIT)
)
const acpOverflowOptions = computed(() => {
  const inlineIds = new Set(acpInlineOptions.value.map((option) => option.id))
  return acpConfigOptions.value.filter((option) => !inlineIds.has(option.id))
})
const acpAgentLabel = computed(() => {
  const modelId = activeAcpAgentId.value ?? agentStore.selectedAgentId
  return (
    resolveModelName('acp', modelId) ||
    agentStore.selectedAgent?.name ||
    modelId ||
    t('chat.mode.acpAgent')
  )
})
const acpAgentIconId = computed(() =>
  resolveModelIconId('acp', activeAcpAgentId.value ?? agentStore.selectedAgentId)
)

const setAcpConfigLoadingRequest = (requestKey: string | null | undefined): void => {
  acpConfigLoadingRequestKey.value = requestKey?.trim() ? requestKey : null
}

const clearAcpConfigLoadingRequest = (requestKey?: string | null): void => {
  if (!requestKey || acpConfigLoadingRequestKey.value === requestKey) {
    acpConfigLoadingRequestKey.value = null
  }
}

const matchesCurrentAcpWarmupTarget = (
  agentId: string | null | undefined,
  workdir: string | null | undefined
): boolean => {
  if (activeAcpSessionId.value || !agentId || activeAcpAgentId.value !== agentId) {
    return false
  }

  const expectedWorkdir = acpWorkspacePath.value?.trim()
  if (!expectedWorkdir) {
    return true
  }

  return workdir?.trim() === expectedWorkdir
}

const permissionModeLabel = computed(() =>
  permissionMode.value === 'default'
    ? t('chat.permissionMode.default')
    : t('chat.permissionMode.fullAccess')
)

const permissionIcon = computed(() =>
  permissionMode.value === 'full_access' ? 'lucide:shield-alert' : 'lucide:shield'
)

const permissionOptions = computed(() => [
  {
    value: 'default' as const,
    label: t('chat.permissionMode.default'),
    icon: 'lucide:shield',
    iconClass: 'text-muted-foreground'
  },
  {
    value: 'full_access' as const,
    label: t('chat.permissionMode.fullAccess'),
    icon: 'lucide:shield-alert',
    iconClass: 'text-orange-500'
  }
])

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { providerId?: unknown; modelId?: unknown }
  return typeof candidate.providerId === 'string' && typeof candidate.modelId === 'string'
}

const isReasoningEffort = (value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' =>
  value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'

const isVerbosity = (value: unknown): value is 'low' | 'medium' | 'high' =>
  value === 'low' || value === 'medium' || value === 'high'

const getCommittedNumericInputValue = (field: GenerationNumericField): string => {
  if (!localSettings.value) {
    return ''
  }

  switch (field) {
    case 'temperature':
      return String(localSettings.value.temperature)
    case 'contextLength':
      return String(localSettings.value.contextLength)
    case 'maxTokens':
      return String(localSettings.value.maxTokens)
    case 'thinkingBudget': {
      const value = localSettings.value.thinkingBudget
      return value === undefined ? '' : String(value)
    }
  }
}

const syncNumericInputDraft = (field: GenerationNumericField): void => {
  numericInputDrafts.value[field] = getCommittedNumericInputValue(field)
}

const clearNumericInputError = (field: GenerationNumericField): void => {
  numericInputErrors.value[field] = null
}

const setNumericInputError = (
  field: GenerationNumericField,
  code: GenerationNumericValidationCode
): void => {
  numericInputErrors.value[field] = code
}

const resetNumericInputFieldState = (field: GenerationNumericField): void => {
  clearNumericInputError(field)
  syncNumericInputDraft(field)
}

const resetNumericInputState = (): void => {
  activeNumericInput.value = null
  resetNumericInputFieldState('temperature')
  resetNumericInputFieldState('contextLength')
  resetNumericInputFieldState('maxTokens')
  resetNumericInputFieldState('thinkingBudget')
}

const hasNumericInputError = (field: GenerationNumericField): boolean =>
  numericInputErrors.value[field] !== null

const startNumericInputEdit = (field: GenerationNumericField): void => {
  activeNumericInput.value = field
  if (!hasNumericInputError(field)) {
    syncNumericInputDraft(field)
  }
}

const setNumericInputDraft = (field: GenerationNumericField, value: string | number): void => {
  if (activeNumericInput.value !== field) {
    activeNumericInput.value = field
  }
  const nextValue = typeof value === 'string' ? value : String(value)
  if (numericInputDrafts.value[field] !== nextValue) {
    generationLocalRevision += 1
  }
  numericInputDrafts.value[field] = nextValue
  clearNumericInputError(field)
}

const stopNumericInputEdit = (field: GenerationNumericField): void => {
  if (activeNumericInput.value === field) {
    activeNumericInput.value = null
  }
}

const getNumericInputValue = (field: GenerationNumericField): string => {
  if (activeNumericInput.value === field || hasNumericInputError(field)) {
    return numericInputDrafts.value[field]
  }
  return getCommittedNumericInputValue(field)
}

const getNumericInputErrorMessage = (field: GenerationNumericField): string => {
  const code = numericInputErrors.value[field]
  if (!code) {
    return ''
  }

  switch (code) {
    case 'finite_number':
      return t('chat.advancedSettings.validation.finiteNumber')
    case 'non_negative_integer':
      return t('chat.advancedSettings.validation.nonNegativeInteger')
    case 'context_length_below_max_tokens':
      return t('chat.advancedSettings.validation.contextLengthAtLeastMaxTokens')
    case 'max_tokens_exceed_context_length':
      return t('chat.advancedSettings.validation.maxTokensWithinContextLength')
  }
}

const isAcpConfigOptionValue = (
  value: unknown
): value is NonNullable<AcpConfigOption['options']>[number] => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.value === 'string' && typeof candidate.label === 'string'
}

const isAcpConfigOption = (value: unknown): value is AcpConfigOption => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.label !== 'string' ||
    (candidate.type !== 'select' && candidate.type !== 'boolean')
  ) {
    return false
  }
  if (!('currentValue' in candidate)) {
    return false
  }
  if (candidate.type === 'select' && candidate.options !== undefined) {
    return Array.isArray(candidate.options) && candidate.options.every(isAcpConfigOptionValue)
  }
  return true
}

const isAcpConfigState = (value: unknown): value is AcpConfigState => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    (candidate.source === 'configOptions' || candidate.source === 'legacy') &&
    Array.isArray(candidate.options) &&
    candidate.options.every(isAcpConfigOption)
  )
}

const hasAcpConfigStateData = (state: AcpConfigState | null | undefined): state is AcpConfigState =>
  Boolean(state?.options.length)

const getAcpOptionCurrentLabel = (option?: AcpConfigOption | null): string | null => {
  if (!option) {
    return null
  }
  if (option.type !== 'select') {
    return null
  }
  const currentValue = typeof option.currentValue === 'string' ? option.currentValue : ''
  return option.options?.find((entry) => entry.value === currentValue)?.label ?? currentValue
}

const getAcpOptionDisplayValue = (option: AcpConfigOption): string => {
  if (option.type === 'boolean') {
    return t(option.currentValue ? 'common.enabled' : 'common.disabled')
  }

  if (typeof option.currentValue === 'string' && option.currentValue.trim()) {
    return option.currentValue
  }

  return getAcpOptionCurrentLabel(option) ?? ''
}

const findEnabledModelMeta = (providerId: string, modelId: string): RENDERER_MODEL_META | null => {
  const group = modelStore.enabledModels.find((item) => item.providerId === providerId)
  return group?.models.find((model) => model.id === modelId) ?? null
}

const getReasoningEffortOptions = (
  portrait: ReasoningPortrait | null | undefined
): SessionGenerationSettings['reasoningEffort'][] => {
  if (
    !portrait ||
    portrait.mode === 'budget' ||
    portrait.mode === 'level' ||
    portrait.mode === 'fixed'
  ) {
    return []
  }

  const options = portrait?.effortOptions?.filter(isReasoningEffort)
  if (options && options.length > 0) {
    return options
  }
  return portrait.mode !== 'mixed' && isReasoningEffort(portrait?.effort)
    ? [...DEFAULT_REASONING_EFFORT_OPTIONS]
    : []
}

const getVerbosityOptions = (
  portrait: ReasoningPortrait | null | undefined
): SessionGenerationSettings['verbosity'][] => {
  const options = portrait?.verbosityOptions?.filter(isVerbosity)
  if (options && options.length > 0) {
    return options
  }
  return isVerbosity(portrait?.verbosity) ? [...DEFAULT_VERBOSITY_OPTIONS] : []
}

const supportsReasoningEffort = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getReasoningEffortOptions(portrait).length > 0

const supportsVerbosity = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getVerbosityOptions(portrait).length > 0

const hasThinkingBudgetSupport = (portrait: ReasoningPortrait | null | undefined): boolean =>
  Boolean(
    portrait &&
    portrait.mode !== 'effort' &&
    portrait.mode !== 'level' &&
    portrait.mode !== 'fixed' &&
    portrait.budget &&
    (portrait.budget.default !== undefined ||
      portrait.budget.min !== undefined ||
      portrait.budget.max !== undefined ||
      portrait.budget.auto !== undefined ||
      portrait.budget.off !== undefined)
  )

const normalizeReasoningEffort = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['reasoningEffort'] | undefined => {
  if (!isReasoningEffort(value)) {
    return undefined
  }

  const options = getReasoningEffortOptions(portrait)
  if (options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isReasoningEffort(portrait?.effort) && options.includes(portrait.effort)
    ? portrait.effort
    : undefined
}

const normalizeVerbosity = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['verbosity'] | undefined => {
  if (!isVerbosity(value)) {
    return undefined
  }

  const options = getVerbosityOptions(portrait)
  if (options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isVerbosity(portrait?.verbosity) && options.includes(portrait.verbosity)
    ? portrait.verbosity
    : undefined
}

const findEnabledModel = (providerId: string, modelId: string): ModelSelection | null => {
  const hit = findEnabledModelMeta(providerId, modelId)
  if (!hit) {
    return null
  }
  return { providerId, modelId: hit.id }
}

const pickFirstEnabledModel = (): ModelSelection | null => {
  for (const group of modelStore.enabledModels) {
    if (group.providerId === 'acp') continue
    const firstModel = group.models[0]
    if (firstModel) {
      return { providerId: group.providerId, modelId: firstModel.id }
    }
  }
  for (const group of modelStore.enabledModels) {
    const firstModel = group.models[0]
    if (firstModel) {
      return { providerId: group.providerId, modelId: firstModel.id }
    }
  }
  return null
}

const resolveModelName = (providerId?: string | null, modelId?: string | null): string => {
  if (!modelId) {
    return ''
  }
  if (providerId) {
    const hit = findEnabledModelMeta(providerId, modelId)
    if (hit) {
      return hit.name
    }
  }
  const found = modelStore.findModelByIdOrName(modelId)
  if (found) return found.model.name
  return modelId
}

const resolveModelIconId = (providerId?: string | null, modelId?: string | null): string => {
  if (providerId === 'acp' && modelId) {
    return modelId
  }
  return providerId || 'anthropic'
}

const clearPendingGenerationPersist = () => {
  if (generationPersistTimer) {
    clearTimeout(generationPersistTimer)
    generationPersistTimer = null
  }
  pendingGenerationPatch = {}
}

const invalidateGenerationPersistResponses = () => {
  generationPersistRequestToken += 1
}

const temperatureInputValue = computed(() => getNumericInputValue('temperature'))
const contextLengthInputValue = computed(() => getNumericInputValue('contextLength'))
const maxTokensInputValue = computed(() => getNumericInputValue('maxTokens'))
const thinkingBudgetInputValue = computed(() => getNumericInputValue('thinkingBudget'))
const isThinkingBudgetEnabled = computed(() => localSettings.value?.thinkingBudget !== undefined)
const isInterleavedThinkingEnabled = computed(
  () => localSettings.value?.forceInterleavedThinkingCompat === true
)

const thinkingBudgetHint = computed(() => {
  if (!isThinkingBudgetEnabled.value) {
    return t('common.disabled')
  }
  return ''
})

const showThinkingBudget = computed(() => {
  if (!localSettings.value) {
    return false
  }
  return (
    capabilitySupportsReasoning.value === true &&
    hasThinkingBudgetSupport(capabilityReasoningPortrait.value)
  )
})

const showVerbosity = computed(
  () =>
    !isAcpAgent.value &&
    supportsVerbosity(capabilityReasoningPortrait.value) &&
    Boolean(localSettings.value)
)

const showReasoningEffort = computed(
  () =>
    !isAcpAgent.value &&
    supportsReasoningEffort(capabilityReasoningPortrait.value) &&
    Boolean(localSettings.value)
)

const effortOptions = computed(() => {
  return getReasoningEffortOptions(capabilityReasoningPortrait.value).map((value) => ({
    value,
    label: t(`settings.model.modelConfig.reasoningEffort.options.${value}`)
  }))
})

const verbosityOptions = computed(() => {
  return getVerbosityOptions(capabilityReasoningPortrait.value).map((value) => ({
    value,
    label: t(`settings.model.modelConfig.verbosity.options.${value}`)
  }))
})

const systemPromptOptions = computed<SystemPromptOption[]>(() => {
  const presetOptions: SystemPromptOption[] = [
    {
      id: 'empty',
      label: t('promptSetting.emptySystemPromptOption'),
      content: ''
    },
    ...systemPromptList.value.map((prompt) => ({
      id: prompt.id,
      label: prompt.name,
      content: prompt.content
    }))
  ]

  const currentPrompt = localSettings.value?.systemPrompt ?? ''
  if (!currentPrompt) {
    return presetOptions
  }

  const matched = presetOptions.find((option) => option.content === currentPrompt)
  if (matched) {
    return presetOptions
  }

  return [
    {
      id: '__custom__',
      label: t('chat.advancedSettings.currentCustomPrompt'),
      content: currentPrompt,
      disabled: true
    },
    ...presetOptions
  ]
})

const systemPromptMenuOptions = computed(() =>
  systemPromptOptions.value.map((option) => ({
    id: option.id,
    label: option.label,
    disabled: option.disabled
  }))
)

const hasLoadedGenerationSettingsForCurrentSelection = computed(() => {
  const loadedSelection = loadedSettingsSelection.value
  const effectiveSelection = effectiveModelSelection.value

  return Boolean(
    localSettings.value &&
    loadedSelection &&
    effectiveSelection &&
    loadedSelection.providerId === effectiveSelection.providerId &&
    loadedSelection.modelId === effectiveSelection.modelId
  )
})

const selectedSystemPromptId = computed(() => {
  if (!hasLoadedGenerationSettingsForCurrentSelection.value || !localSettings.value) {
    return 'empty'
  }
  const currentPrompt = localSettings.value.systemPrompt
  const matched = systemPromptOptions.value.find((option) => option.content === currentPrompt)
  return matched?.id ?? 'empty'
})

const showSystemPromptSection = computed(
  () => !isAcpAgent.value && hasLoadedGenerationSettingsForCurrentSelection.value
)

const modelSettingsModelName = computed(() => {
  return resolveModelName(
    modelSettingsTarget.value?.providerId ?? null,
    modelSettingsTarget.value?.modelId ?? null
  )
})

const modelSettingsProviderText = computed(() => {
  const selection = modelSettingsTarget.value
  if (!selection) {
    return ''
  }
  const providerName = providerNameMap.value.get(selection.providerId) ?? selection.providerId
  return `${providerName} / ${selection.modelId}`
})

const isModelSettingsReady = computed(() => {
  if (!isModelSettingsExpanded.value) {
    return false
  }
  const target = modelSettingsTarget.value
  const effective = effectiveModelSelection.value
  const loadedSelection = loadedSettingsSelection.value
  if (!target || !effective) {
    return false
  }
  return (
    target.providerId === effective.providerId &&
    target.modelId === effective.modelId &&
    loadedSelection?.providerId === effective.providerId &&
    loadedSelection?.modelId === effective.modelId &&
    Boolean(localSettings.value)
  )
})

const displayIconId = computed(() => {
  if (hasActiveSession.value) {
    return resolveModelIconId(
      activeSessionSelection.value?.providerId || draftModelSelection.value?.providerId,
      activeSessionSelection.value?.modelId || draftModelSelection.value?.modelId
    )
  }
  if (isAcpAgent.value) {
    return resolveModelIconId('acp', agentStore.selectedAgentId)
  }
  return resolveModelIconId(
    draftModelSelection.value?.providerId,
    draftModelSelection.value?.modelId
  )
})

const displayModelText = computed(() => {
  if (isAcpAgent.value) {
    return acpAgentLabel.value
  }
  if (hasActiveSession.value) {
    const selection = activeSessionSelection.value ?? draftModelSelection.value
    if (selection?.modelId) {
      return selection.modelId
    }
    return t('common.selectModel')
  }
  const selection = draftModelSelection.value
  if (selection?.modelId) {
    return selection.modelId
  }
  return t('common.selectModel')
})

const syncDraftModelSelection = async () => {
  const token = ++draftModelSyncToken
  if (hasActiveSession.value) return

  const applyDraftSelection = (selection: ModelSelection | null) => {
    draftModelSelection.value = selection
    draftStore.providerId = selection?.providerId
    draftStore.modelId = selection?.modelId
  }

  if (isAcpAgent.value) {
    const agentId = agentStore.selectedAgentId
    applyDraftSelection(
      selectedAgentType.value === 'acp' && agentId ? { providerId: 'acp', modelId: agentId } : null
    )
    return
  }

  try {
    const currentDraft = findEnabledModel(draftStore.providerId || '', draftStore.modelId || '')
    if (currentDraft) {
      applyDraftSelection(currentDraft)
      return
    }

    const deepChatAgentId = selectedDeepChatAgentId.value ?? 'deepchat'
    const agentConfig = await resolveDeepChatAgentConfig(deepChatAgentId)
    if (token !== draftModelSyncToken) return
    if (isModelSelection(agentConfig.defaultModelPreset)) {
      const resolvedAgentDefault = findEnabledModel(
        agentConfig.defaultModelPreset.providerId,
        agentConfig.defaultModelPreset.modelId
      )
      if (resolvedAgentDefault) {
        applyDraftSelection(resolvedAgentDefault)
        return
      }
    }

    const preferredModel = (await configPresenter.getSetting('preferredModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(preferredModel)) {
      const resolvedPreferred = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
      if (resolvedPreferred) {
        applyDraftSelection(resolvedPreferred)
        return
      }
    }

    const defaultModel = (await configPresenter.getSetting('defaultModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(defaultModel)) {
      const resolvedDefault = findEnabledModel(defaultModel.providerId, defaultModel.modelId)
      if (resolvedDefault) {
        applyDraftSelection(resolvedDefault)
        return
      }
    }
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to resolve draft model:', error)
  }

  if (token !== draftModelSyncToken) return
  applyDraftSelection(pickFirstEnabledModel())
}

const resolveDefaultGenerationSettings = async (
  providerId: string,
  modelId: string,
  agentId: string = 'deepchat'
): Promise<SessionGenerationSettings> => {
  const agentConfig = await resolveDeepChatAgentConfig(agentId)
  const modelConfig = await configPresenter.getModelConfig(modelId, providerId)
  const portrait = (await configPresenter.getReasoningPortrait?.(providerId, modelId)) ?? null
  const contextLengthDefault = toValidNonNegativeInteger(modelConfig.contextLength) ?? 32000
  const maxTokensDefault =
    toValidNonNegativeInteger(modelConfig.maxTokens) ?? Math.min(4096, contextLengthDefault)

  const defaults: SessionGenerationSettings = {
    systemPrompt: agentConfig.systemPrompt ?? '',
    temperature: parseFiniteNumericValue(modelConfig.temperature) ?? 0.7,
    contextLength: contextLengthDefault,
    maxTokens:
      maxTokensDefault <= contextLengthDefault
        ? maxTokensDefault
        : Math.min(4096, contextLengthDefault)
  }

  const interleavedThinkingDefault =
    typeof modelConfig.forceInterleavedThinkingCompat === 'boolean'
      ? modelConfig.forceInterleavedThinkingCompat
      : portrait?.interleaved === true
        ? true
        : undefined
  if (typeof interleavedThinkingDefault === 'boolean') {
    defaults.forceInterleavedThinkingCompat = interleavedThinkingDefault
  }

  if (portrait?.supported === true && hasThinkingBudgetSupport(portrait)) {
    const defaultBudget = normalizeLegacyThinkingBudgetValue(
      modelConfig.thinkingBudget ?? portrait.budget?.default
    )
    if (defaultBudget !== undefined) {
      defaults.thinkingBudget = defaultBudget
    }
  }

  if (supportsReasoningEffort(portrait)) {
    const effort = normalizeReasoningEffort(
      portrait,
      modelConfig.reasoningEffort ?? portrait?.effort
    )
    if (effort) {
      defaults.reasoningEffort = effort
    }
  }

  if (supportsVerbosity(portrait)) {
    const verbosity = normalizeVerbosity(portrait, modelConfig.verbosity ?? portrait?.verbosity)
    if (verbosity) {
      defaults.verbosity = verbosity
    }
  }

  return defaults
}

const fetchCapabilities = async (providerId: string, modelId: string): Promise<void> => {
  try {
    const portrait = (await configPresenter.getReasoningPortrait?.(providerId, modelId)) ?? null

    capabilityReasoningPortrait.value = portrait
    capabilitySupportsReasoning.value =
      typeof portrait?.supported === 'boolean' ? portrait.supported : null
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to fetch model capabilities:', error)
    capabilitySupportsReasoning.value = null
    capabilityReasoningPortrait.value = null
  }
}

const flushGenerationPatch = async () => {
  const patch = pendingGenerationPatch
  pendingGenerationPatch = {}
  generationPersistTimer = null

  if (Object.keys(patch).length === 0) {
    return
  }

  const sessionId = sessionStore.activeSessionId
  if (!sessionId) {
    draftStore.updateGenerationSettings(patch)
    return
  }

  const requestToken = ++generationPersistRequestToken
  const localRevisionAtRequest = generationLocalRevision
  try {
    const updated = await agentSessionPresenter.updateSessionGenerationSettings(sessionId, patch)
    if (requestToken !== generationPersistRequestToken) {
      return
    }
    if (localRevisionAtRequest !== generationLocalRevision) {
      return
    }
    localSettings.value = { ...updated }
    resetNumericInputState()
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to update generation settings:', error)
  }
}

const scheduleGenerationPersist = (patch: Partial<SessionGenerationSettings>) => {
  if (!sessionStore.activeSessionId) {
    clearPendingGenerationPersist()
    draftStore.updateGenerationSettings(patch)
    return
  }

  pendingGenerationPatch = { ...pendingGenerationPatch, ...patch }
  if (generationPersistTimer) {
    clearTimeout(generationPersistTimer)
  }
  generationPersistTimer = setTimeout(() => {
    void flushGenerationPatch()
  }, 300)
}

const updateLocalGenerationSettings = (patch: Partial<SessionGenerationSettings>) => {
  if (!localSettings.value) {
    return
  }
  generationSyncToken += 1
  generationLocalRevision += 1

  const next: SessionGenerationSettings = {
    ...localSettings.value,
    ...patch
  }

  localSettings.value = next

  const normalizedPatch: Partial<SessionGenerationSettings> = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')) {
    normalizedPatch.systemPrompt = next.systemPrompt
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'temperature')) {
    normalizedPatch.temperature = next.temperature
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'contextLength')) {
    normalizedPatch.contextLength = next.contextLength
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxTokens')) {
    normalizedPatch.maxTokens = next.maxTokens
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'thinkingBudget')) {
    normalizedPatch.thinkingBudget = next.thinkingBudget
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')) {
    normalizedPatch.reasoningEffort = next.reasoningEffort
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'verbosity')) {
    normalizedPatch.verbosity = next.verbosity
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'forceInterleavedThinkingCompat')) {
    normalizedPatch.forceInterleavedThinkingCompat = next.forceInterleavedThinkingCompat
  }

  scheduleGenerationPersist(normalizedPatch)
}

const syncGenerationSettings = async () => {
  const token = ++generationSyncToken
  clearPendingGenerationPersist()
  invalidateGenerationPersistResponses()
  resetNumericInputState()
  loadedSettingsSelection.value = null

  if (isAcpAgent.value) {
    localSettings.value = null
    loadedSettingsSelection.value = null
    capabilitySupportsReasoning.value = null
    capabilityReasoningPortrait.value = null
    return
  }

  const selection = effectiveModelSelection.value
  if (!selection) {
    localSettings.value = null
    loadedSettingsSelection.value = null
    capabilityReasoningPortrait.value = null
    capabilitySupportsReasoning.value = null
    return
  }

  await fetchCapabilities(selection.providerId, selection.modelId)
  if (token !== generationSyncToken) {
    return
  }

  const sessionId = sessionStore.activeSessionId
  if (sessionId) {
    try {
      const settings = await agentSessionPresenter.getSessionGenerationSettings(sessionId)
      if (token !== generationSyncToken) {
        return
      }
      if (settings) {
        localSettings.value = { ...settings }
        loadedSettingsSelection.value = { ...selection }
      } else {
        const defaults = await resolveDefaultGenerationSettings(
          selection.providerId,
          selection.modelId,
          sessionStore.activeSession?.agentId ?? 'deepchat'
        )
        if (token !== generationSyncToken) {
          return
        }
        localSettings.value = defaults
        loadedSettingsSelection.value = { ...selection }
      }
      return
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load session generation settings:', error)
    }
  }

  const defaults = await resolveDefaultGenerationSettings(
    selection.providerId,
    selection.modelId,
    selectedDeepChatAgentId.value ?? 'deepchat'
  )
  if (token !== generationSyncToken) {
    return
  }
  localSettings.value = defaults
  loadedSettingsSelection.value = { ...selection }
}

const syncAcpConfigOptions = async () => {
  const token = ++acpConfigSyncToken
  const requestKey = acpConfigRequestKey.value
  acpInlineOpenOptionId.value = null

  if (!isAcpAgent.value || !requestKey) {
    acpConfigState.value = null
    acpConfigLoadedRequestKey.value = null
    clearAcpConfigLoadingRequest()
    return
  }

  const agentId = activeAcpAgentId.value

  if (activeAcpSessionId.value) {
    clearAcpConfigLoadingRequest()
    acpConfigState.value = null
    acpConfigLoadedRequestKey.value = null

    try {
      const state = await agentSessionPresenter.getAcpSessionConfigOptions(activeAcpSessionId.value)
      if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
        return
      }
      acpConfigState.value = state
      acpConfigLoadedRequestKey.value = requestKey
      setCachedAcpConfigState(agentId, state)
      clearAcpConfigLoadingRequest(requestKey)
      return
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load ACP session config options:', error)
      if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
        return
      }
      acpConfigState.value = null
      acpConfigLoadedRequestKey.value = null
      clearAcpConfigLoadingRequest(requestKey)
      return
    }
  }

  acpConfigLoadedRequestKey.value = null
  const cachedState = getCachedAcpConfigState(agentId)
  acpConfigState.value = cachedState

  if (hasAcpConfigStateData(cachedState)) {
    clearAcpConfigLoadingRequest(requestKey)
  } else {
    setAcpConfigLoadingRequest(requestKey)
  }

  if (agentId) {
    try {
      let warmupFailed = false
      try {
        await llmproviderPresenter.warmupAcpProcess(agentId, acpWorkspacePath.value ?? undefined)
      } catch (error) {
        warmupFailed = true
        console.warn('[ChatStatusBar] Failed to warmup ACP process:', error)
      }

      const state = await llmproviderPresenter.getAcpProcessConfigOptions(
        agentId,
        acpWorkspacePath.value ?? undefined
      )
      if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
        return
      }

      if (!hasAcpConfigStateData(state)) {
        acpConfigState.value = getCachedAcpConfigState(agentId)
        if (warmupFailed) {
          clearAcpConfigLoadingRequest(requestKey)
        }
        return
      }

      setCachedAcpConfigState(agentId, state)
      acpConfigState.value = state
      clearAcpConfigLoadingRequest(requestKey)
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load ACP process config options:', error)
      if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
        return
      }
      acpConfigState.value = getCachedAcpConfigState(agentId)
      clearAcpConfigLoadingRequest(requestKey)
    }
  }
}

const updateAcpConfigOption = async (configId: string, value: string | boolean) => {
  const sessionId = activeAcpSessionId.value
  const agentId = activeAcpAgentId.value
  if (!sessionId || !isAcpSessionConfigLoaded.value) {
    return
  }

  if (acpOptionSavingIds.value.includes(configId)) {
    return
  }

  acpOptionSavingIds.value = [...acpOptionSavingIds.value, configId]
  try {
    const updated = await agentSessionPresenter.setAcpSessionConfigOption(
      sessionId,
      configId,
      value
    )
    setCachedAcpConfigState(agentId, updated)
    if (activeAcpSessionId.value !== sessionId) {
      return
    }
    acpConfigState.value = updated
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to update ACP config option:', error)
  } finally {
    acpOptionSavingIds.value = acpOptionSavingIds.value.filter((id) => id !== configId)
  }
}

const isAcpOptionSaving = (configId: string) => acpOptionSavingIds.value.includes(configId)

const reloadSystemPrompts = async () => {
  try {
    systemPromptList.value = await configPresenter.getSystemPrompts()
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to load system prompt options:', error)
    systemPromptList.value = []
  }
}

const handleAcpConfigOptionsReady = (_event: unknown, payload?: Record<string, unknown>) => {
  if (!payload || !isAcpAgent.value) {
    return
  }

  const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : ''
  const agentId = typeof payload.agentId === 'string' ? payload.agentId : ''
  const workdir = typeof payload.workdir === 'string' ? payload.workdir : ''

  if (!isAcpConfigState(payload.configState)) {
    return
  }

  if (conversationId) {
    if (activeAcpSessionId.value !== conversationId) {
      return
    }
    setCachedAcpConfigState(agentId || activeAcpAgentId.value, payload.configState)
    acpConfigState.value = payload.configState
    acpConfigLoadedRequestKey.value = `session:${conversationId}`
    clearAcpConfigLoadingRequest(`session:${conversationId}`)
    return
  }

  if (!matchesCurrentAcpWarmupTarget(agentId, workdir)) {
    return
  }

  setCachedAcpConfigState(agentId, payload.configState)

  if (!activeAcpSessionId.value) {
    acpConfigState.value = payload.configState
    clearAcpConfigLoadingRequest(acpConfigRequestKey.value)
  }
}

watch(
  [hasActiveSession, isAcpAgent, () => agentStore.selectedAgentId, () => modelStore.enabledModels],
  () => {
    if (hasActiveSession.value) return
    void syncDraftModelSelection()
  },
  { immediate: true, deep: true }
)

watch(
  [() => sessionStore.activeSessionId, canSelectPermissionMode, () => draftStore.permissionMode],
  async ([sessionId, canSelect, draftPermissionMode]) => {
    const token = ++permissionSyncToken
    if (!canSelect) {
      permissionMode.value = 'full_access'
      return
    }

    if (!sessionId) {
      permissionMode.value = draftPermissionMode === 'default' ? 'default' : 'full_access'
      return
    }

    try {
      const mode = await agentSessionPresenter.getPermissionMode(sessionId)
      if (token !== permissionSyncToken) return
      permissionMode.value = mode === 'default' ? 'default' : 'full_access'
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load permission mode:', error)
      if (token !== permissionSyncToken) return
      permissionMode.value = 'full_access'
    }
  },
  { immediate: true }
)

watch(
  [
    () => sessionStore.activeSessionId,
    showSubagentToggle,
    () => sessionStore.activeSession?.subagentEnabled,
    () => draftStore.subagentEnabled
  ],
  ([sessionId, canShow, activeEnabled, draftEnabled]) => {
    if (!canShow) {
      subagentEnabled.value = false
      return
    }

    if (sessionId) {
      subagentEnabled.value = activeEnabled === true
      return
    }

    subagentEnabled.value = draftEnabled === true
  },
  { immediate: true }
)

watch(
  [
    () => sessionStore.activeSessionId,
    () => sessionStore.activeSession?.providerId,
    () => sessionStore.activeSession?.modelId,
    () => draftModelSelection.value?.providerId,
    () => draftModelSelection.value?.modelId,
    () => isAcpAgent.value
  ],
  () => {
    void syncGenerationSettings()
  },
  { immediate: true }
)

watch(
  [
    () => sessionStore.activeSessionId,
    () => sessionStore.activeSession?.providerId,
    () => sessionStore.activeSession?.modelId,
    () => sessionStore.activeSession?.projectDir,
    () => agentStore.selectedAgentId,
    () => projectStore.selectedProject?.path,
    () => props.acpDraftSessionId,
    () => isAcpAgent.value
  ],
  () => {
    void syncAcpConfigOptions()
  },
  { immediate: true }
)

watch(
  () => acpInlineOptions.value.map((option) => option.id),
  (optionIds) => {
    if (acpInlineOpenOptionId.value && !optionIds.includes(acpInlineOpenOptionId.value)) {
      acpInlineOpenOptionId.value = null
    }
  }
)

function getEffectiveModelSelectionSnapshot(): ModelSelection | null {
  return effectiveModelSelection.value ? { ...effectiveModelSelection.value } : null
}

watch(isModelPanelOpen, (open) => {
  if (open) {
    modelSearchKeyword.value = ''
    isModelSettingsExpanded.value = false
    modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()

    if (isAcpAgent.value) {
      return
    }

    void nextTick(() => {
      const input = document.querySelector<HTMLInputElement>('[data-model-search-input="true"]')
      input?.focus()
    })
    return
  }

  modelSearchKeyword.value = ''
  isModelSettingsExpanded.value = false
  modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()
})

onBeforeUnmount(() => {
  clearPendingGenerationPersist()
  invalidateGenerationPersistResponses()
  window.electron?.ipcRenderer?.removeListener?.(
    ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY,
    handleAcpConfigOptionsReady
  )
})

onMounted(() => {
  window.electron?.ipcRenderer?.on?.(
    ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY,
    handleAcpConfigOptionsReady
  )
})

function isModelSelected(providerId: string, modelId: string) {
  return (
    effectiveModelSelection.value?.providerId === providerId &&
    effectiveModelSelection.value?.modelId === modelId
  )
}

async function changeModelSelection(providerId: string, modelId: string): Promise<boolean> {
  if (isModelSelectionLocked.value) {
    return false
  }

  if (
    effectiveModelSelection.value?.providerId === providerId &&
    effectiveModelSelection.value?.modelId === modelId
  ) {
    return true
  }

  if (hasActiveSession.value) {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) {
      return false
    }
    try {
      await sessionStore.setSessionModel(sessionId, providerId, modelId)
      return true
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to switch active session model:', error)
      return false
    }
  }

  const previousDraftSelection = draftModelSelection.value ? { ...draftModelSelection.value } : null
  const previousDraftProviderId = draftStore.providerId
  const previousDraftModelId = draftStore.modelId
  const previousDraftGenerationSettings = {
    systemPrompt: draftStore.systemPrompt,
    temperature: draftStore.temperature,
    contextLength: draftStore.contextLength,
    maxTokens: draftStore.maxTokens,
    thinkingBudget: draftStore.thinkingBudget,
    reasoningEffort: draftStore.reasoningEffort,
    verbosity: draftStore.verbosity,
    forceInterleavedThinkingCompat: draftStore.forceInterleavedThinkingCompat
  } as Partial<SessionGenerationSettings>
  const clearedDraftModelOverrides = {
    temperature: undefined,
    contextLength: undefined,
    maxTokens: undefined,
    thinkingBudget: undefined,
    reasoningEffort: undefined,
    verbosity: undefined,
    forceInterleavedThinkingCompat: undefined
  } as Partial<SessionGenerationSettings>

  try {
    clearPendingGenerationPersist()
    draftStore.updateGenerationSettings(clearedDraftModelOverrides)
    draftModelSelection.value = { providerId, modelId }
    draftStore.providerId = providerId
    draftStore.modelId = modelId
    await configPresenter.setSetting('preferredModel', { providerId, modelId })
    return true
  } catch (error) {
    draftModelSelection.value = previousDraftSelection
    draftStore.providerId = previousDraftProviderId
    draftStore.modelId = previousDraftModelId
    draftStore.updateGenerationSettings(previousDraftGenerationSettings)
    console.warn('[ChatStatusBar] Failed to switch draft model:', error)
    return false
  }
}

async function handleModelQuickSelect(providerId: string, modelId: string) {
  const changed = await changeModelSelection(providerId, modelId)
  if (!changed) {
    return
  }

  modelSettingsSelection.value = { providerId, modelId }
  isModelSettingsExpanded.value = false
  isModelPanelOpen.value = false
}

async function openModelSettings(providerId: string, modelId: string) {
  const changed = await changeModelSelection(providerId, modelId)
  if (!changed) {
    modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()
    isModelSettingsExpanded.value = false
    return
  }

  modelSettingsSelection.value = { providerId, modelId }
  isModelSettingsExpanded.value = true
}

function collapseModelSettings() {
  isModelSettingsExpanded.value = false
}

function handleSessionPanelOpenChange(open: boolean) {
  if (!open || !showSystemPromptSection.value) {
    return
  }
  void reloadSystemPrompts()
}

function onSystemPromptSelect(optionId: string) {
  if (!hasLoadedGenerationSettingsForCurrentSelection.value || !localSettings.value) {
    return
  }
  const option = systemPromptOptions.value.find((item) => item.id === optionId)
  if (!option || option.disabled) {
    return
  }
  updateLocalGenerationSettings({ systemPrompt: option.content })
}

const getNumericValidationContext = (
  field: GenerationNumericField
): Pick<SessionGenerationSettings, 'contextLength' | 'maxTokens'> => ({
  contextLength:
    field === 'contextLength'
      ? (localSettings.value?.contextLength ?? 0)
      : (localSettings.value?.contextLength ?? 0),
  maxTokens:
    field === 'maxTokens'
      ? (localSettings.value?.maxTokens ?? 0)
      : (localSettings.value?.maxTokens ?? 0)
})

const commitNumericField = (
  field: GenerationNumericField,
  rawValue: string | number
): number | undefined => {
  if (!localSettings.value) {
    stopNumericInputEdit(field)
    resetNumericInputFieldState(field)
    return undefined
  }

  const error = validateGenerationNumericField(field, rawValue, getNumericValidationContext(field))
  if (error) {
    stopNumericInputEdit(field)
    setNumericInputError(field, error)
    return undefined
  }

  const numeric = parseFiniteNumericValue(rawValue)
  if (numeric === undefined) {
    stopNumericInputEdit(field)
    setNumericInputError(field, field === 'temperature' ? 'finite_number' : 'non_negative_integer')
    return undefined
  }

  stopNumericInputEdit(field)
  clearNumericInputError(field)
  return numeric
}

const roundTemperatureStepValue = (value: number): number => Number(value.toFixed(10))

function stepTemperature(direction: -1 | 1) {
  if (!localSettings.value) {
    return
  }
  if (hasNumericInputError('temperature')) {
    return
  }
  const next = roundTemperatureStepValue(
    localSettings.value.temperature + direction * TEMPERATURE_STEP
  )
  updateLocalGenerationSettings({ temperature: next })
  resetNumericInputFieldState('temperature')
}

function onTemperatureInput(value: string | number) {
  setNumericInputDraft('temperature', value)
}

function commitTemperatureInput() {
  const next = commitNumericField('temperature', numericInputDrafts.value.temperature)
  if (next === undefined) {
    return
  }
  updateLocalGenerationSettings({ temperature: next })
  resetNumericInputFieldState('temperature')
}

function stepContextLength(direction: -1 | 1) {
  if (!localSettings.value) {
    return
  }
  if (hasNumericInputError('contextLength')) {
    return
  }
  const next = Math.max(0, localSettings.value.contextLength + direction * CONTEXT_LENGTH_STEP)
  const committed = commitNumericField('contextLength', next)
  if (committed === undefined) {
    return
  }
  updateLocalGenerationSettings({ contextLength: committed })
  resetNumericInputFieldState('contextLength')
}

function onContextLengthInput(value: string | number) {
  setNumericInputDraft('contextLength', value)
}

function commitContextLengthInput() {
  const next = commitNumericField('contextLength', numericInputDrafts.value.contextLength)
  if (next === undefined) {
    return
  }
  updateLocalGenerationSettings({ contextLength: next })
  resetNumericInputFieldState('contextLength')
}

function stepMaxTokens(direction: -1 | 1) {
  if (!localSettings.value) {
    return
  }
  if (hasNumericInputError('maxTokens')) {
    return
  }
  const next = Math.max(0, localSettings.value.maxTokens + direction * MAX_TOKENS_STEP)
  const committed = commitNumericField('maxTokens', next)
  if (committed === undefined) {
    return
  }
  updateLocalGenerationSettings({ maxTokens: committed })
  resetNumericInputFieldState('maxTokens')
}

function onMaxTokensInput(value: string | number) {
  setNumericInputDraft('maxTokens', value)
}

function commitMaxTokensInput() {
  const next = commitNumericField('maxTokens', numericInputDrafts.value.maxTokens)
  if (next === undefined) {
    return
  }
  updateLocalGenerationSettings({ maxTokens: next })
  resetNumericInputFieldState('maxTokens')
}

function onThinkingBudgetToggle(enabled: boolean) {
  if (!localSettings.value) {
    return
  }
  if (!enabled) {
    stopNumericInputEdit('thinkingBudget')
    resetNumericInputFieldState('thinkingBudget')
    updateLocalGenerationSettings({ thinkingBudget: undefined })
    return
  }

  const preferred = normalizeLegacyThinkingBudgetValue(localSettings.value.thinkingBudget) ?? 0
  updateLocalGenerationSettings({ thinkingBudget: preferred })
  resetNumericInputFieldState('thinkingBudget')
}

function stepThinkingBudget(direction: -1 | 1) {
  if (!localSettings.value) {
    return
  }
  if (hasNumericInputError('thinkingBudget')) {
    return
  }
  const current = localSettings.value.thinkingBudget ?? 0
  const next = Math.max(0, current + direction * THINKING_BUDGET_STEP)
  const committed = commitNumericField('thinkingBudget', next)
  if (committed === undefined) {
    return
  }
  updateLocalGenerationSettings({ thinkingBudget: committed })
  resetNumericInputFieldState('thinkingBudget')
}

function onThinkingBudgetInput(value: string | number) {
  setNumericInputDraft('thinkingBudget', value)
}

function commitThinkingBudgetInput() {
  const next = commitNumericField('thinkingBudget', numericInputDrafts.value.thinkingBudget)
  if (next === undefined) {
    return
  }
  updateLocalGenerationSettings({ thinkingBudget: next })
  resetNumericInputFieldState('thinkingBudget')
}

function onReasoningEffortSelect(value: string) {
  if (!localSettings.value) {
    return
  }

  const normalized = normalizeReasoningEffort(capabilityReasoningPortrait.value, value)
  if (!normalized) {
    return
  }
  updateLocalGenerationSettings({ reasoningEffort: normalized })
}

function onVerbositySelect(value: string) {
  if (!localSettings.value) {
    return
  }
  const normalized = normalizeVerbosity(capabilityReasoningPortrait.value, value)
  if (!normalized) {
    return
  }
  updateLocalGenerationSettings({ verbosity: normalized })
}

function onInterleavedThinkingToggle(enabled: boolean) {
  if (!localSettings.value) {
    return
  }
  updateLocalGenerationSettings({
    forceInterleavedThinkingCompat: enabled
  })
}

function onAcpInlineOptionOpenChange(optionId: string, open: boolean) {
  if (open) {
    acpInlineOpenOptionId.value = optionId
    return
  }

  if (acpInlineOpenOptionId.value === optionId) {
    acpInlineOpenOptionId.value = null
  }
}

function onAcpSelectOption(configId: string, value: string) {
  if (!value) {
    return
  }
  acpInlineOpenOptionId.value = null
  void updateAcpConfigOption(configId, value)
}

function onAcpBooleanOption(configId: string, value: boolean) {
  void updateAcpConfigOption(configId, value)
}

async function selectPermissionMode(mode: PermissionMode) {
  if (!canSelectPermissionMode.value) return
  if (permissionMode.value === mode) return

  permissionMode.value = mode
  const sessionId = sessionStore.activeSessionId
  if (!sessionId) {
    draftStore.permissionMode = mode
    return
  }
  try {
    await agentSessionPresenter.setPermissionMode(sessionId, mode)
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to set permission mode:', error)
  }
}

async function onSubagentToggle(enabled: boolean) {
  if (!showSubagentToggle.value || subagentEnabled.value === enabled) {
    return
  }

  subagentEnabled.value = enabled
  const sessionId = sessionStore.activeSessionId
  if (!sessionId) {
    draftStore.subagentEnabled = enabled
    return
  }

  isSubagentToggleUpdating.value = true
  try {
    await sessionStore.setSessionSubagentEnabled(sessionId, enabled)
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to set subagent toggle:', error)
    subagentEnabled.value = sessionStore.activeSession?.subagentEnabled === true
  } finally {
    isSubagentToggleUpdating.value = false
  }
}

defineExpose({
  acpConfigState,
  localSettings,
  permissionMode,
  subagentEnabled,
  showSystemPromptSection,
  showReasoningEffort,
  onTemperatureInput,
  commitTemperatureInput,
  onContextLengthInput,
  commitContextLengthInput,
  onMaxTokensInput,
  commitMaxTokensInput,
  onThinkingBudgetInput,
  commitThinkingBudgetInput,
  onThinkingBudgetToggle,
  stepTemperature,
  stepContextLength,
  stepMaxTokens,
  stepThinkingBudget,
  selectModel: changeModelSelection,
  openModelSettings,
  isModelSettingsExpanded,
  modelSettingsSelection
})
</script>
