<template>
  <div
    data-testid="chat-session-skeleton"
    class="h-full w-full overflow-hidden select-none"
    aria-hidden="true"
  >
    <div class="mx-auto w-full max-w-5xl px-6 py-6 motion-safe:animate-pulse">
      <div class="flex w-full gap-2 pl-4 pr-11 pt-5">
        <div class="size-5 shrink-0 rounded-md bg-muted/70" />
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <div class="h-2.5 w-24 rounded bg-muted/60" />
          <div class="space-y-2.5">
            <div class="h-3 w-[88%] rounded bg-muted/50" />
            <div class="h-3 w-[72%] rounded bg-muted/50" />
            <div class="h-3 w-[46%] rounded bg-muted/40" />
          </div>
        </div>
      </div>

      <div class="flex w-full flex-row-reverse gap-2 pl-11 pt-9">
        <div class="size-5 shrink-0 rounded-md bg-muted/70" />
        <div class="flex w-full max-w-[72%] min-w-0 flex-col items-end gap-2.5">
          <div class="h-2.5 w-16 rounded bg-muted/50" />
          <div class="w-full space-y-2 rounded-lg border border-border/60 bg-muted/40 p-3">
            <div class="ml-auto h-3 w-[86%] rounded bg-muted/75" />
            <div class="ml-auto h-3 w-[58%] rounded bg-muted/60" />
          </div>
        </div>
      </div>

      <div class="flex w-full gap-2 pl-4 pr-11 pt-9">
        <div class="size-5 shrink-0 rounded-md bg-muted/70" />
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <div class="h-2.5 w-20 rounded bg-muted/60" />
          <div class="h-7 w-44 max-w-[55%] rounded-md bg-muted/40" />
          <div class="space-y-2.5">
            <div class="h-3 w-[82%] rounded bg-muted/50" />
            <div class="h-3 w-[64%] rounded bg-muted/50" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
