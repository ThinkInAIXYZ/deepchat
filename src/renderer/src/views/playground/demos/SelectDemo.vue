<template>
  <div class="space-y-2">
    <Label for="framework">Framework</Label>
    <Select>
      <SelectTrigger id="framework" class="w-full">
        <SelectValue placeholder="Select a framework" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="vue">Vue.js</SelectItem>
        <SelectItem value="react">React</SelectItem>
        <SelectItem value="svelte">Svelte</SelectItem>
        <SelectItem value="solid">Solid.js</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>

<script setup lang="ts">
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
</script>
