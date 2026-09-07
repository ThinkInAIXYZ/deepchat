<template>
  <SettingsPageShell
    data-testid="settings-data-page"
    :title="t('settings.data.privacyTitle')"
    :description="t('settings.data.privacyDescription')"
  >
    <div class="flex w-full flex-col gap-4">
      <div
        data-testid="database-encryption-section"
        class="rounded-xl border border-border bg-card/30 p-4"
      >
        <div class="flex flex-col gap-4">
          <div
            class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            :dir="languageStore.dir"
          >
            <span class="flex flex-row items-center gap-2">
              <Icon icon="lucide:refresh-cw" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ t('settings.data.syncEnable') }}</span>
            </span>
            <div class="shrink-0">
              <Switch
                :model-value="syncEnabled"
                :disabled="isSyncInteractionDisabled"
                @update:model-value="handleSyncEnabledChange"
              />
            </div>
          </div>

          <div
            class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <span class="flex flex-row items-center gap-2">
              <Icon icon="lucide:folder" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ t('settings.data.syncFolder') }}</span>
            </span>
            <div class="flex w-full gap-2 lg:w-96">
              <Input
                :model-value="syncFolderPath"
                :disabled="!syncStore.syncEnabled || isSyncInteractionDisabled"
                readonly
                class="h-8!"
                @click="handleSelectSyncFolder"
              />
              <DcButton
                size="icon-sm"
                variant="outline"
                :disabled="!syncStore.syncEnabled || isSyncInteractionDisabled"
                :tooltip="t('settings.data.openSyncFolder')"
                @click="handleOpenSyncFolder"
              >
                <Icon icon="lucide:external-link" class="h-4 w-4" />
              </DcButton>
            </div>
          </div>

          <div
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            :dir="languageStore.dir"
          >
            <span class="flex flex-row items-center gap-2">
              <Icon icon="lucide:clock" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ t('settings.data.lastSyncTime') }}</span>
            </span>
            <span class="text-sm text-muted-foreground">
              {{
                !syncStore.lastSyncTime
                  ? t('settings.data.never')
                  : new Date(syncStore.lastSyncTime).toLocaleString()
              }}
            </span>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row">
            <DcButton
              variant="outline"
              class="w-full sm:w-auto"
              :dir="languageStore.dir"
              :disabled="!syncStore.syncEnabled || isSyncInteractionDisabled"
              @click="handleBackup"
            >
              <Spinner v-if="syncStore.isBackingUp" class="size-4 text-muted-foreground" />
              <Icon v-else icon="lucide:save" class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">
                {{
                  syncStore.isBackingUp
                    ? t('settings.data.backingUp')
                    : t('settings.data.startBackup')
                }}
              </span>
            </DcButton>

            <Dialog :open="isImportDialogOpen" @update:open="handleImportDialogOpenChange">
              <DialogTrigger as-child>
                <DcButton
                  variant="outline"
                  class="w-full sm:w-auto"
                  :disabled="!syncStore.syncEnabled || isSyncInteractionDisabled"
                  :dir="languageStore.dir"
                >
                  <Icon icon="lucide:download" class="h-4 w-4 text-muted-foreground" />
                  <span class="text-sm font-medium">{{ t('settings.data.importData') }}</span>
                </DcButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{{ t('settings.data.importConfirmTitle') }}</DialogTitle>
                  <DialogDescription>
                    {{ t('settings.data.importConfirmDescription') }}
                  </DialogDescription>
                </DialogHeader>
                <div class="flex flex-col gap-4 px-4 pb-4">
                  <div class="flex flex-col gap-2">
                    <Label class="text-sm font-medium" :dir="languageStore.dir">
                      {{ t('settings.data.backupSelectLabel') }}
                    </Label>
                    <Select
                      v-model="selectedBackup"
                      :disabled="syncStore.isImporting || !availableBackups.length"
                    >
                      <SelectTrigger class="h-8!" :dir="languageStore.dir">
                        <SelectValue :placeholder="t('settings.data.selectBackupPlaceholder')" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="backup in availableBackups"
                          :key="backup.fileName"
                          :value="backup.fileName"
                          :dir="languageStore.dir"
                        >
                          {{ formatBackupLabel(backup.fileName, backup.createdAt, backup.size) }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p class="text-xs text-muted-foreground" :dir="languageStore.dir">
                      {{
                        availableBackups.length
                          ? t('settings.data.backupSelectDescription')
                          : t('settings.data.noBackupsAvailable')
                      }}
                    </p>
                  </div>

                  <RadioGroup
                    v-model="importMode"
                    :disabled="syncStore.isImporting"
                    class="flex flex-col gap-2"
                  >
                    <div class="flex items-center space-x-2">
                      <RadioGroupItem value="increment" />
                      <Label>{{ t('settings.data.incrementImport') }}</Label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <RadioGroupItem value="overwrite" />
                      <Label>{{ t('settings.data.overwriteImport') }}</Label>
                    </div>
                  </RadioGroup>
                </div>
                <DialogFooter>
                  <DcButton
                    variant="outline"
                    :disabled="syncStore.isImporting"
                    @click="closeImportDialog"
                  >
                    {{ t('dialog.cancel') }}
                  </DcButton>
                  <DcButton
                    variant="default"
                    :disabled="syncStore.isImporting || !selectedBackup"
                    @click="handleImport"
                  >
                    {{
                      syncStore.isImporting
                        ? t('settings.data.importing')
                        : t('settings.data.confirmImport')
                    }}
                  </DcButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div class="flex flex-col gap-4 border-t border-border pt-4" :dir="languageStore.dir">
            <div class="flex flex-col gap-1">
              <span class="flex flex-row items-center gap-2">
                <Icon icon="lucide:cloud" class="h-4 w-4 text-muted-foreground" />
                <span class="text-sm font-medium">{{ t('settings.data.cloudSync.title') }}</span>
              </span>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.data.cloudSync.description') }}
              </p>
            </div>

            <div
              class="grid w-full gap-1 rounded-lg border border-border bg-muted/30 p-1 sm:w-fit sm:grid-cols-2"
            >
              <button
                type="button"
                data-testid="cloud-provider-r2"
                :disabled="isCloudInteractionDisabled"
                :class="
                  cn(
                    'flex h-8 items-center justify-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
                    cloudProviderMode === 'r2'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )
                "
                @click="setCloudProviderMode('r2')"
              >
                <Icon icon="lucide:cloud" class="h-3.5 w-3.5" />
                <span>{{ t('settings.data.cloudSync.providerR2') }}</span>
              </button>
              <button
                type="button"
                data-testid="cloud-provider-custom"
                :disabled="isCloudInteractionDisabled"
                :class="
                  cn(
                    'flex h-8 items-center justify-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
                    cloudProviderMode === 'custom'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )
                "
                @click="setCloudProviderMode('custom')"
              >
                <Icon icon="lucide:server-cog" class="h-3.5 w-3.5" />
                <span>{{ t('settings.data.cloudSync.providerCustom') }}</span>
              </button>
            </div>

            <div
              v-if="cloudProviderMode === 'r2'"
              class="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground"
            >
              <div class="flex gap-2">
                <Icon icon="lucide:info" class="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <div class="flex min-w-0 flex-col gap-2">
                  <p class="text-foreground">
                    {{ t('settings.data.cloudSync.r2GuideTitle') }}
                  </p>
                  <div class="grid gap-2">
                    <div
                      data-testid="cloud-r2-guide-endpoint"
                      class="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start"
                    >
                      <span class="font-medium text-foreground">
                        {{ t('settings.data.cloudSync.endpoint') }}
                      </span>
                      <span>{{ t('settings.data.cloudSync.r2EndpointHint') }}</span>
                    </div>
                    <div
                      data-testid="cloud-r2-guide-access-key"
                      class="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start"
                    >
                      <span class="font-medium text-foreground">
                        {{ t('settings.data.cloudSync.accessKeyId') }}
                      </span>
                      <span>{{ t('settings.data.cloudSync.r2AccessKeyHint') }}</span>
                    </div>
                    <div
                      data-testid="cloud-r2-guide-secret"
                      class="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start"
                    >
                      <span class="font-medium text-foreground">
                        {{ t('settings.data.cloudSync.secretAccessKey') }}
                      </span>
                      <span>{{ t('settings.data.cloudSync.r2SecretHint') }}</span>
                    </div>
                  </div>
                  <a
                    :href="CLOUDFLARE_R2_S3_DOCS_URL"
                    class="inline-flex w-fit items-center gap-1 text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                    @click.prevent="openExternalLink(CLOUDFLARE_R2_S3_DOCS_URL)"
                  >
                    {{ t('settings.data.cloudSync.r2DocsLink') }}
                    <Icon icon="lucide:external-link" class="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5 sm:col-span-2">
                <Label for="cloud-endpoint" class="text-xs">
                  {{ t('settings.data.cloudSync.endpoint') }}
                </Label>
                <Input
                  id="cloud-endpoint"
                  v-model="cloudForm.endpoint"
                  :disabled="isCloudInteractionDisabled"
                  class="h-8!"
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                />
                <p class="text-xs text-muted-foreground">
                  {{
                    cloudProviderMode === 'r2'
                      ? t('settings.data.cloudSync.endpointR2Description')
                      : t('settings.data.cloudSync.endpointCustomDescription')
                  }}
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <Label for="cloud-bucket" class="text-xs">
                  {{ t('settings.data.cloudSync.bucket') }}
                </Label>
                <Input
                  id="cloud-bucket"
                  v-model="cloudForm.bucket"
                  :disabled="isCloudInteractionDisabled"
                  class="h-8!"
                />
              </div>
              <div v-if="cloudProviderMode === 'custom'" class="flex flex-col gap-1.5">
                <Label for="cloud-region" class="text-xs">
                  {{ t('settings.data.cloudSync.region') }}
                </Label>
                <Input
                  id="cloud-region"
                  v-model="cloudForm.region"
                  :disabled="isCloudInteractionDisabled"
                  class="h-8!"
                  placeholder="auto"
                />
              </div>
              <div class="flex flex-col gap-1.5">
                <Label for="cloud-access-key-id" class="text-xs">
                  {{ t('settings.data.cloudSync.accessKeyId') }}
                </Label>
                <Input
                  id="cloud-access-key-id"
                  v-model="cloudForm.accessKeyId"
                  :disabled="isCloudInteractionDisabled"
                  class="h-8!"
                  autocomplete="off"
                />
                <p
                  v-if="cloudValidation.warnings.includes('r2AccessKeyLooksLikeAccountId')"
                  data-testid="cloud-access-key-warning"
                  class="text-xs text-amber-600 dark:text-amber-400"
                >
                  {{ t('settings.data.cloudSync.r2AccessKeyAccountIdWarning') }}
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <Label for="cloud-secret-access-key" class="text-xs">
                  {{ t('settings.data.cloudSync.secretAccessKey') }}
                </Label>
                <Input
                  id="cloud-secret-access-key"
                  v-model="cloudForm.secretAccessKey"
                  :disabled="isCloudInteractionDisabled"
                  data-testid="cloud-secret-input"
                  type="password"
                  class="h-8!"
                  autocomplete="off"
                  :aria-invalid="
                    cloudValidation.errors.includes('r2SecretLooksLikeApiToken') ? 'true' : 'false'
                  "
                  :placeholder="cloudSecretPlaceholder"
                />
                <p
                  v-if="cloudValidation.errors.includes('r2SecretLooksLikeApiToken')"
                  data-testid="cloud-secret-token-error"
                  class="text-xs text-destructive"
                >
                  {{ t('settings.data.cloudSync.r2SecretApiTokenError') }}
                </p>
                <p v-else class="text-xs text-muted-foreground">
                  {{ cloudSecretStatusText }}
                </p>
              </div>
              <div
                v-if="cloudProviderMode === 'custom'"
                class="flex flex-col gap-1.5 sm:col-span-2"
              >
                <Label for="cloud-prefix" class="text-xs">
                  {{ t('settings.data.cloudSync.prefix') }}
                </Label>
                <Input
                  id="cloud-prefix"
                  v-model="cloudForm.prefix"
                  :disabled="isCloudInteractionDisabled"
                  class="h-8!"
                  placeholder="deepchat-backups"
                />
              </div>
            </div>

            <details
              v-if="cloudProviderMode === 'r2'"
              class="group rounded-md border border-border/70 px-3 py-2"
            >
              <summary
                class="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium"
              >
                <span>{{ t('settings.data.cloudSync.advancedTitle') }}</span>
                <Icon
                  icon="lucide:chevron-down"
                  class="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                  <Label for="cloud-r2-region" class="text-xs">
                    {{ t('settings.data.cloudSync.region') }}
                  </Label>
                  <Input
                    id="cloud-r2-region"
                    v-model="cloudForm.region"
                    :disabled="isCloudInteractionDisabled"
                    class="h-8!"
                    placeholder="auto"
                  />
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.data.cloudSync.r2RegionDescription') }}
                  </p>
                </div>
                <div class="flex flex-col gap-1.5">
                  <Label for="cloud-r2-prefix" class="text-xs">
                    {{ t('settings.data.cloudSync.prefix') }}
                  </Label>
                  <Input
                    id="cloud-r2-prefix"
                    v-model="cloudForm.prefix"
                    :disabled="isCloudInteractionDisabled"
                    class="h-8!"
                    placeholder="deepchat-backups"
                  />
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.data.cloudSync.prefixDescription') }}
                  </p>
                </div>
              </div>
            </details>

            <p
              v-if="cloudConfig && !cloudConfig.safeStorageAvailable"
              class="text-xs text-amber-600 dark:text-amber-400"
            >
              {{ t('settings.data.cloudSync.safeStorageUnavailable') }}
            </p>

            <div class="flex flex-col gap-2 sm:flex-row">
              <DcSubmitButton
                variant="default"
                class="w-full sm:w-auto"
                data-testid="cloud-save-test"
                :status="cloudSaveTestStatus"
                :disabled="isCloudSaveDisabled"
                @click="handleSaveAndTestCloud"
              >
                <span class="text-sm font-medium">
                  {{ t('settings.data.cloudSync.saveAndTest') }}
                </span>
              </DcSubmitButton>
              <DcSubmitButton
                variant="outline"
                class="w-full sm:w-auto"
                data-testid="cloud-save-only"
                :status="cloudSaveStatus"
                :disabled="isCloudSaveDisabled"
                @click="handleSaveCloud"
              >
                <span class="text-sm font-medium">{{ t('settings.data.cloudSync.saveOnly') }}</span>
              </DcSubmitButton>
            </div>
            <DcInlineError v-if="cloudOperationError" :error="cloudOperationError" class="mt-2" />

            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <DcButton
                variant="outline"
                class="w-full sm:w-auto"
                :disabled="isCloudOperationDisabled"
                :title="!hasUsableCloudConfig ? t('settings.data.cloudSync.saveAndTestFirst') : ''"
                @click="handleUploadToCloud"
              >
                <Icon icon="lucide:cloud-upload" class="h-4 w-4 text-muted-foreground" />
                <span class="text-sm font-medium">{{ t('settings.data.cloudSync.upload') }}</span>
              </DcButton>
              <DcButton
                variant="outline"
                class="w-full sm:w-auto"
                :disabled="isCloudOperationDisabled"
                :title="!hasUsableCloudConfig ? t('settings.data.cloudSync.saveAndTestFirst') : ''"
                @click="handlePullFromCloud"
              >
                <Icon icon="lucide:cloud-download" class="h-4 w-4 text-muted-foreground" />
                <span class="text-sm font-medium">{{ t('settings.data.cloudSync.pull') }}</span>
              </DcButton>
              <div class="flex items-center gap-3">
                <RadioGroup
                  v-model="cloudPullMode"
                  :disabled="isCloudInteractionDisabled"
                  class="flex flex-row gap-3"
                >
                  <div class="flex items-center space-x-2">
                    <RadioGroupItem value="increment" id="cloud-increment" />
                    <Label for="cloud-increment" class="text-xs">{{
                      t('settings.data.incrementImport')
                    }}</Label>
                  </div>
                  <div class="flex items-center space-x-2">
                    <RadioGroupItem value="overwrite" id="cloud-overwrite" />
                    <Label for="cloud-overwrite" class="text-xs">{{
                      t('settings.data.overwriteImport')
                    }}</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
            <p v-if="!hasUsableCloudConfig" class="text-xs text-muted-foreground">
              {{ t('settings.data.cloudSync.saveAndTestFirst') }}
            </p>
          </div>
        </div>
      </div>

      <PrivacySettingsSection />

      <div class="rounded-xl border border-border bg-card/30 p-4">
        <div class="flex flex-col gap-4" :dir="languageStore.dir">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="flex gap-3">
              <div
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-foreground"
              >
                <Icon icon="lucide:user-key" class="h-4 w-4" />
              </div>
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">
                  {{ t('settings.data.databaseEncryption.title') }}
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.databaseEncryption.description') }}
                </p>
              </div>
            </div>
            <span
              data-testid="database-encryption-status-badge"
              class="inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-medium"
              :class="
                hasDatabaseSecurityStatusError && !databaseSecurityStatus
                  ? 'border-amber-500/30 text-amber-600 dark:text-amber-400'
                  : databaseSecurityStatus?.enabled
                    ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'border-border text-muted-foreground'
              "
            >
              {{ databaseSecurityStatusLabel }}
            </span>
          </div>

          <div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div class="flex justify-between gap-3">
              <span>{{ t('settings.data.databaseEncryption.cipher') }}</span>
              <span class="text-foreground">{{ databaseCipherLabel }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>{{ t('settings.data.databaseEncryption.systemUnlock') }}</span>
              <span class="text-foreground">{{ systemUnlockLabel }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>{{ t('settings.data.databaseEncryption.startupUnlock') }}</span>
              <span class="text-foreground">{{ startupUnlockLabel }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>{{ t('settings.data.databaseEncryption.lastMigration') }}</span>
              <span class="text-foreground">{{ lastDatabaseMigrationLabel }}</span>
            </div>
          </div>

          <p class="text-xs text-muted-foreground">
            {{ t('settings.data.databaseEncryption.systemCredentialStore') }}
          </p>
          <p
            v-if="databaseSecurityStatus && !databaseSecurityStatus.safeStorageAvailable"
            class="text-xs text-amber-600 dark:text-amber-400"
          >
            {{ t('settings.data.databaseEncryption.safeStorageUnavailable') }}
          </p>

          <div
            v-if="isDatabaseSecurityStatusLoaded && !hasDatabaseSecurityStatusError"
            class="flex flex-col gap-2 sm:flex-row"
          >
            <DcButton
              v-if="!databaseSecurityStatus?.enabled"
              class="w-full justify-center sm:w-36"
              :disabled="isDatabaseSecurityActionDisabled"
              @click="openDatabaseEncryptionDialog('enable')"
            >
              <span>{{ t('settings.data.databaseEncryption.setPasswordButton') }}</span>
            </DcButton>
            <DcButton
              v-else
              variant="outline"
              class="w-full justify-center sm:w-36"
              :disabled="isDatabaseSecurityActionDisabled"
              @click="openDatabaseEncryptionDialog('change')"
            >
              <span>{{ t('settings.data.databaseEncryption.changeButton') }}</span>
            </DcButton>
            <DcButton
              v-if="databaseSecurityStatus?.enabled"
              variant="destructive"
              class="w-full justify-center sm:w-36"
              :disabled="isDatabaseSecurityActionDisabled"
              @click="openDatabaseEncryptionDialog('disable')"
            >
              <span>{{ t('settings.data.databaseEncryption.disableButton') }}</span>
            </DcButton>
          </div>

          <Dialog
            :open="isDatabaseEncryptionDialogOpen"
            @update:open="handleDatabaseEncryptionDialogOpenChange"
          >
            <DialogContent v-if="isDatabaseEncryptionDialogOpen" class="sm:max-w-md">
              <DialogHeader>
                <DialogTitle class="flex items-center gap-2 text-base">
                  <Icon :icon="databaseEncryptionDialogIcon" class="h-4 w-4" />
                  <span>{{ databaseEncryptionDialogTitle }}</span>
                </DialogTitle>
                <DialogDescription>
                  {{ databaseEncryptionDialogDescription }}
                </DialogDescription>
              </DialogHeader>

              <div class="flex flex-col gap-3 py-2">
                <div v-if="databaseEncryptionAction !== 'enable'" class="flex flex-col gap-1.5">
                  <Label class="text-xs" for="database-current-password">
                    {{ t('settings.data.databaseEncryption.currentPassword') }}
                  </Label>
                  <Input
                    id="database-current-password"
                    v-model="databaseCurrentPassword"
                    :disabled="isDatabaseSecurityBusy"
                    type="password"
                    autocomplete="current-password"
                    class="h-9!"
                    tabindex="1"
                    autofocus
                    @keydown.enter.prevent="submitDatabaseEncryptionDialog"
                  />
                </div>

                <div v-if="databaseEncryptionAction !== 'disable'" class="flex flex-col gap-1.5">
                  <Label class="text-xs" for="database-new-password">
                    {{ t('settings.data.databaseEncryption.newPassword') }}
                  </Label>
                  <Input
                    id="database-new-password"
                    v-model="databaseNewPassword"
                    :disabled="isDatabaseSecurityBusy"
                    type="password"
                    autocomplete="new-password"
                    class="h-9!"
                    :tabindex="databaseEncryptionAction === 'enable' ? 1 : 2"
                    :autofocus="databaseEncryptionAction === 'enable'"
                    @keydown.enter.prevent="submitDatabaseEncryptionDialog"
                  />
                </div>

                <div v-if="databaseEncryptionAction !== 'disable'" class="flex flex-col gap-1.5">
                  <Label class="text-xs" for="database-confirm-password">
                    {{ t('settings.data.databaseEncryption.confirmPassword') }}
                  </Label>
                  <Input
                    id="database-confirm-password"
                    v-model="databaseConfirmPassword"
                    :disabled="isDatabaseSecurityBusy"
                    type="password"
                    autocomplete="new-password"
                    class="h-9!"
                    :tabindex="databaseEncryptionAction === 'enable' ? 2 : 3"
                    @keydown.enter.prevent="submitDatabaseEncryptionDialog"
                  />
                </div>
              </div>

              <p v-if="databasePasswordValidation" class="text-xs text-destructive">
                {{ databasePasswordValidation }}
              </p>
              <p
                v-if="databaseSecurityStatus && !databaseSecurityStatus.safeStorageAvailable"
                class="text-xs text-amber-600 dark:text-amber-400"
              >
                {{ t('settings.data.databaseEncryption.safeStorageUnavailable') }}
              </p>
              <DcInlineError
                v-if="databaseSecurityError"
                :error="databaseSecurityError"
                class="mt-2"
              />

              <DialogFooter class="gap-2 sm:justify-between">
                <DcFormActions
                  :submit-status="databaseSecuritySubmitStatus"
                  :submit-disabled="!canSubmitDatabaseEncryptionDialog"
                  :cancel-disabled="isDatabaseSecurityBusy"
                  :danger-submit="databaseEncryptionAction === 'disable'"
                  :submit-label="databaseEncryptionSubmitLabel"
                  :cancel-label="t('settings.data.databaseEncryption.cancelButton')"
                  submit-test-id="database-encryption-submit"
                  @cancel="closeDatabaseEncryptionDialog"
                  @submit="submitDatabaseEncryptionDialog"
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div class="rounded-xl border border-border bg-card/30 p-4">
        <div class="flex flex-col divide-y divide-border">
          <div
            ref="providerImportSectionRef"
            class="flex flex-col gap-3 py-4 first:pt-0 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:download" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">
                  {{ t('settings.data.providerImport.entryTitle') }}
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.providerImport.entryDescription') }}
                </p>
              </div>
            </div>
            <DcButton
              variant="outline"
              class="w-full shrink-0 lg:w-56"
              :dir="languageStore.dir"
              @click="openProviderImportDialog"
            >
              <Icon icon="lucide:download" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">
                {{ t('settings.data.providerImport.entryButton') }}
              </span>
            </DcButton>
          </div>

          <div
            data-testid="database-repair-section"
            class="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:database" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">{{ t('settings.data.databaseRepair.title') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.databaseRepair.description') }}
                </p>
                <p v-if="repairSummaryText" class="text-xs text-muted-foreground">
                  {{
                    t('settings.data.databaseRepair.lastResultLabel', {
                      result: repairSummaryText
                    })
                  }}
                </p>
                <p v-if="repairManualHintText" class="text-xs text-amber-600 dark:text-amber-400">
                  {{ repairManualHintText }}
                </p>
              </div>
            </div>
            <DcButton
              data-testid="database-repair-button"
              variant="outline"
              class="w-full shrink-0 lg:w-56"
              :disabled="isRepairActionDisabled"
              :dir="languageStore.dir"
              @click="runSchemaRepair()"
            >
              <Spinner v-if="isRepairing" class="size-4 text-muted-foreground" />
              <Icon v-else icon="lucide:wrench" class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">
                {{
                  isRepairing
                    ? t('settings.data.databaseRepair.running')
                    : t('settings.data.databaseRepair.button')
                }}
              </span>
            </DcButton>
          </div>

          <div
            class="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:refresh-cw" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">
                  {{ t('settings.data.modelConfigUpdate.title') }}
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.modelConfigUpdate.descriptionPrefix') }}
                  <a
                    class="inline-flex items-center gap-1 hover:text-primary"
                    :href="PUBLIC_PROVIDER_CONF_URL"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.prevent="openExternalLink(PUBLIC_PROVIDER_CONF_URL)"
                  >
                    <span>{{ t('settings.data.modelConfigUpdate.linkLabel') }}</span>
                    <Icon icon="lucide:external-link" class="h-3.5 w-3.5" />
                  </a>
                  {{ t('settings.data.modelConfigUpdate.descriptionSuffix') }}
                </p>
              </div>
            </div>
            <DcButton
              variant="outline"
              class="w-full shrink-0 lg:w-40"
              :disabled="isUpdatingModelConfig"
              :dir="languageStore.dir"
              @click="handleRefreshProviderDb"
            >
              <Spinner v-if="isUpdatingModelConfig" class="size-4 text-muted-foreground" />
              <Icon v-else icon="lucide:refresh-cw" class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">
                {{
                  isUpdatingModelConfig
                    ? t('settings.data.modelConfigUpdate.updating')
                    : t('settings.data.modelConfigUpdate.button')
                }}
              </span>
            </DcButton>
          </div>

          <div
            class="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:rotate-ccw" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">{{ t('settings.data.dangerZone.title') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.dangerZone.description') }}
                </p>
              </div>
            </div>
            <DcButton
              variant="outline"
              class="w-full shrink-0 justify-center border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive lg:w-40"
              :disabled="isResetActionDisabled"
              :dir="languageStore.dir"
              data-testid="danger-zone-reset-entry"
              aria-haspopup="dialog"
              @click="openResetDialog"
            >
              <Icon icon="lucide:triangle-alert" class="h-4 w-4" />
              <span class="text-sm font-medium">{{ t('settings.data.resetData') }}</span>
            </DcButton>
            <DcConfirmDialog
              :open="isResetDialogOpen"
              :title="t('settings.data.resetConfirmTitle')"
              :description="t('settings.data.resetConfirmDescription')"
              :confirm-label="
                isResetting ? t('settings.data.resetting') : t('settings.data.confirmReset')
              "
              :busy="isResetting"
              :disabled-confirm="isResetActionDisabled"
              :confirm-attrs="{ 'data-testid': 'danger-zone-reset-confirm' }"
              @update:open="handleResetDialogOpenChange"
              @confirm="handleReset"
              @cancel="closeResetDialog"
            >
              <div class="p-4">
                <RadioGroup v-model="resetType" class="flex flex-col gap-3" :disabled="isResetting">
                  <div
                    class="-m-2 flex cursor-pointer items-start space-x-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent"
                    :class="resetType === 'chat' ? 'border-destructive/25 bg-destructive/5' : ''"
                    data-testid="danger-zone-reset-option-chat"
                    @click="selectResetType('chat')"
                  >
                    <RadioGroupItem value="chat" id="reset-chat" class="mt-1" />
                    <div class="flex flex-col">
                      <Label for="reset-chat" class="font-medium">{{
                        t('settings.data.resetChatData')
                      }}</Label>
                      <p class="text-xs text-muted-foreground">
                        {{ t('settings.data.resetChatDataDesc') }}
                      </p>
                    </div>
                  </div>
                  <div
                    class="-m-2 flex cursor-pointer items-start space-x-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent"
                    :class="
                      resetType === 'knowledge' ? 'border-destructive/25 bg-destructive/5' : ''
                    "
                    data-testid="danger-zone-reset-option-knowledge"
                    @click="selectResetType('knowledge')"
                  >
                    <RadioGroupItem value="knowledge" id="reset-knowledge" class="mt-1" />
                    <div class="flex flex-col">
                      <Label for="reset-knowledge" class="font-medium">{{
                        t('settings.data.resetKnowledgeData')
                      }}</Label>
                      <p class="text-xs text-muted-foreground">
                        {{ t('settings.data.resetKnowledgeDataDesc') }}
                      </p>
                    </div>
                  </div>
                  <div
                    class="-m-2 flex cursor-pointer items-start space-x-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent"
                    :class="resetType === 'config' ? 'border-destructive/25 bg-destructive/5' : ''"
                    data-testid="danger-zone-reset-option-config"
                    @click="selectResetType('config')"
                  >
                    <RadioGroupItem value="config" id="reset-config" class="mt-1" />
                    <div class="flex flex-col">
                      <Label for="reset-config" class="font-medium">{{
                        t('settings.data.resetConfig')
                      }}</Label>
                      <p class="text-xs text-muted-foreground">
                        {{ t('settings.data.resetConfigDesc') }}
                      </p>
                    </div>
                  </div>
                  <div
                    class="-m-2 flex cursor-pointer items-start space-x-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent"
                    :class="resetType === 'all' ? 'border-destructive/25 bg-destructive/5' : ''"
                    data-testid="danger-zone-reset-option-all"
                    @click="selectResetType('all')"
                  >
                    <RadioGroupItem value="all" id="reset-all" class="mt-1" />
                    <div class="flex flex-col">
                      <Label for="reset-all" class="font-medium">{{
                        t('settings.data.resetAll')
                      }}</Label>
                      <p class="text-xs text-muted-foreground">
                        {{ t('settings.data.resetAllDesc') }}
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            </DcConfirmDialog>
          </div>

          <div
            data-testid="yobrowser-sandbox-section"
            class="flex flex-col gap-3 pt-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:shield" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">{{ t('settings.data.yoBrowser.title') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.yoBrowser.description') }}
                </p>
              </div>
            </div>
            <div class="flex w-full shrink-0 flex-col gap-2 lg:w-56">
              <BrowserDataImportDialog />
              <DcButton
                variant="outline"
                class="w-full shrink-0 lg:w-56"
                :loading="isClearingSandbox"
                icon="lucide:trash-2"
                data-testid="yobrowser-clear-sandbox-button"
                :disabled="isClearingSandbox"
                @click="isClearSandboxDialogOpen = true"
              >
                <span class="text-sm font-medium">
                  {{
                    isClearingSandbox
                      ? t('settings.data.yoBrowser.clearing')
                      : t('settings.data.yoBrowser.clearButton')
                  }}
                </span>
              </DcButton>
              <DcConfirmDialog
                :open="isClearSandboxDialogOpen"
                :title="t('settings.data.yoBrowser.confirmTitle')"
                :description="t('settings.data.yoBrowser.confirmDescription')"
                :confirm-label="
                  isClearingSandbox
                    ? t('settings.data.yoBrowser.clearing')
                    : t('settings.data.yoBrowser.confirmAction')
                "
                :busy="isClearingSandbox"
                :confirm-attrs="{ 'data-testid': 'yobrowser-clear-sandbox-confirm' }"
                @update:open="handleClearSandboxDialogOpenChange"
                @confirm="handleClearSandboxData"
              >
                <p v-if="sandboxClearFailed" role="alert" class="text-sm text-destructive">
                  {{ t('settings.data.yoBrowser.clearFailedTitle') }}
                </p>
              </DcConfirmDialog>
            </div>
          </div>
        </div>
      </div>

      <ProviderConfigImportDialog
        v-model:open="isProviderImportDialogOpen"
        @import-complete="handleProviderImportComplete"
      />

      <AlertDialog :open="!!syncStore.importResult && !syncStore.importResult?.success">
        <AlertDialogContent class="w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('settings.data.importErrorTitle') }}</AlertDialogTitle>
            <AlertDialogDescription
              data-testid="sync-error-dialog-description"
              class="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words pr-1 text-left"
            >
              {{ importErrorDescription }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter data-testid="sync-error-dialog-footer" class="shrink-0">
            <AlertDialogAction data-testid="sync-error-dialog-confirm" @click="handleAlertAction">
              {{ t('dialog.ok') }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProviderImportApplyResult } from '@shared/providerImport'
import type { DatabaseRepairReport, DatabaseSecurityStatus } from '@shared/contracts/routes'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { DcButton } from '@dc-ui/components/button'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import { Input } from '@shadcn/components/ui/input'
import { Switch } from '@shadcn/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useSyncStore } from '@/stores/sync'
import { useLanguageStore } from '@/stores/language'
import { createBrowserClient } from '@api/BrowserClient'
import { createConfigClient } from '@api/ConfigClient'
import { createDeviceClient } from '@api/DeviceClient'
import { createOnboardingClient } from '@api/OnboardingClient'
import { createDatabaseSecurityClient } from '@api/DatabaseSecurityClient'
import { cn } from '@/lib/utils'
import {
  CLOUD_SYNC_DEFAULTS,
  buildCloudSyncConfigInput,
  createDefaultCloudSyncForm,
  validateCloudSyncForm,
  type CloudSyncProviderMode
} from '@/lib/cloudSyncForm'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import PrivacySettingsSection from './common/PrivacySettingsSection.vue'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import ProviderConfigImportDialog from './ProviderConfigImportDialog.vue'
import BrowserDataImportDialog from './BrowserDataImportDialog.vue'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const PROVIDER_IMPORT_SECTION = 'provider-import'
const DATABASE_REPAIR_SECTION = 'database-repair'
const SETTINGS_SECTION_EVENT = 'deepchat:settings-section'
const PUBLIC_PROVIDER_CONF_URL = 'https://github.com/ThinkInAIXYZ/PublicProviderConf'
const CLOUDFLARE_R2_S3_DOCS_URL = 'https://developers.cloudflare.com/r2/get-started/s3/'

type SettingsWindowState = Window & {
  __deepchatSettingsPendingSection?: string | null
}

type PresenterErrorResult = {
  error: string
}

const isPresenterError = (value: unknown): value is PresenterErrorResult => {
  return typeof value === 'object' && value !== null && 'error' in value
}

const { t } = useI18n()
const languageStore = useLanguageStore()
const syncStore = useSyncStore()
const browserClient = createBrowserClient()
const configClient = createConfigClient()
const deviceClient = createDeviceClient()
const onboardingClient = createOnboardingClient()
const databaseSecurityClient = createDatabaseSecurityClient()
const {
  backups: backupsRef,
  isBackingUp: isBackingUpRef,
  isImporting: isImportingRef,
  cloudConfig,
  isCloudBusy
} = storeToRefs(syncStore)

const isImportDialogOpen = ref(false)
const isProviderImportDialogOpen = ref(false)
const importMode = ref('increment')
const selectedBackup = ref('')
const providerImportSectionRef = ref<HTMLElement | null>(null)

const isResetDialogOpen = ref(false)
const resetType = ref<'chat' | 'knowledge' | 'config' | 'all'>('chat')
const isResetting = ref(false)
const isUpdatingModelConfig = ref(false)
const isClearingSandbox = ref(false)
const sandboxClearFailed = ref(false)
const isClearSandboxDialogOpen = ref(false)
const isRepairing = ref(false)
const lastRepairReport = ref<DatabaseRepairReport | null>(null)
const databaseSecurityStatus = ref<DatabaseSecurityStatus | null>(null)
const isDatabaseSecurityStatusLoaded = ref(false)
const hasDatabaseSecurityStatusError = ref(false)
const isDatabaseSecurityBusy = ref(false)
const isDatabaseEncryptionDialogOpen = ref(false)
const databaseEncryptionAction = ref<'enable' | 'change' | 'disable'>('enable')
const databaseCurrentPassword = ref('')
const databaseNewPassword = ref('')
const databaseConfirmPassword = ref('')
const isBackupActive = computed(() => isBackingUpRef.value)
const isImporting = computed(() => isImportingRef.value)
const isSyncFeedbackPending = ref(false)
const isCloudFeedbackPending = ref(false)
const cloudOperationError = ref<string | null>(null)
const databaseSecurityError = ref<string | null>(null)
const { status: cloudSaveStatus, run: runCloudSave } = useDcFormSubmit()
const { status: cloudSaveTestStatus, run: runCloudSaveTest } = useDcFormSubmit()
const { status: databaseSecuritySubmitStatus, run: runDatabaseSecuritySubmit } = useDcFormSubmit()
const syncInitializationFailed = ref(false)
const isSyncOperationBusy = computed(
  () => isBackupActive.value || isImporting.value || isSyncFeedbackPending.value
)
const isSyncInteractionDisabled = computed(
  () => isSyncOperationBusy.value || syncInitializationFailed.value
)
const isRepairActionDisabled = computed(() => {
  return isRepairing.value || isBackupActive.value || isImporting.value
})
const isResetActionDisabled = computed(() => {
  return isResetting.value || isBackupActive.value || isImporting.value
})
const importErrorDescription = computed(() => {
  const message = syncStore.importResult?.message
  if (message && /^sync\.[a-zA-Z0-9_.-]+$/.test(message)) {
    return t(message, { count: syncStore.importResult?.count || 0 })
  }
  return t('sync.error.importFailed')
})
const databasePasswordValidation = computed(() => {
  if (databaseEncryptionAction.value === 'disable') {
    return ''
  }
  if (!databaseNewPassword.value && !databaseConfirmPassword.value) {
    return ''
  }
  if (databaseNewPassword.value !== databaseConfirmPassword.value) {
    return t('settings.data.databaseEncryption.passwordMismatch')
  }
  return ''
})
const isDatabaseSecurityActionDisabled = computed(() => {
  return (
    !isDatabaseSecurityStatusLoaded.value ||
    hasDatabaseSecurityStatusError.value ||
    isDatabaseSecurityBusy.value ||
    isBackupActive.value ||
    isImporting.value ||
    Boolean(databaseSecurityStatus.value?.migrationInProgress)
  )
})
const canEnableDatabaseEncryption = computed(() => {
  return (
    !isDatabaseSecurityActionDisabled.value &&
    !databaseSecurityStatus.value?.enabled &&
    Boolean(databaseNewPassword.value) &&
    databaseNewPassword.value === databaseConfirmPassword.value
  )
})
const canChangeDatabasePassword = computed(() => {
  return (
    !isDatabaseSecurityActionDisabled.value &&
    Boolean(databaseSecurityStatus.value?.enabled) &&
    Boolean(databaseCurrentPassword.value) &&
    Boolean(databaseNewPassword.value) &&
    databaseNewPassword.value === databaseConfirmPassword.value
  )
})
const canDisableDatabaseEncryption = computed(() => {
  return (
    !isDatabaseSecurityActionDisabled.value &&
    Boolean(databaseSecurityStatus.value?.enabled) &&
    Boolean(databaseCurrentPassword.value)
  )
})
const canSubmitDatabaseEncryptionDialog = computed(() => {
  if (databaseEncryptionAction.value === 'enable') {
    return canEnableDatabaseEncryption.value
  }
  if (databaseEncryptionAction.value === 'change') {
    return canChangeDatabasePassword.value
  }
  return canDisableDatabaseEncryption.value
})
const databaseEncryptionDialogIcon = computed(() => {
  if (databaseEncryptionAction.value === 'enable') {
    return 'lucide:lock-keyhole'
  }
  if (databaseEncryptionAction.value === 'change') {
    return 'lucide:key-round'
  }
  return 'lucide:shield-off'
})
const databaseEncryptionDialogTitle = computed(() => {
  if (databaseEncryptionAction.value === 'enable') {
    return t('settings.data.databaseEncryption.enableDialogTitle')
  }
  if (databaseEncryptionAction.value === 'change') {
    return t('settings.data.databaseEncryption.changeDialogTitle')
  }
  return t('settings.data.databaseEncryption.disableDialogTitle')
})
const databaseEncryptionDialogDescription = computed(() => {
  if (databaseEncryptionAction.value === 'enable') {
    return t('settings.data.databaseEncryption.enableDialogDescription')
  }
  if (databaseEncryptionAction.value === 'change') {
    return t('settings.data.databaseEncryption.changeDialogDescription')
  }
  return t('settings.data.databaseEncryption.disableDialogDescription')
})
const databaseEncryptionSubmitLabel = computed(() => {
  if (databaseEncryptionAction.value === 'enable') {
    return t('settings.data.databaseEncryption.enableButton')
  }
  if (databaseEncryptionAction.value === 'change') {
    return t('settings.data.databaseEncryption.changeButton')
  }
  return t('settings.data.databaseEncryption.disableButton')
})
const databaseSecurityUnknownLabel = computed(() => t('settings.data.databaseEncryption.unknown'))
const databaseSecurityLoadingLabel = computed(() => t('settings.data.databaseEncryption.loading'))
const databaseSecurityHasNoStatus = computed(() => !databaseSecurityStatus.value)
const databaseSecurityStatusLabel = computed(() => {
  const status = databaseSecurityStatus.value
  if (hasDatabaseSecurityStatusError.value && !status) {
    return databaseSecurityUnknownLabel.value
  }
  if (!status) {
    return databaseSecurityLoadingLabel.value
  }
  return status.enabled
    ? t('settings.data.databaseEncryption.enabled')
    : t('settings.data.databaseEncryption.disabled')
})
const databaseCipherLabel = computed(() => {
  const status = databaseSecurityStatus.value
  if (hasDatabaseSecurityStatusError.value && !status) {
    return databaseSecurityUnknownLabel.value
  }
  if (!status) {
    return databaseSecurityLoadingLabel.value
  }
  return status.cipher
})
const systemUnlockLabel = computed(() => {
  const status = databaseSecurityStatus.value
  if (hasDatabaseSecurityStatusError.value && !status) {
    return databaseSecurityUnknownLabel.value
  }
  if (!status) {
    return databaseSecurityLoadingLabel.value
  }
  return status.safeStorageAvailable
    ? t('settings.data.databaseEncryption.systemUnlockAvailable')
    : t('settings.data.databaseEncryption.systemUnlockUnavailable')
})
const startupUnlockLabel = computed(() => {
  const status = databaseSecurityStatus.value
  if (hasDatabaseSecurityStatusError.value && !status) {
    return databaseSecurityUnknownLabel.value
  }
  if (!status) {
    return databaseSecurityLoadingLabel.value
  }
  if (!status.enabled) {
    return t('settings.data.databaseEncryption.notRequired')
  }
  return status.manualUnlockRequired
    ? t('settings.data.databaseEncryption.manualUnlock')
    : t('settings.data.databaseEncryption.systemUnlockMode')
})
const lastDatabaseMigrationLabel = computed(() => {
  if (hasDatabaseSecurityStatusError.value && databaseSecurityHasNoStatus.value) {
    return databaseSecurityUnknownLabel.value
  }
  if (databaseSecurityHasNoStatus.value) {
    return databaseSecurityLoadingLabel.value
  }
  const lastMigrationAt = databaseSecurityStatus.value?.lastMigrationAt
  if (!lastMigrationAt) {
    return t('settings.data.never')
  }
  return new Date(lastMigrationAt).toLocaleString()
})

const syncEnabled = computed(() => syncStore.syncEnabled)
const syncFolderPath = computed(() => syncStore.syncFolderPath)

const beginSyncOperation = () => {
  syncInitializationFailed.value = false
  isSyncFeedbackPending.value = true
}

const handleSyncEnabledChange = async (value: boolean) => {
  if (isSyncInteractionDisabled.value || value === syncStore.syncEnabled) return
  beginSyncOperation()
  try {
    await syncStore.setSyncEnabled(value)
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.sync.updated',
      title: t('common.saved')
    })
  } catch (error) {
    console.error('[DataSettings] Failed to update sync state', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.sync.updateFailed',
      title: t('common.error.operationFailed')
    })
  } finally {
    isSyncFeedbackPending.value = false
  }
}

const handleSelectSyncFolder = async () => {
  if (!syncStore.syncEnabled || isSyncInteractionDisabled.value) return
  beginSyncOperation()
  try {
    const selected = await syncStore.selectSyncFolder()
    if (!selected) {
      isSyncFeedbackPending.value = false
      return
    }
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.sync.folderUpdated',
      title: t('common.saved')
    })
  } catch (error) {
    console.error('[DataSettings] Failed to select sync folder', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.sync.folderUpdateFailed',
      title: t('common.error.operationFailed')
    })
  } finally {
    isSyncFeedbackPending.value = false
  }
}

