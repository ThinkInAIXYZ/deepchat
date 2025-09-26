<template>
  <Dialog>
    <DialogTrigger as-child>
      <Button>Open dialog</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Stay in the loop</DialogTitle>
        <DialogDescription>
          Subscribe to product announcements and feature updates.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-3">
        <div class="space-y-1">
          <Label for="email">Email</Label>
          <Input id="email" type="email" placeholder="you@example.com" />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox id="frequency" />
          <Label for="frequency">Weekly digest</Label>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button>Confirm</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { Checkbox } from '@shadcn/components/ui/checkbox'
</script>
