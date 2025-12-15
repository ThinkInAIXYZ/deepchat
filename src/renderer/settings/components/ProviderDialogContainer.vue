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
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@shadcn/components/ui/dialog'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'

const { t } = useI18n()

defineProps<{
  provider: LLM_PROVIDER
  modelToDisable: RENDERER_MODEL_META | null
  checkResult: boolean
}>()

// 使用 defineModel 来处理双向绑定的对话框状态
const showConfirmDialog = defineModel<boolean>('showConfirmDialog', { default: false })
const showCheckModelDialog = defineModel<boolean>('showCheckModelDialog', { default: false })
const showDisableAllConfirmDialog = defineModel<boolean>('showDisableAllConfirmDialog', {
  default: false
})
const showDeleteProviderDialog = defineModel<boolean>('showDeleteProviderDialog', {
  default: false
})

defineEmits<{
  'confirm-disable-model': []
  'confirm-disable-all-models': []
  'confirm-delete-provider': []
}>()
</script>