const handleOpenSyncFolder = async () => {
  if (!syncStore.syncEnabled || isSyncInteractionDisabled.value) return
  beginSyncOperation()
  try {
    await syncStore.openSyncFolder()
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.sync.folderOpened',
      title: t('settings.data.openSyncFolder')
    })
  } catch (error) {
    console.error('[DataSettings] Failed to open sync folder', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.sync.folderOpenFailed',
      title: t('common.error.operationFailed')
    })
  } finally {
    isSyncFeedbackPending.value = false
  }
}

// === Cloud sync (S3-compatible) ===
const cloudProviderMode = ref<CloudSyncProviderMode>('r2')
const cloudPullMode = ref<'increment' | 'overwrite'>('increment')
const cloudForm = ref(createDefaultCloudSyncForm())
const cloudCommittedSignature = ref('')
const cloudFormInitialized = ref(false)

const setCloudProviderMode = (mode: CloudSyncProviderMode) => {
  cloudProviderMode.value = mode
  if (mode === 'r2') {
    cloudForm.value.region = cloudForm.value.region.trim() || CLOUD_SYNC_DEFAULTS.region
    cloudForm.value.prefix = cloudForm.value.prefix.trim() || CLOUD_SYNC_DEFAULTS.prefix
  }
}

const cloudFormSignature = computed(() =>
  JSON.stringify(buildCloudSyncConfigInput(cloudForm.value))
)
const cloudFormDirty = computed(
  () => cloudFormInitialized.value && cloudFormSignature.value !== cloudCommittedSignature.value
)

