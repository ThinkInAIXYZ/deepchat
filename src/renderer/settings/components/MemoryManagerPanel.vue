<template>
  <div class="w-full">
    <div
      v-if="status && status.total > 0 && !hasEmbeddingConfigured"
      class="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"
    >
      {{ t('settings.deepchatAgents.memoryManager.degradedHint') }}
    </div>

    <Tabs v-model="activeTab" class="w-full">
      <TabsList class="grid w-full grid-cols-4">
        <TabsTrigger value="memories">
          {{ t('settings.deepchatAgents.memoryManager.tabMemories') }}
          <Badge v-if="status" variant="secondary" class="ml-1.5">{{ status.total }}</Badge>
        </TabsTrigger>
        <TabsTrigger value="health">
          {{ t('settings.deepchatAgents.memoryManager.tabHealth') }}
          <Badge v-if="health" variant="secondary" class="ml-1.5">{{ health.totalRows }}</Badge>
        </TabsTrigger>
        <TabsTrigger value="persona">
          {{ t('settings.deepchatAgents.memoryManager.tabPersona') }}
        </TabsTrigger>
        <TabsTrigger value="activity">
          {{ t('settings.deepchatAgents.memoryManager.tabActivity') }}
          <Badge v-if="activityCount > 0" variant="secondary" class="ml-1.5">
            {{ activityCount }}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="memories" class="mt-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="text-xs text-muted-foreground">
            {{
              t('settings.deepchatAgents.memoryManager.memoriesCount', { count: memories.length })
            }}
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              :aria-expanded="showAddForm"
              :disabled="memoryDisabled"
              @click="toggleAddForm"
            >
              <Icon icon="lucide:plus" class="mr-1 h-3.5 w-3.5" />
              {{ t('settings.deepchatAgents.memoryManager.addMemory') }}
            </Button>
            <AlertDialog v-if="memories.length > 0">
              <AlertDialogTrigger as-child>
                <Button variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive">
                  <Icon icon="lucide:trash-2" class="mr-1 h-3.5 w-3.5" />
                  {{ t('settings.deepchatAgents.memoryManager.clearAll') }}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t('settings.deepchatAgents.memoryManager.clearConfirmTitle') }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t('settings.deepchatAgents.memoryManager.clearConfirmBody') }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                  <AlertDialogAction
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    @click="handleClear"
                  >
                    {{ t('settings.deepchatAgents.memoryManager.clearAll') }}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div
          v-if="memoryDisabled"
          class="mb-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"
        >
          {{ t('settings.deepchatAgents.memoryManager.addDisabledHint') }}
        </div>

        <div v-if="showAddForm" class="mb-3 space-y-2 rounded-lg border border-border px-3 py-2.5">
          <Textarea
            v-model="addContent"
            class="min-h-16 text-xs"
            :placeholder="t('settings.deepchatAgents.memoryManager.addContentPlaceholder')"
          />
          <div
            class="grid gap-2"
            :class="{
              'sm:grid-cols-2': addCategorySelected,
              'sm:grid-cols-3': !addCategorySelected
            }"
          >
            <Select v-if="!addCategorySelected" v-model="addKind">
              <SelectTrigger class="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="semantic" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.kindSemantic') }}
                </SelectItem>
                <SelectItem value="episodic" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.kindEpisodic') }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="addCategory">
              <SelectTrigger
                class="h-8 w-full text-xs"
                :aria-label="t('settings.deepchatAgents.memoryManager.addCategoryLabel')"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="ADD_CATEGORY_NONE" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.addCategoryNone') }}
                </SelectItem>
                <SelectItem
                  v-for="category in AGENT_MEMORY_CATEGORIES"
                  :key="category"
                  :value="category"
                  class="text-xs"
                >
                  {{ categoryLabel(category) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="addImportance">
              <SelectTrigger class="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.importanceLow') }}
                </SelectItem>
                <SelectItem value="medium" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.importanceMedium') }}
                </SelectItem>
                <SelectItem value="high" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.importanceHigh') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="cancelAdd">
              {{ t('common.cancel') }}
            </Button>
            <Button
              size="sm"
              class="h-7 px-3 text-xs"
              :disabled="adding || addContent.trim().length === 0"
              @click="handleAdd"
            >
              {{ t('settings.deepchatAgents.memoryManager.addMemory') }}
            </Button>
          </div>
        </div>

        <div v-if="memories.length > 0 || searchActive" class="mb-3 space-y-1.5">
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              v-model="searchQuery"
              type="search"
              class="h-8 text-xs sm:flex-1"
              :placeholder="t('settings.deepchatAgents.memoryManager.searchPlaceholder')"
            />
            <Select v-model="categoryFilter">
              <SelectTrigger
                class="h-8 text-xs sm:w-44"
                :aria-label="t('settings.deepchatAgents.memoryManager.categoryFilterLabel')"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.categoryFilterAll') }}
                </SelectItem>
                <SelectItem
                  v-for="category in AGENT_MEMORY_CATEGORIES"
                  :key="category"
                  :value="category"
                  class="text-xs"
                >
                  {{ categoryLabel(category) }}
                </SelectItem>
                <SelectItem value="uncategorized" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.categoryUncategorized') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p v-if="searchError" class="text-[11px] text-destructive">
            {{ searchError }}
          </p>
        </div>

        <div v-if="conflicts.length > 0" class="mb-3 space-y-2">
          <div class="text-xs font-medium">
            {{
              t('settings.deepchatAgents.memoryManager.conflictPairsTitle', {
                count: conflicts.length
              })
            }}
          </div>
          <div
            v-for="conflict in conflicts"
            :key="conflict.challenger.id"
            class="space-y-2 rounded-lg border border-destructive/40 px-3 py-2"
          >
            <div class="grid gap-2 sm:grid-cols-2">
              <p class="wrap-break-word text-xs text-muted-foreground">
                {{ conflict.target.content }}
              </p>
              <p class="wrap-break-word text-xs">
                {{ conflict.challenger.content }}
              </p>
            </div>
            <div class="flex flex-wrap justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-xs"
                @click="handleResolveConflict(conflict.challenger.id, 'keep_target')"
              >
                {{ t('settings.deepchatAgents.memoryManager.keepTarget') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-xs"
                @click="handleResolveConflict(conflict.challenger.id, 'keep_challenger')"
              >
                {{ t('settings.deepchatAgents.memoryManager.keepChallenger') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-xs"
                @click="handleResolveConflict(conflict.challenger.id, 'keep_both')"
              >
                {{ t('settings.deepchatAgents.memoryManager.keepBoth') }}
              </Button>
            </div>
          </div>
        </div>

        <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="error" class="py-10 text-center text-sm text-destructive">
          {{ error }}
        </div>
        <div
          v-else-if="displayedMemories.length === 0"
          class="py-10 text-center text-sm text-muted-foreground"
        >
          {{ emptyMemoryMessage }}
        </div>
        <ScrollArea v-else class="h-[360px] pr-3">
          <ul class="space-y-2">
            <li
              v-for="memory in displayedMemories"
              :key="memory.id"
              class="rounded-lg border border-border px-3 py-2"
              :class="{ 'opacity-60': memory.status === 'archived' }"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="wrap-break-word text-sm">{{ memory.content }}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" class="text-[10px]">{{ memory.kind }}</Badge>
                    <Badge variant="secondary" class="text-[10px]">
                      {{ categoryLabel(memory.category) }}
                    </Badge>
                    <Badge :variant="statusVariant(memory.status)" class="text-[10px]">
                      {{ t(`settings.deepchatAgents.memoryManager.status.${memory.status}`) }}
                    </Badge>
                    <Badge
                      v-if="memory.conflictState === 'challenged'"
                      variant="destructive"
                      class="text-[10px]"
                    >
                      {{ t('settings.deepchatAgents.memoryManager.conflict') }}
                    </Badge>
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatTime(memory.createdAt) }}
                    </span>
                  </div>
                  <button
                    v-if="memory.sourceSession && memory.sourceEntryIds?.length"
                    class="mt-1 block max-w-full truncate text-left text-[10px] text-muted-foreground hover:text-foreground"
                    :title="sourceEntryTitle(memory)"
                    type="button"
                    @click="handleOpenSource(memory)"
                  >
                    {{
                      t('settings.deepchatAgents.memoryManager.sourceLine', {
                        session: shortSession(memory.sourceSession),
                        count: memory.sourceEntryIds?.length ?? 0
                      })
                    }}
                  </button>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 w-7 px-0"
                    :aria-label="t('settings.deepchatAgents.memoryManager.lifecycle.toggle')"
                    :aria-expanded="isLifecycleExpanded(memory.id)"
                    @click="toggleLifecycle(memory.id)"
                  >
                    <Icon
                      :icon="
                        isLifecycleExpanded(memory.id)
                          ? 'lucide:chevron-down'
                          : 'lucide:chevron-right'
                      "
                      class="h-3.5 w-3.5"
                    />
                  </Button>
                  <Button
                    v-if="memory.status === 'archived'"
                    variant="ghost"
                    size="sm"
                    :disabled="memoryDisabled"
                    class="h-7 px-2 text-xs"
                    :aria-label="t('settings.deepchatAgents.memoryManager.restore')"
                    @click="handleRestore(memory.id)"
                  >
                    <Icon icon="lucide:archive-restore" class="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger as-child>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-7 px-2 text-xs text-destructive"
                        :aria-label="t('settings.deepchatAgents.memoryManager.deletePermanent')"
                      >
                        <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {{ t('settings.deepchatAgents.memoryManager.deleteConfirmTitle') }}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {{ t('settings.deepchatAgents.memoryManager.deleteConfirmBody') }}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                        <AlertDialogAction
                          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          @click="handleDelete(memory.id)"
                        >
                          {{ t('settings.deepchatAgents.memoryManager.deletePermanent') }}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <MemoryLifecyclePanel
                v-if="isLifecycleExpanded(memory.id)"
                class="mt-2"
                :lifecycle="lifecycleFor(memory.id)"
                :loading="isLifecycleLoading(memory.id)"
                :error="lifecycleErrorFor(memory.id)"
              />
            </li>
          </ul>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="health" class="mt-3">
        <MemoryHealthSection
          v-if="activeTab === 'health'"
          :health="health"
          :loading="healthLoading"
          :error="healthError"
          :archive-candidate-lifecycle-preview="archiveCandidateLifecyclePreview"
          :archive-candidate-lifecycle-preview-loading="archiveCandidateLifecyclePreviewLoading"
          :archive-candidate-lifecycle-preview-error="archiveCandidateLifecyclePreviewError"
        />
      </TabsContent>

      <TabsContent value="persona" class="mt-3">
        <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
          {{ t('common.loading') }}
        </div>
        <template v-else>
          <div
            class="mb-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"
            :class="props.personaEvolutionEnabled ? '' : 'opacity-80'"
          >
            {{
              props.personaEvolutionEnabled
                ? t('settings.deepchatAgents.memoryManager.personaEvolutionOnHint')
                : t('settings.deepchatAgents.memoryManager.personaEvolutionOffHint')
            }}
          </div>

          <div v-if="personaDrafts.length > 0" class="mb-3 space-y-2">
            <div class="text-xs font-medium">
              {{
                t('settings.deepchatAgents.memoryManager.pendingTitle', {
                  count: personaDrafts.length
                })
              }}
            </div>
            <div
              v-for="draft in personaDrafts"
              :key="draft.id"
              class="space-y-2 rounded-lg border px-3 py-2"
              :class="
                draft.needsReview
                  ? 'border-destructive/60 bg-destructive/5'
                  : 'border-amber-500/50 bg-amber-500/5'
              "
            >
              <div
                v-if="draft.needsReview"
                class="flex items-center gap-1.5 text-[11px] font-medium text-destructive"
              >
                <Icon icon="lucide:triangle-alert" class="h-3.5 w-3.5" />
                {{ t('settings.deepchatAgents.memoryManager.largeChange') }}
              </div>
              <div class="space-y-1">
                <div class="text-[10px] font-medium uppercase text-muted-foreground">
                  {{ t('settings.deepchatAgents.memoryManager.personaCurrent') }}
                </div>
                <p class="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
                  {{
                    activePersonaContent || t('settings.deepchatAgents.memoryManager.personaNone')
                  }}
                </p>
                <div class="text-[10px] font-medium uppercase text-muted-foreground">
                  {{ t('settings.deepchatAgents.memoryManager.personaProposed') }}
                </div>
                <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ draft.content }}</p>
              </div>
              <div class="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="handleRejectDraft(draft.id)"
                >
                  {{ t('settings.deepchatAgents.memoryManager.reject') }}
                </Button>
                <Button size="sm" class="h-7 px-2 text-xs" @click="handleApproveDraft(draft.id)">
                  {{ t('settings.deepchatAgents.memoryManager.approve') }}
                </Button>
              </div>
            </div>
          </div>

          <div
            v-if="personaTimeline.length === 0"
            class="py-10 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.emptyPersona') }}
          </div>
          <ScrollArea v-else class="h-[320px] pr-3">
            <ol class="space-y-2">
              <li
                v-for="version in personaTimeline"
                :key="version.id"
                class="rounded-lg border px-3 py-2"
                :class="isActivePersona(version) ? 'border-primary bg-primary/5' : 'border-border'"
              >
                <div class="mb-1 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5">
                    <Badge
                      :variant="isActivePersona(version) ? 'default' : 'outline'"
                      class="text-[10px]"
                    >
                      {{
                        isActivePersona(version)
                          ? t('settings.deepchatAgents.memoryManager.personaActive')
                          : formatTime(version.createdAt)
                      }}
                    </Badge>
                    <Badge v-if="version.isAnchor" variant="secondary" class="gap-1 text-[10px]">
                      <Icon icon="lucide:lock" class="h-3 w-3" />
                      {{ t('settings.deepchatAgents.memoryManager.anchored') }}
                    </Badge>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      :aria-label="
                        version.isAnchor
                          ? t('settings.deepchatAgents.memoryManager.unanchor')
                          : t('settings.deepchatAgents.memoryManager.anchor')
                      "
                      @click="handleSetAnchor(version.id, !version.isAnchor)"
                    >
                      <Icon
                        :icon="version.isAnchor ? 'lucide:lock-open' : 'lucide:lock'"
                        class="mr-1 h-3.5 w-3.5"
                      />
                      {{
                        version.isAnchor
                          ? t('settings.deepchatAgents.memoryManager.unanchor')
                          : t('settings.deepchatAgents.memoryManager.anchor')
                      }}
                    </Button>
                    <AlertDialog v-if="!isActivePersona(version)">
                      <AlertDialogTrigger as-child>
                        <Button variant="ghost" size="sm" class="h-7 px-2 text-xs">
                          <Icon icon="lucide:rotate-ccw" class="mr-1 h-3.5 w-3.5" />
                          {{ t('settings.deepchatAgents.memoryManager.rollback') }}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {{ t('settings.deepchatAgents.memoryManager.rollbackConfirmTitle') }}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {{ t('settings.deepchatAgents.memoryManager.rollbackConfirmBody') }}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                          <AlertDialogAction @click="handleRollback(version.id)">
                            {{ t('settings.deepchatAgents.memoryManager.rollback') }}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <p class="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
                  {{ version.content }}
                </p>
              </li>
            </ol>
          </ScrollArea>
        </template>
      </TabsContent>

      <TabsContent value="activity" class="mt-3">
        <div v-if="activityLoading" class="py-10 text-center text-sm text-muted-foreground">
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="activityCount === 0"
          class="py-10 text-center text-sm text-muted-foreground"
        >
          {{ t('settings.deepchatAgents.memoryManager.emptyActivity') }}
        </div>
        <ScrollArea v-else class="h-90 pr-3">
          <div class="space-y-4">
            <section v-if="auditEvents.length > 0" class="space-y-2">
              <div class="text-xs font-medium">
                {{
                  t('settings.deepchatAgents.memoryManager.auditEventsTitle', {
                    count: auditEvents.length
                  })
                }}
              </div>
              <ol class="space-y-2">
                <li
                  v-for="event in auditEvents"
                  :key="event.id"
                  class="rounded-lg border border-border px-3 py-2"
                >
                  <div class="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" class="text-[10px]">{{ event.eventType }}</Badge>
                    <Badge :variant="auditStatusVariant(event.status)" class="text-[10px]">
                      {{ event.status }}
                    </Badge>
                    <Badge variant="secondary" class="text-[10px]">{{ event.actorType }}</Badge>
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatTime(event.createdAt) }}
                    </span>
                  </div>
                  <p v-if="event.reason" class="wrap-break-word text-xs text-muted-foreground">
                    {{ event.reason }}
                  </p>
                  <p
                    v-if="formatRefs(event.inputRefs) || formatRefs(event.outputRefs)"
                    class="wrap-break-word text-[10px] text-muted-foreground"
                  >
                    {{ formatRefs(event.inputRefs) }}
                    <span v-if="formatRefs(event.inputRefs) && formatRefs(event.outputRefs)">
                      ·
                    </span>
                    {{ formatRefs(event.outputRefs) }}
                  </p>
                </li>
              </ol>
            </section>

            <section v-if="viewManifests.length > 0" class="space-y-2">
              <div class="text-xs font-medium">
                {{
                  t('settings.deepchatAgents.memoryManager.viewManifestsTitle', {
                    count: viewManifests.length
                  })
                }}
              </div>
              <ol class="space-y-2">
                <li
                  v-for="manifest in viewManifests"
                  :key="`${manifest.sessionId}:${manifest.entryId}`"
                  class="rounded-lg border border-border px-3 py-2"
                >
                  <div class="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" class="text-[10px]">
                      v{{ manifest.policyVersion ?? 1 }}
                    </Badge>
                    <Badge variant="secondary" class="text-[10px]">
                      {{ manifest.tokenBudget }}
                    </Badge>
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatTime(manifest.createdAt) }}
                    </span>
                  </div>
                  <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>
                      {{
                        t('settings.deepchatAgents.memoryManager.manifestSelected', {
                          count: manifest.selectedCount
                        })
                      }}
                    </span>
                    <span>
                      {{
                        t('settings.deepchatAgents.memoryManager.manifestDropped', {
                          count: manifest.droppedCount
                        })
                      }}
                    </span>
                    <span>{{ manifest.estimatedTokens }}</span>
                    <span v-if="manifest.queryHash">
                      {{ shortHash(manifest.queryHash) }}
                    </span>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>

    <Dialog v-model:open="sourceSpanOpen">
      <DialogContent class="sm:max-w-160">
        <DialogHeader class="text-left">
          <DialogTitle>{{
            t('settings.deepchatAgents.memoryManager.sourceDialogTitle')
          }}</DialogTitle>
        </DialogHeader>
        <div v-if="!sourceSpan" class="py-6 text-center text-sm text-muted-foreground">
          {{ t('settings.deepchatAgents.memoryManager.sourceDialogEmpty') }}
        </div>
        <ScrollArea v-else class="max-h-105 pr-3">
          <ol class="space-y-2">
            <li
              v-for="entry in sourceSpan.entries"
              :key="entry.entryId"
              class="rounded-lg border border-border px-3 py-2"
            >
              <div class="mb-1 text-[10px] uppercase text-muted-foreground">
                {{ entry.role }} · #{{ entry.orderSeq }}
              </div>
              <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ entry.content }}</p>
            </li>
          </ol>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Input } from '@shadcn/components/ui/input'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@shadcn/components/ui/alert-dialog'
