<template>
  <div
    class="min-h-screen flex flex-col justify-center items-center overflow-hidden select-none text-white font-['Geist',-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,sans-serif] relative"
    style="background: linear-gradient(135deg, hsl(var(--base-900)) 0%, hsl(var(--base-950)) 100%)"
  >
    <!-- Main Loading Animation -->
    <div class="loader-wrapper">
      <span class="loader-letter">D</span>
      <span class="loader-letter">e</span>
      <span class="loader-letter">e</span>
      <span class="loader-letter">p</span>
      <span class="loader-letter">C</span>
      <span class="loader-letter">h</span>
      <span class="loader-letter">a</span>
      <span class="loader-letter">t</span>
      <div class="loader"></div>
    </div>

    <!-- Logo in bottom right corner -->
    <div class="absolute bottom-6 right-6">
      <img
        src="@/assets/logo.png"
        alt="DeepChat Logo"
        class="w-8 h-8 object-contain opacity-70"
        style="filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// No reactive state needed for the simplified loader
</script>

<style scoped>
.loader-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 180px;
  font-family:
    'Geist',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  font-size: 1.2em;
  font-weight: 300;
  color: white;
  border-radius: 50%;
  background-color: transparent;
  user-select: none;
}

.loader {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  background-color: transparent;
  animation: loader-rotate 2s linear infinite;
  z-index: 0;
}

@keyframes loader-rotate {
  0% {
    transform: rotate(90deg);
    box-shadow:
      0 8px 16px 0 hsl(var(--primary-200)) inset,
      0 16px 32px 0 hsl(var(--primary-500)) inset,
      0 32px 64px 0 hsl(var(--primary-800)) inset;
  }
  25% {
    transform: rotate(180deg);
    box-shadow:
      0 10px 20px 0 hsl(var(--primary-100)) inset,
      0 20px 40px 0 hsl(var(--primary-400)) inset,
      0 40px 80px 0 hsl(var(--primary-700)) inset;
  }
  50% {
    transform: rotate(270deg);
    box-shadow:
      0 12px 24px 0 hsl(var(--primary-200)) inset,
      0 24px 48px 0 hsl(var(--primary-500)) inset,
      0 48px 96px 0 hsl(var(--primary-900)) inset;
  }
  75% {
    transform: rotate(360deg);
    box-shadow:
      0 10px 20px 0 hsl(var(--primary-100)) inset,
      0 20px 40px 0 hsl(var(--primary-400)) inset,
      0 40px 80px 0 hsl(var(--primary-700)) inset;
  }
  100% {
    transform: rotate(450deg);
    box-shadow:
      0 8px 16px 0 hsl(var(--primary-200)) inset,
      0 16px 32px 0 hsl(var(--primary-500)) inset,
      0 32px 64px 0 hsl(var(--primary-800)) inset;
  }
}

.loader-letter {
  display: inline-block;
  opacity: 0.6;
  transform: translateY(0);
  animation: loader-letter-anim 2s infinite;
  z-index: 1;
  border-radius: 50ch;
  border: none;
  color: hsl(var(--primary-200));
}

.loader-letter:nth-child(1) {
  animation-delay: 0s;
}
.loader-letter:nth-child(2) {
  animation-delay: 0.1s;
}
.loader-letter:nth-child(3) {
  animation-delay: 0.2s;
}
.loader-letter:nth-child(4) {
  animation-delay: 0.3s;
}
.loader-letter:nth-child(5) {
  animation-delay: 0.4s;
}
.loader-letter:nth-child(6) {
  animation-delay: 0.5s;
}
.loader-letter:nth-child(7) {
  animation-delay: 0.6s;
}
.loader-letter:nth-child(8) {
  animation-delay: 0.7s;
}

@keyframes loader-letter-anim {
  0%,
  100% {
    opacity: 0.6;
    transform: translateY(0);
  }
  20% {
    opacity: 1;
    transform: scale(1.15);
    color: hsl(var(--primary-100));
  }
  40% {
    opacity: 0.8;
    transform: translateY(0);
  }
}
</style>
