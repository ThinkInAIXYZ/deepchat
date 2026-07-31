import { describe, expect, it } from 'vitest'
import {
  findForbiddenAlertDialogClickModifiers,
  findNonSynchronousAlertDialogClickHandlers
} from '../../../scripts/alert-dialog-contract-guard.mjs'

describe('alert dialog contract guard', () => {
  it('allows ordinary, capture, and unrelated click modifiers', () => {
    expect(
      findForbiddenAlertDialogClickModifiers(`
        <AlertDialogAction @click="confirm">Confirm</AlertDialogAction>
        <AlertDialogAction @click.capture.once="audit">Confirm</AlertDialogAction>
        <AlertDialogCancel v-on:click.once="cancel">Cancel</AlertDialogCancel>
        <Button @click.prevent="submit">Submit</Button>
      `)
    ).toEqual([])
  })

  it('rejects lifecycle modifiers across multiline Action and Cancel tags', () => {
    expect(
      findForbiddenAlertDialogClickModifiers(`
        <AlertDialogAction
          :aria-label="value > 0 ? 'positive' : 'empty'"
          @click.prevent.once="confirm"
        >
          Confirm
        </AlertDialogAction>
        <AlertDialogCancel v-on:click.stop.prevent="cancel">
          Cancel
        </AlertDialogCancel>
      `)
    ).toEqual([
      {
        component: 'AlertDialogAction',
        modifier: 'prevent',
        line: 4
      },
      {
        component: 'AlertDialogCancel',
        modifier: 'stop',
        line: 8
      },
      {
        component: 'AlertDialogCancel',
        modifier: 'prevent',
        line: 8
      }
    ])
  })

  it('does not treat directive-like text outside an opening tag as a violation', () => {
    expect(
      findForbiddenAlertDialogClickModifiers(`
        <!-- AlertDialogAction @click.stop is forbidden -->
        <p>@click.prevent</p>
        <AlertDialogAction data-description="@click.stop" @click="confirm">
          Confirm
        </AlertDialogAction>
      `)
    ).toEqual([])
  })
})

describe('alert dialog synchronous-handler guard', () => {
  it('allows synchronous handlers and unrelated async functions', () => {
    expect(
      findNonSynchronousAlertDialogClickHandlers(`
        <template>
          <AlertDialogAction @click="confirm">Confirm</AlertDialogAction>
          <AlertDialogCancel :onClick="cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction @click="log('async')">Log</AlertDialogAction>
        </template>
        <script setup lang="ts">
        function confirm(): void {}
        const cancel = () => undefined
        async function unrelated(): Promise<void> {}
        </script>
      `)
    ).toEqual([])
  })

  it('rejects direct, bound, and inline async handlers', () => {
    expect(
      findNonSynchronousAlertDialogClickHandlers(`
        <template>
          <AlertDialogAction @click="confirm(item.id)">Confirm</AlertDialogAction>
          <AlertDialogCancel :onClick="cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction @click="async () => submit()">Submit</AlertDialogAction>
        </template>
        <script setup lang="ts">
        async function confirm(): Promise<void> {}
        const cancel = async () => undefined
        </script>
      `)
    ).toEqual([
      {
        component: 'AlertDialogAction',
        reason: 'async-handler',
        handler: 'confirm',
        line: 3
      },
      {
        component: 'AlertDialogCancel',
        reason: 'async-handler',
        handler: 'cancel',
        line: 4
      },
      {
        component: 'AlertDialogAction',
        reason: 'async-handler',
        handler: '<inline>',
        line: 5
      }
    ])
  })

  it('rejects opaque listener bags and async render-function handlers', () => {
    expect(
      findNonSynchronousAlertDialogClickHandlers(`
        <template>
          <AlertDialogAction v-bind="actionProps">Confirm</AlertDialogAction>
          <AlertDialogCancel v-on="listeners">Cancel</AlertDialogCancel>
        </template>
        <script setup lang="ts">
        import { h } from 'vue'
        async function confirm(): Promise<void> {}
        const rendered = () => h(AlertDialogAction, { onClick: confirm })
        const dynamic = () => h(AlertDialogCancel, actionProps)
        </script>
      `)
    ).toEqual([
      {
        component: 'AlertDialogAction',
        reason: 'opaque-listener-bag',
        line: 3
      },
      {
        component: 'AlertDialogCancel',
        reason: 'opaque-listener-bag',
        line: 4
      },
      {
        component: 'AlertDialogAction',
        reason: 'async-handler',
        handler: 'confirm',
        line: 9
      },
      {
        component: 'AlertDialogCancel',
        reason: 'dynamic-render-props',
        line: 10
      }
    ])
  })

  it('rejects dynamic event names without matching directive-like attribute values', () => {
    expect(
      findNonSynchronousAlertDialogClickHandlers(`
        <template>
          <AlertDialogAction
            data-description="Example: @[eventName]"
            @[eventNames[index]]="confirm"
          >
            Confirm
          </AlertDialogAction>
          <AlertDialogCancel v-on:[cancelEvent].once="cancel">Cancel</AlertDialogCancel>
          <Button @[eventName]="unrelated">Other</Button>
        </template>
      `)
    ).toEqual([
      {
        component: 'AlertDialogAction',
        reason: 'dynamic-template-listener',
        line: 5
      },
      {
        component: 'AlertDialogCancel',
        reason: 'dynamic-template-listener',
        line: 9
      }
    ])
  })

  it('rejects async methods and dynamic click expressions in render-function props', () => {
    expect(
      findNonSynchronousAlertDialogClickHandlers(`
        <script setup lang="ts">
        import { h } from 'vue'
        const asyncMethod = () => h(AlertDialogAction, { async onClick() {} })
        const dynamicHandler = () => h(AlertDialogCancel, { onClick: resolveHandler() })
        </script>
      `)
    ).toEqual([
      {
        component: 'AlertDialogAction',
        reason: 'async-handler',
        handler: '<inline>',
        line: 4
      },
      {
        component: 'AlertDialogCancel',
        reason: 'dynamic-render-handler',
        line: 5
      }
    ])
  })
})