import { createMemoryClient, type MemoryUpdatedPayload } from '@api/MemoryClient'
import { useToast } from '@/components/use-toast'
import { AGENT_MEMORY_CATEGORIES, type AgentMemoryCategory } from '@shared/types/agent-memory'
import MemoryHealthSection from './MemoryHealthSection.vue'
import MemoryLifecyclePanel from './MemoryLifecyclePanel.vue'
import type {
  MemoryAddResult,
  MemoryArchiveCandidateLifecyclePreview,
  MemoryAuditEvent,
  MemoryConflictItem,
  MemoryHealthDto,
  MemoryItem,
  MemoryLifecycle,
  MemorySearchResult,
  MemorySourceSpan,
  MemoryStatusDto,
  MemoryViewManifest
} from '@shared/contracts/routes'

type MemoryCategoryFilter = AgentMemoryCategory | 'all' | 'uncategorized'
const ADD_CATEGORY_NONE = 'none'

const props = defineProps<{
  agentId: string
  memoryEnabled?: boolean
  hasEmbeddingConfigured?: boolean
  personaEvolutionEnabled?: boolean
}>()

const { t } = useI18n()
const { toast } = useToast()
const memoryClient = createMemoryClient()

const activeTab = ref<'memories' | 'health' | 'persona' | 'activity'>('memories')
const loading = ref(false)
const activityLoading = ref(false)
const healthLoading = ref(false)
const error = ref<string | null>(null)
const healthError = ref<string | null>(null)
const memories = ref<MemoryItem[]>([])
const searchQuery = ref('')
const searchResults = ref<MemorySearchResult[]>([])
const searching = ref(false)
const IMPORTANCE_VALUES: Record<string, number> = { low: 0.3, medium: 0.5, high: 0.8 }
const categoryFilter = ref<MemoryCategoryFilter>('all')
const showAddForm = ref(false)
const addContent = ref('')
const addKind = ref<'episodic' | 'semantic'>('semantic')
const addCategory = ref<AgentMemoryCategory | typeof ADD_CATEGORY_NONE>(ADD_CATEGORY_NONE)
const addCategorySelected = computed(() => addCategory.value !== ADD_CATEGORY_NONE)
const addImportance = ref<'low' | 'medium' | 'high'>('medium')
const adding = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
// Monotonic dispatch id: only the latest search may write results, so a late response from a
// superseded query (or a switched-away agent) cannot clobber the current one.
let searchRequestId = 0
let refreshRequestId = 0
let healthRequestId = 0
let memoryUpdateVersion = 0
const conflicts = ref<MemoryConflictItem[]>([])
const personaVersions = ref<MemoryItem[]>([])
const personaDrafts = ref<MemoryItem[]>([])
const auditEvents = ref<MemoryAuditEvent[]>([])
const viewManifests = ref<MemoryViewManifest[]>([])
const status = ref<MemoryStatusDto | null>(null)
const health = ref<MemoryHealthDto | null>(null)
const healthDirty = ref(true)
const archiveCandidateLifecyclePreview = ref<MemoryArchiveCandidateLifecyclePreview | null>(null)
const archiveCandidateLifecyclePreviewLoading = ref(false)
const archiveCandidateLifecyclePreviewError = ref<string | null>(null)
const archiveCandidateLifecyclePreviewDirty = ref(true)
const sourceSpanOpen = ref(false)
const sourceSpan = ref<MemorySourceSpan>(null)
const searchError = ref<string | null>(null)
const expandedLifecycleIds = ref<Set<string>>(new Set())
const lifecycleCache = ref<Record<string, MemoryLifecycle | null>>({})
const lifecycleLoading = ref<Record<string, boolean>>({})
const lifecycleErrors = ref<Record<string, string | null>>({})
let lifecycleRequestSeq = 0
const lifecycleRequestIds = new Map<string, number>()
let archiveCandidateLifecyclePreviewRequestId = 0

