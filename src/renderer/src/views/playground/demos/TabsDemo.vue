<template>
  <Tabs default-value="account" class="w-full">
    <TabsList class="grid w-full grid-cols-3">
      <TabsTrigger value="account">Account</TabsTrigger>
      <TabsTrigger value="password">Password</TabsTrigger>
      <TabsTrigger value="security">Security</TabsTrigger>
    </TabsList>
    <TabsContent value="account" class="space-y-2">
      <p class="text-sm text-muted-foreground">
        Make changes to your account here. Click save when you're done.
      </p>
      <Button>Save changes</Button>
    </TabsContent>
    <TabsContent value="password">
      <p class="text-sm text-muted-foreground">Update your password regularly to stay secure.</p>
    </TabsContent>
    <TabsContent value="security">
      <p class="text-sm text-muted-foreground">
        Set up two-factor authentication and review active sessions.
      </p>
    </TabsContent>
  </Tabs>
</template>

<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { Button } from '@shadcn/components/ui/button'
</script>
