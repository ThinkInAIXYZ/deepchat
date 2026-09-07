<template>
  <div
    class="splash-shell"
    :class="{ 'splash-shell--manual-unlock': mode === 'unlock' || mode === 'recovery' }"
  >
    <div v-if="mode === 'unlock'" class="unlock-stage unlock-stage--manual">
      <div class="aurora-background" aria-hidden="true">
        <span class="aurora-ribbon aurora-ribbon--top"></span>
        <span class="aurora-ribbon aurora-ribbon--bottom"></span>
        <span class="aurora-pool aurora-pool--blue"></span>
        <span class="aurora-pool aurora-pool--violet"></span>
      </div>
      <form class="unlock-panel unlock-panel--manual" @submit.prevent="submitUnlock">
        <div class="unlock-brand" aria-hidden="true">
          <div class="unlock-logo unlock-logo--dark" v-html="darkLogo" />
          <div class="unlock-logo unlock-logo--light" v-html="lightLogo" />
        </div>
        <div class="unlock-title">DeepChat</div>
        <div class="unlock-subtitle">Local database is encrypted</div>
        <label class="unlock-label" for="database-password">SQLite password</label>
        <input
          id="database-password"
          ref="passwordInput"
          v-model="password"
          class="unlock-input"
          type="password"
          autocomplete="current-password"
          autofocus
          :disabled="unlockSubmitting || isDebugPreview"
        />
        <div v-if="unlockMessage" class="unlock-message">{{ unlockMessage }}</div>
        <div class="unlock-actions">
          <button
            class="unlock-button unlock-button--primary"
            type="submit"
            :disabled="!password || unlockSubmitting || isDebugPreview"
          >
            {{ unlockSubmitting ? 'Opening...' : 'Unlock' }}
          </button>
          <button
            class="unlock-button"
            type="button"
            :disabled="isDebugPreview"
            @click="cancelUnlock"
          >
            Quit
          </button>
        </div>
        <p class="unlock-hint">
          {{ isDebugPreview ? t('settings.debug.splash.previewHint') : unlockHint }}
        </p>
      </form>
    </div>

    <div v-else-if="mode === 'recovery'" class="unlock-stage unlock-stage--manual">
      <div class="aurora-background" aria-hidden="true">
        <span class="aurora-ribbon aurora-ribbon--top"></span>
        <span class="aurora-ribbon aurora-ribbon--bottom"></span>
        <span class="aurora-pool aurora-pool--blue"></span>
        <span class="aurora-pool aurora-pool--violet"></span>
      </div>
      <form class="unlock-panel unlock-panel--manual" @submit.prevent="submitRecoveryPassword">
        <div class="unlock-brand" aria-hidden="true">
          <div class="unlock-logo unlock-logo--dark" v-html="darkLogo" />
          <div class="unlock-logo unlock-logo--light" v-html="lightLogo" />
        </div>
        <div class="unlock-title">DeepChat</div>
        <div class="unlock-subtitle">{{ recoverySubtitle }}</div>
        <template v-if="recoveryNeedsPassword">
          <label class="unlock-label" for="database-recovery-password">SQLite password</label>
          <input
            id="database-recovery-password"
            ref="recoveryPasswordInput"
            v-model="password"
            class="unlock-input"
            type="password"
            autocomplete="current-password"
            autofocus
            :disabled="unlockSubmitting || isDebugPreview"
          />
        </template>
        <div v-if="recoveryMessage" class="unlock-message">{{ recoveryMessage }}</div>
        <div class="unlock-actions">
          <button
            v-if="recoveryNeedsPassword"
            class="unlock-button unlock-button--primary"
            type="submit"
            :disabled="!password || unlockSubmitting || isDebugPreview"
          >
            {{ unlockSubmitting ? 'Opening...' : 'Unlock' }}
          </button>
          <button
            class="unlock-button"
            :class="{ 'unlock-button--primary': !recoveryNeedsPassword }"
            type="button"
            :disabled="unlockSubmitting || isDebugPreview"
            @click="requestStartEmpty"
          >
            {{ confirmingStartEmpty ? 'Confirm start empty' : 'Start empty' }}
          </button>
          <button
            class="unlock-button"
            type="button"
            :disabled="unlockSubmitting || isDebugPreview"
            @click="cancelRecovery"
          >
            Quit
          </button>
        </div>
        <p class="unlock-hint">Original files will be kept at {{ recoveryPreservedPath }}.</p>
      </form>
    </div>

    <div v-else-if="mode === 'system-unlock'" class="unlock-stage unlock-stage--orb">
      <div class="aurora-background" aria-hidden="true">
        <span class="aurora-ribbon aurora-ribbon--top"></span>
        <span class="aurora-ribbon aurora-ribbon--bottom"></span>
        <span class="aurora-pool aurora-pool--blue"></span>
        <span class="aurora-pool aurora-pool--violet"></span>
      </div>
      <div class="unlock-panel unlock-panel--system">
        <div class="unlock-brand" aria-hidden="true">
          <div class="unlock-logo unlock-logo--dark" v-html="darkLogo" />
          <div class="unlock-logo unlock-logo--light" v-html="lightLogo" />
        </div>
        <div class="unlock-title">DeepChat</div>
        <div class="unlock-subtitle">Unlocking local database</div>
        <p class="unlock-hint">
          DeepChat is reading the saved password from the system credential store.
        </p>
      </div>
    </div>

    <div
      v-else
      class="loader-stage loader-stage--orb"
      :class="{ 'loader-stage--animating': animationStarted }"
      aria-label="DeepChat is starting"
    >
      <div class="aurora-background" aria-hidden="true">
        <span class="aurora-ribbon aurora-ribbon--top"></span>
        <span class="aurora-ribbon aurora-ribbon--bottom"></span>
        <span class="aurora-pool aurora-pool--blue"></span>
        <span class="aurora-pool aurora-pool--violet"></span>
        <span class="aurora-pool aurora-pool--cyan"></span>
      </div>

      <div class="logo-loader" aria-hidden="true">
        <span class="logo-bloom"></span>
        <span class="logo-bloom logo-bloom--inner"></span>
        <span class="core-flare"></span>
        <span class="speed-line speed-line--one"></span>
        <span class="speed-line speed-line--two"></span>
        <!-- Trusted local SVG sources are inlined so each original path can move independently. -->
        <div class="logo-mark logo-mark--dark" v-html="darkLogo" />
        <div class="logo-mark logo-mark--light" v-html="lightLogo" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  type DatabaseRecoveryRequestPayload,
  type DatabaseUnlockProgressPayload,
  type DatabaseUnlockRequestPayload
} from '@shared/contracts/databaseSecurity'
import darkLogo from '@/assets/splash/logo-v3-dark.svg?raw'
import lightLogo from '@/assets/splash/logo-v3-light.svg?raw'
import type { SplashDebugMode } from '@shared/contracts/splash'