const hasEmbeddingConfigured = computed(() => props.hasEmbeddingConfigured === true)
// Only gates the write surface when the caller explicitly reports memory disabled; existing rows
// stay viewable, searchable, and deletable. A disabled add would be folded into a backend no-op.
const memoryDisabled = computed(() => props.memoryEnabled === false)

let disposeUpdated: (() => void) | null = null

async function refreshActivity(agentId: string): Promise<void> {
  activityLoading.value = true
  try {
    const [events, manifests] = await Promise.all([
      memoryClient.listAuditEvents(agentId, { limit: 50 }),
      memoryClient.listViewManifests(agentId, { limit: 50 })
    ])
    if (props.agentId !== agentId) return
    auditEvents.value = events
    viewManifests.value = manifests
  } catch {
    if (props.agentId !== agentId) return
    auditEvents.value = []
    viewManifests.value = []
  } finally {
    if (props.agentId === agentId) {
      activityLoading.value = false
    }
  }
}

async function refreshHealth(agentId: string): Promise<void> {
  const requestId = ++healthRequestId
  healthLoading.value = true
  healthError.value = null
  try {
    const nextHealth = await memoryClient.getHealth(agentId)
    if (!isCurrentHealth(agentId, requestId)) return
    health.value = nextHealth
    healthDirty.value = false
  } catch (e) {
    if (!isCurrentHealth(agentId, requestId)) return
    health.value = null
    healthError.value = e instanceof Error ? e.message : String(e)
    healthDirty.value = false
  } finally {
    if (isCurrentHealth(agentId, requestId)) {
      healthLoading.value = false
    }
  }
}

