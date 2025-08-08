<template>
  <div>
    <!-- 禁用模型确认对话框 -->
    <Dialog v-model:open="showConfirmDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.disableModel.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.provider.dialog.disableModel.content', { name: modelToDisable?.name }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showConfirmDialog = false">{{
            t('dialog.cancel')
          }}</Button>
          <Button variant="destructive" @click="$emit('confirm-disable-model')">{{
            t('settings.provider.dialog.disableModel.confirm')
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 模型列表对话框 -->
    <Dialog v-model:open="showModelListDialog">
      <DialogContent class="max-w-2xl p-0 pb-4 gap-2 flex flex-col">
        <DialogHeader class="p-0">
          <DialogTitle class="p-4">{{
            t('settings.provider.dialog.configModels.title')
          }}</DialogTitle>
          <DialogDescription class="px-4">
            {{ t('settings.provider.dialog.configModels.description') }}
          </DialogDescription>
        </DialogHeader>
        <div class="px-4 py-2 flex-1 h-0 max-h-80 overflow-y-auto">
          <ProviderModelList
            :provider-models="[{ providerId: provider.id, models: providerModels }]"
            :custom-models="customModels"
            :providers="[{ id: provider.id, name: provider.name }]"
            @enabled-change="(model, enabled) => $emit('model-enabled-change', model, enabled)"
          />
        </div>
      </DialogContent>
    </Dialog>

    <!-- API验证结果对话框 -->
    <Dialog v-model:open="showCheckModelDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{
            t(
              checkResult
                ? 'settings.provider.dialog.verify.success'
                : 'settings.provider.dialog.verify.failed'
            )
          }}</DialogTitle>
          <DialogDescription>
            {{
              t(
                checkResult
                  ? 'settings.provider.dialog.verify.successDesc'
                  : 'settings.provider.dialog.verify.failedDesc'
              )
            }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showCheckModelDialog = false">{{
            t('dialog.close')
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 禁用所有模型确认对话框 -->
    <Dialog v-model:open="showDisableAllConfirmDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.disableAllModels.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.provider.dialog.disableAllModels.content', { name: provider.name }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showDisableAllConfirmDialog = false">{{
            t('dialog.cancel')
          }}</Button>
          <Button variant="destructive" @click="$emit('confirm-disable-all-models')">{{
            t('settings.provider.dialog.disableAllModels.confirm')
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除供应商确认对话框 -->
    <Dialog v-model:open="showDeleteProviderDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.deleteProvider.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.provider.dialog.deleteProvider.content', { name: provider.name }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteProviderDialog = false">{{
            t('dialog.cancel')
          }}</Button>
          <Button variant="destructive" @click="$emit('confirm-delete-provider')">{{
            t('settings.provider.dialog.deleteProvider.confirm')
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import ProviderModelList from './ProviderModelList.vue'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'

const { t } = useI18n()

defineProps<{
  provider: LLM_PROVIDER
  providerModels: RENDERER_MODEL_META[]
  customModels: RENDERER_MODEL_META[]
  modelToDisable: RENDERER_MODEL_META | null
  checkResult: boolean
}>()

// 使用 defineModel 来处理双向绑定的对话框状态
const showConfirmDialog = defineModel<boolean>('showConfirmDialog', { default: false })
const showModelListDialog = defineModel<boolean>('showModelListDialog', { default: false })
const showCheckModelDialog = defineModel<boolean>('showCheckModelDialog', { default: false })
const showDisableAllConfirmDialog = defineModel<boolean>('showDisableAllConfirmDialog', {
  default: false
})
const showDeleteProviderDialog = defineModel<boolean>('showDeleteProviderDialog', {
  default: false
})

defineEmits<{
  'confirm-disable-model': []
  'model-enabled-change': [model: RENDERER_MODEL_META, enabled: boolean]
  'confirm-disable-all-models': []
  'confirm-delete-provider': []
}>()
</script>
