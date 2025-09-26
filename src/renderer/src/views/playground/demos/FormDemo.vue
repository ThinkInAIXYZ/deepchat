<template>
  <form class="space-y-4">
    <div class="space-y-2">
      <Label for="name">Name</Label>
      <Input id="name" placeholder="Jane Doe" />
    </div>
    <div class="space-y-2">
      <Label for="email">Email</Label>
      <Input id="email" type="email" placeholder="jane@example.com" />
    </div>
    <div class="space-y-2">
      <Label for="bio">Bio</Label>
      <Textarea id="bio" rows="3" placeholder="Tell us about yourself" />
    </div>
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Switch id="newsletter" />
        <Label for="newsletter">Subscribe</Label>
      </div>
      <div class="flex items-center gap-2">
        <Checkbox id="agreement" />
        <Label for="agreement">Accept terms</Label>
      </div>
    </div>
    <Button type="submit">Submit</Button>
  </form>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Textarea } from '@shadcn/components/ui/textarea'
</script>
