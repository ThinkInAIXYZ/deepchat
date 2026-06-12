# Scheduled Tasks Real Dispatch

## Problem

Scheduled task prompt actions feel fake: `autoSend` creates a session but does not actually send the prompt to the agent, and the settings UI requires users to type raw agent/model IDs by hand.

## Expected Behavior

- `autoSend` creates a session and sends the configured message through the normal chat pipeline.
- The settings UI lists real enabled agents so users can select a target instead of guessing IDs.
- Selecting an agent carries over its default model preset when available.