const { t } = useI18n()

const mode = ref<'loading' | 'system-unlock' | 'unlock' | 'recovery'>('loading')
const requestId = ref('')
const password = ref('')
const unlockReason = ref<DatabaseUnlockRequestPayload['reason']>('manual-required')
const recoveryKind = ref<DatabaseRecoveryRequestPayload['kind']>('true-corruption')
const recoveryPreservedPath = ref('')
const recoveryInvalidPassword = ref(false)
const recoveryQuarantineFailed = ref(false)
const confirmingStartEmpty = ref(false)
const safeStorageAvailable = ref(false)
const unlockSubmitting = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)
const recoveryPasswordInput = ref<HTMLInputElement | null>(null)
const animationStarted = ref(true)
const isDebugPreview = ref(false)

const unlockMessage = computed(() => {
  if (unlockReason.value === 'invalid') {
    return 'Wrong password. Try again.'
  }
  return ''
})

const recoveryNeedsPassword = computed(() => recoveryKind.value === 'unreadable')

const recoverySubtitle = computed(() => {
  if (recoveryKind.value === 'unreadable') {
    return 'This database cannot be read. It may be encrypted or damaged.'
  }
  if (recoveryKind.value === 'orphaned-sidecar') {
    return 'A leftover database journal was found without its main file.'
  }
  return 'The local database is damaged.'
})