async function refreshArchiveCandidateLifecyclePreview(agentId: string): Promise<void> {
  const requestId = ++archiveCandidateLifecyclePreviewRequestId
  archiveCandidateLifecyclePreviewLoading.value = true
  archiveCandidateLifecyclePreviewError.value = null
  try {
    const preview = await memoryClient.getArchiveCandidateLifecyclePreview(agentId)
    if (!isCurrentArchiveCandidateLifecyclePreview(agentId, requestId)) return
    archiveCandidateLifecyclePreview.value = preview
    archiveCandidateLifecyclePreviewDirty.value = false
  } catch (e) {
    if (!isCurrentArchiveCandidateLifecyclePreview(agentId, requestId)) return
    archiveCandidateLifecyclePreview.value = null
    archiveCandidateLifecyclePreviewError.value = e instanceof Error ? e.message : String(e)
    archiveCandidateLifecyclePreviewDirty.value = false
  } finally {
    if (isCurrentArchiveCandidateLifecyclePreview(agentId, requestId)) {
      archiveCandidateLifecyclePreviewLoading.value = false
    }
  }
}

function isCurrentHealth(agentId: string, requestId: number): boolean {
  return requestId === healthRequestId && props.agentId === agentId
}

function isCurrentArchiveCandidateLifecyclePreview(agentId: string, requestId: number): boolean {
  return requestId === archiveCandidateLifecyclePreviewRequestId && props.agentId === agentId
}