const applyCloudConfig = (config: NonNullable<typeof cloudConfig.value>) => {
  cloudForm.value.endpoint = config.endpoint
  cloudForm.value.bucket = config.bucket
  cloudForm.value.region = config.region || CLOUD_SYNC_DEFAULTS.region
  cloudForm.value.prefix = config.prefix || CLOUD_SYNC_DEFAULTS.prefix
  cloudForm.value.accessKeyId = config.accessKeyId
  cloudForm.value.secretAccessKey = ''
  cloudCommittedSignature.value = cloudFormSignature.value
  cloudFormInitialized.value = true
}

watch(
  cloudConfig,
  (config) => {
    if (!config) {
      return
    }
    applyCloudConfig(config)
  },
  { immediate: true }
)

const hasStoredCloudSecret = computed(() => Boolean(cloudConfig.value?.hasSecret))
const cloudValidation = computed(() =>
  validateCloudSyncForm(cloudForm.value, {
    providerMode: cloudProviderMode.value,
    hasStoredSecret: hasStoredCloudSecret.value
  })
)
const isCloudSecretWriteUnavailable = computed(
  () =>
    Boolean(cloudForm.value.secretAccessKey.trim()) &&
    cloudConfig.value?.safeStorageAvailable === false
)
const isCloudInteractionDisabled = computed(() => Boolean(isCloudBusy.value) || !cloudConfig.value)
const isCloudSaveDisabled = computed(
  () =>
    isCloudInteractionDisabled.value ||
    isCloudFeedbackPending.value ||
    cloudSaveStatus.value === 'submitting' ||
    cloudSaveTestStatus.value === 'submitting' ||
    !cloudValidation.value.canSave ||
    isCloudSecretWriteUnavailable.value
)
const hasUsableCloudConfig = computed(() =>
  Boolean(
    cloudConfig.value?.endpoint?.trim() &&
    cloudConfig.value?.bucket?.trim() &&
    cloudConfig.value?.accessKeyId?.trim() &&
    cloudConfig.value?.hasSecret
  )
)
const isCloudOperationDisabled = computed(
  () =>
    isCloudInteractionDisabled.value ||
    isCloudFeedbackPending.value ||
    cloudSaveStatus.value === 'submitting' ||
    cloudSaveTestStatus.value === 'submitting' ||
    !hasUsableCloudConfig.value
)
const cloudSecretPlaceholder = computed(() =>
  hasStoredCloudSecret.value ? t('settings.data.cloudSync.secretConfigured') : ''
)
const cloudSecretStatusText = computed(() => {
  if (hasStoredCloudSecret.value && !cloudForm.value.secretAccessKey) {
    return t('settings.data.cloudSync.secretStoredDescription')
  }
  return t('settings.data.cloudSync.secretInputDescription')
})