const recoveryMessage = computed(() => {
  if (recoveryQuarantineFailed.value) {
    return 'Could not move the original files. Try Start empty again or quit.'
  }
  if (recoveryInvalidPassword.value) {
    return 'Wrong password. Try again.'
  }
  return ''
})

const unlockHint = computed(() => {
  if (unlockReason.value === 'system-key-missing') {
    return 'The saved system credential is missing or cannot be decrypted. Enter the SQLite password once to unlock and save it again.'
  }
  if (!safeStorageAvailable.value) {
    return 'System unlock is unavailable on this device, so manual unlock is required.'
  }
  return 'Enter the SQLite password to unlock this database. Future startups can open automatically after it is saved to the system credential store.'
})

const focusPasswordInput = () => {
  void nextTick(() => {
    passwordInput.value?.focus()
  })
}

const handleDebugMode = (debugMode: SplashDebugMode) => {
  isDebugPreview.value = debugMode === 'unlock' || debugMode === 'recovery'
  requestId.value = ''
  password.value = ''
  unlockSubmitting.value = false
  confirmingStartEmpty.value = false
  if (debugMode === 'recovery') {
    recoveryKind.value = 'unreadable'
    recoveryPreservedPath.value = 'agent.db.corrupt.preview'
    recoveryInvalidPassword.value = false
    recoveryQuarantineFailed.value = false
  }
  mode.value = debugMode
}

const handleRecoveryRequest = (payload: DatabaseRecoveryRequestPayload) => {
  isDebugPreview.value = false
  requestId.value = payload.requestId
  recoveryKind.value = payload.kind
  recoveryPreservedPath.value = payload.preservedPath
  recoveryInvalidPassword.value = payload.invalidPassword === true
  recoveryQuarantineFailed.value = payload.quarantineFailed === true
  confirmingStartEmpty.value = false
  password.value = ''
  unlockSubmitting.value = false
  mode.value = 'recovery'
  if (payload.kind === 'unreadable') {
    void nextTick(() => {
      recoveryPasswordInput.value?.focus()
    })
  }
}

const handleUnlockRequest = (payload: DatabaseUnlockRequestPayload) => {
  isDebugPreview.value = false
  requestId.value = payload.requestId
  unlockReason.value = payload.reason
  safeStorageAvailable.value = payload.safeStorageAvailable
  password.value = ''
  unlockSubmitting.value = false
  mode.value = 'unlock'
  focusPasswordInput()
}

const handleUnlockProgress = (payload: DatabaseUnlockProgressPayload) => {
  isDebugPreview.value = false
  unlockSubmitting.value = false
  if (payload.active) {
    safeStorageAvailable.value = payload.safeStorageAvailable
    mode.value = 'system-unlock'
    return
  }
  if (mode.value === 'system-unlock') {
    mode.value = 'loading'
  }
}

const submitUnlock = () => {
  if (isDebugPreview.value || !requestId.value || !password.value || unlockSubmitting.value) {
    return
  }
  unlockSubmitting.value = true
  window.deepchatSplash.submitUnlock({
    requestId: requestId.value,
    password: password.value
  })
  password.value = ''
}

const submitRecoveryPassword = () => {
  if (
    !requestId.value ||
    !password.value ||
    unlockSubmitting.value ||
    !recoveryNeedsPassword.value
  ) {
    return
  }
  unlockSubmitting.value = true
  window.deepchatSplash.submitRecovery({
    requestId: requestId.value,
    action: 'password',
    password: password.value
  })
  password.value = ''
}

const requestStartEmpty = () => {
  if (!requestId.value || unlockSubmitting.value) {
    return
  }
  if (!confirmingStartEmpty.value) {
    confirmingStartEmpty.value = true
    return
  }
  unlockSubmitting.value = true
  window.deepchatSplash.submitRecovery({
    requestId: requestId.value,
    action: 'start-empty'
  })
}

