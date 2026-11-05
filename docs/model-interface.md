# Model interface

A replay can use the vendored Great Retrofit v2 model or another model file. A model file must follow the interface below. The plugin loads the file with `importlib`, so it runs the model's code. Only point `model.path` at code you trust.

## What the file must define

- `Params`: a dataclass. The intake builds it from `model.params` with `Params(**params)`, so every key in `model.params` must be a field. A key the model does not know is rejected with a readable error.
- `run_simulation(params, on_week=None)`: runs the model and returns a result object. When `on_week` is given, the model calls it once per week, after that week's step.
- The result object has `total_weeks` and `finished`. It may also carry weekly aggregates named `weekly_to_do`, `weekly_queued`, `weekly_in_progress`, `weekly_finished`, `weekly_investor_purchases`, `weekly_gini` and `population_trajectory`. The exporter stores whichever of these exist.

`model.params` must include `n` (the number of buildings) and `run_time` (the number of weeks). Both must be positive.

## The hook

```python
on_week(t, buildings, households, coops)
```

- `t` is the week index, starting at 0.
- `buildings` is a list. Each building has an `id`, a `state` and an `owner_id`.
- `state` is one of `to_do`, `queued`, `in_progress` or `finished`. Any other value is drawn as `to_do`.
- `households` is a dict keyed by household id. A household may have `is_investor`; when it is true, the building it owns is drawn with the investor marker.
- The hook is read-only. It must not change model state and must not draw from the model's random number generator. `lab-render check` runs the model with and without the hook and fails if any result array differs.

## What `check` tests

| Check | Fails the run? |
|---|---|
| Two runs with the same seed give identical trajectories | Yes |
| The hook leaves every result array unchanged | Yes |
| Every building has exactly one state each week, with unique ids | Yes |
| Weekly aggregates add up to the building count | No, reported as WARN |
| Palettes are valid hex colours | No, reported as WARN |
| Finished buildings at the end do not exceed completions | No, reported as WARN |

A WARN does not stop the replay. Read each one and pass it on to the model's authors.

## Weeks

The exporter records `run_time` weeks, numbered 0 to `run_time - 1`. The model reports one more weekly aggregate than the hook records, so the last aggregate has no per-building state. Keyframes must fall in the recorded range.
