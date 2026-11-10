/** Legacy preference names are converted to native capabilities, never to desktop executors. */
const nativeNames: Readonly<Record<string, readonly string[]>> = {
  process: ['exec_stop'],
  question: ['ask_user'],
  deepchat_question: ['ask_user'],
  cronjob: ['schedule'],
  deepchat_subagents: ['agent'],
  subagent_orchestrator: ['agent'],
  skill_list: ['skill'],
  skill_view: ['skill'],
  skill_run: ['skill'],
  apply_patch: ['write', 'edit'],
  str_replace_editor: ['read', 'write', 'edit']
}

export function dimDisabledTools(names: readonly string[]): string[] {
  return [
    ...new Set(
      names.flatMap((name) => (Object.hasOwn(nativeNames, name) ? nativeNames[name] : [name]))
    )
  ].sort()
}