async function ensureHealthFresh(): Promise<void> {
  if (!props.agentId || activeTab.value !== 'health') return
  const tasks: Promise<void>[] = []
  if (healthDirty.value || !health.value) tasks.push(refreshHealth(props.agentId))
  if (
    archiveCandidateLifecyclePreviewDirty.value ||
    archiveCandidateLifecyclePreviewError.value !== null
  ) {
    tasks.push(refreshArchiveCandidateLifecyclePreview(props.agentId))
  }
  await Promise.all(tasks)
}

function markHealthDirty(): void {
  healthRequestId += 1
  archiveCandidateLifecyclePreviewRequestId += 1
  healthDirty.value = true
  health.value = null
  healthError.value = null
  healthLoading.value = false
  archiveCandidateLifecyclePreviewDirty.value = true
  archiveCandidateLifecyclePreview.value = null
  archiveCandidateLifecyclePreviewError.value = null
  archiveCandidateLifecyclePreviewLoading.value = false
}

function refreshHealthIfActive(): void {
  if (activeTab.value === 'health') void ensureHealthFresh()
}

function markHealthDirtyFromEvent(reason: MemoryUpdatedPayload['reason']): void {
  if (reason === 'persona-anchor') return
  markHealthDirty()
  refreshHealthIfActive()
}