const persistCloudConfig = async (): Promise<boolean> => {
  if (isCloudBusy.value || !cloudValidation.value.canSave || isCloudSecretWriteUnavailable.value) {
    return false
  }
  await syncStore.saveCloudConfig(buildCloudSyncConfigInput(cloudForm.value))
  cloudForm.value.secretAccessKey = ''
  cloudCommittedSignature.value = cloudFormSignature.value
  cloudFormInitialized.value = true
  return true
}

const cloudResultDescription = (message: string | undefined): string | undefined => {
  return message && /^sync\.[a-zA-Z0-9_.-]+$/.test(message) ? t(message) : undefined
}

const handleSaveCloud = () => {
  if (isCloudSaveDisabled.value) return
  isCloudFeedbackPending.value = true
  cloudOperationError.value = null
  void runCloudSave(async () => {
    if (!(await persistCloudConfig())) {
      throw new Error('cloud save aborted')
    }
  })
    .catch((error: unknown) => {
      console.error('[DataSettings] Failed to save cloud config', error)
      cloudOperationError.value = t('common.error.operationFailed')
    })
    .finally(() => {
      isCloudFeedbackPending.value = false
    })
}

const handleSaveAndTestCloud = () => {
  if (isCloudSaveDisabled.value) return
  isCloudFeedbackPending.value = true
  cloudOperationError.value = null
  void runCloudSaveTest(async () => {
    if (!(await persistCloudConfig())) {
      throw new Error('cloud save aborted')
    }
    const result = await syncStore.testCloud()
    if (!result?.success) {
      throw new Error(t('settings.data.cloudSync.testFailedTitle'))
    }
  })
    .catch((error: unknown) => {
      console.error('[DataSettings] Failed to save or test cloud config', error)
      cloudOperationError.value = t('settings.data.cloudSync.testFailedTitle')
    })
    .finally(() => {
      isCloudFeedbackPending.value = false
    })
}

