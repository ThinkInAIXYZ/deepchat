<template>
  <FieldSet class="max-w-xl space-y-6">
    <FieldLegend class="text-base font-semibold">Notification preferences</FieldLegend>
    <FieldDescription class="text-sm text-muted-foreground">
      Arrange label, helper text, and controls with a11y-friendly field primitives.
    </FieldDescription>

    <FieldGroup>
      <Field orientation="responsive">
        <FieldLabel for="digest" class="font-medium">Weekly product digest</FieldLabel>
        <FieldContent>
          <Switch id="digest" />
          <FieldDescription class="text-sm text-muted-foreground">
            Receive a summary of key updates every Monday morning.
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field orientation="responsive">
        <FieldLabel for="channel" class="font-medium">Default channel</FieldLabel>
        <FieldContent class="gap-2">
          <Select>
            <SelectTrigger id="channel" class="w-full sm:w-48">
              <SelectValue placeholder="Choose channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="teams">Teams</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription class="text-sm text-muted-foreground">
            Where notifications should arrive by default.
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field orientation="responsive" data-invalid="true">
        <FieldLabel for="quota" class="font-medium">Usage quota</FieldLabel>
        <FieldContent>
          <Input id="quota" type="number" min="0" placeholder="25" aria-invalid="true" />
          <FieldDescription class="text-sm text-muted-foreground">
            The maximum number of alerts your team can trigger each day.
          </FieldDescription>
          <FieldError :errors="[{ message: 'Provide a value between 10 and 50.' }]" />
        </FieldContent>
      </Field>
    </FieldGroup>
  </FieldSet>
</template>

<script setup lang="ts">
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@shadcn/components/ui/field'
import { Input } from '@shadcn/components/ui/input'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
</script>
