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
              data-testid="app-model-switcher"
              :data-selected-provider-id="effectiveModelSelection?.providerId ?? ''"
              :data-selected-model-id="effectiveModelSelection?.modelId ?? ''"
              variant="ghost"
              size="sm"
              :class="[
                'h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg',
                !isModelOptionsReady ? 'opacity-70' : ''
              ]"
              :aria-busy="!isModelOptionsReady"
            >
              <ModelIcon
                :model-id="displayIconId"
                custom-class="w-3.5 h-3.5"
                :is-dark="themeStore.isDark"
              />
              <span>{{ displayModelText }}</span>
              <Icon
                v-if="showModelOptionsLoading"
                icon="lucide:loader-2"
                class="h-3 w-3 animate-spin"
              />
              <Icon v-else icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            :class="[
              'z-72 max-w-[calc(100vw-1rem)] overflow-hidden p-0',
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
                <div v-if="isModelOptionsReady" class="border-b px-2.5 py-2">
                  <Input
                    data-model-search-input="true"
                    v-model="modelSearchKeyword"
                    class="h-7 border-0 bg-transparent px-3 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    :placeholder="t('model.search.placeholder')"
                  />
                </div>

                <div class="max-h-[24rem] overflow-y-auto px-2 py-2">
                  <div
                    v-if="showModelOptionsLoading"
                    data-model-picker-state="loading"
                    class="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    <div class="flex items-center justify-center gap-2">
                      <Icon icon="lucide:loader-2" class="h-3.5 w-3.5 animate-spin" />
                      <span>{{ t('common.loading') }}</span>
                    </div>
                  </div>

                  <div
                    v-else-if="hasModelOptionsError"
                    data-model-picker-state="error"
                    class="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    <div>{{ t('model.error.loadFailed') }}</div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="mt-3 h-7 px-3 text-xs"
                      @click="retryModelOptionsInitialization"
                    >
                      {{ t('settings.dashboard.rtk.actions.retry') }}
                    </Button>
                  </div>

                  <div
                    v-else-if="filteredModelGroups.length === 0"
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
                            data-testid="model-option"
                            :data-provider-id="group.providerId"
                            :data-model-id="model.id"
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
                    <TooltipProvider :delay-duration="200">
                      <div
                        v-if="!showOpenAIMediaGenerationSettings && showTemperatureControl"
                        class="space-y-1.5"
                      >
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
                            :disabled="
                              isMoonshotKimiTemperatureLocked || hasNumericInputError('temperature')
                            "
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
                            :disabled="isMoonshotKimiTemperatureLocked"
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
                            :disabled="
                              isMoonshotKimiTemperatureLocked || hasNumericInputError('temperature')
                            "
                            @click="stepTemperature(1)"
                          >
                            <Icon icon="lucide:plus" class="h-3 w-3" />
                          </Button>
                        </div>
                        <p
                          v-if="moonshotKimiTemperatureHint"
                          class="text-[11px] text-muted-foreground"
                        >
                          {{ moonshotKimiTemperatureHint }}
                        </p>
                        <p
                          v-if="getNumericInputErrorMessage('temperature')"
                          class="text-[11px] text-destructive"
                        >
                          {{ getNumericInputErrorMessage('temperature') }}
                        </p>
                      </div>

                      <div v-if="showTopPControl" class="space-y-1.5">
                        <div class="flex items-center gap-1.5">
                          <label class="text-xs font-medium">{{
                            t('chat.advancedSettings.topP')
                          }}</label>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <button
                                type="button"
                                class="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                :aria-label="t('chat.advancedSettings.topPDescription')"
                              >
                                <Icon icon="lucide:help-circle" class="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="start"
                              class="z-[1000] max-w-80 text-xs"
                            >
                              {{ t('chat.advancedSettings.topPDescription') }}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div class="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8 shrink-0"
                            data-setting-control="topP"
                            data-setting-action="decrement"
                            :aria-label="
                              t('chat.advancedSettings.decreaseValue', {
                                label: t('chat.advancedSettings.topP')
                              })
                            "
                            :disabled="hasNumericInputError('topP') || topPDecreaseDisabled"
                            @click="stepTopP(-1)"
                          >
                            <Icon icon="lucide:minus" class="h-3 w-3" />
                          </Button>
                          <Input
                            :class="[
                              'h-8 flex-1 text-xs tabular-nums',
                              hasNumericInputError('topP') ? 'border-destructive' : ''
                            ]"
                            data-setting-control="topP"
                            type="number"
                            :step="TOP_P_STEP"
                            :min="TOP_P_MIN"
                            :max="TOP_P_MAX"
                            :aria-invalid="hasNumericInputError('topP')"
                            :placeholder="t('chat.advancedSettings.useDefault')"
                            :model-value="topPInputValue"
                            @focus="startNumericInputEdit('topP')"
                            @update:model-value="onTopPInput"
                            @blur="commitTopPInput"
                            @keydown.enter.prevent="commitTopPInput"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8 shrink-0"
                            data-setting-control="topP"
                            data-setting-action="increment"
                            :aria-label="
                              t('chat.advancedSettings.increaseValue', {
                                label: t('chat.advancedSettings.topP')
                              })
                            "
                            :disabled="hasNumericInputError('topP') || topPIncreaseDisabled"
                            @click="stepTopP(1)"
                          >
                            <Icon icon="lucide:plus" class="h-3 w-3" />
                          </Button>
                        </div>
                        <p
                          v-if="getNumericInputErrorMessage('topP')"
                          class="text-[11px] text-destructive"
                        >
                          {{ getNumericInputErrorMessage('topP') }}
                        </p>
                      </div>

                      <div v-if="!showOpenAIMediaGenerationSettings" class="space-y-1.5">
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

                      <div v-if="!showOpenAIMediaGenerationSettings" class="space-y-1.5">
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

                      <div class="space-y-1.5">
                        <label class="text-xs font-medium">{{
                          t('settings.model.modelConfig.timeout.label')
                        }}</label>
                        <div class="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8 shrink-0"
                            data-setting-control="timeout"
                            data-setting-action="decrement"
                            :aria-label="
                              t('chat.advancedSettings.decreaseValue', {
                                label: t('settings.model.modelConfig.timeout.label')
                              })
                            "
                            :disabled="
                              hasNumericInputError('timeout') ||
                              (localSettings.timeout ?? 0) <= TIMEOUT_MIN
                            "
                            @click="stepTimeout(-1)"
                          >
                            <Icon icon="lucide:minus" class="h-3 w-3" />
                          </Button>
                          <Input
                            :class="[
                              'h-8 flex-1 text-xs tabular-nums',
                              hasNumericInputError('timeout') ? 'border-destructive' : ''
                            ]"
                            data-setting-control="timeout"
                            type="number"
                            :step="TIMEOUT_STEP"
                            :min="TIMEOUT_MIN"
                            :max="TIMEOUT_MAX"
                            :aria-invalid="hasNumericInputError('timeout')"
                            :model-value="timeoutInputValue"
                            @focus="startNumericInputEdit('timeout')"
                            @update:model-value="onTimeoutInput"
                            @blur="commitTimeoutInput"
                            @keydown.enter.prevent="commitTimeoutInput"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            class="h-8 w-8 shrink-0"
                            data-setting-control="timeout"
                            data-setting-action="increment"
                            :aria-label="
                              t('chat.advancedSettings.increaseValue', {
                                label: t('settings.model.modelConfig.timeout.label')
                              })
                            "
                            :disabled="
                              hasNumericInputError('timeout') ||
                              (localSettings.timeout ?? 0) >= TIMEOUT_MAX
                            "
                            @click="stepTimeout(1)"
                          >
                            <Icon icon="lucide:plus" class="h-3 w-3" />
                          </Button>
                        </div>
                        <p
                          v-if="getNumericInputErrorMessage('timeout')"
                          class="text-[11px] text-destructive"
                        >
                          {{ getNumericInputErrorMessage('timeout') }}
                        </p>
                      </div>

                      <OpenAIImageGenerationSettingsFields
                        v-if="showOpenAIImageGenerationSettings"
                        density="compact"
                        :model-value="localSettings.imageGeneration"
                        @update:model-value="onImageGenerationSettingsUpdate"
                      />

                      <OpenAIVideoGenerationSettingsFields
                        v-if="showOpenAIVideoGenerationSettings"
                        density="compact"
                        :model-value="localSettings.videoGeneration"
                        @update:model-value="onVideoGenerationSettingsUpdate"
                      />

                      <div
                        v-if="!showOpenAIMediaGenerationSettings && showReasoningEffort"
                        class="space-y-1.5"
                      >
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

                      <div
                        v-if="!showOpenAIMediaGenerationSettings && showReasoningVisibility"
                        class="space-y-1.5"
                      >
                        <label class="text-xs font-medium">{{
                          t('settings.model.modelConfig.reasoningVisibility.label')
                        }}</label>
                        <Select
                          :model-value="
                            localSettings.reasoningVisibility ??
                            reasoningVisibilityOptions[0]?.value
                          "
                          @update:model-value="onReasoningVisibilitySelect($event as string)"
                        >
                          <SelectTrigger class="h-8 text-xs">
                            <SelectValue
                              :placeholder="
                                t('settings.model.modelConfig.reasoningVisibility.placeholder')
                              "
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              v-for="option in reasoningVisibilityOptions"
                              :key="option.value"
                              :value="option.value"
                            >
                              {{ option.label }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div
                        v-if="!showOpenAIMediaGenerationSettings && showVerbosity"
                        class="space-y-1.5"
                      >
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

                      <div
                        v-if="!showOpenAIMediaGenerationSettings && showThinkingBudget"
                        class="space-y-1.5"
                      >
                        <div class="flex items-center justify-between">
                          <label class="text-xs font-medium">{{
                            t('chat.advancedSettings.thinkingBudget')
                          }}</label>
                          <div class="flex items-center gap-2">
                            <span
                              v-if="thinkingBudgetHint"
                              class="text-[11px] text-muted-foreground"
                            >
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

                      <div v-if="!showOpenAIMediaGenerationSettings" class="space-y-1.5">
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
                    </TooltipProvider>
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
import type { ModelConfig, RENDERER_MODEL_META, SystemPrompt } from '@shared/presenter'
import type {
  DeepChatAgentConfig,
  PermissionMode,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'
import { isNewApiEndpointType, resolveProviderCapabilityProviderId } from '@shared/model'
import {
  MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE,
  MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE,
  getMoonshotKimiTemperaturePolicy,
  resolveMoonshotKimiTemperaturePolicy
} from '@shared/moonshotKimiPolicy'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  type AnthropicReasoningVisibility,
  type ReasoningPortrait
} from '@shared/types/model-db'
import {
  normalizeLegacyThinkingBudgetValue,
  parseFiniteNumericValue,
  toValidNonNegativeInteger,
  type GenerationNumericField,
  validateGenerationNumericField
} from '@shared/utils/generationSettingsValidation'
import {
  DEFAULT_MODEL_TIMEOUT,
  MODEL_TIMEOUT_MAX_MS,
  MODEL_TIMEOUT_MIN_MS
} from '@shared/modelConfigDefaults'
import {
  normalizeImageGenerationOptions,
  supportsOpenAIImageGenerationSettings
} from '@shared/imageGenerationSettings'
import {
  normalizeVideoGenerationOptions,
  supportsOpenAICompatibleVideoGeneration
} from '@shared/videoGenerationSettings'
import { resolvePreferredChatModel, type ChatModelSelection } from '@/lib/chatModelSelection'
import {
  getReasoningEffortOptions,
  getReasoningVisibilityOptions,
  getVerbosityOptions,
  hasThinkingBudgetSupport,
  normalizeReasoningEffort,
  normalizeReasoningVisibility,
  normalizeVerbosity,
  supportsReasoningEffort,
  supportsVerbosity
} from './composables/chatStatusBarReasoningOptions'
import { useGenerationNumericInputs } from './composables/useGenerationNumericInputs'
import McpIndicator from '@/components/chat-input/McpIndicator.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import OpenAIImageGenerationSettingsFields from '@/components/settings/OpenAIImageGenerationSettingsFields.vue'
import OpenAIVideoGenerationSettingsFields from '@/components/settings/OpenAIVideoGenerationSettingsFields.vue'
import { createConfigClient } from '@api/ConfigClient'
import { createModelClient } from '@api/ModelClient'
import { createOnboardingClient } from '@api/OnboardingClient'
import { createProviderClient } from '@api/ProviderClient'
import { createSessionClient } from '@api/SessionClient'
import { requestGuidedOnboardingResume } from '@/lib/onboardingResume'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'
import { useThemeStore } from '@/stores/theme'
import { useAgentStore } from '@/stores/ui/agent'
import { useDraftStore } from '@/stores/ui/draft'
import { useProjectStore } from '@/stores/ui/project'
import { useSessionStore } from '@/stores/ui/session'
import { scheduleStartupDeferredTask } from '@/lib/startupDeferred'
import { useChatStatusBarAcpConfig } from './composables/useChatStatusBarAcpConfig'

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

const isSameModelSelection = (
  left: ModelSelection | null | undefined,
  right: ModelSelection | null | undefined
): boolean =>
  Boolean(left && right && left.providerId === right.providerId && left.modelId === right.modelId)

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
const TOP_P_STEP = 0.1
const TOP_P_MIN = 0.1
const TOP_P_MAX = 1
const CONTEXT_LENGTH_STEP = 1024
const MAX_TOKENS_STEP = 128
const TIMEOUT_STEP = 1000
const TIMEOUT_MIN = MODEL_TIMEOUT_MIN_MS
const TIMEOUT_MAX = MODEL_TIMEOUT_MAX_MS
const THINKING_BUDGET_STEP = 128

const themeStore = useThemeStore()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const projectStore = useProjectStore()
const configClient = createConfigClient()
const modelClient = createModelClient()
const onboardingClient = createOnboardingClient()
const providerClient = createProviderClient()
const sessionClient = createSessionClient()
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
const modelSettingsTargetConfig = ref<ModelConfig | null>(null)
const modelSettingsTargetConfigSelection = ref<ModelSelection | null>(null)
let modelSettingsTargetConfigToken = 0

const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityReasoningPortrait = ref<ReasoningPortrait | null>(null)
const capabilitySupportsTemperature = ref<boolean | null>(null)
const capabilityProviderId = ref('')

let draftModelSyncToken = 0
let permissionSyncToken = 0
let generationSyncToken = 0
let generationPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingGenerationPatch: Partial<SessionGenerationSettings> = {}
let generationPersistRequestToken = 0
let generationLocalRevision = 0
let unsubscribeAcpConfigOptionsReady: (() => void) | null = null
let cancelAcpConfigSyncTask: (() => void) | null = null
const isSubagentToggleUpdating = ref(false)

const {
  numericInputDrafts,
  clearNumericInputError,
  setNumericInputError,
  resetNumericInputFieldState,
  resetNumericInputState,
  hasNumericInputError,
  startNumericInputEdit,
  setNumericInputDraft,
  stopNumericInputEdit,
  getNumericInputValue,
  getNumericInputErrorMessage
} = useGenerationNumericInputs({
  localSettings,
  t,
  onDraftChange: () => {
    generationLocalRevision += 1
  }
})

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
  const config = await configClient.resolveDeepChatAgentConfig(agentId)
  if (config) {
    return config
  }

  const defaultSystemPrompt = (await configClient.getDefaultSystemPrompt()) ?? ''

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

const moonshotKimiTemperaturePolicy = computed(() =>
  getMoonshotKimiTemperaturePolicy(
    effectiveModelSelection.value?.providerId,
    effectiveModelSelection.value?.modelId
  )
)
const isMoonshotKimiTemperatureLocked = computed(
  () => moonshotKimiTemperaturePolicy.value?.lockTemperatureControl === true
)
const moonshotKimiTemperatureHint = computed(() =>
  isMoonshotKimiTemperatureLocked.value
    ? t('chat.advancedSettings.temperatureFixedMoonshotKimi', {
        enabled: MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE.toFixed(1),
        disabled: MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE.toFixed(1)
      })
    : ''
)

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
const isModelOptionsReady = computed(() => isAcpAgent.value || modelStore.initialized)
const hasModelOptionsError = computed(
  () => !isAcpAgent.value && !modelStore.initialized && Boolean(modelStore.initializationError)
)
const showModelOptionsLoading = computed(
  () => !isAcpAgent.value && !modelStore.initialized && !hasModelOptionsError.value
)

const resolveProviderApiType = (providerId: string): string | undefined =>
  providerStore.sortedProviders.find((provider) => provider.id === providerId)?.apiType

const modelGroups = computed<GroupedModelList[]>(() => {
  if (!isModelOptionsReady.value) {
    return []
  }

  return modelStore.chatSelectableModelGroups
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

const modelSettingsTargetMeta = computed(() => {
  const target = modelSettingsTarget.value
  if (!target) {
    return null
  }
  return findEnabledModelMeta(target.providerId, target.modelId)
})

const modelSettingsTargetResolvedConfig = computed(() =>
  isSameModelSelection(modelSettingsTarget.value, modelSettingsTargetConfigSelection.value)
    ? modelSettingsTargetConfig.value
    : null
)

const showOpenAIImageGenerationSettings = computed(() => {
  const target = modelSettingsTarget.value
  if (!target) {
    return false
  }

  const modelMeta = modelSettingsTargetMeta.value
  const modelConfig = modelSettingsTargetResolvedConfig.value
  return supportsOpenAIImageGenerationSettings({
    providerId: target.providerId,
    providerApiType: resolveProviderApiType(target.providerId),
    modelId: target.modelId,
    apiEndpoint: modelConfig?.apiEndpoint,
    endpointType: modelConfig?.endpointType ?? modelMeta?.endpointType,
    supportedEndpointTypes: modelMeta?.supportedEndpointTypes,
    type: modelConfig?.type ?? modelMeta?.type
  })
})

const showOpenAIVideoGenerationSettings = computed(() => {
  const target = modelSettingsTarget.value
  if (!target) {
    return false
  }

  const modelMeta = modelSettingsTargetMeta.value
  const modelConfig = modelSettingsTargetResolvedConfig.value
  return supportsOpenAICompatibleVideoGeneration({
    providerId: target.providerId,
    providerApiType: resolveProviderApiType(target.providerId),
    modelId: target.modelId,
    apiEndpoint: modelConfig?.apiEndpoint,
    endpointType: modelConfig?.endpointType ?? modelMeta?.endpointType,
    supportedEndpointTypes: modelMeta?.supportedEndpointTypes,
    type: modelConfig?.type ?? modelMeta?.type
  })
})

const showOpenAIMediaGenerationSettings = computed(
  () => showOpenAIImageGenerationSettings.value || showOpenAIVideoGenerationSettings.value
)

watch(
  () => {
    const target = modelSettingsTarget.value
    return target ? { providerId: target.providerId, modelId: target.modelId } : null
  },
  async (target) => {
    const token = ++modelSettingsTargetConfigToken
    modelSettingsTargetConfig.value = null
    modelSettingsTargetConfigSelection.value = null

    if (!target) {
      return
    }

    try {
      const config = await modelClient.getModelConfig(target.modelId, target.providerId)
      if (token !== modelSettingsTargetConfigToken) {
        return
      }
      modelSettingsTargetConfig.value = config
      modelSettingsTargetConfigSelection.value = { ...target }
    } catch (error) {
      if (token !== modelSettingsTargetConfigToken) {
        return
      }
      console.warn('[ChatStatusBar] Failed to load model settings target config:', error)
    }
  },
  { immediate: true }
)

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

const findEnabledModelMeta = (providerId: string, modelId: string): RENDERER_MODEL_META | null => {
  return modelStore.findChatSelectableModel(providerId, modelId)?.model ?? null
}

const resolveCapabilityProviderIdForSelection = (
  providerId: string,
  modelId: string,
  endpointType?: unknown
): string => {
  const modelMeta = findEnabledModelMeta(providerId, modelId)
  return resolveProviderCapabilityProviderId(
    providerId,
    {
      endpointType: isNewApiEndpointType(endpointType) ? endpointType : modelMeta?.endpointType,
      supportedEndpointTypes: modelMeta?.supportedEndpointTypes,
      type: modelMeta?.type,
      providerApiType: resolveProviderApiType(providerId)
    },
    modelId
  )
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

const {
  acpConfigState,
  acpInlineOpenOptionId,
  acpConfigReadOnly,
  acpInlineOptions,
  acpOverflowOptions,
  acpAgentLabel,
  acpAgentIconId,
  isAcpConfigLoading,
  getAcpOptionDisplayValue,
  isAcpOptionSaving,
  syncAcpConfigOptions,
  handleAcpConfigOptionsReady,
  onAcpInlineOptionOpenChange,
  onAcpSelectOption,
  onAcpBooleanOption
} = useChatStatusBarAcpConfig({
  t,
  isAcpAgent,
  activeAcpAgentId,
  activeAcpSessionId,
  acpWorkspacePath,
  selectedAgentId: computed(() => agentStore.selectedAgentId),
  selectedAgentName: computed(() => agentStore.selectedAgent?.name ?? null),
  providerClient,
  sessionClient,
  resolveModelName,
  resolveModelIconId
})

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
const topPInputValue = computed(() => getNumericInputValue('topP'))
const topPCommittedValue = computed(() => localSettings.value?.topP ?? TOP_P_MAX)
const topPDecreaseDisabled = computed(
  () => localSettings.value?.topP === undefined || topPCommittedValue.value <= TOP_P_MIN
)
const topPIncreaseDisabled = computed(
  () => localSettings.value?.topP !== undefined && topPCommittedValue.value >= TOP_P_MAX
)
const contextLengthInputValue = computed(() => getNumericInputValue('contextLength'))
const maxTokensInputValue = computed(() => getNumericInputValue('maxTokens'))
const timeoutInputValue = computed(() => getNumericInputValue('timeout'))
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

const showTemperatureControl = computed(
  () =>
    (capabilitySupportsTemperature.value !== false || isMoonshotKimiTemperatureLocked.value) &&
    Boolean(localSettings.value)
)
const supportsTopPControl = computed(
  () => capabilityProviderId.value !== 'anthropic' || capabilitySupportsTemperature.value !== false
)
const showTopPControl = computed(
  () =>
    !showOpenAIMediaGenerationSettings.value &&
    supportsTopPControl.value &&
    Boolean(localSettings.value)
)

const showVerbosity = computed(
  () =>
    !isAcpAgent.value &&
    supportsVerbosity(capabilityReasoningPortrait.value) &&
    Boolean(localSettings.value)
)

const isAnthropicReasoningEnabled = computed(() => {
  if (!hasAnthropicReasoningToggle(capabilityProviderId.value, capabilityReasoningPortrait.value)) {
    return true
  }
  if (!localSettings.value) {
    return false
  }

  return getReasoningEffectiveEnabledForProvider(
    capabilityProviderId.value,
    capabilityReasoningPortrait.value,
    {
      reasoning: localSettings.value.reasoningEffort !== undefined ? true : undefined,
      reasoningEffort: localSettings.value.reasoningEffort
    }
  )
})

const showReasoningEffort = computed(
  () =>
    !isAcpAgent.value &&
    supportsReasoningEffort(capabilityReasoningPortrait.value) &&
    Boolean(localSettings.value) &&
    (!hasAnthropicReasoningToggle(capabilityProviderId.value, capabilityReasoningPortrait.value) ||
      isAnthropicReasoningEnabled.value)
)
const showReasoningVisibility = computed(
  () =>
    !isAcpAgent.value &&
    Boolean(localSettings.value) &&
    (!hasAnthropicReasoningToggle(capabilityProviderId.value, capabilityReasoningPortrait.value) ||
      isAnthropicReasoningEnabled.value) &&
    getReasoningVisibilityOptions(capabilityProviderId.value, capabilityReasoningPortrait.value)
      .length > 0
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
const reasoningVisibilityOptions = computed(() =>
  getReasoningVisibilityOptions(capabilityProviderId.value, capabilityReasoningPortrait.value).map(
    (value) => ({
      value,
      label: t(`settings.model.modelConfig.reasoningVisibility.options.${value}`)
    })
  )
)

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
  if (!isModelOptionsReady.value) {
    return hasModelOptionsError.value ? t('model.error.loadFailed') : t('common.loading')
  }
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

const ensureCompleteModelOptionsReady = async (): Promise<boolean> => {
  if (isAcpAgent.value || modelStore.initialized) {
    return true
  }

  try {
    await modelStore.initialize()
    return true
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to initialize enabled models:', error)
    return false
  }
}

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

  if (!modelStore.initialized) {
    applyDraftSelection(null)
    return
  }

  try {
    const deepChatAgentId = selectedDeepChatAgentId.value ?? 'deepchat'
    const [agentConfig, preferredModel, defaultModel] = await Promise.all([
      resolveDeepChatAgentConfig(deepChatAgentId),
      configClient.getSetting('preferredModel'),
      configClient.getSetting('defaultModel')
    ])
    if (token !== draftModelSyncToken) return

    const resolvedModel = resolvePreferredChatModel({
      modelGroups: modelStore.chatSelectableModelGroups,
      selections: [
        draftStore.providerId && draftStore.modelId
          ? { providerId: draftStore.providerId, modelId: draftStore.modelId }
          : null,
        isModelSelection(agentConfig.defaultModelPreset)
          ? (agentConfig.defaultModelPreset as ChatModelSelection)
          : null,
        isModelSelection(preferredModel) ? (preferredModel as ChatModelSelection) : null,
        isModelSelection(defaultModel) ? (defaultModel as ChatModelSelection) : null
      ]
    })
    applyDraftSelection(
      resolvedModel
        ? { providerId: resolvedModel.providerId, modelId: resolvedModel.model.id }
        : null
    )
    return
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to resolve draft model:', error)
  }

  if (token !== draftModelSyncToken) return
  applyDraftSelection(null)
}

const resolveDefaultGenerationSettings = async (
  providerId: string,
  modelId: string,
  agentId: string = 'deepchat'
): Promise<SessionGenerationSettings> => {
  const agentConfig = await resolveDeepChatAgentConfig(agentId)
  const modelConfig = await modelClient.getModelConfig(modelId, providerId)
  const capabilities = await modelClient.getCapabilities(providerId, modelId)
  const resolvedCapabilityProviderId = resolveCapabilityProviderIdForSelection(
    providerId,
    modelId,
    modelConfig.endpointType
  )
  const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
    providerId,
    modelId,
    modelConfig.reasoning
  )
  const portrait = capabilities.reasoningPortrait ?? null
  const contextLengthDefault = toValidNonNegativeInteger(modelConfig.contextLength) ?? 32000
  const maxTokensDefault =
    toValidNonNegativeInteger(modelConfig.maxTokens) ?? Math.min(4096, contextLengthDefault)
  const timeoutDefault = toValidNonNegativeInteger(modelConfig.timeout) ?? DEFAULT_MODEL_TIMEOUT

  const defaults: SessionGenerationSettings = {
    systemPrompt: agentConfig.systemPrompt ?? '',
    temperature:
      fixedTemperatureKimi?.temperature ?? parseFiniteNumericValue(modelConfig.temperature) ?? 0.7,
    topP: normalizeTopP(modelConfig.topP),
    contextLength: contextLengthDefault,
    timeout:
      timeoutDefault >= TIMEOUT_MIN && timeoutDefault <= TIMEOUT_MAX
        ? timeoutDefault
        : DEFAULT_MODEL_TIMEOUT,
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

  const modelMeta = findEnabledModelMeta(providerId, modelId)
  if (
    supportsOpenAIImageGenerationSettings({
      providerId,
      providerApiType: resolveProviderApiType(providerId),
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType ?? modelMeta?.endpointType,
      supportedEndpointTypes: modelMeta?.supportedEndpointTypes,
      type: modelConfig.type ?? modelMeta?.type
    })
  ) {
    const imageGeneration = normalizeImageGenerationOptions(modelConfig.imageGeneration)
    if (imageGeneration) {
      defaults.imageGeneration = imageGeneration
    }
  }

  if (
    supportsOpenAICompatibleVideoGeneration({
      providerId,
      providerApiType: resolveProviderApiType(providerId),
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType ?? modelMeta?.endpointType,
      supportedEndpointTypes: modelMeta?.supportedEndpointTypes,
      type: modelConfig.type ?? modelMeta?.type
    })
  ) {
    const videoGeneration = normalizeVideoGenerationOptions(modelConfig.videoGeneration)
    if (videoGeneration) {
      defaults.videoGeneration = videoGeneration
    }
  }

  if (portrait?.supported === true && hasThinkingBudgetSupport(portrait)) {
    const defaultBudget = normalizeLegacyThinkingBudgetValue(
      modelConfig.thinkingBudget ?? portrait.budget?.default
    )
    if (defaultBudget !== undefined) {
      defaults.thinkingBudget = defaultBudget
    }
  }

  const anthropicReasoningToggle = hasAnthropicReasoningToggle(
    resolvedCapabilityProviderId,
    portrait
  )
  const anthropicReasoningEnabled = anthropicReasoningToggle
    ? getReasoningEffectiveEnabledForProvider(resolvedCapabilityProviderId, portrait, {
        reasoning: modelConfig.reasoning,
        reasoningEffort: modelConfig.reasoningEffort
      })
    : true

  if (supportsReasoningEffort(portrait) && anthropicReasoningEnabled) {
    const effort = normalizeReasoningEffort(
      portrait,
      modelConfig.reasoningEffort ?? portrait?.effort
    )
    if (effort) {
      defaults.reasoningEffort = effort
    }
  }

  const reasoningVisibility = normalizeReasoningVisibility(
    resolvedCapabilityProviderId,
    portrait,
    modelConfig.reasoningVisibility ?? portrait?.visibility
  )
  if (anthropicReasoningEnabled && reasoningVisibility) {
    defaults.reasoningVisibility = reasoningVisibility
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
    const modelConfig = await modelClient.getModelConfig(modelId, providerId)
    const capabilities = await modelClient.getCapabilities(providerId, modelId)
    capabilityProviderId.value = resolveCapabilityProviderIdForSelection(
      providerId,
      modelId,
      modelConfig.endpointType
    )
    const portrait = capabilities.reasoningPortrait ?? null

    capabilityReasoningPortrait.value = portrait
    capabilitySupportsReasoning.value =
      typeof portrait?.supported === 'boolean' ? portrait.supported : null
    capabilitySupportsTemperature.value =
      typeof capabilities.supportsTemperatureControl === 'boolean'
        ? capabilities.supportsTemperatureControl
        : capabilities.temperatureCapability
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to fetch model capabilities:', error)
    capabilityProviderId.value = providerId
    capabilitySupportsReasoning.value = null
    capabilityReasoningPortrait.value = null
    capabilitySupportsTemperature.value = null
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
    const updated = await sessionClient.updateSessionGenerationSettings(sessionId, patch)
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

  const nextPatch = { ...patch }
  if (isMoonshotKimiTemperatureLocked.value) {
    delete nextPatch.temperature
  }

  const next: SessionGenerationSettings = {
    ...localSettings.value,
    ...nextPatch
  }

  localSettings.value = next

  const normalizedPatch: Partial<SessionGenerationSettings> = {}
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'systemPrompt')) {
    normalizedPatch.systemPrompt = next.systemPrompt
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'temperature')) {
    normalizedPatch.temperature = next.temperature
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'topP')) {
    normalizedPatch.topP = normalizeTopP(next.topP)
    next.topP = normalizedPatch.topP
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'contextLength')) {
    normalizedPatch.contextLength = next.contextLength
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'maxTokens')) {
    normalizedPatch.maxTokens = next.maxTokens
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'timeout')) {
    normalizedPatch.timeout = next.timeout
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'thinkingBudget')) {
    normalizedPatch.thinkingBudget = next.thinkingBudget
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'reasoningEffort')) {
    normalizedPatch.reasoningEffort = next.reasoningEffort
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'reasoningVisibility')) {
    normalizedPatch.reasoningVisibility = next.reasoningVisibility
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'verbosity')) {
    normalizedPatch.verbosity = next.verbosity
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'forceInterleavedThinkingCompat')) {
    normalizedPatch.forceInterleavedThinkingCompat = next.forceInterleavedThinkingCompat
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'imageGeneration')) {
    normalizedPatch.imageGeneration = normalizeImageGenerationOptions(next.imageGeneration)
    next.imageGeneration = normalizedPatch.imageGeneration
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'videoGeneration')) {
    normalizedPatch.videoGeneration = normalizeVideoGenerationOptions(next.videoGeneration)
    next.videoGeneration = normalizedPatch.videoGeneration
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
    capabilityProviderId.value = ''
    capabilitySupportsReasoning.value = null
    capabilityReasoningPortrait.value = null
    return
  }

  const selection = effectiveModelSelection.value
  if (!selection) {
    localSettings.value = null
    loadedSettingsSelection.value = null
    capabilityProviderId.value = ''
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
      const settings = await sessionClient.getSessionGenerationSettings(sessionId)
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

const reloadSystemPrompts = async () => {
  try {
    systemPromptList.value = await configClient.getSystemPrompts()
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to load system prompt options:', error)
    systemPromptList.value = []
  }
}

watch(
  [
    hasActiveSession,
    isAcpAgent,
    () => agentStore.selectedAgentId,
    () => modelStore.initialized,
    () => modelStore.chatSelectableModelGroups
  ],
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
      const mode = await sessionClient.getPermissionMode(sessionId)
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
    cancelAcpConfigSyncTask?.()
    cancelAcpConfigSyncTask = scheduleStartupDeferredTask(async () => {
      await syncAcpConfigOptions()
    })
  },
  { immediate: true }
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

    void (async () => {
      const ready = await ensureCompleteModelOptionsReady()
      if (!ready || !isModelPanelOpen.value) {
        return
      }
      await nextTick()
      const input = document.querySelector<HTMLInputElement>('[data-model-search-input="true"]')
      input?.focus()
    })()
    return
  }

  modelSearchKeyword.value = ''
  isModelSettingsExpanded.value = false
  modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()
})