const handleUploadToCloud = async () => {
  if (isCloudOperationDisabled.value) return
  isCloudFeedbackPending.value = true
  try {
    const result = await syncStore.uploadToCloud()
    if (!result?.success) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.data.cloud.uploadFailed',
        title: t('settings.data.cloudSync.uploadFailedTitle'),
        description: cloudResultDescription(result?.message)
      })
      return
    }
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.cloud.uploadSucceeded',
      title: t('settings.data.cloudSync.uploadSuccessTitle')
    })
  } catch (error) {
    console.error('[DataSettings] Failed to upload cloud backup', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.cloud.uploadFailed',
      title: t('settings.data.cloudSync.uploadFailedTitle')
    })
  } finally {
    isCloudFeedbackPending.value = false
  }
}

const handlePullFromCloud = async () => {
  if (isCloudOperationDisabled.value) return
  isCloudFeedbackPending.value = true
  try {
    const result = await syncStore.pullFromCloud(cloudPullMode.value)
    if (!result?.success) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.data.cloud.pullFailed',
        title: t('settings.data.importErrorTitle')
      })
      return
    }
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.cloud.pullSucceeded',
      title: t('settings.data.cloudSync.pullSuccessTitle'),
      description: cloudResultDescription(result.message)
    })
  } catch (error) {
    console.error('[DataSettings] Failed to pull cloud backup', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.cloud.pullFailed',
      title: t('settings.data.importErrorTitle')
    })
  } finally {
    isCloudFeedbackPending.value = false
  }
}