const cancelRecovery = () => {
  if (!requestId.value) {
    return
  }
  const canceledRequestId = requestId.value
  unlockSubmitting.value = false
  window.deepchatSplash.cancelRecovery({
    requestId: canceledRequestId
  })
  requestId.value = ''
  password.value = ''
  confirmingStartEmpty.value = false
  mode.value = 'loading'
}

const cancelUnlock = () => {
  if (isDebugPreview.value || !requestId.value) {
    return
  }
  const canceledRequestId = requestId.value
  unlockSubmitting.value = false
  window.deepchatSplash.cancelUnlock({
    requestId: canceledRequestId
  })
  requestId.value = ''
  password.value = ''
  unlockReason.value = 'manual-required'
  safeStorageAvailable.value = false
  mode.value = 'loading'
}

const cleanupListeners: Array<() => void> = []

onMounted(() => {
  cleanupListeners.push(
    window.deepchatSplash.onUnlockRequest(handleUnlockRequest),
    window.deepchatSplash.onUnlockProgress(handleUnlockProgress),
    window.deepchatSplash.onRecoveryRequest(handleRecoveryRequest),
    window.deepchatSplash.onDebugMode(handleDebugMode)
  )
})

onBeforeUnmount(() => {
  for (const cleanup of cleanupListeners.splice(0)) {
    cleanup()
  }
})
</script>

<style scoped>
.splash-shell {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: transparent;
  user-select: none;
  font-family:
    'Geist',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
}

.loader-stage,
.unlock-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader-stage--orb .aurora-background,
.unlock-stage--orb .aurora-background {
  top: 50%;
  left: 50%;
  width: 340px;
  height: 340px;
  border: 1px solid rgb(148 163 184 / 26%);
  border-radius: 50%;
  box-shadow: inset 0 1px rgb(255 255 255 / 10%);
  transform: translate(-50%, -50%);
}

.loader-stage {
  pointer-events: none;
}

.aurora-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background:
    radial-gradient(ellipse 74% 54% at 50% 48%, rgb(25 99 190 / 28%), transparent 68%),
    rgb(8 13 26 / 92%);
}

.aurora-ribbon,
.aurora-pool {
  position: absolute;
  display: block;
  pointer-events: none;
  will-change: transform;
}

.aurora-ribbon {
  width: 135vmax;
  height: 47vmax;
  border-radius: 48% 52% 45% 55%;
  filter: blur(72px);
}

.aurora-ribbon--top {
  top: -28vmax;
  left: -26vmax;
  animation: aurora-sweep-one 26s ease-in-out infinite alternate;
  background: linear-gradient(
    100deg,
    transparent 9%,
    rgb(41 116 255 / 58%) 35%,
    rgb(33 195 255 / 46%) 62%,
    transparent 89%
  );
}

.aurora-ribbon--bottom {
  right: -38vmax;
  bottom: -27vmax;
  animation: aurora-sweep-two 32s ease-in-out infinite alternate;
  background: linear-gradient(
    95deg,
    transparent 6%,
    rgb(99 54 235 / 42%) 34%,
    rgb(46 102 255 / 40%) 64%,
    transparent 92%
  );
}

.aurora-pool {
  top: 50%;
  left: 50%;
  width: min(70vmax, 820px);
  aspect-ratio: 1.36;
  border-radius: 50%;
  filter: blur(76px);
  mix-blend-mode: screen;
}

.aurora-pool--blue {
  animation: aurora-pool-one 14s ease-in-out infinite alternate;
  background: radial-gradient(ellipse, rgb(22 142 255 / 45%), transparent 67%);
}

.aurora-pool--violet {
  animation: aurora-pool-two 18s ease-in-out infinite alternate;
  background: radial-gradient(ellipse, rgb(102 52 238 / 35%), transparent 67%);
}