// Best-effort event coalescing: if this action observed a memory.updated event while awaiting IPC,
// that event owns the dirty mark; otherwise this fallback keeps health stale instead of fresh-looking.
function markHealthDirtyIfNoObservedUpdate(eventVersionBefore: number): void {
  if (memoryUpdateVersion === eventVersionBefore) markHealthDirty()
}

async function refresh(): Promise<void> {
  if (!props.agentId) return
  const agentId = props.agentId
  refreshRequestId += 1
  const requestId = refreshRequestId
  loading.value = true
  error.value = null
  try {
    const [list, conflictPairs, versions, drafts, currentStatus] = await Promise.all([
      memoryClient.list(agentId),
      memoryClient.listConflicts(agentId),
      memoryClient.listPersonaVersions(agentId),
      memoryClient.listPersonaDrafts(agentId),
      memoryClient.getStatus(agentId)
    ])
    if (requestId !== refreshRequestId || props.agentId !== agentId) return
    memories.value = list
    conflicts.value = conflictPairs
    personaVersions.value = versions
    personaDrafts.value = drafts
    status.value = currentStatus
    resetLifecycleState()
    // Reconcile the search cache with server truth so a mutation that reloads memories does not
    // leave a stale (or already-deleted) row showing in search mode.
    if (searchActive.value) {
      searchRequestId += 1
      void runSearch(agentId, searchQuery.value.trim(), searchRequestId)
    }
    void refreshActivity(agentId)
  } catch (e) {
    if (requestId !== refreshRequestId || props.agentId !== agentId) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (requestId === refreshRequestId && props.agentId === agentId) loading.value = false
  }
}

const searchActive = computed(() => searchQuery.value.trim().length > 0)
const categoryFilterActive = computed(() => categoryFilter.value !== 'all')
const baseDisplayedMemories = computed<MemoryItem[]>(() =>
  searchActive.value ? searchResults.value : memories.value
)
const displayedMemories = computed<MemoryItem[]>(() =>
  baseDisplayedMemories.value.filter(matchesCategoryFilter)
)
const emptyMemoryMessage = computed(() => {
  if (searchActive.value && baseDisplayedMemories.value.length === 0) {
    return t('settings.deepchatAgents.memoryManager.noSearchResults')
  }
  if (categoryFilterActive.value) {
    return t('settings.deepchatAgents.memoryManager.noCategoryResults')
  }
  return t('settings.deepchatAgents.memoryManager.emptyMemories')
})

// A response may only write when it is still the latest dispatch (requestId) for the current agent
// and query. The id carries ordering; the agent/query checks make the staleness guard self-evident.
function isCurrentSearch(agentId: string, query: string, requestId: number): boolean {
  return (
    requestId === searchRequestId && props.agentId === agentId && searchQuery.value.trim() === query
  )
}

async function runSearch(agentId: string, query: string, requestId: number): Promise<void> {
  searching.value = true
  searchError.value = null
  try {
    const results = await memoryClient.search(agentId, query)
    if (isCurrentSearch(agentId, query, requestId)) searchResults.value = results
  } catch (e) {
    if (isCurrentSearch(agentId, query, requestId)) {
      searchResults.value = []
      searchError.value =
        e instanceof Error ? e.message : t('settings.deepchatAgents.memoryManager.searchFailed')
    }
  } finally {
    if (isCurrentSearch(agentId, query, requestId)) searching.value = false
  }
}

function resetSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  searchRequestId += 1
  searchQuery.value = ''
  searchResults.value = []
  searchError.value = null
  searching.value = false
}

function resetLifecycleState(): void {
  expandedLifecycleIds.value = new Set()
  lifecycleCache.value = {}
  lifecycleLoading.value = {}
  lifecycleErrors.value = {}
  lifecycleRequestIds.clear()
  lifecycleRequestSeq += 1
}

function isLifecycleExpanded(memoryId: string): boolean {
  return expandedLifecycleIds.value.has(memoryId)
}

function lifecycleFor(memoryId: string): MemoryLifecycle | null {
  return lifecycleCache.value[memoryId] ?? null
}

