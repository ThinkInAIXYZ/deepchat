# Message Delete Confirmation Implementation Plan

## 总体策略

这是 renderer 交互保护，不是数据层变更。主进程 `sessions.deleteMessage` 继续保持当前删除 API；确认状态放在
`ChatPage.vue`，因为它已经拥有 session id、read-only 判断、删除副作用和 rehydrate 流程。

不要把确认状态放进每个消息行。消息列表是热路径，当前 `MessageListRow` 已经有 resize/intersection observer；给每行挂 dialog 或 watcher 是不必要的。

## Renderer Working Brief

Target
- User-visible behavior: 点击消息 trash 后先弹确认，确认后删除。
- Current rendering component: trash button lives in `MessageToolbar.vue`.
- Logical owner: `ChatPage.vue` owns deletion side effect.
- Route/layout/shell owner: chat page route.
- Trigger path: toolbar emit `delete` -> message item -> row -> list -> `ChatPage.onMessageDelete`.
- Existing similar implementation: shadcn `AlertDialog` in settings and `MessageDialog.vue`.

Context Map
- Vue owner chain: `ChatPage` -> `MessageList` -> `MessageListRow` -> `MessageItem*` -> `MessageToolbar`.
- DOM/render chain: dialog should portal through existing AlertDialog implementation, not mount inside a row.
- State source: local `pendingDeleteMessageId` in `ChatPage`.
- Derived state: `showDeleteMessageDialog = Boolean(pendingDeleteMessageId)`.
- Events: request delete, confirm delete, cancel/close dialog.
- Side effects: `messageStore.clearStreamingState()`, `sessionClient.deleteMessage()`, `loadMessagesAndRehydrate()`.
- Styling/layout constraints: chat list uses content visibility and row measurement; avoid per-row modal DOM.
- Performance-sensitive areas: message list rows and toolbar buttons.
- Accessibility concerns: modal focus, Escape close, keyboard reachable cancel/confirm.
- Electron boundary: existing `SessionClient.deleteMessage` route only; no new IPC.
- Existing project patterns: Vue Composition API, shadcn AlertDialog, i18n.

Diagnosis
- Root cause: destructive action is wired directly to API call at the page owner without an interaction confirmation state.
- Correct ownership layer: `ChatPage.vue` local UI state and handler split.
- Affected consumers: user and assistant message delete emits; route delete API unchanged.
- Constraints: read-only sessions must stay blocked; no per-row dialog.
- Existing pattern to reuse: `AlertDialog` primitive and current delete/rehydrate flow.

Decision
- Selected approach: split `onMessageDelete` into request + confirm path; add one controlled `AlertDialog` in `ChatPage`.
- Files to edit: `ChatPage.vue`, `dialog.json` locale files, focused renderer test.
- State impact: one local ref for pending message id; no Pinia/store change.
- DOM/layout impact: one portal-backed modal mounted by page, not row.
- Render/update impact: no new row props or per-row watchers.
- IPC/main-process impact: none.
- Verification plan: component test plus manual keyboard check.

## Implementation Details

### State

Add local state in `ChatPage.vue`:

```typescript
const pendingDeleteMessageId = ref<string | null>(null)
const showDeleteMessageDialog = computed(() => Boolean(pendingDeleteMessageId.value))
```

### Handler Split

Keep the current delete logic in a private function:

```text
requestMessageDelete(messageId)
  -> validate read-only and non-empty id
  -> pendingDeleteMessageId = messageId

confirmMessageDelete()
  -> capture pending id
  -> clear pending id
  -> re-check read-only/session/id
  -> run existing delete flow

cancelMessageDelete()
  -> pendingDeleteMessageId = null
```

The existing `@delete` listener from `MessageList` should call the request handler, not the destructive flow.

### Dialog Placement

Place the controlled `AlertDialog` once in `ChatPage.vue`, near other page-level overlays:

```vue
<AlertDialog :open="showDeleteMessageDialog" @update:open="onDeleteDialogOpenChange">
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{{ t('dialog.deleteMessage.title') }}</AlertDialogTitle>
      <AlertDialogDescription>
        {{ t('dialog.deleteMessage.description') }}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel @click="cancelMessageDelete">
        {{ t('dialog.cancel') }}
      </AlertDialogCancel>
      <AlertDialogAction @click="confirmMessageDelete">
        {{ t('dialog.deleteMessage.confirm') }}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Use the existing primitive imports from `@shadcn/components/ui/alert-dialog`.

### Session Changes

Watch `props.sessionId` or rely on existing page remount behavior. Safer minimal behavior:

```text
watch(() => props.sessionId, () => {
  pendingDeleteMessageId.value = null
})
```

No store persistence is needed.

## Tests

Use existing `test/renderer/components/ChatPage.test.ts` style:

- Trigger delete emit from `MessageList`; assert `sessionClient.deleteMessage` was not called.
- Confirm dialog action; assert delete was called with active session id and message id.
- Cancel dialog; assert delete was not called.
- Read-only session; assert request does not open dialog and delete is not called.

No main-process test is needed because the route behavior is unchanged.

## Verification

Run after implementation:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm test -- ChatPage
```

Manual check:

- Trash click opens modal.
- Escape closes modal.
- Cancel closes modal.
- Confirm deletes and rehydrates.
- Dark/light theme dialog text remains readable.
- Small window keeps buttons visible.

Skipped: undo/soft delete. Add only when users need recovery after confirmed deletion.
