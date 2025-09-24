import { cva } from "class-variance-authority"

export { default as NavigationMenu } from "./NavigationMenu.vue"
export { default as NavigationMenuContent } from "./NavigationMenuContent.vue"
export { default as NavigationMenuIndicator } from "./NavigationMenuIndicator.vue"
export { default as NavigationMenuItem } from "./NavigationMenuItem.vue"
export { default as NavigationMenuLink } from "./NavigationMenuLink.vue"
export { default as NavigationMenuList } from "./NavigationMenuList.vue"
export { default as NavigationMenuTrigger } from "./NavigationMenuTrigger.vue"
export { default as NavigationMenuViewport } from "./NavigationMenuViewport.vue"

export const navigationMenuTriggerStyle = cva(
  'group inline-flex h-9 w-max items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100 hover:text-zinc-900 focus:bg-zinc-100 focus:text-zinc-900 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:hover:bg-zinc-100 data-[state=open]:text-zinc-900 data-[state=open]:focus:bg-zinc-100 data-[state=open]:bg-zinc-100/50 focus-visible:ring-zinc-950/50 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus:bg-zinc-800 dark:focus:text-zinc-50 dark:data-[state=open]:hover:bg-zinc-800 dark:data-[state=open]:text-zinc-50 dark:data-[state=open]:focus:bg-zinc-800 dark:data-[state=open]:bg-zinc-800/50 dark:focus-visible:ring-zinc-300/50',
)