onBeforeUnmount(() => {
  clearPendingGenerationPersist()
  invalidateGenerationPersistResponses()
  cancelAcpConfigSyncTask?.()
  cancelAcpConfigSyncTask = null
  unsubscribeAcpConfigOptionsReady?.()
  unsubscribeAcpConfigOptionsReady = null
})

onMounted(() => {
  unsubscribeAcpConfigOptionsReady = sessionClient.onAcpConfigOptionsReady(
    handleAcpConfigOptionsReady
  )
})

function isModelSelected(providerId: string, modelId: string) {
  return (
    effectiveModelSelection.value?.providerId === providerId &&
    effectiveModelSelection.value?.modelId === modelId
  )
}

async function completeSwitchModelOnboardingIfNeeded(previousSelection: ModelSelection | null) {
  const currentSelection = getEffectiveModelSelectionSnapshot()
  const alreadySelected =
    previousSelection?.providerId === currentSelection?.providerId &&
    previousSelection?.modelId === currentSelection?.modelId

  if (alreadySelected) {
    return
  }

  try {
    const state = await onboardingClient.getState()
    if (state.status !== 'active' || state.currentStepId !== 'switch-model') {
      return
    }

    const nextState = await onboardingClient.setStepStatus({
      stepId: 'switch-model',
      status: 'completed'
    })

    if (nextState.currentStepId === null) {
      await onboardingClient.complete()
    }

    requestGuidedOnboardingResume('step-completed')
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to complete switch-model onboarding step:', error)
  }
}