const clearDatabasePasswordFields = () => {
  databaseCurrentPassword.value = ''
  databaseNewPassword.value = ''
  databaseConfirmPassword.value = ''
}

const openDatabaseEncryptionDialog = (action: 'enable' | 'change' | 'disable') => {
  if (isDatabaseSecurityActionDisabled.value) {
    return
  }
  databaseEncryptionAction.value = action
  clearDatabasePasswordFields()
  isDatabaseEncryptionDialogOpen.value = true
}

const closeDatabaseEncryptionDialog = () => {
  if (isDatabaseSecurityBusy.value) {
    return
  }
  isDatabaseEncryptionDialogOpen.value = false
  clearDatabasePasswordFields()
}

const handleDatabaseEncryptionDialogOpenChange = (open: boolean) => {
  if (open) {
    isDatabaseEncryptionDialogOpen.value = true
    return
  }
  closeDatabaseEncryptionDialog()
}

const refreshDatabaseSecurityStatus = async () => {
  hasDatabaseSecurityStatusError.value = false
  try {
    databaseSecurityStatus.value = await databaseSecurityClient.getStatus()
    isDatabaseSecurityStatusLoaded.value = true
  } catch (error) {
    console.error('[DataSettings] Failed to load database encryption status', error)
    isDatabaseSecurityStatusLoaded.value = Boolean(databaseSecurityStatus.value)
    hasDatabaseSecurityStatusError.value = true
  }
}

