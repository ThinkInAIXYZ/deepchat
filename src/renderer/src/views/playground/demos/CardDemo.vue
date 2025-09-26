<template>
  <Card class="w-full">
    <CardHeader>
      <CardTitle>Analytics overview</CardTitle>
      <CardDescription>Track performance and monitor key metrics.</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-lg border border-border p-3">
        <p class="text-xs text-muted-foreground">Active users</p>
        <p class="text-2xl font-semibold">2,431</p>
      </div>
      <div class="rounded-lg border border-border p-3">
        <p class="text-xs text-muted-foreground">Retention</p>
        <p class="text-2xl font-semibold">82%</p>
      </div>
    </CardContent>
    <CardFooter class="flex justify-end gap-2">
      <Button variant="ghost">Download</Button>
      <Button>View details</Button>
    </CardFooter>
  </Card>
</template>

<script setup lang="ts">
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'
import { Button } from '@shadcn/components/ui/button'
</script>