function isLifecycleLoading(memoryId: string): boolean {
  return lifecycleLoading.value[memoryId] === true
}

function lifecycleErrorFor(memoryId: string): string | null {
  return lifecycleErrors.value[memoryId] ?? null
}

function hasLifecycleCache(memoryId: string): boolean {
  return Object.prototype.hasOwnProperty.call(lifecycleCache.value, memoryId)
}

function setLifecycleExpanded(memoryId: string, expanded: boolean): void {
  const next = new Set(expandedLifecycleIds.value)
  if (expanded) next.add(memoryId)
  else next.delete(memoryId)
  expandedLifecycleIds.value = next
}

async function toggleLifecycle(memoryId: string): Promise<void> {
  if (isLifecycleExpanded(memoryId)) {
    setLifecycleExpanded(memoryId, false)
    return
  }
  setLifecycleExpanded(memoryId, true)
  if (hasLifecycleCache(memoryId) || lifecycleLoading.value[memoryId]) return
  await loadLifecycle(memoryId)
}

async function loadLifecycle(memoryId: string): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const requestId = ++lifecycleRequestSeq
  lifecycleRequestIds.set(memoryId, requestId)
  lifecycleLoading.value = { ...lifecycleLoading.value, [memoryId]: true }
  lifecycleErrors.value = { ...lifecycleErrors.value, [memoryId]: null }
  try {
    const lifecycles = await memoryClient.getLifecycle(agentId, memoryId)
    if (!isCurrentLifecycleRequest(agentId, memoryId, requestId)) return
    lifecycleCache.value = { ...lifecycleCache.value, [memoryId]: lifecycles[0] ?? null }
  } catch (e) {
    if (!isCurrentLifecycleRequest(agentId, memoryId, requestId)) return
    lifecycleErrors.value = {
      ...lifecycleErrors.value,
      [memoryId]: e instanceof Error ? e.message : String(e)
    }
  } finally {
    if (isCurrentLifecycleRequest(agentId, memoryId, requestId)) {
      lifecycleLoading.value = { ...lifecycleLoading.value, [memoryId]: false }
    }
  }
}

function isCurrentLifecycleRequest(agentId: string, memoryId: string, requestId: number): boolean {
  return props.agentId === agentId && lifecycleRequestIds.get(memoryId) === requestId
}

function matchesCategoryFilter(memory: MemoryItem): boolean {
  if (categoryFilter.value === 'all') return true
  if (categoryFilter.value === 'uncategorized') return memory.category == null
  return memory.category === categoryFilter.value
}

function categoryLabel(category: AgentMemoryCategory | null | undefined): string {
  if (category == null) return t('settings.deepchatAgents.memoryManager.categoryUncategorized')
  return t(`settings.deepchatAgents.memoryManager.category.${category}`)
}

watch(searchQuery, (value) => {
  const query = value.trim()
  if (searchTimer) clearTimeout(searchTimer)
  // Bump the id the instant the query changes — not only when the debounce fires — so an earlier
  // in-flight request is invalidated before it can resolve into a box that has moved on.
  searchRequestId += 1
  const requestId = searchRequestId
  if (!query) {
    searchResults.value = []
    searchError.value = null
    searching.value = false
    return
  }
  const agentId = props.agentId
  searchTimer = setTimeout(() => void runSearch(agentId, query, requestId), 200)
})

// The injected self-model is the newest version that is active (or a legacy row that was never
// superseded). Drafts and rejected versions are kept out of the timeline entirely.
const activePersonaId = computed<string | null>(() => {
  const match = personaVersions.value.find(
    (version) =>
      version.personaState === 'active' ||
      (version.personaState == null && version.supersededBy === null)
  )
  return match?.id ?? null
})

const activePersonaContent = computed<string | null>(
  () =>
    personaVersions.value.find((version) => version.id === activePersonaId.value)?.content ?? null
)

const personaTimeline = computed<MemoryItem[]>(() =>
  personaVersions.value.filter(
    (version) => version.personaState !== 'draft' && version.personaState !== 'rejected'
  )
)

const activityCount = computed(() => auditEvents.value.length + viewManifests.value.length)

function isActivePersona(version: MemoryItem): boolean {
  return version.id === activePersonaId.value
}

function statusVariant(
  memoryStatus: MemoryItem['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (memoryStatus === 'error') return 'destructive'
  if (memoryStatus === 'conflicted') return 'destructive'
  if (memoryStatus === 'embedded') return 'default'
  if (memoryStatus === 'archived') return 'outline'
  return 'secondary'
}

function auditStatusVariant(
  status: MemoryAuditEvent['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive'
  if (status === 'completed') return 'default'
  return 'secondary'
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

function formatRefValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`
  if (value && typeof value === 'object') return '{...}'
  if (
    typeof value === 'string' &&
    !/(id|ids|type|status|action|reason|policy|seq|count)$/i.test(key)
  ) {
    return 'text'
  }
  return String(value)
}

function formatRefs(refs: Record<string, unknown>): string {
  return Object.entries(refs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatRefValue(key, value)}`)
    .join(' · ')
}

function shortHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash
}

function shortSession(session: string): string {
  return session.length > 8 ? `…${session.slice(-8)}` : session
}

function sourceEntryTitle(memory: MemoryItem): string {
  return memory.sourceEntryIds?.join(', ') ?? ''
}