const runDatabaseSecurityAction = (action: () => Promise<DatabaseSecurityStatus>) => {
  if (isDatabaseSecurityBusy.value) return
  databaseSecurityError.value = null
  void runDatabaseSecuritySubmit(async () => {
    isDatabaseSecurityBusy.value = true
    try {
      databaseSecurityStatus.value = await action()
      isDatabaseSecurityStatusLoaded.value = true
      hasDatabaseSecurityStatusError.value = false
      clearDatabasePasswordFields()
      isDatabaseEncryptionDialogOpen.value = false
    } finally {
      isDatabaseSecurityBusy.value = false
    }
  }).catch((error: unknown) => {
    console.error('[DataSettings] Database encryption action failed', error)
    databaseSecurityError.value = t('settings.data.databaseEncryption.failedTitle')
  })
}

const enableDatabaseEncryption = async () => {
  if (!canEnableDatabaseEncryption.value) {
    return
  }
  await runDatabaseSecurityAction(() => databaseSecurityClient.enable(databaseNewPassword.value))
}

const changeDatabasePassword = async () => {
  if (!canChangeDatabasePassword.value) {
    return
  }
  await runDatabaseSecurityAction(() =>
    databaseSecurityClient.changePassword(databaseCurrentPassword.value, databaseNewPassword.value)
  )
}

const disableDatabaseEncryption = async () => {
  if (!canDisableDatabaseEncryption.value) {
    return
  }
  await runDatabaseSecurityAction(() =>
    databaseSecurityClient.disable(databaseCurrentPassword.value)
  )
}

const submitDatabaseEncryptionDialog = async () => {
  if (!canSubmitDatabaseEncryptionDialog.value) {
    return
  }
  if (databaseEncryptionAction.value === 'enable') {
    await enableDatabaseEncryption()
    return
  }
  if (databaseEncryptionAction.value === 'change') {
    await changeDatabasePassword()
    return
  }
  await disableDatabaseEncryption()
}

const repairSummaryText = computed(() => {
  const report = lastRepairReport.value
  if (!report) {
    return ''
  }

  if (report.status === 'healthy') {
    return t('settings.data.databaseRepair.summaryHealthy')
  }

  const repairedCount = report.repairedIssues.length
  const manualCount = report.remainingIssues.length

  if (manualCount > 0 && repairedCount > 0) {
    return t('settings.data.databaseRepair.summaryRepairedWithManual', {
      repaired: repairedCount,
      manual: manualCount
    })
  }

  if (manualCount > 0) {
    return t('settings.data.databaseRepair.summaryManualOnly', {
      manual: manualCount
    })
  }

  return t('settings.data.databaseRepair.summaryRepaired', {
    count: repairedCount
  })
})

const repairManualHintText = computed(() => {
  const report = lastRepairReport.value
  if (!report || report.remainingIssues.length === 0) {
    return ''
  }

  return t('settings.data.databaseRepair.manualHint', {
    count: report.remainingIssues.length
  })
})

const consumePendingSection = (section: string): boolean => {
  const state = window as SettingsWindowState
  if (state.__deepchatSettingsPendingSection !== section) {
    return false
  }

  state.__deepchatSettingsPendingSection = null
  return true
}

const openProviderImportDialog = () => {
  providerImportSectionRef.value?.scrollIntoView({
    block: 'center',
    behavior: 'smooth'
  })
  isProviderImportDialogOpen.value = true
}

const handleProviderImportComplete = (result: ProviderImportApplyResult) => {
  if (result.summary.imported > 0) {
    void completeProviderImportOnboardingSteps(result)
  }
}

const completeProviderImportOnboardingSteps = async (result: ProviderImportApplyResult) => {
  try {
    const state = await onboardingClient.getState()
    if (state.status !== 'active') {
      return
    }

    const importedResults = result.results.filter((item) =>
      ['created', 'updated', 'overwritten'].includes(item.status)
    )
    await onboardingClient.setStepStatus({ stepId: 'select-provider', status: 'completed' })
    await onboardingClient.setStepStatus({ stepId: 'provider-api-key', status: 'completed' })
    if (importedResults.some((item) => item.modelCount > 0)) {
      await onboardingClient.setStepStatus({ stepId: 'provider-model', status: 'completed' })
    }
  } catch (error) {
    console.error('[DataSettings] Failed to complete provider import onboarding steps', error)
  }
}

const openExternalLink = (url: string) => {
  void browserClient.openExternal(url).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
  })
}

const runSchemaRepair = async () => {
  if (isRepairActionDisabled.value) {
    return
  }

  isRepairing.value = true

  try {
    const result = await databaseSecurityClient.repairSchema()
    if (isPresenterError(result) || !result) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.data.databaseRepair.failed',
        title: t('settings.data.databaseRepair.toastFailedTitle'),
        description: t('settings.data.databaseRepair.toastFailedDescription')
      })
      return
    }

    lastRepairReport.value = result
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.databaseRepair.completed',
      title: repairSummaryText.value
    })
  } catch (error) {
    console.error('[DataSettings] Failed to repair database schema', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.databaseRepair.failed',
      title: t('settings.data.databaseRepair.toastFailedTitle'),
      description: t('settings.data.databaseRepair.toastFailedDescription')
    })
  } finally {
    isRepairing.value = false
  }
}

const handleSettingsSectionNavigation = (event: Event) => {
  const detail = (event as CustomEvent<{ section?: string }>).detail
  if (detail?.section === PROVIDER_IMPORT_SECTION) {
    ;(window as SettingsWindowState).__deepchatSettingsPendingSection = null
    openProviderImportDialog()
    return
  }

  if (detail?.section !== DATABASE_REPAIR_SECTION || isRepairActionDisabled.value) {
    return
  }

  ;(window as SettingsWindowState).__deepchatSettingsPendingSection = null
  void runSchemaRepair()
}

const dataOperationBusy = computed(
  () =>
    isBackupActive.value ||
    isImporting.value ||
    isCloudBusy.value ||
    isDatabaseSecurityBusy.value ||
    isRepairing.value ||
    isUpdatingModelConfig.value ||
    isResetting.value ||
    isClearingSandbox.value ||
    isSyncFeedbackPending.value ||
    isCloudFeedbackPending.value
)
const databaseSecurityDraftDirty = computed(
  () =>
    isDatabaseEncryptionDialogOpen.value &&
    Boolean(
      databaseCurrentPassword.value || databaseNewPassword.value || databaseConfirmPassword.value
    )
)
const dataDraftDirty = computed(() => cloudFormDirty.value || databaseSecurityDraftDirty.value)