async function changeModelSelection(
  providerId: string,
  modelId: string
): Promise<{
  applied: boolean
  selectionChanged: boolean
  previousSelection: ModelSelection | null
}> {
  const ready = await ensureCompleteModelOptionsReady()
  const previousSelection = getEffectiveModelSelectionSnapshot()

  if (!ready) {
    return { applied: false, selectionChanged: false, previousSelection }
  }

  if (isModelSelectionLocked.value) {
    return { applied: false, selectionChanged: false, previousSelection }
  }

  if (
    effectiveModelSelection.value?.providerId === providerId &&
    effectiveModelSelection.value?.modelId === modelId
  ) {
    return { applied: true, selectionChanged: false, previousSelection }
  }

  if (hasActiveSession.value) {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) {
      return { applied: false, selectionChanged: false, previousSelection }
    }
    try {
      await sessionStore.setSessionModel(sessionId, providerId, modelId)
      return { applied: true, selectionChanged: true, previousSelection }
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to switch active session model:', error)
      return { applied: false, selectionChanged: false, previousSelection }
    }
  }

  const previousDraftSelection = draftModelSelection.value ? { ...draftModelSelection.value } : null
  const previousDraftProviderId = draftStore.providerId
  const previousDraftModelId = draftStore.modelId
  const previousDraftGenerationSettings = {
    systemPrompt: draftStore.systemPrompt,
    temperature: draftStore.temperature,
    topP: draftStore.topP,
    contextLength: draftStore.contextLength,
    maxTokens: draftStore.maxTokens,
    timeout: draftStore.timeout,
    thinkingBudget: draftStore.thinkingBudget,
    reasoningEffort: draftStore.reasoningEffort,
    reasoningVisibility: draftStore.reasoningVisibility,
    verbosity: draftStore.verbosity,
    forceInterleavedThinkingCompat: draftStore.forceInterleavedThinkingCompat,
    imageGeneration: draftStore.imageGeneration,
    videoGeneration: draftStore.videoGeneration
  } as Partial<SessionGenerationSettings>
  const clearedDraftModelOverrides = {
    temperature: undefined,
    topP: undefined,
    contextLength: undefined,
    maxTokens: undefined,
    timeout: undefined,
    thinkingBudget: undefined,
    reasoningEffort: undefined,
    reasoningVisibility: undefined,
    verbosity: undefined,
    forceInterleavedThinkingCompat: undefined,
    imageGeneration: undefined,
    videoGeneration: undefined
  } as Partial<SessionGenerationSettings>

  try {
    clearPendingGenerationPersist()
    draftStore.updateGenerationSettings(clearedDraftModelOverrides)
    draftModelSelection.value = { providerId, modelId }
    draftStore.providerId = providerId
    draftStore.modelId = modelId
    await configClient.setSetting('preferredModel', { providerId, modelId })
    return { applied: true, selectionChanged: true, previousSelection }
  } catch (error) {
    draftModelSelection.value = previousDraftSelection
    draftStore.providerId = previousDraftProviderId
    draftStore.modelId = previousDraftModelId
    draftStore.updateGenerationSettings(previousDraftGenerationSettings)
    console.warn('[ChatStatusBar] Failed to switch draft model:', error)
    return { applied: false, selectionChanged: false, previousSelection }
  }
}

