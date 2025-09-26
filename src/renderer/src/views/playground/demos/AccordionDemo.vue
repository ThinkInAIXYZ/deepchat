<template>
  <Accordion type="single" collapsible class="w-full">
    <AccordionItem value="item-1">
      <AccordionTrigger>Product updates</AccordionTrigger>
      <AccordionContent>
        Stay up to date with the latest improvements, fixes, and features.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="item-2">
      <AccordionTrigger>Team highlights</AccordionTrigger>
      <AccordionContent>
        Meet the people building the experience and learn about their process.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="item-3">
      <AccordionTrigger>FAQ</AccordionTrigger>
      <AccordionContent>
        Answers to the most common questions from our community.
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>

<script setup lang="ts">
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@shadcn/components/ui/accordion'
</script>