watch(isClearSandboxDialogOpen, (open) => {
  if (!open) sandboxClearFailed.value = false
})

const discardDataDrafts = () => {
  if (cloudConfig.value) {
    applyCloudConfig(cloudConfig.value)
  } else {
    cloudForm.value = createDefaultCloudSyncForm()
    cloudCommittedSignature.value = cloudFormSignature.value
    cloudFormInitialized.value = true
  }
  clearDatabasePasswordFields()
  isDatabaseEncryptionDialogOpen.value = false
  isImportDialogOpen.value = false
  isResetDialogOpen.value = false
  isClearSandboxDialogOpen.value = false
}

const dataLeaveGuardLease = settingsLeaveGuard.register({
  id: 'settings-data-operations',
  onDiscard: discardDataDrafts
})
const stopDataLeaveRiskSync = watch(
  [dataOperationBusy, dataDraftDirty],
  ([busy, dirty]) => {
    dataLeaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

const initializeSyncSettings = async () => {
  if (isSyncFeedbackPending.value) return
  beginSyncOperation()
  try {
    await syncStore.initialize()
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.sync.initialized',
      title: t('settings.data.syncFolder')
    })
  } catch (error) {
    syncInitializationFailed.value = true
    console.error('[DataSettings] Failed to initialize sync settings', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.sync.initializeFailed',
      title: t('common.error.operationFailed')
    })
  } finally {
    isSyncFeedbackPending.value = false
  }
}

onMounted(async () => {
  await initializeSyncSettings()
  await refreshDatabaseSecurityStatus()
  window.addEventListener(SETTINGS_SECTION_EVENT, handleSettingsSectionNavigation as EventListener)

  if (consumePendingSection(PROVIDER_IMPORT_SECTION)) {
    openProviderImportDialog()
  }

  if (!isRepairActionDisabled.value && consumePendingSection(DATABASE_REPAIR_SECTION)) {
    void runSchemaRepair()
  }
})

onBeforeUnmount(() => {
  stopDataLeaveRiskSync()
  dataLeaveGuardLease.release()
  window.removeEventListener(
    SETTINGS_SECTION_EVENT,
    handleSettingsSectionNavigation as EventListener
  )
})

const availableBackups = computed(() => backupsRef.value || [])

watch(availableBackups, (backups) => {
  if (!backups.length) {
    selectedBackup.value = ''
    return
  }
  if (!selectedBackup.value || !backups.find((item) => item.fileName === selectedBackup.value)) {
    selectedBackup.value = backups[0].fileName
  }
})

watch(isImportDialogOpen, async (open) => {
  if (open) {
    await syncStore.refreshBackups()
    if (availableBackups.value.length > 0) {
      selectedBackup.value = availableBackups.value[0].fileName
    } else {
      selectedBackup.value = ''
    }
  }
})

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

const formatBackupLabel = (fileName: string, createdAt: number, size: number) => {
  const date = new Date(createdAt)
  const formatted = Number.isFinite(createdAt)
    ? `${date.toLocaleString()} (${formatBytes(size)})`
    : `${fileName} (${formatBytes(size)})`
  return formatted
}

const handleBackup = async () => {
  if (!syncStore.syncEnabled || isSyncInteractionDisabled.value) return
  try {
    const backupInfo = await syncStore.startBackup()
    if (!backupInfo) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.data.sync.backupFailed',
        title: t('common.error.operationFailed')
      })
      return
    }
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.sync.backupSucceeded',
      title: t('settings.data.toast.backupSuccessTitle')
    })
  } catch (error) {
    console.error('[DataSettings] Backup failed', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.sync.backupFailed',
      title: t('common.error.operationFailed')
    })
  }
}

const handleRefreshProviderDb = async () => {
  if (isUpdatingModelConfig.value) return

  isUpdatingModelConfig.value = true
  try {
    const result = await configClient.refreshProviderDb(true)

    if (!result || result.status === 'error') {
      console.error('[DataSettings] Failed to refresh provider DB', {
        status: result?.status ?? 'missing'
      })
      notifyRenderer({
        kind: 'error',
        code: 'settings.data.modelConfig.updateFailed',
        title: t('settings.data.modelConfigUpdate.failedTitle'),
        description: t('settings.data.modelConfigUpdate.failedDescription')
      })
      return
    }

    const isUpToDate = result.status === 'not-modified' || result.status === 'skipped'
    notifyRenderer({
      kind: 'success',
      code: isUpToDate ? 'settings.data.modelConfig.upToDate' : 'settings.data.modelConfig.updated',
      title: t(
        isUpToDate
          ? 'settings.data.modelConfigUpdate.upToDateTitle'
          : 'settings.data.modelConfigUpdate.updatedTitle'
      ),
      description: t(
        isUpToDate
          ? 'settings.data.modelConfigUpdate.upToDateDescription'
          : 'settings.data.modelConfigUpdate.updatedDescription'
      )
    })
  } catch (error) {
    console.error('[DataSettings] Failed to refresh provider DB', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.modelConfig.updateFailed',
      title: t('settings.data.modelConfigUpdate.failedTitle'),
      description: t('settings.data.modelConfigUpdate.failedDescription')
    })
  } finally {
    isUpdatingModelConfig.value = false
  }
}

const closeImportDialog = () => {
  if (syncStore.isImporting) return
  isImportDialogOpen.value = false
  importMode.value = 'increment'
}

const handleImportDialogOpenChange = (open: boolean) => {
  if (open) {
    isImportDialogOpen.value = true
    return
  }
  closeImportDialog()
}

const handleImport = async () => {
  if (!selectedBackup.value || isSyncInteractionDisabled.value) return
  beginSyncOperation()
  try {
    const result = await syncStore.importData(
      selectedBackup.value,
      importMode.value as 'increment' | 'overwrite'
    )
    if (!result) {
      isSyncFeedbackPending.value = false
      return
    }
    if (result.success) {
      notifyRenderer({
        kind: 'success',
        code: 'settings.data.sync.importSucceeded',
        title: t('settings.data.importSuccessTitle'),
        description: t(result.message, {
          count: result.count ?? 0
        })
      })
    } else {
      notifyRenderer({
        kind: 'error',
        code: 'settings.data.sync.importFailed',
        title: t('settings.data.importErrorTitle')
      })
    }
    closeImportDialog()
  } catch (error) {
    console.error('[DataSettings] Import failed', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.sync.importFailed',
      title: t('settings.data.importErrorTitle')
    })
  } finally {
    isSyncFeedbackPending.value = false
  }
}

const handleAlertAction = () => {
  syncStore.clearImportResult()
}

const closeResetDialog = () => {
  if (isResetting.value) return
  isResetDialogOpen.value = false
  resetType.value = 'chat'
}

const handleResetDialogOpenChange = (open: boolean) => {
  if (isResetting.value) return
  if (open) {
    isResetDialogOpen.value = true
    return
  }
  closeResetDialog()
}

const openResetDialog = () => {
  if (isResetActionDisabled.value) {
    return
  }

  resetType.value = 'chat'
  isResetDialogOpen.value = true
}

const selectResetType = (type: typeof resetType.value) => {
  if (isResetting.value) return
  resetType.value = type
}

const handleReset = async () => {
  if (isResetActionDisabled.value) return

  const selectedResetType = resetType.value
  isResetting.value = true
  try {
    await deviceClient.resetDataByType(selectedResetType)
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.reset.completed',
      title: t('settings.data.resetData')
    })
    isResetDialogOpen.value = false
    resetType.value = 'chat'
  } catch (error) {
    console.error('[DataSettings] Failed to reset data', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.data.reset.failed',
      title: t('common.error.operationFailed')
    })
  } finally {
    isResetting.value = false
  }
}

const handleClearSandboxData = async () => {
  if (isClearingSandbox.value) return

  sandboxClearFailed.value = false
  isClearingSandbox.value = true
  try {
    await browserClient.clearSandboxData()
    notifyRenderer({
      kind: 'success',
      code: 'settings.data.sandbox.cleared',
      title: t('settings.data.yoBrowser.clearedTitle'),
      description: t('settings.data.yoBrowser.clearedDescription')
    })
    isClearSandboxDialogOpen.value = false
  } catch (error) {
    console.error('[DataSettings] Failed to clear YoBrowser sandbox data', error)
    sandboxClearFailed.value = true
  } finally {
    isClearingSandbox.value = false
  }
}

const handleClearSandboxDialogOpenChange = (open: boolean) => {
  if (isClearingSandbox.value) return
  isClearSandboxDialogOpen.value = open
}
</script>