.aurora-pool--cyan {
  animation: aurora-pool-three 22s ease-in-out infinite alternate;
  background: radial-gradient(ellipse, rgb(61 213 255 / 28%), transparent 66%);
}

.logo-loader {
  position: relative;
  isolation: isolate;
  width: 176px;
  height: 176px;
}

.logo-bloom,
.core-flare {
  position: absolute;
  z-index: -1;
  display: block;
  pointer-events: none;
  opacity: 0;
  will-change: opacity, transform;
}

.logo-bloom {
  top: 42px;
  left: 22px;
  width: 156px;
  height: 92px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    rgb(37 181 255 / 58%),
    rgb(45 113 255 / 18%) 42%,
    transparent 72%
  );
  transform: scale(0.42);
}

.logo-bloom--inner {
  top: 67px;
  left: 30px;
  width: 116px;
  height: 38px;
  background: radial-gradient(
    ellipse,
    rgb(162 235 255 / 92%),
    rgb(36 140 255 / 18%) 48%,
    transparent 76%
  );
  transform: scaleX(0.12) scaleY(0.6);
}

.core-flare {
  top: 64px;
  left: 42px;
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: #dff8ff;
  box-shadow:
    0 0 10px 3px rgb(103 221 255 / 90%),
    0 0 30px 9px rgb(25 126 255 / 46%);
  opacity: 0;
  transform: scale(0.3);
}

.speed-line {
  position: absolute;
  z-index: 2;
  left: -14px;
  width: 128px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent,
    rgb(88 181 255 / 78%) 42%,
    rgb(218 245 255 / 88%) 58%,
    transparent
  );
  opacity: 0;
  transform: translateX(-34px) scaleX(0.36);
  transform-origin: left;
  will-change: transform, opacity;
}

.speed-line--one {
  top: 76px;
}

.speed-line--two {
  top: 108px;
  width: 106px;
  opacity: 0.65;
}

.logo-mark {
  position: absolute;
  top: 16px;
  left: 0;
  width: 176px;
  height: 144px;
  display: none;
  opacity: 0;
  transform: translateX(36px) scale(0.78);
  will-change: opacity, transform;
}

.logo-mark :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.logo-mark :deep(path) {
  transform-box: fill-box;
  transform-origin: center;
  will-change: opacity, transform;
}

.logo-mark--dark {
  display: block;
}

@media (prefers-color-scheme: light) {
  .aurora-background {
    background:
      radial-gradient(ellipse 74% 54% at 50% 48%, rgb(147 210 255 / 48%), transparent 68%), #eef7ff;
  }

  .aurora-ribbon--top {
    opacity: 0.52;
  }

  .aurora-ribbon--bottom {
    opacity: 0.3;
  }

  .logo-mark--dark {
    display: none;
  }

  .logo-mark--light {
    display: block;
  }
}

.loader-stage--animating .logo-bloom {
  animation: bloom-deploy 720ms cubic-bezier(0.16, 0.84, 0.32, 1) 350ms both;
}

.loader-stage--animating .logo-bloom--inner {
  animation: inner-bloom-flash 530ms cubic-bezier(0.2, 0.82, 0.24, 1) 690ms both;
}

.loader-stage--animating .core-flare {
  animation: core-flare 470ms cubic-bezier(0.16, 0.84, 0.32, 1) 730ms both;
}

.loader-stage--animating .speed-line--one {
  animation: speed-scan 1.35s linear 1.2s infinite;
}

.loader-stage--animating .speed-line--two {
  animation: speed-scan 1.35s linear 610ms infinite;
}

.loader-stage--animating .logo-mark {
  animation: mech-frame-arrive 920ms cubic-bezier(0.16, 0.84, 0.32, 1) 80ms forwards;
}

/* The source fish path is clipped into native body and tail components for assembly. */
.logo-mark :deep(.logo-tail) {
  transform-box: view-box;
  transform-origin: 688px 515px;
}

.loader-stage--animating .logo-mark :deep(.logo-wake) {
  animation: mech-wake-deploy 1.05s cubic-bezier(0.16, 0.84, 0.32, 1) 170ms both;
}

