# Recording

Recording is controlled through MCP tools:

- `set_recording`
- `get_recording_state`
- `replay_trajectory`

Enable recording before UI actions, perform the same snapshot/action/verify loop, then inspect recording state. Replay only trajectories requested by the user or created in the current task.