function notifyActionFailed(e?: unknown): void {
  toast({
    variant: 'destructive',
    title: t('settings.deepchatAgents.memoryManager.actionFailed'),
    description: e instanceof Error ? e.message : e ? String(e) : undefined
  })
}

async function handleDelete(memoryId: string): Promise<void> {
  try {
    const eventVersionBefore = memoryUpdateVersion
    const ok = await memoryClient.remove(props.agentId, memoryId)
    if (!ok) return notifyActionFailed()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleClear(): Promise<void> {
  try {
    const eventVersionBefore = memoryUpdateVersion
    const removed = await memoryClient.clear(props.agentId)
    if (removed === 0) {
      toast({
        title: t('settings.deepchatAgents.memoryManager.clearNoop')
      })
      return
    }
    memories.value = []
    searchResults.value = []
    conflicts.value = []
    status.value = status.value ? { ...status.value, total: 0, pendingEmbedding: 0 } : null
    resetLifecycleState()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refreshActivity(props.agentId)
  } catch (e) {
    notifyActionFailed(e)
  }
}

function resetAddForm(): void {
  showAddForm.value = false
  addContent.value = ''
  addKind.value = 'semantic'
  addCategory.value = ADD_CATEGORY_NONE
  addImportance.value = 'medium'
}

function toggleAddForm(): void {
  if (memoryDisabled.value) return
  showAddForm.value = !showAddForm.value
}

function cancelAdd(): void {
  resetAddForm()
}

function notifyAddOutcome(result: MemoryAddResult): void {
  if (result.action === 'challenged') {
    toast({ title: t('settings.deepchatAgents.memoryManager.addConflict') })
    return
  }
  if (result.action === 'noop') {
    // Only an exact-content collision is a genuine duplicate; every other no-op (disabled, empty,
    // decision-skip) is reported as "not added" so a disabled agent never reads as "duplicate".
    const key =
      result.reason === 'duplicate'
        ? 'settings.deepchatAgents.memoryManager.addDuplicate'
        : 'settings.deepchatAgents.memoryManager.addSkipped'
    toast({ title: t(key) })
    return
  }
  toast({ title: t('settings.deepchatAgents.memoryManager.addSuccess') })
}

async function handleAdd(): Promise<void> {
  const content = addContent.value.trim()
  if (!content || adding.value || memoryDisabled.value) return
  adding.value = true
  try {
    const eventVersionBefore = memoryUpdateVersion
    const category = addCategory.value === ADD_CATEGORY_NONE ? undefined : addCategory.value
    const importance = IMPORTANCE_VALUES[addImportance.value]
    const input = category
      ? { content, category, importance }
      : { content, kind: addKind.value, importance }
    const result = await memoryClient.add(props.agentId, input)
    notifyAddOutcome(result)
    if (result.action !== 'noop') markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    resetAddForm()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  } finally {
    adding.value = false
  }
}

async function handleOpenSource(memory: MemoryItem): Promise<void> {
  sourceSpan.value = null
  sourceSpanOpen.value = true
  try {
    sourceSpan.value = await memoryClient.getSourceSpan(props.agentId, memory.id)
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleResolveConflict(
  challengerId: string,
  outcome: 'keep_target' | 'keep_challenger' | 'keep_both'
): Promise<void> {
  try {
    const eventVersionBefore = memoryUpdateVersion
    const ok = await memoryClient.resolveConflict(props.agentId, challengerId, outcome)
    if (!ok) return notifyActionFailed()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleRollback(versionId: string): Promise<void> {
  try {
    const eventVersionBefore = memoryUpdateVersion
    const ok = await memoryClient.rollbackPersona(props.agentId, versionId)
    if (!ok) return notifyActionFailed()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleApproveDraft(draftId: string): Promise<void> {
  try {
    const eventVersionBefore = memoryUpdateVersion
    const ok = await memoryClient.approvePersonaDraft(props.agentId, draftId)
    if (!ok) return notifyActionFailed()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleRejectDraft(draftId: string): Promise<void> {
  try {
    const eventVersionBefore = memoryUpdateVersion
    const ok = await memoryClient.rejectPersonaDraft(props.agentId, draftId)
    if (!ok) return notifyActionFailed()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleSetAnchor(versionId: string, anchored: boolean): Promise<void> {
  try {
    const ok = await memoryClient.setPersonaAnchor(props.agentId, versionId, anchored)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleRestore(memoryId: string): Promise<void> {
  if (memoryDisabled.value) return
  try {
    const eventVersionBefore = memoryUpdateVersion
    const ok = await memoryClient.restore(props.agentId, memoryId)
    if (!ok) return notifyActionFailed()
    markHealthDirtyIfNoObservedUpdate(eventVersionBefore)
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

watch(
  () => props.agentId,
  () => {
    activeTab.value = 'memories'
    categoryFilter.value = 'all'
    markHealthDirty()
    resetLifecycleState()
    resetSearch()
    resetAddForm()
    void refresh()
  }
)

watch(activeTab, (tab) => {
  if (tab === 'health') void ensureHealthFresh()
})

onMounted(() => {
  void refresh()
  disposeUpdated = memoryClient.onUpdated((payload) => {
    if (payload.agentId === props.agentId) {
      memoryUpdateVersion += 1
      markHealthDirtyFromEvent(payload.reason)
      void refresh()
    }
  })
})

onUnmounted(() => {
  disposeUpdated?.()
  disposeUpdated = null
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
})
</script>
