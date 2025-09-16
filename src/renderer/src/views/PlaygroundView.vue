<template>
  <div class="w-full h-full overflow-auto p-4 space-y-6 uikit-theme">
    <Toolbar bordered class="sticky top-0 bg-background/80 backdrop-blur z-10"
      >UIKit Playground (dev only)</Toolbar
    >

    <section>
      <h3 class="text-sm font-medium mb-2">Buttons</h3>
      <div class="flex flex-wrap gap-2 items-center">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button size="icon"><span class="i-lucide-plus w-4 h-4" /></Button>
        <IconButton><span class="i-lucide-settings w-4 h-4" /></IconButton>
      </div>
    </section>

    <Separator />

    <section>
      <h3 class="text-sm font-medium mb-2">Inputs</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
        <div class="space-y-1">
          <Label>Email</Label>
          <Input placeholder="name@example.com" />
        </div>
        <div class="space-y-1">
          <Label>Message</Label>
          <Textarea rows="3" placeholder="Type something..." />
        </div>
        <div class="flex items-center gap-3">
          <Checkbox id="c1" />
          <Label for="c1">Accept terms</Label>
        </div>
        <div class="flex items-center gap-3">
          <Switch />
          <Label>Notifications</Label>
        </div>
        <div class="flex items-center gap-3">
          <Slider :min="0" :max="100" :model-value="[20]" style="width: 200px" />
          <Label>Volume</Label>
        </div>
        <div class="flex items-center gap-2">
          <NumberField style="width: 200px">
            <NumberFieldInput />
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberField>
          <Label>Count</Label>
        </div>
      </div>
    </section>

    <Separator />

    <section>
      <h3 class="text-sm font-medium mb-2">Display</h3>
      <div class="flex flex-wrap gap-3 items-center">
        <Badge>Badge</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Card class="w-64">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card description</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Avatar>
                <AvatarImage src="https://avatars.githubusercontent.com/u/2?v=4" />
                <AvatarFallback>U</AvatarFallback>
              </Avatar>
              <div class="text-sm">Hello UIKit</div>
            </div>
          </CardContent>
          <CardFooter>
            <Progress :model-value="66" class="w-full" />
          </CardFooter>
        </Card>
        <Skeleton class="w-40 h-6" />
        <Chip><span class="i-lucide-bot w-4 h-4" />Model</Chip>
        <Pill><span class="i-lucide-check w-3.5 h-3.5" />web_search - found 10 sites</Pill>
      </div>
    </section>

    <Separator />

    <section>
      <h3 class="text-sm font-medium mb-2">Tabs</h3>
      <TabStrip>
        <TabItem active>Active tab</TabItem>
        <TabItem>Idle</TabItem>
        <TabItem closable>Closable</TabItem>
      </TabStrip>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  Toolbar,
  IconButton,
  Button,
  Input,
  Textarea,
  Label,
  Checkbox,
  Switch,
  Slider,
  NumberField,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
  Separator,
  Progress,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Chip,
  Pill,
  TabStrip,
  TabItem
} from '@/components/uikit'
</script>

<style scoped>
.i-lucide-plus {
  mask: url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 class=%22lucide lucide-plus%22><path d=%22M5 12h14%22/><path d=%22M12 5v14%22/></svg>')
    no-repeat center / contain;
  background: currentColor;
}
.i-lucide-settings {
  mask: url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 class=%22lucide lucide-settings%22><path d=%22M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z%22/><path d=%22M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6c.16 0 .33-.02.49-.05H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .7.4 1.34 1 1.64.2.1.4.2.62.27A1.65 1.65 0 0 0 16 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.48.48-.62 1.2-.33 1.82.1.2.2.4.27.62.3.6.94 1 1.64 1H21a2 2 0 1 1 0 4h-.09c-.7 0-1.34.4-1.64 1-.07.22-.17.42-.27.62Z%22/></svg>')
    no-repeat center / contain;
  background: currentColor;
}
.i-lucide-bot {
  mask: url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 class=%22lucide lucide-bot%22><path d=%22M12 8V4H8%22/><rect width=%2216%22 height=%2212%22 x=%224%22 y=%228%22 rx=%222%22/><path d=%22M2 14h2%22/><path d=%22M20 14h2%22/><path d=%22M15 13v2%22/><path d=%22M9 13v2%22/></svg>')
    no-repeat center / contain;
  background: currentColor;
}
.i-lucide-check {
  mask: url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 class=%22lucide lucide-check%22><path d=%22M20 6 9 17l-5-5%22/></svg>')
    no-repeat center / contain;
  background: currentColor;
}
</style>