async function handleModelQuickSelect(providerId: string, modelId: string) {
  const result = await changeModelSelection(providerId, modelId)
  if (!result.applied) {
    return
  }

  if (result.selectionChanged) {
    await completeSwitchModelOnboardingIfNeeded(result.previousSelection)
  }

  modelSettingsSelection.value = { providerId, modelId }
  isModelSettingsExpanded.value = false
  isModelPanelOpen.value = false
}

async function openModelSettings(providerId: string, modelId: string) {
  const result = await changeModelSelection(providerId, modelId)
  if (!result.applied) {
    modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()
    isModelSettingsExpanded.value = false
    return
  }

  if (result.selectionChanged) {
    await completeSwitchModelOnboardingIfNeeded(result.previousSelection)
  }

  modelSettingsSelection.value = { providerId, modelId }
  isModelSettingsExpanded.value = true
}

function collapseModelSettings() {
  isModelSettingsExpanded.value = false
}

async function retryModelOptionsInitialization() {
  await ensureCompleteModelOptionsReady()
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
  if (isMoonshotKimiTemperatureLocked.value) {
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

const roundTopPStepValue = (value: number): number => Number(value.toFixed(10))

function normalizeTopP(value: unknown): number | undefined {
  const numeric = parseFiniteNumericValue(value)
  return numeric !== undefined && numeric >= 0.1 && numeric <= 1 ? numeric : undefined
}

function stepTopP(direction: -1 | 1) {
  if (!localSettings.value) {
    return
  }
  if (hasNumericInputError('topP')) {
    return
  }
  if (direction === -1 && localSettings.value.topP === undefined) {
    return
  }
  const current = localSettings.value.topP ?? TOP_P_MAX
  const next = Math.min(TOP_P_MAX, Math.max(TOP_P_MIN, current + direction * TOP_P_STEP))
  updateLocalGenerationSettings({ topP: roundTopPStepValue(next) })
  resetNumericInputFieldState('topP')
}

function onTopPInput(value: string | number) {
  setNumericInputDraft('topP', value)
}

function commitTopPInput() {
  if (numericInputDrafts.value.topP.trim() === '') {
    stopNumericInputEdit('topP')
    clearNumericInputError('topP')
    updateLocalGenerationSettings({ topP: undefined })
    resetNumericInputFieldState('topP')
    return
  }

  const draftNum = parseFiniteNumericValue(numericInputDrafts.value.topP)
  if (draftNum !== undefined) {
    if (draftNum < TOP_P_MIN) {
      numericInputDrafts.value.topP = String(TOP_P_MIN)
    } else if (draftNum > TOP_P_MAX) {
      numericInputDrafts.value.topP = String(TOP_P_MAX)
    }
  }

  const next = commitNumericField('topP', numericInputDrafts.value.topP)
  if (next === undefined) {
    return
  }
  updateLocalGenerationSettings({ topP: next })
  resetNumericInputFieldState('topP')
}

function onTemperatureInput(value: string | number) {
  if (isMoonshotKimiTemperatureLocked.value) {
    return
  }
  setNumericInputDraft('temperature', value)
}

function commitTemperatureInput() {
  if (isMoonshotKimiTemperatureLocked.value) {
    resetNumericInputFieldState('temperature')
    return
  }
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

function stepTimeout(direction: -1 | 1) {
  if (!localSettings.value) {
    return
  }
  if (hasNumericInputError('timeout')) {
    return
  }

  const next = Math.max(
    TIMEOUT_MIN,
    Math.min(TIMEOUT_MAX, localSettings.value.timeout + direction * TIMEOUT_STEP)
  )
  const committed = commitNumericField('timeout', next)
  if (committed === undefined) {
    return
  }
  updateLocalGenerationSettings({ timeout: committed })
  resetNumericInputFieldState('timeout')
}

function onTimeoutInput(value: string | number) {
  setNumericInputDraft('timeout', value)
}

function commitTimeoutInput() {
  const next = commitNumericField('timeout', numericInputDrafts.value.timeout)
  if (next === undefined) {
    return
  }
  updateLocalGenerationSettings({ timeout: next })
  resetNumericInputFieldState('timeout')
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

function onReasoningVisibilitySelect(value: string) {
  if (!localSettings.value) {
    return
  }
  const normalized = normalizeReasoningVisibility(
    capabilityProviderId.value,
    capabilityReasoningPortrait.value,
    value
  )
  if (!normalized) {
    return
  }
  updateLocalGenerationSettings({ reasoningVisibility: normalized })
}

function onInterleavedThinkingToggle(enabled: boolean) {
  if (!localSettings.value) {
    return
  }
  updateLocalGenerationSettings({
    forceInterleavedThinkingCompat: enabled
  })
}

function onImageGenerationSettingsUpdate(
  imageGeneration: SessionGenerationSettings['imageGeneration']
) {
  if (!localSettings.value) {
    return
  }
  updateLocalGenerationSettings({
    imageGeneration: normalizeImageGenerationOptions(imageGeneration)
  })
}

function onVideoGenerationSettingsUpdate(
  videoGeneration: SessionGenerationSettings['videoGeneration']
) {
  if (!localSettings.value) {
    return
  }
  updateLocalGenerationSettings({
    videoGeneration: normalizeVideoGenerationOptions(videoGeneration)
  })
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
    await sessionClient.setPermissionMode(sessionId, mode)
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
  onTimeoutInput,
  commitTimeoutInput,
  onThinkingBudgetInput,
  commitThinkingBudgetInput,
  onThinkingBudgetToggle,
  stepTemperature,
  stepContextLength,
  stepMaxTokens,
  stepTimeout,
  stepThinkingBudget,
  selectModel: changeModelSelection,
  openModelSettings,
  isModelSettingsExpanded,
  modelSettingsSelection
})
</script>
