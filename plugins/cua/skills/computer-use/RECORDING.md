# Recording

Recording is controlled through DeepChat tools:

- `start_recording`
- `stop_recording`
- `get_recording_state`
- `replay_trajectory`
- `install_ffmpeg`

Enable recording before UI actions, perform the same snapshot/action/verify loop, then inspect
recording state. Replay only trajectories requested by the user or created in the current task.

`install_ffmpeg` may install or configure a dependency. Use it only after explicit user approval.