.loader-stage--animating .logo-mark :deep(.logo-body) {
  animation: mech-body-lock 900ms cubic-bezier(0.16, 0.84, 0.32, 1) 170ms both;
}

.loader-stage--animating .logo-mark :deep(.logo-tail) {
  animation:
    mech-tail-fold 760ms cubic-bezier(0.16, 0.84, 0.32, 1) 340ms both,
    native-tail-idle 1.8s ease-in-out 1.22s infinite;
}

.loader-stage--animating .logo-mark :deep(.logo-eye) {
  animation:
    core-ignite 480ms cubic-bezier(0.16, 0.84, 0.32, 1) 790ms both,
    eye-blink 2.1s ease-in-out 1.72s infinite;
}

.unlock-stage {
  padding: 28px;
}

.unlock-panel {
  position: relative;
  z-index: 1;
  display: flex;
  width: min(340px, 100%);
  flex-direction: column;
  gap: 11px;
  border: 1px solid rgb(148 163 184 / 28%);
  border-radius: 20px;
  background: linear-gradient(145deg, rgb(10 30 71 / 84%), rgb(3 12 33 / 82%));
  box-shadow:
    0 18px 48px rgb(2 8 23 / 34%),
    inset 0 1px rgb(255 255 255 / 8%);
  padding: 22px 24px 24px;
  backdrop-filter: blur(22px);
}

