import { describe, expect, it } from 'vitest'
import { findForbiddenAlertDialogClickModifiers } from '../../../scripts/alert-dialog-contract-guard.mjs'

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