.unlock-panel--system,
.unlock-panel--manual {
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.unlock-panel--system {
  align-items: center;
  text-align: center;
}

.unlock-brand {
  position: relative;
  width: 52px;
  height: 44px;
  margin-bottom: 1px;
}

.unlock-logo {
  position: absolute;
  inset: 0;
  display: none;
  animation: unlock-logo-float 2.6s ease-in-out infinite;
}

.unlock-logo :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* Both logo variants retain their native third path as the white eye. */
.unlock-logo :deep(path:nth-of-type(3)) {
  transform-box: fill-box;
  transform-origin: center;
  animation: eye-blink 2.1s ease-in-out 500ms infinite;
}

.unlock-logo--dark {
  display: block;
}

@media (prefers-color-scheme: light) {
  .unlock-panel {
    border-color: rgb(45 116 181 / 20%);
    background: rgb(255 255 255 / 72%);
    box-shadow:
      0 18px 48px rgb(67 125 178 / 18%),
      inset 0 1px rgb(255 255 255 / 74%);
  }

  .unlock-title {
    color: #102a55;
  }

  .unlock-subtitle,
  .unlock-label {
    color: rgb(24 70 121 / 78%);
  }

  .unlock-input {
    border-color: rgb(38 115 188 / 22%);
    background: rgb(255 255 255 / 66%);
    color: #102a55;
  }

  .unlock-hint {
    color: rgb(24 70 121 / 68%);
  }

  .unlock-button {
    border-color: rgb(38 115 188 / 22%);
    background: rgb(255 255 255 / 62%);
    color: #12335f;
  }

  .unlock-logo--dark {
    display: none;
  }

  .unlock-logo--light {
    display: block;
  }
}

.unlock-title {
  color: white;
  font-size: 22px;
  font-weight: 600;
}

.unlock-subtitle {
  color: rgb(226 232 240 / 82%);
  font-size: 13px;
}

.unlock-label {
  margin-top: 8px;
  color: rgb(226 232 240 / 82%);
  font-size: 12px;
}

.unlock-input {
  height: 36px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 8px;
  outline: none;
  background: rgb(255 255 255 / 8%);
  color: white;
  padding: 0 10px;
}

.unlock-input:focus {
  border-color: rgb(96 165 250 / 84%);
  box-shadow: 0 0 0 3px rgb(96 165 250 / 35%);
}

.unlock-message {
  color: #fca5a5;
  font-size: 12px;
}

.unlock-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.unlock-button {
  height: 34px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 8px;
  background: rgb(255 255 255 / 8%);
  color: white;
  padding: 0 14px;
  font-size: 13px;
}

.unlock-button:disabled {
  cursor: default;
  opacity: 0.58;
}

.unlock-button--primary {
  border-color: #60a5fa;
  background: #2563eb;
}

.unlock-hint {
  margin: 4px 0 0;
  color: rgb(226 232 240 / 62%);
  font-size: 12px;
  line-height: 1.45;
}

@keyframes unlock-logo-float {
  0%,
  100% {
    transform: translateY(0) rotate(-1deg);
  }
  50% {
    transform: translateY(-3px) rotate(1deg);
  }
}

@keyframes aurora-sweep-one {
  0% {
    transform: translate3d(-9vmax, -3vmax, 0) rotate(-8deg) scale(0.96);
  }
  55% {
    transform: translate3d(12vmax, 9vmax, 0) rotate(3deg) scale(1.08);
  }
  100% {
    transform: translate3d(25vmax, -2vmax, 0) rotate(10deg) scale(0.98);
  }
}

@keyframes aurora-sweep-two {
  0% {
    transform: translate3d(6vmax, 5vmax, 0) rotate(17deg) scale(0.92);
  }
  48% {
    transform: translate3d(-13vmax, -9vmax, 0) rotate(8deg) scale(1.1);
  }
  100% {
    transform: translate3d(-26vmax, 3vmax, 0) rotate(-1deg) scale(0.98);
  }
}

@keyframes aurora-pool-one {
  from {
    transform: translate3d(-62%, -61%, 0) scale(0.85);
  }
  to {
    transform: translate3d(-35%, -44%, 0) scale(1.18);
  }
}

@keyframes aurora-pool-two {
  from {
    transform: translate3d(-30%, -32%, 0) scale(0.8);
  }
  to {
    transform: translate3d(-69%, -55%, 0) scale(1.2);
  }
}

@keyframes aurora-pool-three {
  from {
    transform: translate3d(-74%, -48%, 0) scale(0.7);
  }
  to {
    transform: translate3d(-42%, -62%, 0) scale(1.15);
  }
}

@keyframes bloom-deploy {
  0% {
    opacity: 0;
    transform: scale(0.42);
  }
  56% {
    opacity: 0.82;
    transform: scale(1.13);
  }
  100% {
    opacity: 0.36;
    transform: scale(1);
  }
}

@keyframes inner-bloom-flash {
  0% {
    opacity: 0;
    transform: scaleX(0.12) scaleY(0.6);
  }
  48% {
    opacity: 1;
    transform: scaleX(1.28) scaleY(1.18);
  }
  100% {
    opacity: 0;
    transform: scaleX(1.58) scaleY(0.82);
  }
}

@keyframes core-flare {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  42% {
    opacity: 1;
    transform: scale(1.8);
  }
  100% {
    opacity: 0;
    transform: scale(0.68);
  }
}

@keyframes speed-scan {
  0% {
    opacity: 0;
    transform: translateX(-34px) scaleX(0.36);
  }
  18% {
    opacity: 0.9;
  }
  78% {
    opacity: 0.62;
  }
  100% {
    opacity: 0;
    transform: translateX(74px) scaleX(1);
  }
}

@keyframes mech-wake-deploy {
  0% {
    opacity: 0;
    transform: scaleX(0.12) scaleY(0.62);
  }
  58% {
    opacity: 0.74;
    transform: scaleX(1.12) scaleY(1.04);
  }
  100% {
    opacity: 0.5;
    transform: scale(1);
  }
}

@keyframes mech-body-lock {
  0% {
    opacity: 0;
    transform: scaleX(0.52) scaleY(0.78) skewY(-5deg);
  }
  52% {
    opacity: 1;
    transform: scaleX(1.06) scaleY(0.98) skewY(1deg);
  }
  74% {
    transform: scaleX(0.985) scaleY(1.015) skewY(0);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes core-ignite {
  0% {
    opacity: 0;
    transform: scale(0.12);
  }
  62% {
    opacity: 1;
    transform: scale(1.22);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes mech-tail-fold {
  0% {
    opacity: 0;
    transform: rotate(64deg) scaleX(0.28) scaleY(0.68);
  }
  52% {
    opacity: 1;
    transform: rotate(-10deg) scaleX(1.06) scaleY(0.97);
  }
  76% {
    transform: rotate(3deg) scaleX(0.985) scaleY(1.015);
  }
  100% {
    opacity: 1;
    transform: rotate(0) scale(1);
  }
}

@keyframes native-tail-idle {
  0%,
  100% {
    rotate: 1.1deg;
  }
  50% {
    rotate: -1.3deg;
  }
}

@keyframes mech-frame-arrive {
  0% {
    opacity: 0;
    transform: scaleX(0.68) scaleY(0.8) skewY(-4deg);
  }
  28% {
    opacity: 1;
    transform: scaleX(0.94) scaleY(0.92) skewY(1deg);
  }
  56% {
    transform: scaleX(1.045) scaleY(1.02) skewY(-0.75deg);
  }
  75% {
    transform: scaleX(0.99) scaleY(1.01) skewY(0.2deg);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes card-settle {
  0% {
    filter: brightness(0.5);
    transform: scale(0.88);
  }
  65% {
    filter: brightness(1.24);
    transform: scale(1.025);
  }
  100% {
    filter: brightness(1);
    transform: scale(1);
  }
}

@keyframes rim-breathe {
  0%,
  100% {
    opacity: 0.12;
  }
  50% {
    opacity: 0.34;
  }
}

@keyframes wake-sweep {
  0% {
    opacity: 0;
    transform: translateX(62px) scaleX(0.12) scaleY(0.7);
  }
  44% {
    opacity: 0.78;
    transform: translateX(10px) scaleX(1.16) scaleY(1.05);
  }
  100% {
    opacity: 0.5;
    transform: translateX(0) scaleX(1) scaleY(1);
  }
}

@keyframes wake-idle {
  0%,
  100% {
    opacity: 0.34;
    transform: translateX(0) scaleY(0.98);
  }
  50% {
    opacity: 0.62;
    transform: translateX(5px) scaleY(1.03);
  }
}

@keyframes fish-swim {
  0% {
    opacity: 0;
    transform: translateX(54px) translateY(5px) scaleX(0.58) scaleY(0.82) rotate(7deg);
  }
  58% {
    opacity: 1;
    transform: translateX(-7px) translateY(-2px) scaleX(1.08) scaleY(0.98) rotate(-2deg);
  }
  80% {
    transform: translateX(2px) translateY(1px) scaleX(0.99) scaleY(1.02) rotate(0.6deg);
  }
  100% {
    opacity: 1;
    transform: translateX(0) translateY(0) scale(1) rotate(0);
  }
}

@keyframes fish-idle {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-1px);
  }
}

@keyframes eye-arrive {
  0% {
    opacity: 0;
    transform: translateX(16px) scale(0.32);
  }
  62% {
    opacity: 1;
    transform: translateX(-2px) scale(1.16);
  }
  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes eye-blink {
  0%,
  7%,
  100% {
    scale: 1 1;
  }
  2%,
  5% {
    scale: 1 0.08;
  }
}

@keyframes speed-line {
  from {
    opacity: 0;
    transform: translateX(-34px) scaleX(0.4);
  }
  28% {
    opacity: 0.96;
  }
  to {
    opacity: 0;
    transform: translateX(104px) scaleX(1);
  }
}

@keyframes wake-pulse {
  from {
    opacity: 0.15;
    transform: translateX(4px) scale(0.82, 0.72);
  }
  50% {
    opacity: 0.78;
  }
  to {
    opacity: 0;
    transform: translateX(42px) scale(1.18, 1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .aurora-ribbon,
  .aurora-pool,
  .logo-bloom,
  .core-flare,
  .speed-line,
  .logo-mark,
  .logo-mark :deep(path),
  .unlock-logo,
  .unlock-logo :deep(path) {
    animation: none;
  }

  .speed-line {
    display: none;
  }
}
</style>
